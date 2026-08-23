"""POST /api/watchlist_detail — on-demand price/RSI(D-W-M)/return-%
detail for watchlisted tickers that momentum_screeners.nseScreener
doesn't cover (outside NSE 750 — below the Smallcap 100 cutoff, or too
recently listed to have cleared NSE's index-eligibility rules yet).

Small scale by design (a handful of tickers per watchlist, capped at
MAX_TICKERS below) and computed live via yfinance on every request —
deliberately NOT cached or pushed to Postgres like the 6 momentum
screeners; this exists purely to answer "give me nseScreener-shaped
data for these specific few tickers right now" for the Watchlist page.
Same wilder_rsi()/row math as ~/.claude/skills/NseScreener's script,
just ported here and scoped to an explicit ticker list instead of the
whole NSE 750 universe.

POST body: {"tickers": ["SYM1", "SYM2", ...]}
Response: {"rows": {"SYM1": {...same shape as nseScreener rows...}, ...}}
Tickers yfinance has no data for (delisted, wrong symbol, etc.) are
just absent from the response rather than erroring the whole request.
"""
import os
import sys
import warnings
from datetime import date, timedelta

warnings.filterwarnings("ignore")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http.server import BaseHTTPRequestHandler

import pandas as pd
import yfinance as yf

from _http import read_json_body, require_auth, send_json

MAX_TICKERS = 15  # bounds worst-case request latency


def wilder_rsi(series, length=14):
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


def pct(cd, idx):
    if len(cd) > abs(idx):
        old = float(cd.iloc[idx])
        current = float(cd.iloc[-1])
        return round((current - old) / old * 100, 2) if old else None
    return None


def pct_since(cd, offset):
    current_date = cd.index[-1]
    current = float(cd.iloc[-1])
    target = current_date - offset
    past = cd[cd.index <= target]
    if past.empty:
        return None
    old = float(past.iloc[-1])
    return round((current - old) / old * 100, 2) if old else None


def fetch_closes(tickers, period, interval):
    """Returns {symbol: pandas Series of Close, indexed by date}."""
    try:
        data = yf.download(tickers, period=period, interval=interval, group_by="ticker",
                            threads=True, progress=False, auto_adjust=True)
    except Exception:
        return {}
    out = {}
    for t in tickers:
        try:
            df = data[t] if isinstance(data.columns, pd.MultiIndex) else data
        except KeyError:
            continue
        df = df.dropna(how="all")
        if df.empty or "Close" not in df:
            continue
        close = df["Close"].dropna()
        if close.empty:
            continue
        out[t.replace(".NS", "")] = close
    return out


def fetch_name_sector(symbol):
    """yfinance's .info (a separate, slower call than the bulk .download()
    used for prices — confirmed live it still works from Vercel, same as
    .download()) — best-effort: any failure here just means this one
    ticker's name/sector stay blank, not a request failure."""
    try:
        info = yf.Ticker(f"{symbol}.NS").info
        return info.get("longName") or info.get("shortName"), info.get("sector")
    except Exception:
        return None, None


def build_row(symbol, cd, cw, cm):
    if cd is None or len(cd) < 20:
        return None
    last_date = cd.index[-1].date()
    if (date.today() - last_date).days > 5:
        return None

    rsi_w, green_3w = None, False
    if cw is not None and len(cw) >= 20:
        rsi_w = wilder_rsi(cw)
    if cw is not None and len(cw) >= 4:
        green_3w = bool(all(float(cw.iloc[i]) > float(cw.iloc[i - 1]) for i in [-3, -2, -1]))

    rsi_m = wilder_rsi(cm) if (cm is not None and len(cm) >= 15) else None
    name, sector = fetch_name_sector(symbol)

    return {
        "symbol": symbol,
        "name": name,
        "sector": sector,
        "price": round(float(cd.iloc[-1]), 2),
        "as_of": last_date.isoformat(),
        "change_pct": pct(cd, -2),
        "weekly_pct": pct(cd, -6),
        "monthly_pct": pct_since(cd, pd.DateOffset(months=1)),
        "three_month_pct": pct_since(cd, pd.DateOffset(months=3)),
        "yearly_pct": pct_since(cd, pd.DateOffset(years=1)),
        "rsi_d": wilder_rsi(cd) if len(cd) >= 30 else None,
        "rsi_w": rsi_w,
        "rsi_m": rsi_m,
        "three_week_green": green_3w,
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        tickers = body.get("tickers")
        if not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
            send_json(self, 400, {"error": "tickers must be a list of strings"})
            return
        tickers = tickers[:MAX_TICKERS]
        if not tickers:
            send_json(self, 200, {"rows": {}})
            return

        yf_tickers = [f"{t}.NS" for t in tickers]
        daily = fetch_closes(yf_tickers, "2y", "1d")
        weekly = fetch_closes(yf_tickers, "2y", "1wk")
        monthly = fetch_closes(yf_tickers, "5y", "1mo")

        rows = {}
        for t in tickers:
            r = build_row(t, daily.get(t), weekly.get(t), monthly.get(t))
            if r:
                rows[t] = r
        send_json(self, 200, {"rows": rows})
