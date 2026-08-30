"""Shared technical-indicator logic for the Guide page's Multibagger
Checklist (GET /api/fetch_company?guide=<name>, added 2026-08-30).

Single-symbol yfinance pull + the exact same formulas/thresholds as
four already-verified-live screeners in api/momentum_screeners.py —
myLongTermInvestingStrategy (weekly RSI>66 + 12/21/33-week EMA
ribbon), MA Breakout (200D/33W EMA on OHLC4, recent-cross + not-
overextended), Value RSI Turnaround (monthly RSI crossing 40 and
progressing), and Grandfather-Father-Son (Monthly+Weekly RSI>60 with a
daily RSI pullback-and-recovery at support). DUPLICATED here rather
than imported from momentum_screeners.py, on purpose — same reasoning
as _val_rsi_series vs nseScreener's _nse_wilder_rsi already being two
separate implementations in this codebase: a future change to one
screener's batch logic shouldn't silently change what the Guide page
reports for the same rule, and vice versa. If a threshold is fixed in
one place, fix it in both or retire one in favor of the other.

Also adds one check none of the 4 screeners compute: a VCP-style daily
EMA(10)/EMA(20) contraction, replicating viraj_screen.py's Chartink
"C3" scan clause (`abs(ema10-ema20) narrowing over the last few days`)
via plain pandas instead of an extra Chartink network round-trip —
cheaper and more reliable for a single on-demand lookup than calling
out to a third-party site (viraj_screen.py's own "Run now" failures
are a live example of that round-trip being the fragile part)."""
import pandas as pd
import yfinance as yf
from datetime import date, timedelta

FETCH_YEARS = 5
MIN_DAILY_BARS = 260  # ~1 trading year — below this, none of the below is trustworthy

# myLongTermInvestingStrategy mirror
LTIS_RSI_PERIOD = 14
LTIS_RSI_THRESHOLD = 66
LTIS_EMA_PERIODS = [12, 21, 33]

# MA Breakout mirror (EMA on OHLC4, not Close — feedback_ema_ohlc4_source.md)
MAB_RECENCY_WEEKS = 8
MAB_MAX_PCT_ABOVE = 20.0
MAB_DAILY_EMA_PERIOD = 200
MAB_WEEKLY_EMA_PERIOD = 33

# Value RSI Turnaround mirror
VAL_RSI_THRESHOLD = 40
VAL_RSI_UPPER_CAP = 60
VAL_RECENCY_MONTHS = 3

# Grandfather-Father-Son mirror
GFS_HIGHER_TF_RSI_THRESHOLD = 60
GFS_SUPPORT_LOW = 35
GFS_SUPPORT_HIGH = 45
GFS_LOOKBACK_DAYS = 10

# VCP-style daily EMA(10)/EMA(20) contraction — mirrors viraj_screen.py's
# Chartink C3 clause ("today's gap narrower than 3 days ago AND than
# 1 day ago") on trading-day offsets, not calendar days.
VCP_LOOKBACK_1 = 3
VCP_LOOKBACK_2 = 1

# RSBenchmarkCheck mirror — relative strength vs NIFTY 500 across 5
# timeframes. Deliberately its OWN weighting/window set, not shared
# with momentum_screeners.py's Nifty500RelativeStrength (which uses a
# DIFFERENT 10/40/30/20 weighting across only 4 windows, no 12M) — same
# "don't let one screener's formula silently drift another's" reasoning
# as every other duplicated formula in this file.
RSB_WINDOWS = [("1w", 7), ("1m", 30), ("3m", 90), ("6m", 180), ("12m", 365)]
RSB_WEIGHTS = {"1w": 0.10, "1m": 0.25, "3m": 0.30, "6m": 0.20, "12m": 0.15}
RSB_BENCHMARK_TICKER = "^CRSLDX"  # Yahoo Finance's NIFTY 500 index symbol
RSB_MIN_HISTORY_DAYS = 35
RSB_FETCH_DAYS_BUFFER = 400


def _rsb_nearest_on_or_before(series, target_date):
    eligible = series[series.index.date <= target_date]
    return None if eligible.empty else float(eligible.iloc[-1])


def _rsb_pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return round((a / b - 1) * 100, 2)


def _rsb_returns(close_series, last_date):
    last_close = float(close_series.iloc[-1])
    return {key: _rsb_pct(last_close, _rsb_nearest_on_or_before(close_series, last_date - timedelta(days=days)))
            for key, days in RSB_WINDOWS}


def fetch_rs_benchmark(symbol, close_d=None):
    """Relative strength vs NIFTY 500 across Weekly/Monthly/Quarterly/
    Bi-Annually/Yearly windows — mirrors the RSBenchmarkCheck skill
    (~/.claude/skills/RSBenchmarkCheck), single-symbol. RS% = the
    stock's own % return minus the benchmark's, over the same window —
    a spread in percentage points, not a ratio. Returns (dict, None) on
    success or (None, error) — best-effort, a failure here shouldn't
    fail the whole Guide technicals fetch. `close_d`, if the caller
    already has it (fetch_technicals does), is reused instead of a
    second download of the stock's own price — only the benchmark
    needs its own fetch."""
    try:
        if close_d is None:
            start = (date.today() - timedelta(days=RSB_FETCH_DAYS_BUFFER)).isoformat()
            df = yf.download(f"{symbol}.NS", start=start, interval="1d", auto_adjust=True, progress=False)
            if df is None or df.empty:
                return None, f"no yfinance price history for {symbol}.NS"
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            close_d = df["Close"].dropna()
        start = (date.today() - timedelta(days=RSB_FETCH_DAYS_BUFFER)).isoformat()
        bench_df = yf.download(RSB_BENCHMARK_TICKER, start=start, interval="1d", auto_adjust=True, progress=False)
    except Exception as e:
        return None, f"yfinance fetch failed: {e}"
    if bench_df is None or bench_df.empty:
        return None, "no benchmark data from yfinance"
    if isinstance(bench_df.columns, pd.MultiIndex):
        bench_df.columns = bench_df.columns.get_level_values(0)
    bench_close = bench_df["Close"].dropna()

    last_date = close_d.index[-1].date()
    span_days = (close_d.index[-1].date() - close_d.index[0].date()).days
    if span_days < RSB_MIN_HISTORY_DAYS:
        return None, f"only {span_days}d of price history"

    stock_r = _rsb_returns(close_d, last_date)
    bench_r = _rsb_returns(bench_close, last_date)
    rs = {k: (round(stock_r[k] - bench_r[k], 2) if stock_r[k] is not None and bench_r[k] is not None else None)
          for k, _ in RSB_WINDOWS}
    available = {k: v for k, v in rs.items() if v is not None}
    rs_score = None
    if available:
        wsum = sum(RSB_WEIGHTS[k] for k in available)
        rs_score = round(sum(v * RSB_WEIGHTS[k] for k, v in available.items()) / wsum, 2)

    common_idx = close_d.index.intersection(bench_close.index)
    rs_new_high = False
    if len(common_idx) > 1:
        ratio = close_d.loc[common_idx] / bench_close.loc[common_idx]
        rs_new_high = bool(ratio.iloc[-1] >= ratio.max())

    return {
        "benchmark": "NIFTY 500", "returns": stock_r, "benchmark_returns": bench_r,
        "rs": rs, "rs_score": rs_score, "rs_new_high": rs_new_high,
    }, None


def _rsi_series(close, period=14):
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - 100 / (1 + rs)
    return rsi.where(avg_loss != 0, 100.0)


def _mab_analyze(close, ohlc4, ema_period, recency_periods):
    """Same math as momentum_screeners.py's _mab_analyze, but never
    returns None outright — the Guide page wants to SHOW where a stock
    stands even when it doesn't currently qualify as a fresh breakout
    (e.g. "above the 200D EMA but crossed 40 weeks ago" is still useful
    context), so booleans (recent_cross/not_extended) carry the
    pass/fail instead of a None short-circuit."""
    if len(close) < ema_period + recency_periods + 20:
        return None
    ema = ohlc4.ewm(span=ema_period, adjust=False).mean()
    above = close > ema
    last_close, last_ema = float(close.iloc[-1]), float(ema.iloc[-1])
    if not bool(above.iloc[-1]):
        return {"above": False, "ema": round(last_ema, 2)}
    i = len(above) - 1
    while i > 0 and bool(above.iloc[i - 1]):
        i -= 1
    periods_since_cross = None if i == 0 else len(above) - 1 - i
    pct_above = round((last_close / last_ema - 1) * 100, 2)
    return {
        "above": True, "ema": round(last_ema, 2), "pct_above": pct_above,
        "periods_since_cross": periods_since_cross,
        "recent_cross": periods_since_cross is not None and periods_since_cross <= recency_periods,
        "not_extended": pct_above <= MAB_MAX_PCT_ABOVE,
    }


def fetch_technicals(symbol):
    """symbol: bare NSE symbol (no .NS suffix). Returns (dict, None) on
    success, (None, error_message) on failure — same shape convention
    as _screener_fetch.fetch_one()."""
    start = (date.today() - timedelta(days=365 * FETCH_YEARS)).isoformat()
    try:
        df = yf.download(f"{symbol}.NS", start=start, interval="1d",
                          auto_adjust=True, progress=False)
    except Exception as e:
        return None, f"yfinance fetch failed: {e}"
    if df is None or df.empty:
        return None, f"no yfinance price history for {symbol}.NS"
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.dropna(subset=["Close"])
    if len(df) < MIN_DAILY_BARS:
        return None, f"only {len(df)} days of price history — too little to score reliably"

    close_d, open_d, low_d = df["Close"], df["Open"], df["Low"]
    ohlc4_d = (df["Open"] + df["High"] + df["Low"] + df["Close"]) / 4

    weekly = df.resample("W-FRI").agg(
        {"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    close_w = weekly["Close"]
    ohlc4_w = (weekly["Open"] + weekly["High"] + weekly["Low"] + weekly["Close"]) / 4
    monthly_close = close_d.resample("ME").last().dropna()

    result = {"price": round(float(close_d.iloc[-1]), 2)}

    # --- RSI across all three timeframes, for the Guide page's Technical panel ---
    rsi_d_series_early = _rsi_series(close_d, 14).dropna()
    result["rsi_d"] = round(float(rsi_d_series_early.iloc[-1]), 1) if len(rsi_d_series_early) else None

    # --- StrongStockScreener (SSS) mirrors, added 2026-08-30 ---
    # Viraj Logic's C2: plain Close-based 200-day EMA (Chartink's own
    # "latest close > latest ema(close,200)" clause) — deliberately
    # separate from MA Breakout's OHLC4-based 200D EMA above (same
    # "duplicate rather than let one screener silently drift another"
    # reasoning as every other mirrored formula in this file).
    viraj_above_200d_close_ema = None
    if len(close_d) >= 200:
        ema200_close = close_d.ewm(span=200, adjust=False).mean()
        viraj_above_200d_close_ema = bool(close_d.iloc[-1] > ema200_close.iloc[-1])
    result["viraj_above_200d_close_ema"] = viraj_above_200d_close_ema

    # Quant Logic's Layer 4 momentum: 1Y total return ÷ stdev(daily
    # returns) over that same year — a Sharpe-like smoothness score,
    # self-computed here (unlike StrongStockScreener's Viraj-list variant,
    # which borrows momoindiascreener's own sharpe_1yr field — no such
    # field exists for an arbitrary company typed into Guide).
    quant_momentum = None
    if len(close_d) >= 200:
        window = close_d[close_d.index >= close_d.index[-1] - pd.Timedelta(days=365)]
        if len(window) >= 100:
            total_return = float(window.iloc[-1] / window.iloc[0] - 1)
            stdev = float(window.pct_change().dropna().std())
            quant_momentum = round(total_return / stdev, 2) if stdev else None
    result["quant_momentum"] = quant_momentum

    # --- myLongTermInvestingStrategy mirror: weekly RSI>66 + 12/21/33W EMA ribbon (Close-based) ---
    ltis = None
    rsi_w_series = _rsi_series(close_w, LTIS_RSI_PERIOD).dropna()
    if len(rsi_w_series) >= 5:
        ema_w = {p: close_w.ewm(span=p, adjust=False).mean() for p in LTIS_EMA_PERIODS}
        if all(not pd.isna(ema_w[p].iloc[-1]) for p in LTIS_EMA_PERIODS):
            rsi_w = float(rsi_w_series.iloc[-1])
            last_close_w = float(close_w.iloc[-1])
            above_12 = last_close_w > float(ema_w[12].iloc[-1])
            above_21 = last_close_w > float(ema_w[21].iloc[-1])
            above_33 = last_close_w > float(ema_w[33].iloc[-1])
            ltis = {
                "rsi_w": round(rsi_w, 1), "rsi_w_pass": rsi_w > LTIS_RSI_THRESHOLD,
                "ema12w": round(float(ema_w[12].iloc[-1]), 2), "above_ema12w": above_12,
                "ema21w": round(float(ema_w[21].iloc[-1]), 2), "above_ema21w": above_21,
                "ema33w_close": round(float(ema_w[33].iloc[-1]), 2), "above_ema33w": above_33,
                "above_ribbon": above_12 and above_21 and above_33,
            }
    result["ltis"] = ltis

    # --- MA Breakout mirror: 200D / 33W EMA on OHLC4 ---
    result["ma_breakout"] = {
        "d200": _mab_analyze(close_d, ohlc4_d, MAB_DAILY_EMA_PERIOD, MAB_RECENCY_WEEKS * 5),
        "w33": _mab_analyze(close_w, ohlc4_w, MAB_WEEKLY_EMA_PERIOD, MAB_RECENCY_WEEKS),
    }

    # --- VCP-style daily EMA(10)/EMA(20) contraction ---
    contraction = None
    if len(close_d) >= 25:
        ema10 = close_d.ewm(span=10, adjust=False).mean()
        ema20 = close_d.ewm(span=20, adjust=False).mean()
        diff = (ema10 - ema20).abs()
        contraction = bool(diff.iloc[-1] < diff.iloc[-1 - VCP_LOOKBACK_1]
                            and diff.iloc[-1] < diff.iloc[-1 - VCP_LOOKBACK_2])
    result["vcp_contraction"] = contraction

    # --- Value RSI Turnaround mirror: monthly RSI crossed 40, progressing, capped at 60 ---
    val = None
    rsi_m_series = _rsi_series(monthly_close, 14).dropna()
    if len(rsi_m_series) >= VAL_RECENCY_MONTHS + 5:
        above = rsi_m_series > VAL_RSI_THRESHOLD
        current_rsi_m = float(rsi_m_series.iloc[-1])
        val = {"rsi_m": round(current_rsi_m, 1), "active": False}
        if bool(above.iloc[-1]):
            i = len(above) - 1
            while i > 0 and bool(above.iloc[i - 1]):
                i -= 1
            if i > 0:
                months_since_cross = len(above) - 1 - i
                rsi_at_cross = float(rsi_m_series.iloc[i])
                if (months_since_cross <= VAL_RECENCY_MONTHS and current_rsi_m > rsi_at_cross
                        and current_rsi_m <= VAL_RSI_UPPER_CAP):
                    val["active"] = True
                    val["months_since_cross"] = months_since_cross
                    val["rsi_at_cross"] = round(rsi_at_cross, 1)
    result["value_rsi_turnaround"] = val

    # --- Grandfather-Father-Son mirror ---
    gfs = None
    rsi_d_series = rsi_d_series_early
    if len(rsi_m_series) and len(rsi_w_series) and len(rsi_d_series) >= GFS_LOOKBACK_DAYS + 5:
        monthly_rsi, weekly_rsi = float(rsi_m_series.iloc[-1]), float(rsi_w_series.iloc[-1])
        gfs = {"monthly_rsi": round(monthly_rsi, 1), "weekly_rsi": round(weekly_rsi, 1), "active": False}
        if monthly_rsi > GFS_HIGHER_TF_RSI_THRESHOLD and weekly_rsi > GFS_HIGHER_TF_RSI_THRESHOLD:
            recent_idx = rsi_d_series.index[-GFS_LOOKBACK_DAYS:]
            candidates = [d for d in recent_idx
                          if GFS_SUPPORT_LOW <= rsi_d_series.loc[d] <= GFS_SUPPORT_HIGH
                          and close_d.loc[d] > open_d.loc[d]]
            if candidates:
                trigger_date = candidates[-1]
                trigger_rsi = float(rsi_d_series.loc[trigger_date])
                current_daily_rsi = float(rsi_d_series.iloc[-1])
                trigger_low = float(low_d.loc[trigger_date])
                after = low_d.loc[low_d.index > trigger_date]
                stopped_out = (not after.empty) and float(after.min()) < trigger_low
                if current_daily_rsi >= trigger_rsi and not stopped_out:
                    gfs.update({
                        "active": True, "daily_rsi": round(current_daily_rsi, 1),
                        "daily_rsi_at_support": round(trigger_rsi, 1),
                        "stop_loss": round(trigger_low, 2),
                        "days_since_support": int((close_d.index > trigger_date).sum()),
                    })
    result["grandfather_father_son"] = gfs

    rs_benchmark, _rsb_err = fetch_rs_benchmark(symbol, close_d)
    result["rs_benchmark"] = rs_benchmark  # None on failure — best-effort, doesn't fail the whole technicals fetch

    return result, None


# ── Checklist assembly (merges the fundamentals fetch_one() already
# returns with fetch_technicals() above into the Guide page's scored
# checklist) ─────────────────────────────────────────────────────────

# Sector Leader Compare skill's fundamental quality bar — ROE/ROCE/
# cash-conversion thresholds are this feature's own reasonable-quality
# bar (not lifted from an existing screener the way the technicals
# above are), since none of this app's existing screeners score those
# three. DOL threshold reused verbatim from viraj_screen.py's F1 rule
# (`dol > 1.5`), computed here on an ANNUAL basis (fetch_one() only
# returns annual P&L rows in the shape this needs) where viraj_screen's
# own F1 uses the latest quarter YoY — a deliberate basis difference,
# not an inconsistency: different screener, different cadence, same
# already-established threshold.
FUND_ROE_THRESHOLD = 15.0
FUND_ROCE_THRESHOLD = 15.0
FUND_CASH_CONVERSION_THRESHOLD = 80.0
FUND_DOL_THRESHOLD = 1.5


def _mab_active(d):
    return bool(d and d.get("above") and d.get("recent_cross") and d.get("not_extended"))


def build_checklist(fund, tech):
    from _screener_fetch import yoy_series

    items_f = []

    rev_g = [v for v in (fund.get("revenue_growth_pct") or []) if v is not None]
    latest_rev_g = rev_g[-1] if rev_g else None
    items_f.append({
        "key": "revenue_growth", "label": "Revenue growth positive (latest FY, YoY)",
        "value": f"{latest_rev_g:+.1f}%" if latest_rev_g is not None else "—",
        "pass": None if latest_rev_g is None else latest_rev_g > 0,
    })

    qrg = [v for v in (fund.get("q_revenue_growth_pct") or []) if v is not None]
    if len(qrg) >= 2:
        cur_q, prev_q = qrg[-1], qrg[-2]
        items_f.append({
            "key": "revenue_accel", "label": "Quarterly revenue growth accelerating (latest Q YoY vs prior Q YoY)",
            "value": f"{cur_q:+.1f}% vs {prev_q:+.1f}%", "pass": cur_q > prev_q,
        })
    else:
        items_f.append({"key": "revenue_accel", "label": "Quarterly revenue growth accelerating (latest Q YoY vs prior Q YoY)",
                         "value": "—", "pass": None})

    op_g = [v for v in yoy_series(fund.get("operating_profit") or []) if v is not None]
    dol = round(op_g[-1] / latest_rev_g, 2) if (op_g and latest_rev_g not in (None, 0)) else None
    items_f.append({
        "key": "dol", "label": f"Operating leverage: OP growth ÷ Sales growth > {FUND_DOL_THRESHOLD} (annual)",
        "value": str(dol) if dol is not None else "—", "pass": None if dol is None else dol > FUND_DOL_THRESHOLD,
    })

    eps_list = fund.get("eps") or []
    eps_idx = [i for i, v in enumerate(eps_list) if v is not None]
    eps_pass, eps_val = None, "—"
    if len(eps_idx) >= 2:
        e_cur, e_prev = eps_list[eps_idx[-1]], eps_list[eps_idx[-2]]
        if e_prev < 0 and e_cur > 0:
            eps_pass, eps_val = True, "Turned profitable"
        elif e_prev != 0:
            g = round((e_cur - e_prev) / abs(e_prev) * 100, 1)
            eps_pass, eps_val = g > 0, f"{g:+.1f}%"
    items_f.append({"key": "eps_growth", "label": "EPS growth positive (latest FY, YoY)", "value": eps_val, "pass": eps_pass})

    roe = fund.get("roe_pct")
    items_f.append({"key": "roe", "label": f"ROE > {FUND_ROE_THRESHOLD:.0f}%",
                     "value": f"{roe:.1f}%" if roe is not None else "—",
                     "pass": None if roe is None else roe > FUND_ROE_THRESHOLD})

    roce = fund.get("roce_pct")
    items_f.append({"key": "roce", "label": f"ROCE > {FUND_ROCE_THRESHOLD:.0f}%",
                     "value": f"{roce:.1f}%" if roce is not None else "—",
                     "pass": None if roce is None else roce > FUND_ROCE_THRESHOLD})

    cc = fund.get("cash_conversion_pct")
    items_f.append({"key": "cash_conversion", "label": f"Cash conversion (CFO ÷ Operating Profit) > {FUND_CASH_CONVERSION_THRESHOLD:.0f}%",
                     "value": f"{cc:.0f}%" if cc is not None else "—",
                     "pass": None if cc is None else cc > FUND_CASH_CONVERSION_THRESHOLD})

    items_t = []
    ltis = (tech or {}).get("ltis")
    items_t.append({"key": "weekly_rsi", "label": f"Weekly RSI(14) > {LTIS_RSI_THRESHOLD} (Minervini SEPA)",
                     "value": f"{ltis['rsi_w']}" if ltis else "—", "pass": ltis["rsi_w_pass"] if ltis else None})
    items_t.append({"key": "ema_ribbon", "label": "Price above 12W/21W/33W EMA (Long-Term Investing Strategy)",
                     "value": "—" if not ltis else ("Yes" if ltis["above_ribbon"] else "No"),
                     "pass": ltis["above_ribbon"] if ltis else None})

    mab = (tech or {}).get("ma_breakout") or {}
    d200, w33 = mab.get("d200"), mab.get("w33")
    above_any = [d for d in (d200, w33) if d and d.get("above")]
    above_pass = (bool(above_any) if (d200 or w33) else None)
    items_t.append({"key": "above_ma", "label": "Price above 200D EMA or 33W EMA (OHLC4)",
                     "value": "—" if above_pass is None else ("Yes" if above_pass else "No"), "pass": above_pass})
    if above_any:
        not_ext_pass = any(d.get("not_extended") for d in above_any)
        best_pct = min(d["pct_above"] for d in above_any)
        not_ext_val = f"{best_pct:+.1f}%"
    else:
        not_ext_pass, not_ext_val = None, "—"
    items_t.append({"key": "not_extended", "label": f"Not overextended — within {MAB_MAX_PCT_ABOVE:.0f}% of that EMA",
                     "value": not_ext_val, "pass": not_ext_pass})

    vcp = (tech or {}).get("vcp_contraction")
    items_t.append({"key": "vcp", "label": "Daily EMA(10)/EMA(20) contracting (VCP-style tightening)",
                     "value": "—" if vcp is None else ("Yes" if vcp else "No"), "pass": vcp})

    def _tally(items):
        applicable = [it for it in items if it["pass"] is not None]
        return sum(1 for it in applicable if it["pass"]), len(applicable)

    f_passed, f_applicable = _tally(items_f)
    t_passed, t_applicable = _tally(items_t)
    total_passed, total_applicable = f_passed + t_passed, f_applicable + t_applicable
    pct = round(total_passed / total_applicable * 100) if total_applicable else 0
    if total_applicable == 0:
        verdict = "Not enough data to score"
    elif pct >= 80:
        verdict = "Strong checklist match"
    elif pct >= 50:
        verdict = "Partial match — watchlist"
    else:
        verdict = "Weak match"

    entry_setups = {"ma_breakout": None, "value_rsi_turnaround": None, "grandfather_father_son": None}
    if tech:
        entry_setups["ma_breakout"] = {"active": _mab_active(d200) or _mab_active(w33), "d200": d200, "w33": w33}
        vrt = tech.get("value_rsi_turnaround")
        entry_setups["value_rsi_turnaround"] = {"active": bool(vrt and vrt.get("active")), **(vrt or {})}
        gfs = tech.get("grandfather_father_son")
        entry_setups["grandfather_father_son"] = {"active": bool(gfs and gfs.get("active")), **(gfs or {})}

    return {
        "fundamentals": {"items": items_f, "passed": f_passed, "applicable": f_applicable},
        "technicals": {"items": items_t, "passed": t_passed, "applicable": t_applicable},
        "entry_setups": entry_setups,
        "score": {"passed": total_passed, "applicable": total_applicable, "pct": pct, "verdict": verdict},
    }


# ── FundamentalTrend mirror (full port, added 2026-08-30) ───────────
# Same math as ~/.claude/skills/FundamentalTrend/scripts/
# fundamental_trend.py, reusing fetch_one()'s already-fetched annual
# P&L/Balance Sheet/Cash Flow/Ratios rows instead of a second fetch.

def _ft_cagr(vals, years_back):
    if vals is None or len(vals) <= years_back:
        return None, "insufficient history"
    latest, base = vals[-1], vals[-1 - years_back]
    if latest is None or base is None:
        return None, "no data"
    if base <= 0 and latest <= 0:
        return None, "n/a"
    if base <= 0 < latest:
        return None, "turned positive"
    if base > 0 and latest <= 0:
        return None, "turned negative"
    return round(((latest / base) ** (1 / years_back) - 1) * 100, 1), None


def _ft_point_change(vals, years_back):
    if vals is None or len(vals) <= years_back:
        return None, "insufficient history"
    latest, base = vals[-1], vals[-1 - years_back]
    if latest is None or base is None:
        return None, "no data"
    return round(latest - base, 1), None


def _ft_trend(vals, n):
    """Directional check over the trailing n points, allowing one wobble
    against the overall direction — used only for the deterioration
    flag, independent of the 1Y/3Y/5Y table."""
    pts = [v for v in (vals or []) if v is not None][-n:]
    if len(pts) < 3:
        return "insufficient data"
    steps = [pts[i] - pts[i - 1] for i in range(1, len(pts))]
    up, down = sum(1 for s in steps if s > 0), sum(1 for s in steps if s < 0)
    avg = sum(pts) / len(pts)
    net_pct = ((pts[-1] - pts[0]) / avg * 100) if avg else 0
    if abs(net_pct) < 5:
        return "flat"
    if pts[-1] > pts[0] and up >= down + 1:
        return "up"
    if pts[-1] < pts[0] and down >= up + 1:
        return "down"
    return "mixed"


def build_fundamental_trend(fund):
    growth_metrics = [
        ("Sales", fund.get("revenue")), ("Operating Profit", fund.get("operating_profit")),
        ("EPS", fund.get("eps")), ("Borrowings", fund.get("borrowings")),
        ("Operating Cash Flow", fund.get("cfo")),
    ]
    growth_rows = []
    for label, vals in growth_metrics:
        row = {"label": label}
        for yrs in (1, 3, 5):
            g, note = _ft_cagr(vals, yrs)
            row[f"y{yrs}"], row[f"y{yrs}_note"] = g, note
        growth_rows.append(row)

    ratio_metrics = [
        ("Debtor Days", fund.get("debtor_days")), ("Inventory Days", fund.get("inventory_days")),
        ("Days Payable", fund.get("days_payable")), ("Cash Conversion Cycle", fund.get("cash_conversion_cycle")),
        ("Working Capital Days", fund.get("working_capital_days_annual")),
        ("ROCE %", fund.get("roce_series")), ("ROE % (computed)", fund.get("roe_series")),
    ]
    ratio_rows = []
    for label, vals in ratio_metrics:
        row = {"label": label}
        for yrs in (1, 3, 5):
            d, note = _ft_point_change(vals, yrs)
            row[f"y{yrs}"], row[f"y{yrs}_note"] = d, note
        ratio_rows.append(row)

    # Cash Conversion Deterioration flag — Working Capital Days is the
    # PRIMARY trigger (not Cash Conversion Cycle, which is blind to
    # anything outside Inventory/Debtor/Payable Days); CCC/Inventory
    # Days are diagnostic support, not required AND-conditions.
    wc, roce = fund.get("working_capital_days_annual"), fund.get("roce_series")
    ccc, inv = fund.get("cash_conversion_cycle"), fund.get("inventory_days")
    have_core = wc is not None and roce is not None
    deteriorating = have_core and _ft_trend(wc, 5) == "up" and _ft_trend(roce, 5) == "down"
    return {
        "growth": growth_rows, "ratios": ratio_rows,
        "deterioration_flag": {
            "scoreable": have_core, "deteriorating": deteriorating if have_core else None,
            "ccc_confirms": bool(ccc is not None and _ft_trend(ccc, 5) == "up"),
            "inventory_confirms": bool(inv is not None and _ft_trend(inv, 5) == "up"),
        },
    }


# ── MultibaggerChecklist mirror — numbers-only subset (added
# 2026-08-30) — 11 of the skill's 12 Compounding Engine Checklist
# points; skips point 1 (order-book judgment: reading actual BSE
# filing text to tell a binding order from a soft framework needs
# human/AI judgment, not a deterministic backend check) and the bull/
# bear prose synthesis the real skill adds on top — Harish's own
# explicit scoping choice for this endpoint. Same math/thresholds as
# ~/.claude/skills/MultibaggerChecklist/scripts/multibagger_checklist.py.

def _mc_dilution_timeline(fund):
    face_value, equity_capital = fund.get("face_value"), fund.get("equity_capital")
    years = fund.get("balance_sheet_years") or fund.get("years")
    if not equity_capital or not face_value:
        return None
    shares = [round(v / face_value, 4) if v is not None else None for v in equity_capital]
    out = {"years": years, "shares_cr": shares}
    for label, back in [("1Y", 1), ("3Y", 3), ("5Y", 5)]:
        v, note = _ft_point_change(shares, back)
        pct = round(v / shares[-1 - back] * 100, 1) if (v is not None and shares[-1 - back]) else None
        out[label] = {"new_shares_cr": v, "pct": pct, "note": note}
    return out


def _mc_quarterly_concentration(fund):
    net_profit = fund.get("q_net_profit")
    if not net_profit or len(net_profit) < 4:
        return None
    last4 = [v for v in net_profit[-4:] if v is not None]
    latest = net_profit[-1]
    concentration = round(latest / sum(last4) * 100, 1) if (last4 and latest is not None and sum(last4) != 0) else None
    return {
        "quarters": fund.get("quarters"), "sales": fund.get("q_revenue"),
        "net_profit": net_profit, "eps": fund.get("q_eps"),
        "latest_quarter_pct_of_ttm_profit": concentration,
        "concentrated": (abs(concentration) > 55) if concentration is not None else None,
    }


def _mc_rate_of_change(series, n_prior=3):
    """Is the latest year-over-year point-change bigger than the average
    of the PRIOR point-changes (an acceleration, not just an
    improvement)? None if there isn't enough history for a 'prior
    average pace' comparison."""
    pts = [v for v in (series or []) if v is not None]
    if len(pts) < n_prior + 2:
        return None
    changes = [pts[i] - pts[i - 1] for i in range(1, len(pts))]
    latest = changes[-1]
    prior = changes[-(n_prior + 1):-1]
    prior_avg = sum(prior) / len(prior)
    return {"latest_change": round(latest, 1), "prior_avg_change": round(prior_avg, 1),
            "accelerating": latest > 0 and latest > prior_avg}


def _mc_ascending_check(current, v1, v3, v5):
    """Pass if current is below EACH of v1/v3/v5 independently (not a
    chained current<v1<v3<v5 — a single volatile benchmark year can
    break that stricter reading even when current is genuinely the
    best of the four). None (not scoreable) if any value is missing."""
    vals = [current, v1, v3, v5]
    return None if any(v is None for v in vals) else (current < v1 and current < v3 and current < v5)


def _mc_signed_change(vals, years_back):
    """Linear normalized rate (latest-base)/abs(base)/years — stays
    defined for a negative base (WC Days/CCC are legitimately negative
    for a capital-efficient, supplier-financed business), unlike a
    geometric CAGR which needs a positive base."""
    if vals is None or len(vals) <= years_back:
        return None
    latest, base = vals[-1], vals[-1 - years_back]
    if latest is None or base is None or base == 0:
        return None
    return ((latest - base) / abs(base) / years_back) * 100.0


def _mc_wc_ccc_check(n, name, metric_vals, sales_vals, metric_label):
    windows = [("1Y", 1), ("3Y", 3), ("5Y", 5)]
    detail = {}
    for w, back in windows:
        m, s = _mc_signed_change(metric_vals, back), _mc_signed_change(sales_vals, back)
        ok = None if (m is None or s is None) else m <= s
        detail[w] = {"pass": ok, "metric_pct": round(m, 1) if m is not None else None,
                     "sales_pct": round(s, 1) if s is not None else None}
    subchecks = [d["pass"] for d in detail.values()]
    overall = None if any(v is None for v in subchecks) else all(subchecks)
    parts = []
    for w, _ in windows:
        d = detail[w]
        parts.append(f"{w} n/a" if d["pass"] is None else
                      f"{w} {metric_label} {d['metric_pct']:+.1f}% vs Sales {d['sales_pct']:+.1f}% [{'OK' if d['pass'] else 'X'}]")
    return {"n": n, "name": name, "pass": overall, "windows": detail, "detail": " | ".join(parts)}


def _mc_cmp3y(by_label, a, b, allow_equal=False):
    va, vb = by_label[a].get("y3"), by_label[b].get("y3")
    if va is None or vb is None:
        return None
    # allow_equal: 0% dilution makes EPS growth mathematically EQUAL to
    # Net Profit growth, not greater — an epsilon treats "keeping pace"
    # as a pass, same as "outpacing".
    return va >= vb - 0.05 if allow_equal else va > vb


def build_compounding_checklist(fund):
    sales, op = fund.get("revenue"), fund.get("operating_profit")
    netprofit, eps, borrow = fund.get("net_profit"), fund.get("eps"), fund.get("borrowings")

    growth_rows = []
    for label, vals in [("Sales Growth", sales), ("Operating Profit Growth", op),
                         ("Net Profit Growth", netprofit), ("EPS Growth", eps),
                         ("Borrowing Growth", borrow)]:
        row = {"label": label}
        for yrs in (1, 3, 5):
            row[f"y{yrs}"], _ = _ft_cagr(vals, yrs)
        growth_rows.append(row)
    by_label = {r["label"]: r for r in growth_rows}

    dilution = _mc_dilution_timeline(fund)
    dilution_3y = dilution["3Y"]["pct"] if dilution else None
    sales_3y = by_label["Sales Growth"].get("y3")

    def pct_str(v):
        return "—" if v is None else f"{v:+.1f}%"

    checks = [
        {"n": 2, "name": "Rising volume/revenue",
         "pass": None if sales_3y is None else sales_3y > 0,
         "detail": f"Sales 3Y CAGR {pct_str(sales_3y)}"},
        {"n": 3, "name": "Operating leverage (Op. Profit growing faster than Sales)",
         "pass": _mc_cmp3y(by_label, "Operating Profit Growth", "Sales Growth"),
         "detail": f"Op.Profit {pct_str(by_label['Operating Profit Growth'].get('y3'))} vs Sales {pct_str(sales_3y)} (3Y)"},
        {"n": 4, "name": "Net Profit growing faster than Sales",
         "pass": _mc_cmp3y(by_label, "Net Profit Growth", "Sales Growth"),
         "detail": f"Net Profit {pct_str(by_label['Net Profit Growth'].get('y3'))} vs Sales {pct_str(sales_3y)} (3Y)"},
        {"n": 5, "name": "Minimal dilution",
         "pass": None if dilution_3y is None else abs(dilution_3y) < 10,
         "detail": f"Share count 3Y change: {pct_str(dilution_3y)}"},
        {"n": 6, "name": "Debt growing slower than Sales (controlled, not necessarily falling)",
         "pass": _mc_cmp3y(by_label, "Sales Growth", "Borrowing Growth"),
         "detail": f"Sales {pct_str(sales_3y)} vs Borrowings {pct_str(by_label['Borrowing Growth'].get('y3'))} (3Y)"},
        {"n": 7, "name": "EPS keeping pace with or outpacing Net Profit (no-dilution amplifier)",
         "pass": _mc_cmp3y(by_label, "EPS Growth", "Net Profit Growth", allow_equal=True),
         "detail": f"EPS {pct_str(by_label['EPS Growth'].get('y3'))} vs Net Profit {pct_str(by_label['Net Profit Growth'].get('y3'))} (3Y)"},
    ]

    def accel_detail(accel):
        return "insufficient history for a prior-pace comparison" if not accel else \
            f"latest change {accel['latest_change']:+.1f}pts vs prior avg {accel['prior_avg_change']:+.1f}pts/yr"

    roce_accel = _mc_rate_of_change(fund.get("roce_series"))
    roe_accel = _mc_rate_of_change(fund.get("roe_series"))
    checks.append({"n": 9, "name": "ROCE accelerating (not just improving)",
                    "pass": roce_accel["accelerating"] if roce_accel else None,
                    "detail": accel_detail(roce_accel), "raw": roce_accel})
    checks.append({"n": 10, "name": "ROE accelerating (not just improving)",
                    "pass": roe_accel["accelerating"] if roe_accel else None,
                    "detail": accel_detail(roe_accel), "raw": roe_accel})

    pe_trail = fund.get("pe_trailing_averages")
    pe_ok = _mc_ascending_check(pe_trail.get("current"), pe_trail.get("avg_1y"), pe_trail.get("avg_3y"), pe_trail.get("avg_5y")) if pe_trail else None
    pe_detail = ("insufficient PE chart history" if not pe_trail else
                 f"PE now {pe_trail['current']:g} | 1Y avg {pe_trail['avg_1y']:g} | 3Y avg {pe_trail['avg_3y']:g} | 5Y avg {pe_trail['avg_5y']:g}")
    checks.append({"n": 8, "name": "Current PE below its own 1Y/3Y/5Y trailing averages (re-rating room, not already spent)",
                    "pass": pe_ok, "detail": pe_detail, "raw": pe_trail})

    checks.append(_mc_wc_ccc_check(11, "Working Capital Days change <= Sales change (1Y and 3Y and 5Y)",
                                    fund.get("working_capital_days_annual"), sales, "WC"))
    checks.append(_mc_wc_ccc_check(12, "Cash Conversion Cycle change <= Sales change (1Y and 3Y and 5Y)",
                                    fund.get("cash_conversion_cycle"), sales, "CCC"))
    checks.sort(key=lambda c: c["n"])

    n_pass = sum(1 for c in checks if c["pass"] is True)
    n_scored = sum(1 for c in checks if c["pass"] is not None)

    # Mechanical "Pattern match vs ACE" verdict — a deterministic count
    # of matched/diverged/unscoreable checks, NOT the Claude-written
    # bull/bear synthesis the real skill layers on top (that needs
    # judgment — e.g. is a dilution divergence a red flag or a
    # deleveraging raise? — and stays out of this endpoint per Harish's
    # own scoping choice, 2026-08-30).
    matched = [c["name"] for c in checks if c["pass"] is True]
    diverged = [c["name"] for c in checks if c["pass"] is False]
    if n_scored == 0:
        pattern_verdict = "Not yet determinable — too little reporting history"
    elif len(matched) == n_scored and not diverged:
        pattern_verdict = "REPLICATES the ACE pattern"
    elif len(matched) / n_scored >= 0.5:
        pattern_verdict = "PARTIALLY replicates the ACE pattern"
    else:
        pattern_verdict = "DOES NOT replicate the ACE pattern"

    return {
        "dilution": dilution, "quarterly_concentration": _mc_quarterly_concentration(fund),
        "checks": checks, "passed": n_pass, "scored": n_scored,
        "pattern_verdict": pattern_verdict, "matched": matched, "diverged": diverged,
    }


# ── Guide page view (added 2026-08-30, "page can be improved, lets
# have columns...") — wraps build_checklist() (still the source of the
# score badge) with the data Harish actually asked to see: last-3-
# period growth tables (quarterly + annual), a current-state Ratios
# panel, an RSI-across-3-timeframes panel, and a per-EMA-period Y/N
# price panel. ──────────────────────────────────────────────────────

PEG_MIN_YEARS = 3  # 3 annual EPS points = 2 YoY steps for the CAGR


def _last_n_periods(labels, series_map, n=3):
    """labels: full period-label list (already trimmed to whatever
    fetch_one()/clean_stock() kept). series_map: {field_name: values},
    same length/index alignment as labels. Returns up to the last n
    periods as a list of {"period": ..., **row}, oldest first — None
    values pass through as None (rendered as "—" by the frontend)."""
    n_avail = len(labels)
    take = min(n, n_avail)
    if take <= 0:
        return []
    out = []
    for i in range(n_avail - take, n_avail):
        row = {"period": labels[i]}
        for field, vals in series_map.items():
            row[field] = vals[i] if i < len(vals) else None
        out.append(row)
    return out


def _cagr_pct(vals, min_years=PEG_MIN_YEARS):
    """CAGR% over the last `min_years` non-None values of an annual
    series (e.g. EPS) — None if there aren't enough clean points or the
    earliest of them isn't positive (a CAGR off a loss/zero base is
    undefined, not just a small/negative number)."""
    clean = [v for v in vals if v is not None]
    if len(clean) < min_years:
        return None
    first, last = clean[-min_years], clean[-1]
    if first is None or first <= 0:
        return None
    years = min_years - 1
    return round(((last / first) ** (1 / years) - 1) * 100, 1)


def build_guide_view(fund, tech):
    from _screener_fetch import yoy_series

    checklist = build_checklist(fund, tech)

    quarters = fund.get("quarters") or []
    quarterly_table = _last_n_periods(quarters, {
        "sales_growth_pct": fund.get("q_revenue_growth_pct") or [],
        "op_growth_pct": fund.get("q_operating_profit_growth_pct") or [],
        "opm_pct": fund.get("q_opm_pct") or [],
        "eps": fund.get("q_eps") or [],
    })

    years = fund.get("years") or []
    op_growth_annual = yoy_series(fund.get("operating_profit") or [])
    annual_table = _last_n_periods(years, {
        "sales_growth_pct": fund.get("revenue_growth_pct") or [],
        "op_growth_pct": op_growth_annual,
        "opm_pct": fund.get("opm_pct") or [],
        "eps": fund.get("eps") or [],
    })

    eps_cagr = _cagr_pct(fund.get("eps") or [])
    pe = fund.get("pe_ratio")
    peg = round(pe / eps_cagr, 2) if (pe is not None and eps_cagr and eps_cagr > 0) else None
    latest_q_opm = next((v for v in reversed(fund.get("q_opm_pct") or []) if v is not None), None)

    ratios = {
        "pe": pe,
        "gpm_pct": None,  # Screener.in has no distinct Gross Profit line in its standard P&L — genuinely unavailable, not a fetch failure
        "opm_pct": latest_q_opm,
        "peg": peg,
        "roe_pct": fund.get("roe_pct"),
        "roce_pct": fund.get("roce_pct"),
        "working_capital_days": fund.get("working_capital_days"),
    }

    ltis = (tech or {}).get("ltis")
    rsi = {
        "daily": (tech or {}).get("rsi_d"),
        "weekly": ltis["rsi_w"] if ltis else None,
        "monthly": (tech or {}).get("value_rsi_turnaround", {}).get("rsi_m") if tech and tech.get("value_rsi_turnaround") else None,
    }

    prices = None
    if ltis:
        prices = {
            "ema12w": {"value": ltis["ema12w"], "above": ltis["above_ema12w"]},
            "ema21w": {"value": ltis["ema21w"], "above": ltis["above_ema21w"]},
            "ema33w": {"value": ltis["ema33w_close"], "above": ltis["above_ema33w"]},
        }

    return {
        **checklist,
        "quarterly_table": quarterly_table,
        "annual_table": annual_table,
        "ratios": ratios,
        "rsi": rsi,
        "prices": prices,
        "fundamental_trend": build_fundamental_trend(fund),
        "compounding_checklist": build_compounding_checklist(fund),
        "rs_benchmark": (tech or {}).get("rs_benchmark"),
        "quant_logic": build_quant_layer(fund, tech),
        "viraj_logic": build_viraj_layer(fund, tech),
    }


# ── StrongStockScreener (SSS) mirrors, added 2026-08-30 — "create
# sections like QUANT, VIRAJ logic" — Quant Logic's 4-layer pipeline
# (Universe filter -> Quality -> Valuation -> Momentum) and Viraj
# Logic's 6-rule F1-F3/C1-C3 scoring, both applied to the single
# company Guide is checking rather than screening a whole universe.
# Same thresholds/formulas as ~/.claude/skills/StrongStockScreener.

QUANT_MCAP_MIN, QUANT_MCAP_MAX = 500.0, 20000.0
QUANT_ROCE_THRESHOLD = 12.0
QUANT_PE_THRESHOLD = 40.0


def _all_positive(vals, n):
    """True if the last n values are all present and > 0, False if all
    present but at least one <= 0, None if there aren't n clean values
    to judge at all."""
    window = (vals or [])[-n:]
    if len(window) < n or any(v is None for v in window):
        return None
    return all(v > 0 for v in window)


def build_quant_layer(fund, tech):
    mcap = fund.get("market_cap_cr")
    in_universe = None if mcap is None else (QUANT_MCAP_MIN <= mcap <= QUANT_MCAP_MAX)

    rev_g_3q = _all_positive(fund.get("q_revenue_growth_pct"), 3)
    earn_g_4q = _all_positive(fund.get("q_pat_growth_pct"), 4)

    opm = fund.get("q_opm_pct") or []
    margin_exp = None
    if len(opm) >= 8:
        latest4 = [v for v in opm[-4:] if v is not None]
        earliest4 = [v for v in opm[:4] if v is not None]
        if len(latest4) == 4 and len(earliest4) == 4:
            margin_exp = (sum(latest4) / 4) > (sum(earliest4) / 4)

    # ROCE (Quant's own definition, distinct from Screener's published
    # ROCE% already used elsewhere in Guide): TTM Operating Profit ÷
    # (Equity Capital + Reserves + Borrowings) from the latest annual
    # Balance Sheet.
    q_op = fund.get("q_operating_profit") or []
    ttm_op_vals = [v for v in q_op[-4:] if v is not None]
    ttm_op = sum(ttm_op_vals) if len(ttm_op_vals) == 4 else None
    eq, res, borrow = fund.get("equity_capital"), fund.get("reserves"), fund.get("borrowings")
    capital_employed = None
    if eq and res and eq[-1] is not None and res[-1] is not None:
        b = borrow[-1] if (borrow and borrow[-1] is not None) else 0.0
        capital_employed = eq[-1] + res[-1] + b
    quant_roce = round(ttm_op / capital_employed * 100, 1) if (ttm_op is not None and capital_employed not in (None, 0)) else None
    roce_pass = None if quant_roce is None else quant_roce > QUANT_ROCE_THRESHOLD

    # Valuation: trailing PE = latest price ÷ TTM EPS (sum of last 4
    # quarters) — Quant's own definition, may differ slightly from
    # Screener's own displayed pe_ratio (different EPS basis).
    q_eps = fund.get("q_eps") or []
    ttm_eps_vals = [v for v in q_eps[-4:] if v is not None]
    ttm_eps = sum(ttm_eps_vals) if len(ttm_eps_vals) == 4 else None
    price = fund.get("current_price")
    trailing_pe = round(price / ttm_eps, 1) if (price is not None and ttm_eps not in (None, 0)) else None
    pe_pass = None if trailing_pe is None else trailing_pe < QUANT_PE_THRESHOLD

    momentum = (tech or {}).get("quant_momentum")

    checks = [
        {"layer": "Layer 2: Quality", "key": "RevG3Q", "name": "Revenue growth positive, last 3 qtrs YoY",
         "pass": rev_g_3q, "detail": ", ".join(f"{v:+.1f}%" for v in (fund.get("q_revenue_growth_pct") or [])[-3:] if v is not None) or "—"},
        {"layer": "Layer 2: Quality", "key": "EarnG4Q", "name": "Earnings growth positive, last 4 qtrs YoY",
         "pass": earn_g_4q, "detail": ", ".join(f"{v:+.1f}%" for v in (fund.get("q_pat_growth_pct") or [])[-4:] if v is not None) or "—"},
        {"layer": "Layer 2: Quality", "key": "MarginExp", "name": "Margin expansion (latest 4Q avg OPM > earliest 4Q avg OPM)",
         "pass": margin_exp, "detail": (f"latest {sum(v for v in opm[-4:] if v is not None)/4:.1f}% vs earliest {sum(v for v in opm[:4] if v is not None)/4:.1f}%" if margin_exp is not None else "—")},
        {"layer": "Layer 2: Quality", "key": "ROCE", "name": f"ROCE > {QUANT_ROCE_THRESHOLD:.0f}% (TTM Op. Profit ÷ Capital Employed)",
         "pass": roce_pass, "detail": f"{quant_roce}%" if quant_roce is not None else "—"},
        {"layer": "Layer 3: Valuation", "key": "PE", "name": f"Trailing PE < {QUANT_PE_THRESHOLD:.0f}x (Price ÷ TTM EPS)",
         "pass": pe_pass, "detail": f"{trailing_pe}x" if trailing_pe is not None else "—"},
        {"layer": "Layer 4: Momentum", "key": "Momentum", "name": "1Y return ÷ stdev(daily returns) — higher = smoother/stronger trend",
         "pass": None, "detail": f"{momentum}" if momentum is not None else "—"},
    ]
    score = sum(1 for c in checks if c["pass"] is True)
    scored = sum(1 for c in checks if c["pass"] is not None)
    return {"in_universe": in_universe, "mcap": mcap, "checks": checks, "score": score, "scored": scored, "momentum": momentum}


def _vj_quarterly_yoy(cur, prev):
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur - prev) / abs(prev) * 100, 1)


def build_viraj_layer(fund, tech):
    q_eps = fund.get("q_eps") or []
    e_cur = q_eps[-1] if q_eps else None
    e_prev = q_eps[-5] if len(q_eps) >= 5 else None

    sales_g = (fund.get("q_revenue_growth_pct") or [None])[-1]
    ebit_g = (fund.get("q_operating_profit_growth_pct") or [None])[-1]

    eps_g, eps_turned = None, False
    if e_cur is not None and e_prev is not None:
        if e_prev < 0 and e_cur > 0:
            eps_turned = True
        elif e_prev > 0 and e_cur > 0:
            eps_g = _vj_quarterly_yoy(e_cur, e_prev)

    dol = round(ebit_g / sales_g, 2) if (ebit_g and sales_g) else None
    dfl = round(eps_g / ebit_g, 2) if (isinstance(eps_g, float) and ebit_g) else None
    f1 = None if dol is None else dol > 1.5
    f2 = None if dfl is None else dfl < 1.2

    q_op = fund.get("q_operating_profit") or []
    op_curr = q_op[-1] if q_op else None
    op_prev = q_op[-5] if len(q_op) >= 5 else None
    f3 = None if (op_curr is None or op_prev is None) else op_curr > op_prev

    ltis = (tech or {}).get("ltis")
    rsi_w = ltis["rsi_w"] if ltis else None
    c1 = ltis["rsi_w_pass"] if ltis else None
    c2 = (tech or {}).get("viraj_above_200d_close_ema")
    c3 = (tech or {}).get("vcp_contraction")

    rsi_d = (tech or {}).get("rsi_d")
    val = (tech or {}).get("value_rsi_turnaround")
    rsi_m = val.get("rsi_m") if val else None
    mcap = fund.get("market_cap_cr")
    in_universe = None
    if mcap is not None and rsi_d is not None and rsi_w is not None and rsi_m is not None:
        in_universe = mcap > 500 and rsi_d > 66 and rsi_w > 66 and rsi_m > 66

    checks = [
        {"key": "F1", "name": "DOL > 1.5 (EBIT growth outpaces Sales growth)",
         "pass": f1, "detail": f"DOL {dol} (EBIT {ebit_g:+.1f}% / Sales {sales_g:+.1f}%)" if dol is not None else "—"},
        {"key": "F2", "name": "DFL < 1.2 (EPS growth not over-levered vs EBIT growth)",
         "pass": f2, "detail": f"DFL {dfl}" if dfl is not None else ("EPS turned profitable — DFL n/a" if eps_turned else "—")},
        {"key": "F3", "name": "Latest quarter Operating Profit > same quarter last year",
         "pass": f3, "detail": f"{op_curr:g} vs {op_prev:g}" if (op_curr is not None and op_prev is not None) else "—"},
        {"key": "C1", "name": "Weekly RSI(14) > 66", "pass": c1, "detail": f"{rsi_w}" if rsi_w is not None else "—"},
        {"key": "C2", "name": "Price above 200-day EMA (Stage 2, Close-based)", "pass": c2, "detail": ""},
        {"key": "C3", "name": "Daily 10D & 20D EMA converging (coiling/basing)", "pass": c3, "detail": ""},
    ]
    score = sum(1 for c in checks if c["pass"] is True)
    scored = sum(1 for c in checks if c["pass"] is not None)
    return {"in_universe": in_universe, "checks": checks, "score": score, "scored": scored, "dol": dol, "dfl": dfl}
