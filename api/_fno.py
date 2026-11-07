"""F&O Flow: one row per F&O underlying from NSE's end-of-day F&O bhavcopy (UDiFF).

Source: https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_<YYYYMMDD>_F_0000.csv.zip (anonymous, same host as the
equity bhavcopy the app already reads). Idea taken from github.com/MrChartist/order-flow (build-up from futures price + open
interest, option-chain levels, conviction checks); only the method, none of its code.

What a row holds (all from the exchange's own numbers, nothing simulated):
  fut_chg_pct   near-month future's close vs its previous close
  oi_chg_pct    change in OPEN INTEREST summed over every listed month (summing the months keeps the roll from looking like unwinding)
  buildup       Long build-up / Short covering / Short build-up / Long unwinding (price direction x OI direction), Neutral when either is flat
  pcr           put OI / call OI of the nearest options expiry
  support       strike with the most put OI at or below spot;  resistance: most call OI at or above spot
  add_*         the strike where the most OI was added today (puts = writers defending, calls = writers capping)
  writers_lean  (put OI added - call OI added) / (both), -1..+1, summed over strikes whose OI rose
  conviction    0-5 checks that agree with the move (see _conviction)
History (kept in meta `fo_hist`, last HIST_DAYS sessions) gives the 5-session spot / OI change and the build-up streak.
"""
import io
import math
import zipfile
from datetime import date, timedelta

import pandas as pd

FO_URL = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d}_F_0000.csv.zip"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
HIST_DAYS = 8  # sessions kept in fo_hist
NEED_DAYS = 6  # sessions fetched on a cold start (today + 5 back = a 5-session window)
FLAT_PRICE_PCT = 0.10  # |future move| under this = flat (no build-up call)
FLAT_OI_PCT = 0.50  # |OI move| under this = flat
LEAN_MIN = 0.15  # option writers "lean" one way beyond this
INDEXES = ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50")


def _f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def fetch_day(session, d):
    """bytes of the zip for date d, or None (weekend / holiday / not published yet)."""
    url = FO_URL.format(d=d.strftime("%Y%m%d"))
    for attempt in range(3):
        r = session.get(url, headers=HEADERS, timeout=40)
        if r.status_code == 200 and r.content[:2] == b"PK":
            return r.content
        if r.status_code != 403:
            return None
        import time
        time.sleep(1.0 * (attempt + 1))
    return None


def read_zip(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as fh:
            return pd.read_csv(fh)


def buildup(price_pct, oi_pct):
    if price_pct is None or oi_pct is None or abs(price_pct) < FLAT_PRICE_PCT or abs(oi_pct) < FLAT_OI_PCT:
        return "Neutral"
    if price_pct > 0:
        return "Long build-up" if oi_pct > 0 else "Short covering"
    return "Short build-up" if oi_pct > 0 else "Long unwinding"


def _max_pain(calls, puts):
    """Strike where option buyers lose the most (writers pay the least). calls/puts: {strike: oi}."""
    strikes = sorted(set(calls) | set(puts))
    if len(strikes) < 3:
        return None
    best, best_k = None, None
    for k in strikes:
        pain = sum(max(0.0, k - s) * oi for s, oi in calls.items()) + sum(max(0.0, s - k) * oi for s, oi in puts.items())
        if best is None or pain < best:
            best, best_k = pain, k
    return best_k


def parse_day(df):
    """(trade_date_iso, {symbol: row}) from one day's F&O bhavcopy frame. Index underlyings carry kind='index'."""
    if df is None or df.empty:
        return None, {}
    trade = str(df["TradDt"].iloc[0])[:10]
    fut = df[df["FinInstrmTp"].isin(["STF", "IDF"])]
    opt = df[df["FinInstrmTp"].isin(["STO", "IDO"])]
    optg = {k: g for k, g in opt.groupby("TckrSymb", sort=False)}
    out = {}
    for sym, g in fut.groupby("TckrSymb", sort=False):
        if g["FinInstrmTp"].iloc[0] == "IDF" and sym not in INDEXES:  # NIFTYFPI and the like: not a market index worth a row
            continue
        g = g.sort_values("XpryDt")
        live = g[g["XpryDt"] >= trade]
        if live.empty:
            continue
        near = live.iloc[0]
        close, prev = _f(near["ClsPric"]), _f(near["PrvsClsgPric"])
        spot = _f(near["UndrlygPric"])
        if not close or close <= 0:
            continue
        fut_chg = (close / prev - 1) * 100 if prev and prev > 0 else None
        oi = float(live["OpnIntrst"].sum())
        d_oi = float(live["ChngInOpnIntrst"].sum())
        oi_chg = d_oi / (oi - d_oi) * 100 if (oi - d_oi) > 0 else None
        lot = int(near["NewBrdLotQty"]) if _f(near["NewBrdLotQty"]) else None
        row = {
            "symbol": sym,
            "kind": "index" if near["FinInstrmTp"] == "IDF" else "stock",
            "lot": lot,
            "spot": spot,
            "fut_close": round(close, 2),
            "fut_chg_pct": None if fut_chg is None else round(fut_chg, 2),
            "basis_pct": None if not spot else round((close / spot - 1) * 100, 2),
            "oi": int(oi),
            "oi_chg": int(d_oi),
            "oi_chg_pct": None if oi_chg is None else round(oi_chg, 2),
            "oi_value_cr": round(oi * close / 1e7, 1),
            "turnover_cr": round(float(live["TtlTrfVal"].sum()) / 1e7, 1),
            "fut_expiry": str(near["XpryDt"])[:10],
        }
        row["buildup"] = buildup(row["fut_chg_pct"], row["oi_chg_pct"])
        og = optg.get(sym)
        if og is not None and not og.empty:
            oexp = sorted(e for e in og["XpryDt"].unique() if e >= trade)
            if oexp:
                og = og[og["XpryDt"] == oexp[0]]
                ce, pe = og[og["OptnTp"] == "CE"], og[og["OptnTp"] == "PE"]
                c_oi = {float(k): float(v) for k, v in zip(ce["StrkPric"], ce["OpnIntrst"])}
                p_oi = {float(k): float(v) for k, v in zip(pe["StrkPric"], pe["OpnIntrst"])}
                tc, tp = sum(c_oi.values()), sum(p_oi.values())
                ref = spot or close
                row["opt_expiry"] = str(oexp[0])[:10]
                row["pcr"] = round(tp / tc, 2) if tc > 0 else None
                below = {k: v for k, v in p_oi.items() if k <= ref * 1.0001 and v > 0}
                above = {k: v for k, v in c_oi.items() if k >= ref * 0.9999 and v > 0}
                if below:
                    k = max(below, key=lambda s: (below[s], -abs(ref - s)))
                    row["support"], row["support_oi"] = k, int(below[k])
                if above:
                    k = max(above, key=lambda s: (above[s], -abs(ref - s)))
                    row["resistance"], row["resistance_oi"] = k, int(above[k])
                row["max_pain"] = _max_pain(c_oi, p_oi)
                # where OI was added today, and who is adding (puts written = support being built, calls written = a lid)
                dce = {float(k): float(v) for k, v in zip(ce["StrkPric"], ce["ChngInOpnIntrst"])}
                dpe = {float(k): float(v) for k, v in zip(pe["StrkPric"], pe["ChngInOpnIntrst"])}
                add_c = sum(v for v in dce.values() if v > 0)
                add_p = sum(v for v in dpe.values() if v > 0)
                row["writers_lean"] = round((add_p - add_c) / (add_p + add_c), 2) if (add_p + add_c) > 0 else None
                best = None
                for k, v in dce.items():
                    if v > 0 and (best is None or v > best[2]):
                        best = (k, "CE", v)
                for k, v in dpe.items():
                    if v > 0 and (best is None or v > best[2]):
                        best = (k, "PE", v)
                if best:
                    row["add_strike"], row["add_type"], row["add_oi"] = best[0], best[1], int(best[2])
        out[sym] = row
    return trade, out


def _hist_point(row):
    return [row.get("spot"), row.get("oi"), row.get("fut_close")]


def _pct(a, b):
    return None if not a or not b or b <= 0 else (a / b - 1) * 100


def _sign(x):
    return 0 if x is None or x == 0 else (1 if x > 0 else -1)


def _conviction(r, sector_median):
    """The checks that agree with the future's move (direction = its sign). Five end-of-day checks - Order Flow's own list has a
    'last hour agrees' check that needs minute data; here the 5-session view stands in for it."""
    d = _sign(r.get("fut_chg_pct"))
    if d == 0 or r.get("buildup") == "Neutral":
        return 0, []
    why = []
    if r["buildup"] in ("Long build-up", "Short build-up"):
        why.append("new positions opened with the move")
    if _sign(r.get("spot_chg_pct")) == d:
        why.append("spot agrees")
    lean = r.get("writers_lean")
    if lean is not None and abs(lean) >= LEAN_MIN and _sign(lean) == d:
        why.append("option writers lean the same way")
    if sector_median is not None and _sign(sector_median) == d:
        why.append("sector agrees")
    s5, o5 = r.get("spot_5d_pct"), r.get("oi_5d_pct")
    if s5 is not None and o5 is not None and _sign(s5) == d and o5 > 0:
        why.append("5 sessions agree (price and OI)")
    return len(why), why


def build_rows(last_date, last, hist, techs, sector_map, nse750):
    """last: {sym: row} of the newest session; hist: {date_iso: {sym: [spot, oi, fut_close]}} (newest session included).
    techs: {sym: bhav technicals row}. Returns (rows, summary)."""
    # RS 3M percentile among the NSE 750 (same rule as Chartist_RS_Scanner / All Technicals)
    from _bhav import _rs_percentile

    uni = sorted(t["w_pct_3m"] for s, t in techs.items() if s in nse750 and t.get("w_pct_3m") is not None)
    dates = sorted(hist)
    rows = []
    for sym, r in last.items():
        t = techs.get(sym) or {}
        r = dict(r)
        r["sector"] = sector_map.get(sym, "") if r["kind"] == "stock" else "Index"
        r["name"] = t.get("name", "")
        r["spot_chg_pct"] = t.get("change_pct")
        pts = [(dt, hist[dt].get(sym)) for dt in dates]
        pts = [(dt, p) for dt, p in pts if p]
        if r["spot_chg_pct"] is None and len(pts) >= 2 and _pct(pts[-1][1][0], pts[-2][1][0]) is not None:
            r["spot_chg_pct"] = round(_pct(pts[-1][1][0], pts[-2][1][0]), 2)
        r["rs_3m"] = _rs_percentile(uni, t.get("w_pct_3m")) if r["kind"] == "stock" else None
        for k_out, k_in in (("pct_52wh", "pct_from_52w_high"), ("pct_50d_ema", "pct_50d_ema"), ("rsi_w", "rsi_w"), ("delivery_pct", "deliv_pct"), ("market_cap_cr", "market_cap_cr")):
            r[k_out] = t.get(k_in)
        # 5-session view and the build-up streak from the stored history
        if len(pts) >= 2:
            back = pts[max(0, len(pts) - 6)][1]  # 5 sessions back (or the oldest we hold)
            cur = pts[-1][1]
            s5, o5 = _pct(cur[0], back[0]), _pct(cur[1], back[1])
            r["spot_5d_pct"] = None if s5 is None else round(s5, 2)
            r["oi_5d_pct"] = None if o5 is None else round(o5, 1)
            r["window_days"] = min(5, len(pts) - 1)
            streak = 1 if r["buildup"] != "Neutral" else 0
            for i in range(len(pts) - 2, 0, -1):  # earlier sessions: price from spot, OI from the all-month total
                if streak and buildup(_pct(pts[i][1][0], pts[i - 1][1][0]), _pct(pts[i][1][1], pts[i - 1][1][1])) == r["buildup"]:
                    streak += 1
                else:
                    break
            r["streak"] = streak
        rows.append(r)
    # sector medians of the futures move (stocks only, sectors with 3+ F&O names)
    by_sec = {}
    for r in rows:
        if r["kind"] == "stock" and r["sector"] and r.get("fut_chg_pct") is not None:
            by_sec.setdefault(r["sector"], []).append(r["fut_chg_pct"])
    med = {}
    for s, v in by_sec.items():
        if len(v) >= 3:
            v = sorted(v)
            med[s] = v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2
    for r in rows:
        r["sector_median"] = None if r["sector"] not in med else round(med[r["sector"]], 2)
        r["conviction"], r["why"] = _conviction(r, r["sector_median"]) if r["kind"] == "stock" else (None, [])
        r["direction"] = "Bullish" if _sign(r.get("fut_chg_pct")) > 0 and r["buildup"] != "Neutral" else ("Bearish" if _sign(r.get("fut_chg_pct")) < 0 and r["buildup"] != "Neutral" else "Flat")
    stocks = [r for r in rows if r["kind"] == "stock"]
    moves = sorted(r["fut_chg_pct"] for r in stocks if r.get("fut_chg_pct") is not None)
    counts = {}
    for r in stocks:
        counts[r["buildup"]] = counts.get(r["buildup"], 0) + 1
    idx = {r["symbol"]: {k: r.get(k) for k in ("fut_close", "fut_chg_pct", "oi_chg_pct", "buildup", "pcr", "support", "resistance", "max_pain", "writers_lean", "spot")} for r in rows if r["kind"] == "index"}
    tp = sum(1 for r in stocks if (r.get("fut_chg_pct") or 0) >= FLAT_PRICE_PCT)
    tn = sum(1 for r in stocks if (r.get("fut_chg_pct") or 0) <= -FLAT_PRICE_PCT)
    summary = {
        "session": last_date, "history_sessions": len(dates), "stocks": len(stocks), "up": tp, "down": tn, "flat": len(stocks) - tp - tn,
        "median_move_pct": None if not moves else round(moves[len(moves) // 2], 2),
        "buildup_counts": counts,
        "oi_value_cr": round(sum(r.get("oi_value_cr") or 0 for r in stocks), 0),
        "indexes": idx,
        "sectors": sorted(({"sector": s, "median_pct": round(m, 2), "n": len(by_sec[s]), "up": sum(1 for v in by_sec[s] if v >= FLAT_PRICE_PCT), "down": sum(1 for v in by_sec[s] if v <= -FLAT_PRICE_PCT)} for s, m in med.items()), key=lambda x: -x["median_pct"]),
    }
    return rows, summary


def load_days(session, hist, today=None, want=NEED_DAYS, max_back=16):
    """Walk back from today until `want` sessions are in hand. The newest session's file is always read (its full rows are needed);
    older ones are fetched only when fo_hist does not hold them. hist = {date_iso: {sym: [spot, oi, fut_close]}} is updated in place.
    Returns (hist, newest_iso, newest_rows)."""
    d = today or date.today()
    newest_iso, newest_rows, have = None, None, 0
    for _ in range(max_back):
        if have >= want:
            break
        iso = d.isoformat()
        if d.weekday() < 5:
            if newest_iso is not None and iso in hist:
                have += 1
            else:
                blob = fetch_day(session, d)
                if blob:
                    trade, rows = parse_day(read_zip(blob))
                    if trade == iso and rows:
                        hist[iso] = {s: _hist_point(r) for s, r in rows.items()}
                        if newest_iso is None:
                            newest_iso, newest_rows = iso, rows
                        have += 1
        d -= timedelta(days=1)
    for k in sorted(hist)[:-HIST_DAYS]:
        hist.pop(k, None)
    return hist, newest_iso, newest_rows
