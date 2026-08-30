"""GET /api/cron_screener_rs — PILOT: runs the Nifty500RelativeStrength
momentum screener entirely on Vercel, triggered by Vercel Cron, instead
of ~/.claude/skills/Nifty500RelativeStrength/scripts/nifty500_rs_screener.py
on Harish's own Mac.

This is explicitly a pilot for ONE of the 4 yfinance-based NSE-750
screeners (the others are myLongTermInvestingStrategy, weekendInvesting,
quantBollinger — not yet ported). run_requests.py's own docstring
already flags the two open questions this pilot exists to answer before
the other 3 get the same treatment: does a ~750-ticker yfinance bulk
download actually complete within Vercel's function time budget, and
does Yahoo Finance's known tendency to throttle/block datacenter IPs
bite at this scale in practice (rather than in theory). NSE's own
archives site (fetched for the universe list below) is a second,
separate unknown — it's historically been aggressive about blocking
non-browser traffic, independent of the Yahoo question.

Ported from nifty500_rs_screener.py's core logic (get_universe_symbols
-> fetch_all_daily -> fetch_benchmark -> returns_for/RS scoring) with
three deliberate drops, all inapplicable to a stateless cloud function:
  - No parquet day-cache (fetch_all_daily/fetch_benchmark) — this runs
    once per cron trigger, not repeatedly, so there's nothing to cache
    against.
  - No Excel export / rclone gdrive upload — no persistent disk and no
    rclone binary on Vercel; the ledger's Momentum Screeners tab is the
    delivery mechanism here, not a spreadsheet.
  - Writes straight to Postgres via set_meta("momentum_screeners", ...)
    instead of doing an HTTP POST to this same app's own /api/
    momentum_screeners — one process, no self-referential round trip.

Same CRON_SECRET auth as cron_refresh_prices.py/cron_refresh_full.py.

An optional `?limit=N` query param caps the universe to the first N
symbols — manual pilot testing only (confirms the NSE-archives fetch
and yfinance both work from Vercel's network before committing to a
full 750-ticker run), never set by the real cron trigger."""
import csv
import io
import os
import sys
import time
import urllib.request
import warnings
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

warnings.filterwarnings("ignore")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import yfinance as yf

from _db import get_conn, get_meta, set_meta
from _http import send_json

NSE_TOTAL_MARKET_URL = "https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv"
BENCHMARK_TICKER = "^CRSLDX"  # Yahoo Finance's NIFTY 500 index symbol
FETCH_MONTHS_BUFFER = 9
CHUNK = 40
RS_WEIGHTS = {"rs_1w": 0.10, "rs_1m": 0.40, "rs_3m": 0.30, "rs_6m": 0.20}
TOP_N = 30
MIN_HISTORY_DAYS = 35


def _is_authed_cron(handler) -> bool:
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return False
    header = handler.headers.get("Authorization", "")
    return header == f"Bearer {secret}"


def get_universe_symbols():
    req = urllib.request.Request(NSE_TOTAL_MARKET_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    return [(r["Symbol"].strip(), r["Company Name"].strip(), r["Industry"].strip()) for r in rows]


def fetch_all_daily(symbols):
    tickers = [f"{s}.NS" for s in symbols]
    start = (date.today() - timedelta(days=30 * FETCH_MONTHS_BUFFER)).isoformat()
    frames = []
    for i in range(0, len(tickers), CHUNK):
        chunk = tickers[i:i + CHUNK]
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


def fetch_benchmark():
    start = (date.today() - timedelta(days=30 * FETCH_MONTHS_BUFFER)).isoformat()
    df = yf.download(BENCHMARK_TICKER, start=start, interval="1d", progress=False, auto_adjust=True)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Close"]].dropna()
    df.index.name = "date"
    return df.reset_index()


def to_records(df_slice):
    out = []
    for _, row in df_slice.sort_values("date").iterrows():
        d = row["date"]
        d = d.date() if hasattr(d, "date") else d
        out.append({"date": d.isoformat() if hasattr(d, "isoformat") else str(d), "close": float(row["Close"])})
    return out


def nearest_on_or_before(data, target_date):
    best = None
    for row in data:
        d = datetime.strptime(row["date"], "%Y-%m-%d").date()
        if d <= target_date:
            if best is None or d > datetime.strptime(best["date"], "%Y-%m-%d").date():
                best = row
    return best


def pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return round((a / b - 1) * 100, 2)


def returns_for(data, last_date):
    data = sorted(data, key=lambda r: r["date"])
    last = data[-1]
    w1 = nearest_on_or_before(data, last_date - timedelta(days=7))
    m1 = nearest_on_or_before(data, last_date - timedelta(days=30))
    m3 = nearest_on_or_before(data, last_date - timedelta(days=90))
    m6 = nearest_on_or_before(data, last_date - timedelta(days=180))
    return {
        "last_close": last["close"], "last_date": last["date"],
        "r_1w": pct(last["close"], w1["close"] if w1 else None),
        "r_1m": pct(last["close"], m1["close"] if m1 else None),
        "r_3m": pct(last["close"], m3["close"] if m3 else None),
        "r_6m": pct(last["close"], m6["close"] if m6 else None),
        "data": data, "span_days": (datetime.strptime(data[-1]["date"], "%Y-%m-%d").date()
                                     - datetime.strptime(data[0]["date"], "%Y-%m-%d").date()).days,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not _is_authed_cron(self):
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
            constituents = get_universe_symbols()
        except Exception as e:
            send_json(self, 502, {"error": f"NSE universe fetch failed: {e}"})
            return
        symbols = [c[0] for c in constituents]
        name_map = {c[0]: c[1] for c in constituents}
        sector_map = {c[0]: c[2] for c in constituents}
        if limit:
            symbols = symbols[:limit]

        try:
            daily = fetch_all_daily(symbols)
            bench_df = fetch_benchmark()
        except Exception as e:
            send_json(self, 502, {"error": f"yfinance fetch failed: {e}"})
            return
        if daily is None or bench_df.empty:
            send_json(self, 502, {"error": "no data fetched from yfinance"})
            return

        stocks_data = {sym: to_records(g) for sym, g in daily.groupby("symbol")}
        bench_data = sorted(to_records(bench_df), key=lambda r: r["date"])
        last_date = datetime.strptime(bench_data[-1]["date"], "%Y-%m-%d").date()
        bench = returns_for(bench_data, last_date)
        bench_by_date = {r["date"]: r["close"] for r in bench["data"]}

        rows, skipped = [], []
        for symbol, sdata in stocks_data.items():
            if not sdata:
                skipped.append(symbol)
                continue
            s = returns_for(sdata, last_date)
            if s["span_days"] < MIN_HISTORY_DAYS:
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
        top = rows[:TOP_N]

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
