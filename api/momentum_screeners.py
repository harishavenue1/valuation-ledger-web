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

GET /api/momentum_screeners?screener=<key> — runs ONE of the 4
yfinance-based NSE-750 screeners entirely on Vercel via Vercel Cron,
instead of the matching ~/.claude/skills/<Name>/scripts/*.py on
Harish's own Mac. Folded into this file rather than 4 separate cron_*
files (the original design) — the Hobby plan's 12-Serverless-
Functions-per-deployment cap was already maxed out at exactly 12
existing endpoints, hit live 2026-08-30 trying to add just 3 new
files. Auth is the only thing that differs from the POST above: see
_cron_auth.py, checked here instead of the usual cookie gate since
cron requests carry no browser cookie.

Nifty500RelativeStrength was ported first as a pilot (2026-08-30) to
answer two open questions before porting the other 3 the same way:
does a ~750-ticker yfinance bulk download finish inside Vercel's time
budget, and does Yahoo Finance (or NSE's own archives site, fetched
for the universe list) throttle/block Vercel's datacenter IP at this
scale. Confirmed live: 750 tickers, ~91s, no blocking — so
myLongTermInvestingStrategy/weekendInvesting/quantBollinger were
ported the same way immediately after. Each screener is its own cron
entry in vercel.json hitting this same path with a different
`?screener=` value, run one at a time (never chained in one request) —
each takes roughly a minute, comfortably inside the 300s cap on its
own, but four back-to-back would not be.

Ported from each script's core logic (NSE-archives universe fetch via
the shared _ms_fetch_daily below -> screener-specific weekly indicator/
signal computation, unchanged from the original scripts) — dropping
the parquet day-cache and Excel/gdrive export from all 4 (neither
applies to a one-shot stateless cloud function; this runs once per
cron trigger, not repeatedly) and writing straight to Postgres instead
of each script's own self-POST.

An optional `?limit=N` query param caps the universe to the first N
symbols — manual testing only, never set by the real cron trigger."""
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

import numpy as np
import pandas as pd
import yfinance as yf

from _cron_auth import is_authed_cron_or_cookie
from _db import get_conn, get_meta, set_meta
from _http import read_json_body, require_auth, send_json

NSE_TOTAL_MARKET_URL = "https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv"
FETCH_CHUNK = 40


def _ms_get_universe_symbols():
    req = urllib.request.Request(NSE_TOTAL_MARKET_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    return [(r["Symbol"].strip(), r["Company Name"].strip(), r["Industry"].strip()) for r in rows]


def _ms_fetch_daily(symbols, start_iso, need_hl=False):
    """Shared chunked-yfinance-download helper — identical pattern all 4
    original scripts used with their own local parquet cache, just
    without the cache (this runs once per cron trigger, nothing to
    cache against). need_hl=True also keeps High/Low (quantBollinger's
    ATR/chandelier-stop math needs them; the other 3 only use Close)."""
    cols = ["Close", "High", "Low"] if need_hl else ["Close"]
    tickers = [f"{s}.NS" for s in symbols]
    frames = []
    for i in range(0, len(tickers), FETCH_CHUNK):
        chunk = tickers[i:i + FETCH_CHUNK]
        try:
            data = yf.download(chunk, start=start_iso, interval="1d", group_by="ticker",
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
            df = df[cols].dropna()
            if df.empty:
                continue
            df["symbol"] = t.replace(".NS", "")
            frames.append(df)
    if not frames:
        return None
    combined = pd.concat(frames)
    combined.index.name = "date"
    return combined.reset_index()


# ── Nifty500RelativeStrength ────────────────────────────────────────────────

RS_BENCHMARK_TICKER = "^CRSLDX"  # Yahoo Finance's NIFTY 500 index symbol
RS_FETCH_MONTHS_BUFFER = 9
RS_WEIGHTS = {"rs_1w": 0.10, "rs_1m": 0.40, "rs_3m": 0.30, "rs_6m": 0.20}
RS_TOP_N = 30
RS_MIN_HISTORY_DAYS = 35


def _rs_fetch_benchmark():
    start = (date.today() - timedelta(days=30 * RS_FETCH_MONTHS_BUFFER)).isoformat()
    df = yf.download(RS_BENCHMARK_TICKER, start=start, interval="1d", progress=False, auto_adjust=True)
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


def _run_rs(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=30 * RS_FETCH_MONTHS_BUFFER)).isoformat()
    daily = _ms_fetch_daily(symbols, start)
    bench_df = _rs_fetch_benchmark()
    if daily is None or bench_df.empty:
        return None, "no data fetched from yfinance"

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
    return {"label": "RS (NSE750)", "push_rows": rows[:RS_TOP_N], "scanned": len(rows), "skipped": len(skipped)}, None


# ── myLongTermInvestingStrategy ─────────────────────────────────────────────

LTIS_RSI_PERIOD = 14
LTIS_RSI_THRESHOLD = 66
LTIS_EMA_PERIODS = [12, 21, 33]
LTIS_EXIT_EMA = 33
LTIS_FETCH_YEARS = 4
LTIS_MIN_HISTORY_WEEKS = max(LTIS_EMA_PERIODS) + LTIS_RSI_PERIOD + 10


def _ltis_weekly_indicators(g):
    weekly = g.resample("W-FRI").agg({"Close": "last"}).dropna()
    close = weekly["Close"]
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1 / LTIS_RSI_PERIOD, min_periods=LTIS_RSI_PERIOD, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / LTIS_RSI_PERIOD, min_periods=LTIS_RSI_PERIOD, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - 100 / (1 + rs)
    rsi = rsi.where(avg_loss != 0, 100.0)

    df = pd.DataFrame({"close": close, "rsi14": rsi})
    for p in LTIS_EMA_PERIODS:
        df[f"ema{p}"] = close.ewm(span=p, adjust=False).mean()
    return df


def _ltis_signal_asof(weekly_df, asof_date):
    w = weekly_df[weekly_df.index.date <= asof_date]
    if len(w) < LTIS_MIN_HISTORY_WEEKS:
        return None
    row = w.iloc[-1]
    if pd.isna(row["rsi14"]) or any(pd.isna(row[f"ema{p}"]) for p in LTIS_EMA_PERIODS):
        return None
    close = row["close"]
    ribbon_ok = all(close > row[f"ema{p}"] for p in LTIS_EMA_PERIODS)
    signal = bool(row["rsi14"] > LTIS_RSI_THRESHOLD and ribbon_ok)
    return {
        "as_of": w.index[-1].strftime("%Y-%m-%d"), "close": round(close, 2),
        "rsi14": round(row["rsi14"], 2),
        "ema12": round(row["ema12"], 2), "ema21": round(row["ema21"], 2), "ema33": round(row["ema33"], 2),
        "pct_above_ema33": round((close / row[f"ema{LTIS_EXIT_EMA}"] - 1) * 100, 2),
        "signal": signal,
    }


def _run_ltis(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=365 * LTIS_FETCH_YEARS)).isoformat()
    daily = _ms_fetch_daily(symbols, start)
    if daily is None:
        return None, "no data fetched from yfinance"

    today = date.today()
    rows, skipped = [], []
    for sym, g in daily.groupby("symbol"):
        wdf = _ltis_weekly_indicators(g.set_index("date"))
        if len(wdf) < LTIS_MIN_HISTORY_WEEKS:
            skipped.append(sym)
            continue
        res = _ltis_signal_asof(wdf, today)
        if res is None:
            skipped.append(sym)
            continue
        res["symbol"] = sym
        res["name"] = name_map.get(sym, sym)
        res["sector"] = sector_map.get(sym, "")
        rows.append(res)

    signals = [r for r in rows if r["signal"]]
    signals.sort(key=lambda r: -r["rsi14"])
    return {"label": "myLongTermInvestingStrategy", "push_rows": signals, "scanned": len(rows), "skipped": len(skipped)}, None


# ── weekendInvesting ─────────────────────────────────────────────────────────

WI_TOP_N = 20
WI_LOOKBACK_WEEKS = 52
WI_FETCH_MONTHS_BUFFER = 15
WI_WATCHLIST_EXTRA = 20


def _wi_resample_weekly(daily_df):
    daily_df = daily_df.set_index("date")
    weekly = daily_df.resample("W-FRI").agg({"Close": "last"}).dropna()
    if len(weekly) and daily_df.index.max() < weekly.index[-1] - timedelta(days=4):
        weekly = weekly.iloc[:-1]
    return weekly


def _wi_compute_rank_row(weekly):
    if len(weekly) < WI_LOOKBACK_WEEKS + 4:
        return None
    close = weekly["Close"]
    last_close = close.iloc[-1]
    base_close = close.iloc[-1 - WI_LOOKBACK_WEEKS]
    if pd.isna(last_close) or pd.isna(base_close) or base_close <= 0:
        return None
    roc_1y = (last_close / base_close - 1) * 100
    return {
        "as_of": weekly.index[-1].strftime("%Y-%m-%d"),
        "close": round(last_close, 2),
        "close_52w_ago": round(base_close, 2),
        "roc_1y_pct": round(roc_1y, 2),
        "weeks_of_history": len(weekly),
    }


def _run_weekend_investing(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=30 * WI_FETCH_MONTHS_BUFFER)).isoformat()
    daily = _ms_fetch_daily(symbols, start)
    if daily is None:
        return None, "no data fetched from yfinance"

    rows, skipped = [], []
    for sym, g in daily.groupby("symbol"):
        weekly = _wi_resample_weekly(g[["date", "Close"]])
        res = _wi_compute_rank_row(weekly)
        if res is None:
            skipped.append(sym)
            continue
        res["symbol"] = sym
        res["name"] = name_map.get(sym, sym)
        res["sector"] = sector_map.get(sym, "")
        rows.append(res)

    rows.sort(key=lambda r: -r["roc_1y_pct"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    top20 = rows[:WI_TOP_N]
    watchlist = rows[WI_TOP_N:WI_TOP_N + WI_WATCHLIST_EXTRA]
    return {"label": "weekendInvesting", "push_rows": top20 + watchlist, "scanned": len(rows), "skipped": len(skipped)}, None


# ── quantBollinger ───────────────────────────────────────────────────────────

QB_MID_WINDOW = 55
QB_BAND_SD = 3.7
QB_TRAIL_MA_WEEKS = 34
QB_ATR_WINDOW = 14
QB_ATR_MULT = 1.8
QB_INITIAL_STOP_PCT = 0.20
QB_MAX_PORTFOLIO = 25
QB_MIN_HISTORY_WEEKS = QB_MID_WINDOW + 15
QB_FETCH_YEARS = 4


def _qb_resample_weekly(daily_df):
    daily_df = daily_df.set_index("date")
    weekly = daily_df.resample("W-FRI").agg({"Close": "last", "High": "max", "Low": "min"})
    weekly = weekly.dropna(how="all")
    if len(weekly) and daily_df.index.max() < weekly.index[-1] - timedelta(days=4):
        weekly = weekly.iloc[:-1]
    return weekly


def _qb_compute_signal(weekly):
    if len(weekly) < QB_MIN_HISTORY_WEEKS:
        return None
    close = weekly["Close"]
    mid = close.rolling(QB_MID_WINDOW).mean()
    std = close.rolling(QB_MID_WINDOW).std()
    upper = mid + QB_BAND_SD * std
    ma34 = close.rolling(QB_TRAIL_MA_WEEKS).mean()

    prev_close = close.shift(1)
    tr = pd.concat([
        weekly["High"] - weekly["Low"],
        (weekly["High"] - prev_close).abs(),
        (weekly["Low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(QB_ATR_WINDOW).mean()

    last_close = close.iloc[-1]
    last_upper = upper.iloc[-1]
    last_mid = mid.iloc[-1]
    last_std = std.iloc[-1]
    last_ma34 = ma34.iloc[-1]
    last_atr = atr.iloc[-1]
    if pd.isna(last_upper) or pd.isna(last_ma34) or pd.isna(last_atr):
        return None

    signal = last_close > last_upper
    rs55 = None
    if len(close) > QB_MID_WINDOW:
        base = close.iloc[-QB_MID_WINDOW - 1]
        if base and not pd.isna(base) and base > 0:
            rs55 = round((last_close / base - 1) * 100, 2)

    chandelier = last_close - QB_ATR_MULT * last_atr
    initial_stop = last_close * (1 - QB_INITIAL_STOP_PCT)
    return {
        "as_of": weekly.index[-1].strftime("%Y-%m-%d"),
        "close": round(last_close, 2),
        "sma55": round(last_mid, 2),
        "std55": round(last_std, 2),
        "upper_band": round(last_upper, 2),
        "pct_above_band": round((last_close / last_upper - 1) * 100, 2),
        "signal": bool(signal),
        "rs55_pct": rs55,
        "sma34": round(last_ma34, 2),
        "pct_vs_sma34": round((last_close / last_ma34 - 1) * 100, 2),
        "atr14": round(last_atr, 2),
        "chandelier_stop": round(chandelier, 2),
        "initial_stop_20pct": round(initial_stop, 2),
        "weeks_of_history": len(weekly),
    }


def _run_quant_bollinger(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=365 * QB_FETCH_YEARS)).isoformat()
    daily = _ms_fetch_daily(symbols, start, need_hl=True)
    if daily is None:
        return None, "no data fetched from yfinance"

    rows, skipped = [], []
    for sym, g in daily.groupby("symbol"):
        weekly = _qb_resample_weekly(g[["date", "Close", "High", "Low"]])
        res = _qb_compute_signal(weekly)
        if res is None:
            skipped.append(sym)
            continue
        res["symbol"] = sym
        res["name"] = name_map.get(sym, sym)
        res["sector"] = sector_map.get(sym, "")
        rows.append(res)

    signals = [r for r in rows if r["signal"]]
    signals.sort(key=lambda r: (r["rs55_pct"] is None, -(r["rs55_pct"] or -999)))
    kept = signals[:QB_MAX_PORTFOLIO]
    return {"label": "quantBollinger", "push_rows": kept, "scanned": len(rows), "skipped": len(skipped)}, None


SCREENER_RUNNERS = {
    "Nifty500RelativeStrength": _run_rs,
    "myLongTermInvestingStrategy": _run_ltis,
    "weekendInvesting": _run_weekend_investing,
    "quantBollinger": _run_quant_bollinger,
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
        if not is_authed_cron_or_cookie(self):
            send_json(self, 401, {"error": "unauthorized"})
            return

        query = parse_qs(urlparse(self.path).query)
        screener = (query.get("screener") or [None])[0]
        runner = SCREENER_RUNNERS.get(screener)
        if not runner:
            send_json(self, 400, {"error": f"?screener= must be one of {sorted(SCREENER_RUNNERS)}"})
            return

        limit = None
        if query.get("limit"):
            try:
                limit = int(query["limit"][0])
            except ValueError:
                limit = None

        start_t = time.monotonic()
        try:
            constituents = _ms_get_universe_symbols()
        except Exception as e:
            send_json(self, 502, {"error": f"NSE universe fetch failed: {e}"})
            return
        symbols = [c[0] for c in constituents]
        name_map = {c[0]: c[1] for c in constituents}
        sector_map = {c[0]: c[2] for c in constituents}
        if limit:
            symbols = symbols[:limit]

        try:
            result, err = runner(symbols, name_map, sector_map)
        except Exception as e:
            send_json(self, 502, {"error": f"{screener} failed: {e}"})
            return
        if err:
            send_json(self, 502, {"error": err})
            return

        conn = get_conn()
        try:
            all_screeners = get_meta(conn, "momentum_screeners", {})
            all_screeners[screener] = {
                "label": result["label"],
                "as_of": date.today().isoformat(),
                "rows": result["push_rows"],
            }
            set_meta(conn, "momentum_screeners", all_screeners)
        finally:
            conn.close()

        send_json(self, 200, {
            "ok": True,
            "screener": screener,
            "universe": len(symbols),
            "scanned": result["scanned"],
            "skipped": result["skipped"],
            "pushed": len(result["push_rows"]),
            "elapsed_s": round(time.monotonic() - start_t, 1),
        })
