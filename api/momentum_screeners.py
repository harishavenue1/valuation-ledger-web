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


def _ms_fetch_daily(symbols, start_iso, need_hl=False, need_ohlc=False):
    """Shared chunked-yfinance-download helper — identical pattern all 4
    original scripts used with their own local parquet cache, just
    without the cache (this runs once per cron trigger, nothing to
    cache against). need_hl=True also keeps High/Low (quantBollinger's
    ATR/chandelier-stop math needs them; the other 3 only use Close).
    need_ohlc=True keeps Open too (maBreakout computes its EMAs on
    OHLC4 = (O+H+L+C)/4 per Harish's standing EMA rule — see
    feedback_ema_ohlc4_source.md — not Close alone)."""
    cols = ["Open", "High", "Low", "Close"] if need_ohlc else (["Close", "High", "Low"] if need_hl else ["Close"])
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


# ── nseScreener ──────────────────────────────────────────────────────────────
#
# Day/Week/Month/3Month/Year % change + Wilder RSI(D/W/M) + 3-week-
# green flag, ported from ~/.claude/skills/NseScreener/scripts/
# nse_screener.py. One deliberate deviation from that script (and from
# this file's own RS/momentum_screeners naming — this section is
# "_nse_" not "_ns_" to avoid colliding with the unrelated NSE_
# constants elsewhere): the original does 3 SEPARATE yfinance pulls
# (daily/weekly/monthly intervals) per run. Three full 750-ticker bulk
# downloads back to back risked actually exceeding Vercel's 300s cap
# outright (each of the 4 single-fetch screeners already took ~90-100s
# alone) — a silent kill with no partial result, worse than a small
# fidelity gap. So this fetches ONE 5-year daily series (covers both
# the 2y window the original's weekly fetch used and the 5y window its
# monthly fetch used) and derives weekly/monthly via pandas resample
# instead — same "resample from one daily fetch" technique
# weekendInvesting/quantBollinger/myLongTermInvestingStrategy already
# use in this same file. Verified live (2026-08-30, TITAN) that
# resampled Close values match yfinance's own native weekly/monthly
# bars — both are just "last close in the period", so the numbers
# don't move, only the network cost does (1 download instead of 3).

NSE_RSI_MIN_DAILY = 30
NSE_RSI_MIN_WEEKLY = 20
NSE_RSI_MIN_MONTHLY = 15
NSE_FETCH_YEARS = 5
NSE_STALE_DAYS = 5  # matches build_row()'s own staleness guard


def _nse_wilder_rsi(series, length=14):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.iloc[1:length + 1].mean()
    avg_loss = loss.iloc[1:length + 1].mean()
    for g, l in zip(gain.iloc[length + 1:], loss.iloc[length + 1:]):
        avg_gain = (avg_gain * (length - 1) + g) / length
        avg_loss = (avg_loss * (length - 1) + l) / length
    if avg_loss == 0:
        return 100.0
    return round(100 - 100 / (1 + avg_gain / avg_loss), 2)


def _nse_pct(cd, idx):
    if len(cd) > abs(idx):
        old = float(cd.iloc[idx])
        current = float(cd.iloc[-1])
        return round((current - old) / old * 100, 2) if old else None
    return None


def _nse_pct_since(cd, offset):
    current_date = cd.index[-1]
    current = float(cd.iloc[-1])
    target = current_date - offset
    past = cd[cd.index <= target]
    if past.empty:
        return None
    old = float(past.iloc[-1])
    return round((current - old) / old * 100, 2) if old else None


def _nse_build_row(symbol, name, sector, cd, cw, cm):
    if cd is None or len(cd) < 20:
        return None
    last_date = cd.index[-1].date()
    if (date.today() - last_date).days > NSE_STALE_DAYS:
        return None

    rsi_w, green_3w = None, False
    if cw is not None and len(cw) >= NSE_RSI_MIN_WEEKLY:
        rsi_w = _nse_wilder_rsi(cw)
    if cw is not None and len(cw) >= 4:
        green_3w = bool(all(float(cw.iloc[i]) > float(cw.iloc[i - 1]) for i in [-3, -2, -1]))

    rsi_m = _nse_wilder_rsi(cm) if (cm is not None and len(cm) >= NSE_RSI_MIN_MONTHLY) else None

    return {
        "symbol": symbol, "name": name, "sector": sector,
        "price": round(float(cd.iloc[-1]), 2),
        "as_of": last_date.isoformat(),
        "change_pct": _nse_pct(cd, -2),
        "weekly_pct": _nse_pct(cd, -6),
        "monthly_pct": _nse_pct_since(cd, pd.DateOffset(months=1)),
        "three_month_pct": _nse_pct_since(cd, pd.DateOffset(months=3)),
        "yearly_pct": _nse_pct_since(cd, pd.DateOffset(years=1)),
        "rsi_d": _nse_wilder_rsi(cd) if len(cd) >= NSE_RSI_MIN_DAILY else None,
        "rsi_w": rsi_w,
        "rsi_m": rsi_m,
        "three_week_green": green_3w,
    }


def _run_nse_screener(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=365 * NSE_FETCH_YEARS)).isoformat()
    daily = _ms_fetch_daily(symbols, start)
    if daily is None:
        return None, "no data fetched from yfinance"

    rows, skipped = [], []
    for sym, g in daily.groupby("symbol"):
        cd = g.set_index("date")["Close"]
        cw = cd.resample("W-FRI").last().dropna()
        cm = cd.resample("ME").last().dropna()
        r = _nse_build_row(sym, name_map.get(sym, sym), sector_map.get(sym, ""), cd, cw, cm)
        if r is None:
            skipped.append(sym)
            continue
        rows.append(r)

    rows.sort(key=lambda r: -(r["change_pct"] or -999))
    return {"label": "NSE Screener", "push_rows": rows, "scanned": len(rows), "skipped": len(skipped)}, None


# ── sectorAlpha ──────────────────────────────────────────────────────────────
#
# Sector rotation screen: alpha (sector return minus NIFTY 500 return)
# across 1M/3M/6M/1Y for NSE's canonical sectors — added 2026-08-30 at
# Harish's request after a Vijay Thakkar video ("Monthly Analysis"
# series) on identifying strong sectors; the video's transcript wasn't
# actually reachable (no tool here can pull YouTube captions), so the
# exact definition was confirmed directly with Harish instead of
# guessed at: alpha = sector return - NIFTY 500 return, same
# methodology his existing SectorRelativeStrength skill already uses
# (that skill's 1W/1M/3M/6M, extended here to 1M/3M/6M/1Y per his ask).
#
# Data source is the one real deviation from that skill: it reads
# sector INDEX prices from Zerodha Kite (Harish's private, authenticated
# API — not something to run from Vercel). Checked live before building
# anything: yfinance's own NSE sectoral INDEX tickers (^CNXAUTO,
# ^CNXFMCG, etc.) are stale — several hadn't updated in 6+ weeks when
# checked. Liquid NSE-listed sector ETFs (BANKBEES, ITBEES, PHARMABEES,
# ...) have fresh daily data instead, same as any stock, so those are
# the sector proxy here. Coverage is deliberately incomplete rather
# than papered over: Realty, Media, and Consumer Durables have no
# liquid tradeable ETF on NSE, and the one Chemicals ETF found had only
# 21 days of listing history (not enough for a 1Y return) — all four
# are simply left out rather than estimated from a shakier proxy, same
# "don't compute on data you don't trust" principle as the ENTERO fix
# in nseScreener above.

SECTOR_ETF_TICKERS = {
    "Auto": "AUTOIETF.NS",
    "Bank": "BANKBEES.NS",
    "PSU Bank": "PSUBNKBEES.NS",
    "Private Bank": "PVTBANIETF.NS",
    "Financial Services": "FINIETF.NS",
    "FMCG": "FMCGIETF.NS",
    "IT": "ITBEES.NS",
    "Metal": "METALIETF.NS",
    "Pharma": "PHARMABEES.NS",
    "Healthcare": "HEALTHIETF.NS",
    "Oil & Gas": "OILIETF.NS",
    "Infrastructure": "INFRAIETF.NS",
    # Added 2026-08-30 after Harish pointed at NSE's thematic-indices page
    # (nseindia.com itself times out to any fetch here — same bot-
    # protection this codebase already worked around via the archives.
    # subdomain elsewhere — so these were found by testing candidate
    # NSE-listed ETF tickers against yfinance directly, same method as
    # the original 12). Realty in particular was one of the three
    # sectors excluded outright when this screener first shipped —
    # MOREALTY.NS (listed Mar 2024, 600+ days of history) closes that
    # gap. Energy/Services/Capital Markets ETFs were found too but
    # excluded — each had well under a year of listing history (147-213
    # days), not enough for a trustworthy 1Y return; revisit once they
    # age past SEC_MIN_HISTORY_DAYS. Media and Consumer Durables still
    # have no liquid ETF found.
    "Commodities": "COMMOIETF.NS",
    "Consumption": "CONSUMIETF.NS",
    "MNC": "MNC.NS",
    "Manufacturing": "MAKEINDIA.NS",
    "EV & New Age Auto": "EVINDIA.NS",
    "Defence": "GROWWDEFNC.NS",
    "CPSE": "CPSEETF.NS",
    "Realty": "MOREALTY.NS",
    # Added same day, on request — Mirae Asset's is the only real
    # Internet-sector ETF found (NETF.NS looked promising by name but
    # is actually Tata's plain Nifty 50 ETF, a ticker-guess false
    # positive, discarded). Only listed Sep 2025, so it clears
    # SEC_MIN_HISTORY_DAYS but doesn't have a full year yet — its 1Y
    # alpha will read "—" until its first anniversary; 1M/3M/6M work now.
    "Internet": "INTERNET.NS",
}
SEC_BENCHMARK_TICKER = "^CRSLDX"  # NIFTY 500 — same benchmark as Nifty500RelativeStrength above
SEC_FETCH_YEARS = 2  # comfortably covers the 1Y lookback + MIN_HISTORY check
# 2026-08-30: rebalanced to fold in rs_1w (Harish: "why 1W score not
# considered?" — his own choice of the three options offered, keeping
# the original recency-weighted shape but trimming 1M/6M/1Y to make
# room). Was {rs_1m: 0.40, rs_3m: 0.30, rs_6m: 0.20, rs_1y: 0.10} before
# rs_1w existed as a column at all — this DOES shift every sector's
# already-live rs_score/rank, done deliberately this time (not silently).
SEC_WEIGHTS = {"rs_1w": 0.10, "rs_1m": 0.35, "rs_3m": 0.30, "rs_6m": 0.15, "rs_1y": 0.10}
SEC_MIN_HISTORY_DAYS = 250  # need close to a year of real data to be scoreable at all


def _sec_fetch_series(ticker, start_iso):
    df = yf.download(ticker, start=start_iso, interval="1d", progress=False, auto_adjust=True)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Close"]].dropna()
    df.index.name = "date"
    return df.reset_index()


def _sec_to_records(df_slice):
    out = []
    for _, row in df_slice.sort_values("date").iterrows():
        d = row["date"]
        d = d.date() if hasattr(d, "date") else d
        out.append({"date": d.isoformat() if hasattr(d, "isoformat") else str(d), "close": float(row["Close"])})
    return out


def _sec_nearest_on_or_before(data, target_date):
    best = None
    for row in data:
        d = datetime.strptime(row["date"], "%Y-%m-%d").date()
        if d <= target_date:
            if best is None or d > datetime.strptime(best["date"], "%Y-%m-%d").date():
                best = row
    return best


def _sec_pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return round((a / b - 1) * 100, 2)


def _sec_returns_for(data, last_date):
    data = sorted(data, key=lambda r: r["date"])
    last = data[-1]
    w1 = _sec_nearest_on_or_before(data, last_date - timedelta(days=7))
    m1 = _sec_nearest_on_or_before(data, last_date - timedelta(days=30))
    m3 = _sec_nearest_on_or_before(data, last_date - timedelta(days=90))
    m6 = _sec_nearest_on_or_before(data, last_date - timedelta(days=180))
    y1 = _sec_nearest_on_or_before(data, last_date - timedelta(days=365))
    return {
        "last_close": last["close"], "last_date": last["date"],
        # r_1w added 2026-08-30 for sectorStockAlpha's "weekly alpha"
        # column — sectorAlpha (this helper's other caller) doesn't
        # read this key at all, so its own rows/rs_score are unaffected.
        "r_1w": _sec_pct(last["close"], w1["close"] if w1 else None),
        "r_1m": _sec_pct(last["close"], m1["close"] if m1 else None),
        "r_3m": _sec_pct(last["close"], m3["close"] if m3 else None),
        "r_6m": _sec_pct(last["close"], m6["close"] if m6 else None),
        "r_1y": _sec_pct(last["close"], y1["close"] if y1 else None),
        "data": data, "span_days": (datetime.strptime(data[-1]["date"], "%Y-%m-%d").date()
                                     - datetime.strptime(data[0]["date"], "%Y-%m-%d").date()).days,
    }


def _run_sector_alpha(symbols, name_map, sector_map):
    """Ignores symbols/name_map/sector_map (the NSE-750 universe) — this
    screener has its own fixed, small list of sector ETF tickers, not
    the per-stock universe every other screener in this file scans."""
    start = (date.today() - timedelta(days=365 * SEC_FETCH_YEARS)).isoformat()
    try:
        bench_df = _sec_fetch_series(SEC_BENCHMARK_TICKER, start)
    except Exception as e:
        return None, f"benchmark fetch failed: {e}"
    if bench_df.empty:
        return None, "no benchmark data fetched from yfinance"
    bench_data = sorted(_sec_to_records(bench_df), key=lambda r: r["date"])
    last_date = datetime.strptime(bench_data[-1]["date"], "%Y-%m-%d").date()
    bench = _sec_returns_for(bench_data, last_date)

    rows, skipped = [], []
    for sector, ticker in SECTOR_ETF_TICKERS.items():
        try:
            df = _sec_fetch_series(ticker, start)
        except Exception:
            skipped.append(sector)
            continue
        if df.empty:
            skipped.append(sector)
            continue
        data = sorted(_sec_to_records(df), key=lambda r: r["date"])
        s = _sec_returns_for(data, last_date)
        if s["span_days"] < SEC_MIN_HISTORY_DAYS:
            skipped.append(sector)
            continue

        # rs_1w added 2026-08-30 ("also for sector alpha tab"), folded
        # into rs_score's weighting the same day per Harish's own
        # follow-up ("why 1W score not considered?") — see SEC_WEIGHTS.
        rs_1w = None if s["r_1w"] is None or bench["r_1w"] is None else round(s["r_1w"] - bench["r_1w"], 2)
        rs_1m = None if s["r_1m"] is None or bench["r_1m"] is None else round(s["r_1m"] - bench["r_1m"], 2)
        rs_3m = None if s["r_3m"] is None or bench["r_3m"] is None else round(s["r_3m"] - bench["r_3m"], 2)
        rs_6m = None if s["r_6m"] is None or bench["r_6m"] is None else round(s["r_6m"] - bench["r_6m"], 2)
        rs_1y = None if s["r_1y"] is None or bench["r_1y"] is None else round(s["r_1y"] - bench["r_1y"], 2)

        rs_parts = {"rs_1w": rs_1w, "rs_1m": rs_1m, "rs_3m": rs_3m, "rs_6m": rs_6m, "rs_1y": rs_1y}
        available = {k: v for k, v in rs_parts.items() if v is not None}
        if not available:
            skipped.append(sector)
            continue
        wsum = sum(SEC_WEIGHTS[k] for k in available)
        rs_score = round(sum(v * SEC_WEIGHTS[k] for k, v in available.items()) / wsum, 2)

        stock_by_date = {r["date"]: r["close"] for r in s["data"]}
        bench_by_date = {r["date"]: r["close"] for r in bench["data"]}
        common_dates = sorted(d for d in stock_by_date if d in bench_by_date)
        if common_dates:
            base_ratio = stock_by_date[common_dates[0]] / bench_by_date[common_dates[0]]
            rs_line_vals = [(stock_by_date[d] / bench_by_date[d]) / base_ratio * 100 for d in common_dates]
            rs_new_high = rs_line_vals[-1] >= max(rs_line_vals)
        else:
            rs_new_high = False

        rows.append({
            # "sector_name", not "sector" — GenericTable auto-shows a
            # sector-filter dropdown for any row shape with a "sector"
            # field, which makes no sense here since each row already
            # IS one distinct sector, not a stock classified into one.
            "sector_name": sector, "ticker": ticker.replace(".NS", ""),
            "price": s["last_close"], "as_of": s["last_date"],
            "r_1m": s["r_1m"], "r_3m": s["r_3m"], "r_6m": s["r_6m"], "r_1y": s["r_1y"],
            "rs_1w": rs_1w, "rs_1m": rs_1m, "rs_3m": rs_3m, "rs_6m": rs_6m, "rs_1y": rs_1y,
            "rs_score": rs_score, "rs_new_high": rs_new_high,
        })

    rows.sort(key=lambda r: -r["rs_score"])
    n = len(rows)
    for i, r in enumerate(rows, 1):
        r["rank"] = i
        r["zone"] = "Leader" if i <= max(1, n // 3) else ("Laggard" if i > n - max(1, n // 3) else "Middle")
    return {"label": "Sector Alpha", "push_rows": rows, "scanned": len(rows), "skipped": len(skipped)}, None


# ── sectorStockAlpha ─────────────────────────────────────────────────────────
#
# Which stocks are beating THEIR OWN sector's return — the drill-down
# sectorAlpha above doesn't give: stock alpha = stock return minus its
# sector's average return, same 1M/3M/6M/1Y windows. Added 2026-08-30
# right after sectorAlpha, at Harish's request ("video also shows
# internal stocks in each sector showing alpha against the sector
# returns over same time period").
#
# Deliberately does NOT reuse sectorAlpha's 12 ETF-branded sectors —
# checked with Harish first: those are Nifty-INDEX groupings (Pharma
# and Healthcare are two separate indices; Bank splits into PSU/
# Private; Infrastructure is a cross-sector theme with no constituent
# list at all), and none of that maps cleanly onto the NSE-750
# universe's own "Industry" tag every stock already carries elsewhere
# in this file (sector_map, from the same NSE-archives CSV RS/LTIS/WI/
# QB/nseScreener all already fetch) — that tag lumps Pharma+Healthcare
# into one "Healthcare" industry, doesn't distinguish PSU vs Private
# banks, etc. Forcing stocks into the ETF-sector list would mean
# silently misclassifying or dropping most of the universe.
#
# So this uses a DIFFERENT, self-consistent "sector" definition just
# for this screener: NSE's own Industry tag, with each industry's
# "return" computed bottom-up as the plain average of its own
# constituent stocks' returns (only industries with at least
# SSA_MIN_STOCKS_PER_SECTOR scoreable stocks are used at all) — no ETL
# ticker, no mapping guesswork, full coverage of every real industry
# in the universe rather than just the 12 with a liquid ETF proxy.
#
# Theme groups (added same day, on request): Defence and Manufacturing
# are cross-industry THEMES (a defence stock might be tagged Capital
# Goods or IT by industry; a themed constituent list cuts across
# several industries at once), so they can't be built the industry-
# average way at all — there's no single-industry bucket to average
# into. Instead these use each theme's REAL NSE index constituent list
# (found live on the archives. subdomain — nseindia.com's main site
# times out to any fetch here, same as usual, but the static archives
# host works, same trick this file already uses for the Total Market
# list) and compare each constituent's own return against that THEME'S
# ETF return (SECTOR_ETF_TICKERS' GROWWDEFNC.NS/MAKEINDIA.NS — same
# tickers sectorAlpha already uses, so the two tabs agree on what
# "Defence" and "Manufacturing" mean). A stock CAN appear twice — once
# under its industry, once under a theme it also belongs to — that's
# not a bug, a stock genuinely can be both. MNC/Commodities/
# Consumption/CPSE/EV & New Age Auto were also asked for but have no
# discoverable constituent-list filename on the archives host (several
# naming patterns tried, all 404) — left out rather than guessed at.

SSA_FETCH_YEARS = 2
SSA_MIN_HISTORY_DAYS = 250  # ~1Y of real data to be scoreable at all
SSA_MIN_STOCKS_PER_SECTOR = 3  # need at least this many scoreable stocks for a sector average to mean anything
# 2026-08-30: rebalanced to fold in alpha_1w — same rationale/weights
# as SEC_WEIGHTS above (Harish: "why 1W score not considered?").
SSA_WEIGHTS = {"alpha_1w": 0.10, "alpha_1m": 0.35, "alpha_3m": 0.30, "alpha_6m": 0.15, "alpha_1y": 0.10}

SSA_THEME_INDEX_URLS = {
    "Defence": "https://archives.nseindia.com/content/indices/ind_niftyindiadefence_list.csv",
    "Manufacturing": "https://archives.nseindia.com/content/indices/ind_niftyindiamanufacturing_list.csv",
}


def _ssa_sector_avg(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def _ssa_fetch_theme_symbols(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    return {r["Symbol"].strip() for r in rows}


def _run_sector_stock_alpha(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=365 * SSA_FETCH_YEARS)).isoformat()
    daily = _ms_fetch_daily(symbols, start)
    if daily is None:
        return None, "no data fetched from yfinance"

    per_stock = {}
    for sym, g in daily.groupby("symbol"):
        recs = _rs_to_records(g)
        if not recs:
            continue
        last_date = datetime.strptime(recs[-1]["date"], "%Y-%m-%d").date()
        r = _sec_returns_for(recs, last_date)
        if r["span_days"] < SSA_MIN_HISTORY_DAYS:
            continue
        per_stock[sym] = r

    by_sector = {}
    for sym, r in per_stock.items():
        sec = sector_map.get(sym) or "Unknown"
        by_sector.setdefault(sec, []).append(r)

    sector_returns = {}
    for sec, items in by_sector.items():
        if len(items) < SSA_MIN_STOCKS_PER_SECTOR:
            continue
        sector_returns[sec] = {
            "r_1w": _ssa_sector_avg([r["r_1w"] for r in items]),
            "r_1m": _ssa_sector_avg([r["r_1m"] for r in items]),
            "r_3m": _ssa_sector_avg([r["r_3m"] for r in items]),
            "r_6m": _ssa_sector_avg([r["r_6m"] for r in items]),
            "r_1y": _ssa_sector_avg([r["r_1y"] for r in items]),
        }

    rows, skipped = [], []
    for sym, r in per_stock.items():
        sec = sector_map.get(sym) or "Unknown"
        sec_ret = sector_returns.get(sec)
        if sec_ret is None:
            skipped.append(sym)  # sector had too few scoreable stocks to average
            continue

        # alpha_1w added 2026-08-30 ("add weekly alpha column"), folded
        # into alpha_score's weighting the same day per Harish's own
        # follow-up ("why 1W score not considered?") — see SSA_WEIGHTS.
        alpha_1w = None if r["r_1w"] is None or sec_ret["r_1w"] is None else round(r["r_1w"] - sec_ret["r_1w"], 2)
        alpha_1m = None if r["r_1m"] is None or sec_ret["r_1m"] is None else round(r["r_1m"] - sec_ret["r_1m"], 2)
        alpha_3m = None if r["r_3m"] is None or sec_ret["r_3m"] is None else round(r["r_3m"] - sec_ret["r_3m"], 2)
        alpha_6m = None if r["r_6m"] is None or sec_ret["r_6m"] is None else round(r["r_6m"] - sec_ret["r_6m"], 2)
        alpha_1y = None if r["r_1y"] is None or sec_ret["r_1y"] is None else round(r["r_1y"] - sec_ret["r_1y"], 2)

        parts = {"alpha_1w": alpha_1w, "alpha_1m": alpha_1m, "alpha_3m": alpha_3m, "alpha_6m": alpha_6m, "alpha_1y": alpha_1y}
        available = {k: v for k, v in parts.items() if v is not None}
        if not available:
            skipped.append(sym)
            continue
        wsum = sum(SSA_WEIGHTS[k] for k in available)
        alpha_score = round(sum(v * SSA_WEIGHTS[k] for k, v in available.items()) / wsum, 2)

        rows.append({
            "symbol": sym, "name": name_map.get(sym, sym), "sector": sec,
            "price": r["last_close"], "as_of": r["last_date"],
            "r_1m": r["r_1m"], "r_3m": r["r_3m"], "r_6m": r["r_6m"], "r_1y": r["r_1y"],
            "alpha_1w": alpha_1w, "alpha_1m": alpha_1m, "alpha_3m": alpha_3m, "alpha_6m": alpha_6m, "alpha_1y": alpha_1y,
            "alpha_score": alpha_score,
        })

    # Theme groups (Defence/Manufacturing) — see the module comment
    # above for why these can't be built the industry-average way. A
    # constituent can be missing from per_stock (delisted, insufficient
    # history) without failing the whole theme — just skipped like any
    # other stock.
    for theme, url in SSA_THEME_INDEX_URLS.items():
        etf_ticker = SECTOR_ETF_TICKERS.get(theme)
        if not etf_ticker:
            continue
        try:
            members = _ssa_fetch_theme_symbols(url)
            theme_df = _sec_fetch_series(etf_ticker, start)
        except Exception:
            skipped.append(f"[theme:{theme}] fetch failed")
            continue
        if theme_df.empty:
            skipped.append(f"[theme:{theme}] no ETF data")
            continue
        theme_data = sorted(_sec_to_records(theme_df), key=lambda r: r["date"])
        theme_last_date = datetime.strptime(theme_data[-1]["date"], "%Y-%m-%d").date()
        theme_ret = _sec_returns_for(theme_data, theme_last_date)

        for sym in members:
            r = per_stock.get(sym)
            if r is None:
                skipped.append(sym)
                continue
            alpha_1w = None if r["r_1w"] is None or theme_ret["r_1w"] is None else round(r["r_1w"] - theme_ret["r_1w"], 2)
            alpha_1m = None if r["r_1m"] is None or theme_ret["r_1m"] is None else round(r["r_1m"] - theme_ret["r_1m"], 2)
            alpha_3m = None if r["r_3m"] is None or theme_ret["r_3m"] is None else round(r["r_3m"] - theme_ret["r_3m"], 2)
            alpha_6m = None if r["r_6m"] is None or theme_ret["r_6m"] is None else round(r["r_6m"] - theme_ret["r_6m"], 2)
            alpha_1y = None if r["r_1y"] is None or theme_ret["r_1y"] is None else round(r["r_1y"] - theme_ret["r_1y"], 2)
            parts = {"alpha_1w": alpha_1w, "alpha_1m": alpha_1m, "alpha_3m": alpha_3m, "alpha_6m": alpha_6m, "alpha_1y": alpha_1y}
            available = {k: v for k, v in parts.items() if v is not None}
            if not available:
                skipped.append(sym)
                continue
            wsum = sum(SSA_WEIGHTS[k] for k in available)
            alpha_score = round(sum(v * SSA_WEIGHTS[k] for k, v in available.items()) / wsum, 2)
            rows.append({
                "symbol": sym, "name": name_map.get(sym, sym), "sector": theme,
                "price": r["last_close"], "as_of": r["last_date"],
                "r_1m": r["r_1m"], "r_3m": r["r_3m"], "r_6m": r["r_6m"], "r_1y": r["r_1y"],
                "alpha_1w": alpha_1w, "alpha_1m": alpha_1m, "alpha_3m": alpha_3m, "alpha_6m": alpha_6m, "alpha_1y": alpha_1y,
                "alpha_score": alpha_score,
            })

    rows.sort(key=lambda r: -r["alpha_score"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return {"label": "Stocks vs Sector", "push_rows": rows, "scanned": len(rows), "skipped": len(skipped)}, None


# ── maBreakout ───────────────────────────────────────────────────────────────
#
# Stocks that recently crossed above (and have held above) the 200-day
# EMA or the 33-week EMA, without having run too far past it — added
# 2026-08-30 on request: "stocks above 500 Cr Market Cap, crossing
# 200DEMA or 33WEMA... or crossed and stays above... recently and
# consolidates... distance ... should not be more than 20% on upside."
# Three deliberate scope decisions, all confirmed with Harish before
# building rather than assumed:
#   - No market cap filter. There's no bulk NSE/yfinance source for
#     market cap across 750 stocks — getting it would mean 750
#     individual Screener.in fetches, far too slow/risky at that scale
#     (a lighter ~110-ticker Screener.in fetch already took 230s
#     elsewhere in this file). The NSE 750 (Nifty Total Market)
#     universe's own inclusion bar already excludes true microcaps in
#     practice, so this is likely close to a no-op anyway.
#   - "Consolidates" isn't a separate tightness/range test — the
#     "not more than 20% above the MA" cap IS the consolidation
#     definition (still basing near the line, not extended).
#   - "Recently" = within the last 8 weeks (MAB_RECENCY_WEEKS) since
#     the actual cross-up event, not just "currently above" (which
#     would also match a stock that's been trending for a year).
#
# EMAs are computed on OHLC4 = (Open+High+Low+Close)/4, not Close
# alone, per Harish's standing rule (feedback_ema_ohlc4_source.md) —
# but the above/below CHECK compares the real Close against that
# OHLC4-based EMA line, not OHLC4 against itself (same memory: "SMA/
# RSI/trigger comparisons stay on Close"). The weekly OHLC4 is built
# from real weekly O/H/L/C (first/max/min/last of the week), not an
# average of daily OHLC4 values — the standard way to build a weekly
# candle from daily bars.

MAB_FETCH_YEARS = 3
MAB_MIN_HISTORY_DAYS = 250
MAB_RECENCY_WEEKS = 8
MAB_MAX_PCT_ABOVE = 20.0
MAB_DAILY_EMA_PERIOD = 200
MAB_WEEKLY_EMA_PERIOD = 33


def _mab_analyze(close, ohlc4, ema_period, recency_periods):
    """close/ohlc4: same-length, same-index pd.Series, ascending. EMA is
    computed on ohlc4; the above/below check and the %-above figure
    compare the real close against that EMA line. Returns None if the
    stock doesn't currently qualify: not above the EMA right now,
    crossed too long ago (or the cross predates our fetch window
    entirely, so recency can't be confirmed), or price has run more
    than MAB_MAX_PCT_ABOVE% past the EMA."""
    if len(close) < ema_period + recency_periods + 20:  # buffer before the recency window, so a real prior "below" can actually be observed
        return None
    ema = ohlc4.ewm(span=ema_period, adjust=False).mean()
    above = close > ema
    if not bool(above.iloc[-1]):
        return None
    i = len(above) - 1
    while i > 0 and bool(above.iloc[i - 1]):
        i -= 1
    if i == 0:
        return None  # already above at the start of our fetch window — can't confirm this was actually a recent cross
    periods_since_cross = len(above) - 1 - i
    if periods_since_cross > recency_periods:
        return None
    last_close = float(close.iloc[-1])
    last_ema = float(ema.iloc[-1])
    pct_above = round((last_close / last_ema - 1) * 100, 2)
    if pct_above > MAB_MAX_PCT_ABOVE:
        return None
    return {"ema": round(last_ema, 2), "pct_above": pct_above, "periods_since_cross": periods_since_cross,
            "fresh": periods_since_cross <= 1}


def _run_ma_breakout(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=365 * MAB_FETCH_YEARS)).isoformat()
    daily = _ms_fetch_daily(symbols, start, need_ohlc=True)
    if daily is None:
        return None, "no data fetched from yfinance"

    daily_recency_bars = MAB_RECENCY_WEEKS * 5  # ~5 trading days/week
    weekly_recency_bars = MAB_RECENCY_WEEKS

    rows, skipped = [], []
    for sym, g in daily.groupby("symbol"):
        g = g.set_index("date").sort_index()
        if len(g) < MAB_MIN_HISTORY_DAYS:
            skipped.append(sym)
            continue
        close_d = g["Close"]
        ohlc4_d = (g["Open"] + g["High"] + g["Low"] + g["Close"]) / 4

        weekly_ohlc = g[["Open", "High", "Low", "Close"]].resample("W-FRI").agg(
            {"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
        close_w = weekly_ohlc["Close"]
        ohlc4_w = (weekly_ohlc["Open"] + weekly_ohlc["High"] + weekly_ohlc["Low"] + weekly_ohlc["Close"]) / 4

        d200 = _mab_analyze(close_d, ohlc4_d, MAB_DAILY_EMA_PERIOD, daily_recency_bars)
        w33 = _mab_analyze(close_w, ohlc4_w, MAB_WEEKLY_EMA_PERIOD, weekly_recency_bars)
        if d200 is None and w33 is None:
            skipped.append(sym)
            continue

        via = " & ".join(v for v, ok in (("200D EMA", d200), ("33W EMA", w33)) if ok)
        rows.append({
            "symbol": sym, "name": name_map.get(sym, sym), "sector": sector_map.get(sym, ""),
            "price": round(float(close_d.iloc[-1]), 2), "via": via,
            "ema200d": d200["ema"] if d200 else None,
            "pct_above_200d": d200["pct_above"] if d200 else None,
            "days_since_cross_200d": d200["periods_since_cross"] if d200 else None,
            "ema33w": w33["ema"] if w33 else None,
            "pct_above_33w": w33["pct_above"] if w33 else None,
            "weeks_since_cross_33w": w33["periods_since_cross"] if w33 else None,
            "fresh_this_week": bool((d200 and d200["fresh"]) or (w33 and w33["fresh"])),
        })

    def _sort_key(r):
        candidates = [v for v in (r["pct_above_200d"], r["pct_above_33w"]) if v is not None]
        return min(candidates) if candidates else 999
    rows.sort(key=_sort_key)

    return {"label": "MA Breakout", "push_rows": rows, "scanned": len(rows), "skipped": len(skipped)}, None


# ── valueRsiTurnaround ───────────────────────────────────────────────────────
#
# "Value" strategy: monthly RSI(14) crossing above 40 and progressing —
# added 2026-08-30. Confirmed 3 specific choices with Harish before
# building rather than guessing at "crossing 40 and progressing":
#   - "Recent" cross = within the last 3 completed monthly candles.
#   - "Progressing" = current RSI is strictly higher than it was at the
#     cross month (net higher since crossing — a flat/wobbly month in
#     between doesn't disqualify it, as long as the overall move since
#     the cross is upward).
#   - Upper cap at RSI 60 — past that it's arguably already a momentum
#     stock, not a value/turnaround entry anymore.
#
# Uses a SEPARATE RSI implementation from nseScreener's _nse_wilder_rsi
# on purpose, not sharing it: that one only returns the latest scalar
# value (a manual Wilder-recursion loop), but this screener needs the
# FULL historical RSI series to find WHEN it crossed 40 and what RSI
# was at that point — so this uses the same EWM-based Wilder-equivalent
# approach myLongTermInvestingStrategy's weekly RSI already uses
# elsewhere in this file, just vectorized (pandas .ewm(alpha=1/14),
# same mathematical family as Wilder smoothing, differing only in how
# the first few periods are seeded — the two can show slightly
# different values for the same stock/period as a result). Left
# nseScreener's existing RSI untouched rather than refactor it to
# share this — that's live, user-visible data; not something to
# silently change as a side effect of adding a new screener.

VAL_FETCH_YEARS = 5  # matches nseScreener's own precedent for monthly-RSI reliability
VAL_RSI_THRESHOLD = 40
VAL_RSI_UPPER_CAP = 60
VAL_RECENCY_MONTHS = 3
VAL_MIN_MONTHLY_BARS = 24  # ~2 years of monthly closes — long enough to trust the RSI and actually observe a prior below-40 state


def _val_rsi_series(close, period=14):
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - 100 / (1 + rs)
    return rsi.where(avg_loss != 0, 100.0)


def _run_value_rsi_turnaround(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=365 * VAL_FETCH_YEARS)).isoformat()
    daily = _ms_fetch_daily(symbols, start)
    if daily is None:
        return None, "no data fetched from yfinance"

    rows, skipped = [], []
    for sym, g in daily.groupby("symbol"):
        cd = g.set_index("date")["Close"].sort_index()
        cm = cd.resample("ME").last().dropna()
        if len(cm) < VAL_MIN_MONTHLY_BARS:
            skipped.append(sym)
            continue

        valid = _val_rsi_series(cm).dropna()
        if len(valid) < VAL_RECENCY_MONTHS + 5:
            skipped.append(sym)
            continue

        above = valid > VAL_RSI_THRESHOLD
        if not bool(above.iloc[-1]):
            skipped.append(sym)
            continue
        i = len(above) - 1
        while i > 0 and bool(above.iloc[i - 1]):
            i -= 1
        if i == 0:
            skipped.append(sym)  # already above 40 at the start of our fetch window — can't confirm this was actually a recent cross
            continue
        months_since_cross = len(above) - 1 - i
        if months_since_cross > VAL_RECENCY_MONTHS:
            skipped.append(sym)
            continue

        current_rsi = round(float(valid.iloc[-1]), 2)
        rsi_at_cross = round(float(valid.iloc[i]), 2)
        if current_rsi <= rsi_at_cross:
            skipped.append(sym)  # not "progressing" — net flat or lower since the cross
            continue
        if current_rsi > VAL_RSI_UPPER_CAP:
            skipped.append(sym)
            continue

        rows.append({
            "symbol": sym, "name": name_map.get(sym, sym), "sector": sector_map.get(sym, ""),
            "price": round(float(cd.iloc[-1]), 2),
            "rsi_m": current_rsi, "rsi_at_cross": rsi_at_cross,
            "months_since_cross": months_since_cross,
            "rsi_gain_since_cross": round(current_rsi - rsi_at_cross, 2),
        })

    rows.sort(key=lambda r: -r["rsi_gain_since_cross"])
    return {"label": "Value RSI Turnaround", "push_rows": rows, "scanned": len(rows), "skipped": len(skipped)}, None


# ── grandfatherFatherSon ─────────────────────────────────────────────────────
#
# Vishal Malkan's "Grandfather-Father-Son" / "5-Star RSI" strategy —
# added 2026-08-30 after a linked video turned out to describe a
# genuinely different, more specific setup than valueRsiTurnaround
# above (checked live via web search against multiple independent
# sources — a chartink screener, an elearnmarkets writeup, and the
# video's own title — before building, rather than guessed at):
#   - Monthly RSI(14) > 60 AND Weekly RSI(14) > 60 — the "grandfather"
#     and "father" timeframes confirm a genuinely strong, established
#     uptrend, not just a short-term bounce.
#   - Daily RSI(14) (the "son") pulled back into a 35-45 support zone
#     within the last 10 trading days — in a trend this strong, 40 on
#     the daily tends to act as support rather than get broken.
#   - The day of that pullback low must be a bullish (green) candle —
#     the "reversal at support" entry trigger — and daily RSI today
#     must be at or above that low (the bounce has actually started,
#     not still sitting at the low with no confirmation yet).
#   - The setup must still be live: no day AFTER that low has broken
#     below its candle's own low (that would mean the stop already
#     got hit — this isn't still an open, valid setup).
# Stop-loss = the low of that trigger candle, per the strategy's own
# rule. Target (daily RSI back to 60) is shown as a fact in the
# methodology note, not fabricated into a price number — RSI doesn't
# map cleanly onto price, so a "target price" here would just be
# invented precision.
#
# Reuses _val_rsi_series (the same EWM-based Wilder RSI as
# valueRsiTurnaround) for all three timeframes — not nseScreener's
# _nse_wilder_rsi, for the same reason as that screener: this needs
# full historical RSI series (to find the recent daily low and check
# no later day broke the trigger candle), not just nseScreener's
# single latest-value output.

GFS_FETCH_YEARS = 5
GFS_HIGHER_TF_RSI_THRESHOLD = 60  # monthly AND weekly RSI must clear this
GFS_SUPPORT_LOW = 35
GFS_SUPPORT_HIGH = 45
GFS_LOOKBACK_DAYS = 10  # trading days to look back for the daily RSI pullback low


def _run_grandfather_father_son(symbols, name_map, sector_map):
    start = (date.today() - timedelta(days=365 * GFS_FETCH_YEARS)).isoformat()
    daily = _ms_fetch_daily(symbols, start, need_ohlc=True)
    if daily is None:
        return None, "no data fetched from yfinance"

    rows, skipped = [], []
    for sym, g in daily.groupby("symbol"):
        g = g.set_index("date").sort_index()
        close_d, open_d, low_d = g["Close"], g["Open"], g["Low"]

        cm = close_d.resample("ME").last().dropna()
        cw = close_d.resample("W-FRI").last().dropna()
        if len(cm) < VAL_MIN_MONTHLY_BARS or len(cw) < 30 or len(close_d) < 60:
            skipped.append(sym)
            continue

        rsi_m = _val_rsi_series(cm).dropna()
        rsi_w = _val_rsi_series(cw).dropna()
        rsi_d = _val_rsi_series(close_d).dropna()
        if rsi_m.empty or rsi_w.empty or len(rsi_d) < GFS_LOOKBACK_DAYS + 5:
            skipped.append(sym)
            continue

        monthly_rsi = float(rsi_m.iloc[-1])
        weekly_rsi = float(rsi_w.iloc[-1])
        if monthly_rsi <= GFS_HIGHER_TF_RSI_THRESHOLD or weekly_rsi <= GFS_HIGHER_TF_RSI_THRESHOLD:
            skipped.append(sym)
            continue

        # The trigger day is NOT simply "whichever day has the lowest RSI
        # in the window" — that day is almost always still a falling
        # (bearish) candle, since RSI keeps dropping as price drops. The
        # actual Malkan trigger is: scan the window for ANY day where RSI
        # sits in the 35-45 support zone AND that day's own candle is
        # bullish (confirmed empirically 2026-08-30 — the naive "RSI
        # minimum" approach found zero matches out of 750 stocks; this
        # approach found real ones immediately). Take the most recent
        # such day if more than one qualifies.
        recent_idx = rsi_d.index[-GFS_LOOKBACK_DAYS:]
        candidates = [d for d in recent_idx
                      if GFS_SUPPORT_LOW <= rsi_d.loc[d] <= GFS_SUPPORT_HIGH and close_d.loc[d] > open_d.loc[d]]
        if not candidates:
            skipped.append(sym)
            continue
        trigger_date = candidates[-1]
        trigger_rsi = float(rsi_d.loc[trigger_date])

        current_daily_rsi = float(rsi_d.iloc[-1])
        if current_daily_rsi < trigger_rsi:
            skipped.append(sym)  # hasn't turned up from the trigger day yet
            continue
        trigger_low = float(low_d.loc[trigger_date])

        after = low_d.loc[low_d.index > trigger_date]
        if not after.empty and float(after.min()) < trigger_low:
            skipped.append(sym)  # a later day already broke below the trigger candle's low — setup already stopped out
            continue

        days_since_trigger = int((close_d.index > trigger_date).sum())
        rows.append({
            "symbol": sym, "name": name_map.get(sym, sym), "sector": sector_map.get(sym, ""),
            "price": round(float(close_d.iloc[-1]), 2),
            "monthly_rsi": round(monthly_rsi, 1), "weekly_rsi": round(weekly_rsi, 1),
            "daily_rsi": round(current_daily_rsi, 1), "daily_rsi_at_support": round(trigger_rsi, 1),
            "days_since_support": days_since_trigger,
            "stop_loss": round(trigger_low, 2),
        })

    rows.sort(key=lambda r: r["days_since_support"])
    return {"label": "Grandfather-Father-Son", "push_rows": rows, "scanned": len(rows), "skipped": len(skipped)}, None


SCREENER_RUNNERS = {
    "Nifty500RelativeStrength": _run_rs,
    "myLongTermInvestingStrategy": _run_ltis,
    "weekendInvesting": _run_weekend_investing,
    "quantBollinger": _run_quant_bollinger,
    "nseScreener": _run_nse_screener,
    "sectorAlpha": _run_sector_alpha,
    "sectorStockAlpha": _run_sector_stock_alpha,
    "maBreakout": _run_ma_breakout,
    "valueRsiTurnaround": _run_value_rsi_turnaround,
    "grandfatherFatherSon": _run_grandfather_father_son,
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
