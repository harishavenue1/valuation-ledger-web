"""POST /api/momentum_screeners — pushed by 4 local skill scripts after
each run (myLongTermInvestingStrategy, weekendInvesting, quantBollinger,
Nifty500RelativeStrength — all now NSE 750-scoped), one push per
screener: {"screener": "<key>", "label": "<display name>",
"as_of": "YYYY-MM-DD", "rows": [...]}. Row shape differs per screener
(each has its own columns) — stored and returned as-is, the frontend
renders each tab according to its own known fields. Unlike
guidance_tracker/viraj_screen (single blob, whole-thing overwritten
each save), this upserts just the one screener's key within the
stored dict, since the 4 scripts run independently on their own
schedules and shouldn't clobber each other's latest data.
Read back as part of the /api/stocks bundle (bundle.momentum_screeners).

GET /api/momentum_screeners — PILOT: runs the Nifty500RelativeStrength
screener entirely on Vercel via Vercel Cron, instead of
~/.claude/skills/Nifty500RelativeStrength/scripts/nifty500_rs_screener.py
on Harish's own Mac. Folded into this file rather than its own
cron_screener_rs.py (a separate file was the original design, but the
Hobby plan's 12-Serverless-Functions-per-deployment cap was already
maxed out — hit live 2026-08-30) — auth is the only thing that
differs: see _cron_auth.py, checked here instead of the usual cookie
gate since cron requests carry no browser cookie.

Explicitly a pilot for ONE of the 4 yfinance-based NSE-750 screeners
(myLongTermInvestingStrategy/weekendInvesting/quantBollinger not yet
ported) — answers two open questions before porting the other 3 the
same way: does a ~750-ticker yfinance bulk download finish inside
Vercel's time budget, and does Yahoo Finance (or NSE's own archives
site, fetched for the universe list) throttle/block Vercel's
datacenter IP at this scale. Not yet wired into vercel.json's "crons";
triggered manually via curl until proven live.

Ported from nifty500_rs_screener.py's core logic (NSE-archives universe
fetch -> chunked yfinance daily download -> benchmark-relative RS
scoring), dropping the parquet day-cache and Excel/gdrive export
(neither applies to a one-shot stateless cloud function) and writing
straight to Postgres instead of a self-POST.

An optional `?limit=N` query param caps the universe to the first N
symbols — manual pilot testing only, never set by the real cron
trigger."""
import csv
import io
import os
import sys
import time
import urllib.request
import warnings
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlparse

warnings.filterwarnings("ignore")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http.server import BaseHTTPRequestHandler

import pandas as pd
import yfinance as yf

from _cron_auth import is_authed_cron
from _db import get_conn, get_meta, set_meta
from _http import read_json_body, require_auth, send_json

NSE_TOTAL_MARKET_URL = "https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv"
BENCHMARK_TICKER = "^CRSLDX"  # Yahoo Finance's NIFTY 500 index symbol
FETCH_MONTHS_BUFFER = 9
RS_CHUNK = 40
RS_WEIGHTS = {"rs_1w": 0.10, "rs_1m": 0.40, "rs_3m": 0.30, "rs_6m": 0.20}
RS_TOP_N = 30
RS_MIN_HISTORY_DAYS = 35


def _rs_get_universe_symbols():
    req = urllib.request.Request(NSE_TOTAL_MARKET_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    return [(r["Symbol"].strip(), r["Company Name"].strip(), r["Industry"].strip()) for r in rows]


def _rs_fetch_all_daily(symbols):
    tickers = [f"{s}.NS" for s in symbols]
    start = (date.today() - timedelta(days=30 * FETCH_MONTHS_BUFFER)).isoformat()
    frames = []
    for i in range(0, len(tickers), RS_CHUNK):
        chunk = tickers[i:i + RS_CHUNK]
        try:
            data = yf.download(chunk, start=start, interval="1d", group_by="ticker",
                                threads=True, progress=False, auto_adjust=True)
        except Exception:
            continue
        for t in chunk:
            try:
                df = data[t] if isinstance(data.columns, pd.MultiIndex) else data
            except KeyError:
                continue
            df = df.dropna(how="all")
            if df.empty or "Close" not in df:
                continue
            df = df[["Close"]].dropna()
            if df.empty:
                continue
            df["symbol"] = t.replace(".NS", "")
            frames.append(df)
    if not frames:
        return None
    combined = pd.concat(frames)
    combined.index.name = "date"
    return combined.reset_index()


def _rs_fetch_benchmark():
    start = (date.today() - timedelta(days=30 * FETCH_MONTHS_BUFFER)).isoformat()
    df = yf.download(BENCHMARK_TICKER, start=start, interval="1d", progress=False, auto_adjust=True)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Close"]].dropna()
    df.index.name = "date"
    return df.reset_index()


def _rs_to_records(df_slice):
    out = []
    for _, row in df_slice.sort_values("date").iterrows():
        d = row["date"]
        d = d.date() if hasattr(d, "date") else d
        out.append({"date": d.isoformat() if hasattr(d, "isoformat") else str(d), "close": float(row["Close"])})
    return out


def _rs_nearest_on_or_before(data, target_date):
    best = None
    for row in data:
        d = datetime.strptime(row["date"], "%Y-%m-%d").date()
        if d <= target_date:
            if best is None or d > datetime.strptime(best["date"], "%Y-%m-%d").date():
                best = row
    return best


def _rs_pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return round((a / b - 1) * 100, 2)


def _rs_returns_for(data, last_date):
    data = sorted(data, key=lambda r: r["date"])
    last = data[-1]
    w1 = _rs_nearest_on_or_before(data, last_date - timedelta(days=7))
    m1 = _rs_nearest_on_or_before(data, last_date - timedelta(days=30))
    m3 = _rs_nearest_on_or_before(data, last_date - timedelta(days=90))
    m6 = _rs_nearest_on_or_before(data, last_date - timedelta(days=180))
    return {
        "last_close": last["close"], "last_date": last["date"],
        "r_1w": _rs_pct(last["close"], w1["close"] if w1 else None),
        "r_1m": _rs_pct(last["close"], m1["close"] if m1 else None),
        "r_3m": _rs_pct(last["close"], m3["close"] if m3 else None),
        "r_6m": _rs_pct(last["close"], m6["close"] if m6 else None),
        "data": data, "span_days": (datetime.strptime(data[-1]["date"], "%Y-%m-%d").date()
                                     - datetime.strptime(data[0]["date"], "%Y-%m-%d").date()).days,
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        screener = body.get("screener")
        if not isinstance(screener, str) or not screener:
            send_json(self, 400, {"error": "screener (string) is required"})
            return
        if not isinstance(body.get("rows"), list) or not isinstance(body.get("as_of"), str):
            send_json(self, 400, {"error": "as_of (string) and rows (list) are required"})
            return
        conn = get_conn()
        try:
            all_screeners = get_meta(conn, "momentum_screeners", {})
            all_screeners[screener] = {
                "label": body.get("label", screener),
                "as_of": body["as_of"],
                "rows": body["rows"],
            }
            set_meta(conn, "momentum_screeners", all_screeners)
            send_json(self, 200, {"ok": True, "count": len(body["rows"])})
        finally:
            conn.close()

    def do_GET(self):
        if not is_authed_cron(self):
            send_json(self, 401, {"error": "unauthorized"})
            return

        limit = None
        query = parse_qs(urlparse(self.path).query)
        if query.get("limit"):
            try:
                limit = int(query["limit"][0])
            except ValueError:
                limit = None

        start_t = time.monotonic()
        try:
            constituents = _rs_get_universe_symbols()
        except Exception as e:
            send_json(self, 502, {"error": f"NSE universe fetch failed: {e}"})
            return
        symbols = [c[0] for c in constituents]
        name_map = {c[0]: c[1] for c in constituents}
        sector_map = {c[0]: c[2] for c in constituents}
        if limit:
            symbols = symbols[:limit]

        try:
            daily = _rs_fetch_all_daily(symbols)
            bench_df = _rs_fetch_benchmark()
        except Exception as e:
            send_json(self, 502, {"error": f"yfinance fetch failed: {e}"})
            return
        if daily is None or bench_df.empty:
            send_json(self, 502, {"error": "no data fetched from yfinance"})
            return

        stocks_data = {sym: _rs_to_records(g) for sym, g in daily.groupby("symbol")}
        bench_data = sorted(_rs_to_records(bench_df), key=lambda r: r["date"])
        last_date = datetime.strptime(bench_data[-1]["date"], "%Y-%m-%d").date()
        bench = _rs_returns_for(bench_data, last_date)
        bench_by_date = {r["date"]: r["close"] for r in bench["data"]}

        rows, skipped = [], []
        for symbol, sdata in stocks_data.items():
            if not sdata:
                skipped.append(symbol)
                continue
            s = _rs_returns_for(sdata, last_date)
            if s["span_days"] < RS_MIN_HISTORY_DAYS:
                skipped.append(symbol)
                continue

            rs_1w = None if s["r_1w"] is None or bench["r_1w"] is None else round(s["r_1w"] - bench["r_1w"], 2)
            rs_1m = None if s["r_1m"] is None or bench["r_1m"] is None else round(s["r_1m"] - bench["r_1m"], 2)
            rs_3m = None if s["r_3m"] is None or bench["r_3m"] is None else round(s["r_3m"] - bench["r_3m"], 2)
            rs_6m = None if s["r_6m"] is None or bench["r_6m"] is None else round(s["r_6m"] - bench["r_6m"], 2)

            rs_parts = {"rs_1w": rs_1w, "rs_1m": rs_1m, "rs_3m": rs_3m, "rs_6m": rs_6m}
            available = {k: v for k, v in rs_parts.items() if v is not None}
            if not available:
                skipped.append(symbol)
                continue
            wsum = sum(RS_WEIGHTS[k] for k in available)
            rs_score = round(sum(v * RS_WEIGHTS[k] for k, v in available.items()) / wsum, 2)

            stock_by_date = {r["date"]: r["close"] for r in s["data"]}
            common_dates = sorted(d for d in stock_by_date if d in bench_by_date)
            if common_dates:
                base_ratio = stock_by_date[common_dates[0]] / bench_by_date[common_dates[0]]
                rs_line_vals = [(stock_by_date[d] / bench_by_date[d]) / base_ratio * 100 for d in common_dates]
                rs_new_high = rs_line_vals[-1] >= max(rs_line_vals)
            else:
                rs_new_high = False

            rows.append({
                "symbol": symbol, "name": name_map.get(symbol, symbol), "sector": sector_map.get(symbol, ""),
                "price": s["last_close"], "as_of": s["last_date"],
                "r_1w": s["r_1w"], "r_1m": s["r_1m"], "r_3m": s["r_3m"], "r_6m": s["r_6m"],
                "rs_1w": rs_1w, "rs_1m": rs_1m, "rs_3m": rs_3m, "rs_6m": rs_6m,
                "rs_score": rs_score, "rs_new_high": rs_new_high,
            })

        rows.sort(key=lambda r: -r["rs_score"])
        for i, r in enumerate(rows, 1):
            r["rank"] = i
        top = rows[:RS_TOP_N]

        conn = get_conn()
        try:
            all_screeners = get_meta(conn, "momentum_screeners", {})
            all_screeners["Nifty500RelativeStrength"] = {
                "label": "RS (NSE750)",
                "as_of": date.today().isoformat(),
                "rows": top,
            }
            set_meta(conn, "momentum_screeners", all_screeners)
        finally:
            conn.close()

        send_json(self, 200, {
            "ok": True,
            "universe": len(symbols),
            "scored": len(rows),
            "skipped": len(skipped),
            "pushed": len(top),
            "elapsed_s": round(time.monotonic() - start_t, 1),
        })
