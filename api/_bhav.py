"""NSE bhavcopy store — every listed stock's daily bar from NSE's own bulk file.

2026-10-02 ("how do they get 2K+ stocks details" -> "sketch the daily
bhavcopy store" -> "if the NSE dont allow, only then go for yahoo" / "if
successful then only populate all technicals page for all stocks pulled from
nse"). One ~400KB CSV per trading day
(nsearchives.nseindia.com/products/content/sec_bhavdata_full_<DDMMYYYY>.csv)
carries open/high/low/close/volume/delivery % for ~3,500 listed securities,
so the whole market costs one request a day instead of thousands of
per-stock Yahoo calls. Files are underscore-prefixed (not a Vercel function).

Things learned from real files (see the spike) that shape this module:
  - On an NSE HOLIDAY the site still publishes a file, but it is a copy of
    the previous trading day (the DATE1 column inside still says the old
    date). The trade date is therefore read from DATE1, never the filename.
  - PREV_CLOSE is the raw previous close, NOT corporate-action adjusted
    (0 mismatches in 84,000 stock-days), so splits/bonuses can't be detected
    from it. Prices here are stored RAW; a day-over-day close ratio outside
    [0.77, 1.30] flags a candidate event, which is confirmed against Yahoo's
    split record for just that symbol (the only per-stock Yahoo call). A
    flagged jump nobody has confirmed yet is never shown across: the symbol's
    history is cut at it.
  - Index members like SIGMAADV trade in series BE, SME names in SM, so
    series EQ, BE and SM are all kept (EQ wins if a symbol shows up twice).

Storage: one JSONB row per (symbol, quarter) holding that quarter's bars as
columns (bhav_chunks) — 5x smaller than a row per bar, and the daily update
only rewrites the current quarter's small rows. Nothing here touches the
Yahoo-based nse750PriceCache or any existing screener; the page reads this
only when the verification in publish() says it matches Yahoo's numbers, and
falls back to the Yahoo path otherwise.
"""
import bisect
import collections
import csv
import io
import time
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import psycopg2.extras
import requests

from _db import get_conn, get_meta, set_meta

BHAV_URL = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{d}.csv"
NAMES_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
SME_NAMES_URL = "https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv"
SERIES_PRIORITY = {"EQ": 0, "BE": 1, "SM": 2}
STORE_DAYS = 740  # ~2y of calendar days: enough for a converged 200D EMA and a 33W EMA
STATE_KEY = "bhav_state"
TECH_KEY = "bhav_technicals"
MCAP_KEY = "bhav_mcaps"
MCAP_REFRESH_DAYS = 14
DB_MAX_MB = 400  # refuse to grow the database past this
JUMP_LO, JUMP_HI = 0.77, 1.30  # day-over-day close ratio outside this = candidate split/bonus
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv,*/*", "Accept-Language": "en-US,en;q=0.9"}

DDL = """
CREATE TABLE IF NOT EXISTS bhav_chunks (
  symbol TEXT NOT NULL,
  q TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (symbol, q)
);
CREATE TABLE IF NOT EXISTS bhav_actions (
  symbol TEXT NOT NULL,
  ex_date DATE NOT NULL,
  factor REAL NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (symbol, ex_date)
);
"""


def ensure_tables(conn):
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()


def db_size_mb(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT pg_database_size(current_database())")
        return cur.fetchone()[0] / 1024 / 1024


def _f(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


# ── fetching / parsing ──────────────────────────────────────────────────────

def fetch_file(d, session):
    """(status, text|None). Backs off on 403 — NSE's CDN soft-limits bursts."""
    url = BHAV_URL.format(d=d.strftime("%d%m%Y"))
    status, text = None, None
    for attempt in range(3):
        r = session.get(url, headers=HEADERS, timeout=25)
        status = r.status_code
        if status != 403:
            text = r.text if status == 200 else None
            break
        time.sleep(1.0 * (attempt + 1))
    return status, text


def parse_day(text):
    """(trade_date_iso|None, {symbol: [o, h, l, c, v, deliv_pct, series]}).
    Trade date comes from DATE1 inside the file (holiday files are copies of
    the previous day). One row per symbol, series priority EQ > BE > SM."""
    rows = {}
    dates = collections.Counter()
    for raw in csv.DictReader(io.StringIO(text)):
        x = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        sym, series = x.get("SYMBOL"), x.get("SERIES")
        pri = SERIES_PRIORITY.get(series)
        if not sym or pri is None:
            continue
        c = _f(x.get("CLOSE_PRICE"))
        if c is None or c <= 0:
            continue
        prev = rows.get(sym)
        if prev is not None and SERIES_PRIORITY[prev[6]] <= pri:
            continue
        o, h, l = _f(x.get("OPEN_PRICE")), _f(x.get("HIGH_PRICE")), _f(x.get("LOW_PRICE"))
        rows[sym] = [o if o else c, h if h else c, l if l else c, c, _f(x.get("TTL_TRD_QNTY")), _f(x.get("DELIV_PER")), series]
        dates[x.get("DATE1")] += 1
    if not rows or not dates:
        return None, {}
    try:
        trade = datetime.strptime(dates.most_common(1)[0][0], "%d-%b-%Y").date().isoformat()
    except (TypeError, ValueError):
        return None, {}
    return trade, rows


def fetch_names(session):
    """{symbol: company name} from NSE's listed-equities file plus its SME list."""
    out = {}
    for url, key in ((NAMES_URL, "NAME OF COMPANY"), (SME_NAMES_URL, "NAME_OF_COMPANY")):
        try:
            r = session.get(url, headers=HEADERS, timeout=25)
        except Exception:
            continue
        if r.status_code != 200:
            continue
        for raw in csv.DictReader(io.StringIO(r.text)):
            x = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
            if x.get("SYMBOL") and x.get(key):
                out.setdefault(x["SYMBOL"], x[key])
    return out


# ── storage ────────────────────────────────────────────────────────────────

def quarter_of(iso):
    return f"{iso[:4]}Q{(int(iso[5:7]) - 1) // 3 + 1}"


def _empty_chunk():
    return {"d": [], "o": [], "h": [], "l": [], "c": [], "v": [], "dp": [], "s": "EQ"}


def _put_bar(ch, iso, row):
    o, h, l, c, v, dp, series = row
    vals = (round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v) if v is not None else None, round(dp, 1) if dp is not None else None)
    i = bisect.bisect_left(ch["d"], iso)
    if i < len(ch["d"]) and ch["d"][i] == iso:
        for key, val in zip(("o", "h", "l", "c", "v", "dp"), vals):
            ch[key][i] = val
    else:
        ch["d"].insert(i, iso)
        for key, val in zip(("o", "h", "l", "c", "v", "dp"), vals):
            ch[key].insert(i, val)
    ch["s"] = series


def flush_days(conn, days):
    """Merge {trade_iso: {symbol: row}} into the quarter chunks."""
    by_q = collections.defaultdict(lambda: collections.defaultdict(dict))
    for iso, rows in days.items():
        q = quarter_of(iso)
        for sym, row in rows.items():
            by_q[q][sym][iso] = row
    written = 0
    with conn.cursor() as cur:
        for q, syms in by_q.items():
            cur.execute("SELECT symbol, data FROM bhav_chunks WHERE q = %s AND symbol = ANY(%s)", (q, list(syms)))
            existing = {s: d for s, d in cur.fetchall()}
            out = []
            for sym, bars in syms.items():
                ch = existing.get(sym) or _empty_chunk()
                for iso, row in bars.items():
                    _put_bar(ch, iso, row)
                out.append((sym, q, psycopg2.extras.Json(ch)))
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO bhav_chunks (symbol, q, data) VALUES %s ON CONFLICT (symbol, q) DO UPDATE SET data = EXCLUDED.data",
                out,
                page_size=200,
            )
            written += len(out)
    conn.commit()
    return written


def load_frame(conn, since_iso):
    """All stored bars on/after since_iso as one DataFrame (raw prices)."""
    first_q = quarter_of(since_iso)
    with conn.cursor() as cur:
        cur.execute("SELECT symbol, q, data FROM bhav_chunks WHERE q >= %s", (first_q,))
        sym, dts, cols = [], [], {k: [] for k in ("o", "h", "l", "c", "v", "dp")}
        for symbol, _q, ch in cur:
            n = len(ch["d"])
            sym.extend([symbol] * n)
            dts.extend(ch["d"])
            for k in cols:
                cols[k].extend(ch[k])
    if not sym:
        return pd.DataFrame(columns=["symbol", "date", "o", "h", "l", "c", "v", "dp"])
    # every numeric column as float64: volume arrives as int64 when no bar is
    # missing it, and split-adjusting it (v / factor) then raises in pandas
    df = pd.DataFrame({"symbol": sym, "date": pd.to_datetime(dts), **{k: pd.to_numeric(pd.Series(v), errors="coerce").astype("float64") for k, v in cols.items()}})
    df = df[df["date"] >= pd.Timestamp(since_iso)]
    return df.sort_values(["symbol", "date"]).reset_index(drop=True)


# ── ingest (the daily job) ───────────────────────────────────────────────────

def run_store(budget_s=200):
    """Fetch every weekday in the last STORE_DAYS not yet checked (today and
    yesterday always re-checked: NSE publishes late), newest first, then merge
    them into the store. Gentle on purpose (2 workers) and resumable."""
    from concurrent.futures import ThreadPoolExecutor

    conn = get_conn()
    try:
        ensure_tables(conn)
        size = db_size_mb(conn)
        if size > DB_MAX_MB:
            return [{"item": "ABORTED", "value": f"database is {size:.0f}MB > {DB_MAX_MB}MB guard — nothing ingested"}]
        state = get_meta(conn, STATE_KEY, None) or {}
    finally:
        conn.close()

    checked = set(state.get("checked") or [])
    today = date.today()
    start = today - timedelta(days=STORE_DAYS)
    always = {today, today - timedelta(days=1)}
    todo = []
    d = today
    while d >= start:
        if d.weekday() < 5 and (d in always or d.isoformat() not in checked):
            todo.append(d)
        d -= timedelta(days=1)

    t0 = time.monotonic()
    session = requests.Session()
    fetched, copies, missing, blocked, errors = {}, 0, 0, 0, 0
    stored_days, written = 0, 0
    stop = False

    def flush_pending():
        nonlocal fetched, stored_days, written
        if not fetched:
            return
        wconn = get_conn()
        try:
            written += flush_days(wconn, fetched)
        finally:
            wconn.close()
        stored_days += len(fetched)
        fetched = {}

    for i in range(0, len(todo), 16):
        if stop or time.monotonic() - t0 > budget_s:
            break
        batch = todo[i:i + 16]
        batch_blocked = 0

        def one(day):
            time.sleep(0.15)
            return day, fetch_file(day, session)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda day: _safe(one, day), batch))
        for res in results:
            if res is None:
                errors += 1
                continue
            day, (status, text) = res
            if status == 200 and text:
                trade, rows = parse_day(text)
                if trade is None:
                    errors += 1
                elif trade == day.isoformat():
                    fetched[trade] = rows
                    checked.add(day.isoformat())
                else:
                    copies += 1  # holiday file: a copy of an earlier day
                    checked.add(day.isoformat())
            elif status == 404:
                missing += 1
                if day not in always:
                    checked.add(day.isoformat())
            elif status == 403:
                batch_blocked += 1
            else:
                errors += 1
        blocked += batch_blocked
        if batch_blocked >= len(batch) // 2:
            stop = True
        if len(fetched) >= 45:  # about a quarter of trading days: bounds memory and write size
            newest = max(fetched)
            flush_pending()
            state["last_trade"] = max(newest, state.get("last_trade", ""))
    last_new = max(fetched) if fetched else None
    flush_pending()
    if last_new:
        state["last_trade"] = max(last_new, state.get("last_trade", ""))

    conn = get_conn()
    try:
        cutoff = start.isoformat()
        state["checked"] = sorted(c for c in checked if c >= cutoff)
        # names refresh weekly
        if (state.get("names_as_of") or "") < (today - timedelta(days=7)).isoformat() or not state.get("names_has_sme"):
            names = fetch_names(session)
            if names:
                state["names"], state["names_as_of"], state["names_has_sme"] = names, today.isoformat(), True
        set_meta(conn, STATE_KEY, state)
        size = db_size_mb(conn)
    finally:
        conn.close()

    return [
        {"item": "weekdays requested", "value": len(todo)},
        {"item": "trading days stored", "value": stored_days},
        {"item": "holiday copies skipped", "value": copies},
        {"item": "files not found (404)", "value": missing},
        {"item": "blocked (403) / errors", "value": f"{blocked} / {errors}"},
        {"item": "chunk rows written", "value": written},
        {"item": "latest trade date", "value": state.get("last_trade")},
        {"item": "stopped early", "value": stop or (time.monotonic() - t0 > budget_s)},
        {"item": "database MB", "value": round(size, 1)},
    ]


def _safe(fn, arg):
    try:
        return fn(arg)
    except Exception:
        return None


# ── corporate actions ────────────────────────────────────────────────────────

def find_jumps(df):
    """[(symbol, ex_iso, ratio)] where the close moved outside [JUMP_LO, JUMP_HI]
    from the IMMEDIATELY preceding trading day. A symbol that was missing for a
    stretch (it moved to a series we don't keep, or was suspended) compares
    across that gap otherwise, and an ordinary multi-day move would read as a
    split."""
    if df.empty:
        return []
    cal = {d: i for i, d in enumerate(sorted(df["date"].unique()))}
    day_idx = df["date"].map(cal).to_numpy()
    sym = df["symbol"].to_numpy()
    c = df["c"].to_numpy(dtype=float)
    prev = np.roll(c, 1)
    same = (np.roll(sym, 1) == sym) & (day_idx - np.roll(day_idx, 1) == 1)
    same[0] = False
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(same & (prev > 0), c / prev, 1.0)
    idx = np.where((ratio <= JUMP_LO) | (ratio >= JUMP_HI))[0]
    dates = df["date"].dt.date.astype(str).to_numpy()
    return [(sym[i], dates[i], float(ratio[i])) for i in idx]


def load_actions(conn):
    out = collections.defaultdict(list)
    with conn.cursor() as cur:
        cur.execute("SELECT symbol, ex_date, factor, source FROM bhav_actions")
        for s, ex, factor, source in cur.fetchall():
            out[s].append((ex.isoformat(), float(factor), source))
    return out


# Clean price factors an issue can produce (1:1 bonus = 0.5, 2:1 = 0.333,
# 1:5 split = 0.2, 1:10 = 0.1 …); consolidations are the reciprocals.
_CLEAN_DOWN = [0.8, 0.75, 2 / 3, 0.6, 0.5, 0.4, 1 / 3, 0.25, 0.2, 1 / 6, 1 / 8, 0.1, 1 / 15, 0.05, 0.04, 0.02, 0.01]
_CLEAN_ALL = sorted(set(_CLEAN_DOWN) | {1 / c for c in _CLEAN_DOWN})


def _snap(x, candidates, tol):
    """The candidate nearest to x (log distance) if within relative tol, else None."""
    if not x or x <= 0:
        return None
    best = min(candidates, key=lambda c: abs(np.log(x / c)))
    return best if abs(x / best - 1) <= tol else None


def decide_factor(ratio, near_splits):
    """(factor, source) for a flagged jump, or (None, None) when it can't be
    decided yet. factor multiplies prices BEFORE the ex-date.

    near_splits = Yahoo's split ratios dated within a few days of the jump
    (2.0 = 2-for-1). The ex-date session itself can move up to ±20% on top of
    the issue, and a bonus is often bundled with a split that Yahoo lists only
    once (BAJFINANCE: Yahoo 2.0, real 10x), so Yahoo supplies the DATE and the
    first factor, any residual snaps to a clean ratio, and a jump that is
    itself an exact clean fraction (a 10:1 ETF unit split Yahoo has no record
    of) is accepted on the price pattern alone."""
    for sr in near_splits:
        if sr <= 0:
            continue
        residual = ratio * sr
        if 0.80 <= residual <= 1.25:
            return 1.0 / sr, "yahoo-split"
        r2 = _snap(residual, _CLEAN_ALL, 0.12)
        if r2:
            return r2 / sr, "yahoo-split+residual"
    if ratio <= 0.55 or ratio >= 1.8:
        r = _snap(ratio, _CLEAN_ALL, 0.04)
        if r:
            return r, "price-pattern"
    return None, None


def _lookup_symbol(sym):
    """(sym, split_list | None on a lookup error, whether Yahoo knows the symbol)."""
    import yfinance as yf

    try:
        tk = yf.Ticker(f"{sym}.NS")
        sp = tk.splits
        split_list = [(ts.date(), float(r)) for ts, r in sp.items()] if sp is not None else []
    except Exception:
        return sym, None, False
    known = bool(split_list)
    if not known:
        try:
            known = not tk.history(period="1mo").empty
        except Exception:
            known = False
    return sym, split_list, known


def confirm_jumps(jumps, actions, budget_s=90):
    """For flagged jumps nobody has resolved, ask Yahoo for that symbol's split
    history (the only per-stock Yahoo call in this pipeline; 4 at a time),
    decide a factor with decide_factor, and record it — or 'rejected' (a
    genuine move) or 'nodata' (Yahoo doesn't carry the symbol: the history stays
    cut at the jump, and it isn't asked again every day)."""
    from concurrent.futures import ThreadPoolExecutor

    known = {(s, ex) for s, rows in actions.items() for ex, _f_, _src in rows}
    pending = [j for j in jumps if (j[0], j[1]) not in known]
    t0 = time.monotonic()
    by_symbol = collections.defaultdict(list)
    for sym, ex, ratio in pending:
        by_symbol[sym].append((ex, ratio))
    stats = collections.Counter()
    syms = list(by_symbol)
    for i in range(0, len(syms), 24):
        if time.monotonic() - t0 > budget_s:
            break
        batch = syms[i:i + 24]
        with ThreadPoolExecutor(max_workers=4) as pool:
            looked = list(pool.map(_lookup_symbol, batch))
        rows = []
        for sym, split_list, known_to_yahoo in looked:
            if split_list is None:
                stats["yahoo_failed"] += 1
                continue
            for ex, ratio in by_symbol[sym]:
                ex_d = date.fromisoformat(ex)
                near = [sr for sd, sr in split_list if abs((sd - ex_d).days) <= 4]
                factor, source = decide_factor(ratio, near)
                if factor is None:
                    factor, source = (1.0, "rejected") if known_to_yahoo else (1.0, "nodata")
                rows.append((sym, ex, float(factor), source))
                stats[source] += 1
        if rows:
            # a fresh short-lived connection per write: the Yahoo calls between
            # writes are slow enough for a pooler to drop an idle one
            wconn = get_conn()
            try:
                with wconn.cursor() as cur:
                    psycopg2.extras.execute_values(
                        cur,
                        "INSERT INTO bhav_actions (symbol, ex_date, factor, source) VALUES %s ON CONFLICT (symbol, ex_date) DO UPDATE SET factor = EXCLUDED.factor, source = EXCLUDED.source",
                        rows,
                    )
                wconn.commit()
            finally:
                wconn.close()
    return {"flagged": len(jumps), "pending_before": len(pending), **dict(stats)}


def adjust_frame(df, actions, jumps):
    """Back-adjust prices for confirmed splits, and cut each symbol's history at
    its latest still-unresolved jump (never show a number across one)."""
    if df.empty:
        return df
    df = df.sort_values(["symbol", "date"]).reset_index(drop=True)
    idx = df.groupby("symbol", sort=False).indices
    known = {(s, ex) for s, rows in actions.items() for ex, _f_, src in rows if src != "nodata"}
    for sym, rows in actions.items():
        pos = idx.get(sym)
        if pos is None:
            continue
        dates = df["date"].to_numpy()[pos]
        for ex, factor, source in rows:
            if source in ("rejected", "nodata") or abs(factor - 1) < 1e-9:
                continue
            before = pos[dates < np.datetime64(ex)]
            if len(before):
                df.loc[before, ["o", "h", "l", "c"]] *= factor
                df.loc[before, "v"] = df.loc[before, "v"] / factor
    cut = {}
    for sym, ex, _ratio in jumps:
        if (sym, ex) not in known:
            cut[sym] = max(cut.get(sym, ""), ex)
    if cut:
        keep = np.ones(len(df), dtype=bool)
        dates = df["date"].to_numpy()
        for sym, ex in cut.items():
            pos = idx.get(sym)
            if pos is not None:
                keep[pos[dates[pos] < np.datetime64(ex)]] = False
        df = df[keep].reset_index(drop=True)
    return df


# ── technicals ───────────────────────────────────────────────────────────────

def _wilder_rsi(df, col, period=14):
    delta = df.groupby("symbol", sort=False)[col].diff()
    gain = delta.clip(lower=0).fillna(0.0)
    loss = (-delta.clip(upper=0)).fillna(0.0)
    g = pd.Series(gain.to_numpy(), index=df.index).groupby(df["symbol"], sort=False)
    l = pd.Series(loss.to_numpy(), index=df.index).groupby(df["symbol"], sort=False)
    ag = g.transform(lambda s: s.ewm(alpha=1 / period, min_periods=period, adjust=False).mean())
    al = l.transform(lambda s: s.ewm(alpha=1 / period, min_periods=period, adjust=False).mean())
    rs = ag / al
    rsi = 100 - 100 / (1 + rs)
    return rsi.where(al != 0, 100.0)


def _r2(x):
    return None if x is None or x != x else round(float(x), 2)


def compute_technicals(df, names):
    """One row per symbol with its latest bar: price, % changes, EMA/high
    distances, RSI and delivery. EMAs on OHLC4, compared with the latest close
    (this account's standing convention); weekly bars are resampled from the
    dailies (W-FRI) and the in-progress week counts as a bar, matching
    nse750Technicals' definitions so the two are comparable."""
    if df.empty:
        return []
    df = df.sort_values(["symbol", "date"]).reset_index(drop=True)
    g = df.groupby("symbol", sort=False)
    df["o4"] = (df["o"] + df["h"] + df["l"] + df["c"]) / 4
    for span in (20, 50, 200):
        df[f"e{span}"] = g["o4"].transform(lambda s, span=span: s.ewm(span=span, adjust=False).mean())
    df["n"] = g.cumcount() + 1
    df["rsi_d"] = _wilder_rsi(df, "c")
    df["prev_c"] = g["c"].shift(1)

    last = df.groupby("symbol", sort=False).tail(1).set_index("symbol")
    last_date = df["date"].max()
    # Only what trades now: the store keeps two years of bars, so delisted names
    # and finished rights-entitlement tickers (SYMBOL-RE, SYMBOL-RE1...) still
    # have rows with months-old last bars.
    live = (last["date"] >= last_date - pd.Timedelta(days=5)) & ~last.index.to_series().str.contains(r"-(?:RE|W)\d*$", regex=True)
    last = last[live]

    df["wk"] = df["date"].dt.to_period("W-FRI")
    wk = df.groupby(["symbol", "wk"], sort=True).agg(o=("o", "first"), h=("h", "max"), l=("l", "min"), c=("c", "last")).reset_index()
    wk["o4"] = (wk["o"] + wk["h"] + wk["l"] + wk["c"]) / 4
    wg = wk.groupby("symbol", sort=False)
    wk["e33"] = wg["o4"].transform(lambda s: s.ewm(span=33, adjust=False).mean())
    wk["n"] = wg.cumcount() + 1
    wk["rsi_w"] = _wilder_rsi(wk, "c")
    for k in (1, 4, 13, 26, 52):
        wk[f"c{k}"] = wg["c"].shift(k)
    wlast = wk.groupby("symbol", sort=False).tail(1).set_index("symbol")

    # Core Day/Week/Month/3M/Year % use nseScreener's own definitions (5 trading
    # bars back; 1 month / 3 months / 1 year back by calendar, the latest bar on
    # or before that date) so the two columns mean the same thing; the
    # weekly-bar changes (w_*) are nse750Technicals' convention.
    cal = {}
    pos_by_sym = df.groupby("symbol", sort=False).indices
    dates_np = df["date"].to_numpy()
    close_np = df["c"].to_numpy(dtype=float)
    for sym, pos in pos_by_sym.items():
        d_arr, c_arr = dates_np[pos], close_np[pos]
        out = {}
        out["weekly_pct"] = (c_arr[-1] / c_arr[-6] - 1) * 100 if len(c_arr) > 5 and c_arr[-6] else None
        for key, off in (("monthly_pct", pd.DateOffset(months=1)), ("three_month_pct", pd.DateOffset(months=3)), ("yearly_pct", pd.DateOffset(years=1))):
            target = np.datetime64(pd.Timestamp(d_arr[-1]) - off)
            j = int(np.searchsorted(d_arr, target, side="right")) - 1
            out[key] = (c_arr[-1] / c_arr[j] - 1) * 100 if j >= 0 and c_arr[j] else None
        cal[sym] = out

    ath = df.groupby("symbol", sort=False)["h"].max()
    recent = df[df["date"] >= last_date - pd.Timedelta(days=365)]
    high52 = recent.groupby("symbol", sort=False)["h"].max()
    tail20 = df.groupby("symbol", sort=False).tail(20)
    dp20 = tail20.groupby("symbol", sort=False)["dp"].mean()
    vol20 = df.groupby("symbol", sort=False).tail(21).groupby("symbol", sort=False)["v"].apply(lambda s: s.iloc[:-1].mean() if len(s) > 1 else np.nan)
    first_date = df.groupby("symbol", sort=False)["date"].min()

    def pct(a, b):
        return None if (b is None or b != b or b == 0 or a is None or a != a) else round((a / b - 1) * 100, 2)

    rows = []
    for sym, r in last.iterrows():
        w = wlast.loc[sym] if sym in wlast.index else None
        c = float(r["c"])
        row = {
            "symbol": sym,
            "name": names.get(sym, ""),
            "price": round(c, 2),
            "as_of": r["date"].date().isoformat(),
            "bars": int(r["n"]),
            "change_pct": pct(c, r["prev_c"]),
            "weekly_pct": _r2(cal[sym]["weekly_pct"]),
            "monthly_pct": _r2(cal[sym]["monthly_pct"]),
            "three_month_pct": _r2(cal[sym]["three_month_pct"]),
            "yearly_pct": _r2(cal[sym]["yearly_pct"]),
            "w_pct_1w": pct(c, w["c1"]) if w is not None else None,
            "w_pct_1m": pct(c, w["c4"]) if w is not None else None,
            "w_pct_3m": pct(c, w["c13"]) if w is not None else None,
            "w_pct_6m": pct(c, w["c26"]) if w is not None else None,
            "rsi_d": round(float(r["rsi_d"]), 1) if r["rsi_d"] == r["rsi_d"] else None,
            "rsi_w": round(float(w["rsi_w"]), 1) if w is not None and w["rsi_w"] == w["rsi_w"] else None,
            "pct_20d_ema": pct(c, r["e20"]) if r["n"] >= 20 else None,
            "pct_50d_ema": pct(c, r["e50"]) if r["n"] >= 50 else None,
            "pct_200d_ema": pct(c, r["e200"]) if r["n"] >= 200 else None,
            "pct_33w_ema": pct(c, w["e33"]) if w is not None and w["n"] >= 33 else None,
            "pct_from_ath": pct(c, ath.get(sym)),
            "pct_from_52w_high": pct(c, high52.get(sym)),
            "deliv_pct": round(float(r["dp"]), 1) if r["dp"] == r["dp"] else None,
            "deliv_pct_avg20": round(float(dp20.get(sym)), 1) if sym in dp20.index and dp20.get(sym) == dp20.get(sym) else None,
            "volume": int(r["v"]) if r["v"] == r["v"] else None,
            "turnover_cr": round(c * float(r["v"]) / 1e7, 2) if r["v"] == r["v"] else None,
            "vol_x": round(float(r["v"]) / float(vol20.get(sym)), 2) if sym in vol20.index and vol20.get(sym) and vol20.get(sym) == vol20.get(sym) and r["v"] == r["v"] else None,
        }
        # a symbol with <53 weekly bars has no honest 1Y change — already None via NaN shift
        rows.append(row)
    return rows


# ── verification + publishing ────────────────────────────────────────────────

def verify(rows, ms):
    """Compare this store's numbers with the independent Yahoo-based ones the
    app already shows for the NSE-750 (same conventions, so apples to apples).
    Returns (ok, stats)."""
    by_sym = {r["symbol"]: r for r in rows}
    nse = {r["symbol"]: r for r in (ms.get("nseScreener", {}).get("rows") or [])}
    nt = {r["symbol"]: r for r in (ms.get("nse750Technicals", {}).get("rows") or [])}
    stats = {"rows": len(rows)}
    last = max((r["as_of"] for r in rows), default="")
    stats["latest_trade_date"] = last
    stale_days = (date.today() - date.fromisoformat(last)).days if last else 999
    stats["stale_days"] = stale_days

    def share(pairs, tol):
        pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
        if len(pairs) < 100:
            return None, len(pairs)
        return round(sum(1 for a, b in pairs if abs(a - b) <= tol) / len(pairs), 3), len(pairs)

    price_ok = [
        (by_sym[s]["price"], n.get("price"))
        for s, n in nse.items()
        if s in by_sym and n.get("as_of") == by_sym[s]["as_of"] and n.get("price") and by_sym[s]["price"]
    ]
    if len(price_ok) >= 100:
        stats["price_within_0.5pct"] = round(sum(1 for a, b in price_ok if abs(a / b - 1) <= 0.005) / len(price_ok), 3)
    else:
        stats["price_within_0.5pct"] = None
    stats["price_overlap"] = len(price_ok)
    core = (
        ("change_pct", "change_pct", 0.3),
        ("weekly_pct", "weekly_pct", 0.8),
        ("monthly_pct", "monthly_pct", 1.0),
        ("three_month_pct", "three_month_pct", 1.5),
        ("yearly_pct", "yearly_pct", 3.0),  # Yahoo's series is dividend-adjusted, ours is split-only
    )
    mapping = (
        ("pct_33w_ema", "pct_33w_ema", 4.0),
        ("pct_200d_ema", "pct_200d_ema", 5.0),
        ("pct_from_52w_high", "pct_from_52w_high", 3.0),
    )
    shares = {}
    for mine, theirs, tol in core:
        s, n = share([(by_sym[sym].get(mine), t.get(theirs)) for sym, t in nse.items() if sym in by_sym and t.get("as_of") == by_sym[sym]["as_of"]], tol)
        shares[mine] = {"within": s, "n": n, "tol_pp": tol, "vs": "nseScreener"}
    for mine, theirs, tol in mapping:
        s, n = share([(by_sym[sym].get(mine), t.get(theirs)) for sym, t in nt.items() if sym in by_sym], tol)
        shares[mine] = {"within": s, "n": n, "tol_pp": tol, "vs": "nse750Technicals"}
    stats["vs_yahoo"] = shares

    checks = [
        len(rows) >= 2000,
        stale_days <= 5,
        (stats["price_within_0.5pct"] is None) or stats["price_within_0.5pct"] >= 0.97,
    ]
    for mine in shares:
        s = shares[mine]["within"]
        checks.append(s is None or s >= 0.85)
    stats["checks_passed"] = f"{sum(checks)}/{len(checks)}"
    return all(checks), stats


def _shares(sym):
    """(symbol, shares outstanding or None). NSE's daily files carry no share
    counts, so this is the one thing here that comes from Yahoo (fast_info; ETFs
    and a few odd symbols have none). The SHARE COUNT is stored, not Yahoo's market
    cap, because Yahoo's price lags for some small stocks (ANLON: its 506 vs NSE's
    758.55 close) — market cap = NSE's exact close x shares."""
    import yfinance as yf

    try:
        n = yf.Ticker(f"{sym}.NS").fast_info["shares"]
        return sym, (float(n) if n else None)
    except Exception:
        return sym, None


def refresh_shares(symbols, budget_s):
    """Fill/refresh share counts within a time budget — symbols never fetched
    first, then the stalest — so the ~3,300 get covered over a few runs and then
    re-cycle about every MCAP_REFRESH_DAYS days. {symbol: shares or None}."""
    from concurrent.futures import ThreadPoolExecutor

    conn = get_conn()
    try:
        store = (get_meta(conn, MCAP_KEY, None) or {}).get("shares") or {}
    finally:
        conn.close()
    today = date.today().isoformat()
    stale_before = (date.today() - timedelta(days=MCAP_REFRESH_DAYS)).isoformat()
    order = sorted(
        (s for s in symbols if s not in store or (store[s][1] or "") < stale_before),
        key=lambda s: store[s][1] if s in store else "",
    )
    t0 = time.monotonic()
    fetched = 0
    for i in range(0, len(order), 40):
        if time.monotonic() - t0 > budget_s:
            break
        with ThreadPoolExecutor(max_workers=4) as pool:
            for sym, n in pool.map(_shares, order[i:i + 40]):
                store[sym] = [n, today]
                fetched += 1
    if fetched:
        conn = get_conn()
        try:
            set_meta(conn, MCAP_KEY, {"shares": store})
        finally:
            conn.close()
    return {s: (store[s][0] if s in store else None) for s in symbols}, {"share_counts_fetched": fetched, "share_counts_known": sum(1 for s in symbols if s in store and store[s][0]), "share_counts_waiting": max(0, len(order) - fetched)}


def publish(budget_s=240):
    """Load the store, confirm/adjust corporate actions, compute technicals for
    every stock, verify against Yahoo, publish (ok flag + rows) to bhav_technicals.
    A failure leaves ok=False (or the previous payload) so the page falls back to
    the Yahoo-based universe. Each database phase uses its own short-lived
    connection (the Yahoo lookups in between are slow)."""
    t0 = time.monotonic()
    since = (date.today() - timedelta(days=STORE_DAYS)).isoformat()
    conn = get_conn()
    try:
        ensure_tables(conn)
        df = load_frame(conn, since)
        actions = load_actions(conn)
    finally:
        conn.close()
    if df.empty:
        conn = get_conn()
        try:
            set_meta(conn, TECH_KEY, {"ok": False, "reason": "store is empty", "rows": []})
        finally:
            conn.close()
        return [{"item": "RESULT", "value": "store is empty — nothing published"}]

    jumps = find_jumps(df)
    action_stats = confirm_jumps(jumps, actions, budget_s=max(20, budget_s - (time.monotonic() - t0) - 60))

    conn = get_conn()
    try:
        actions = load_actions(conn)
        state = get_meta(conn, STATE_KEY, None) or {}
        ms = get_meta(conn, "momentum_screeners", {}) or {}
    finally:
        conn.close()
    df = adjust_frame(df, actions, jumps)
    rows = compute_technicals(df, state.get("names") or {})
    shares, cap_stats = refresh_shares([r["symbol"] for r in rows], budget_s=max(0, min(150, budget_s - (time.monotonic() - t0) - 40)))
    for r in rows:
        n = shares.get(r["symbol"])
        r["market_cap_cr"] = round(r["price"] * n / 1e7) if n else None
    action_stats.update(cap_stats)
    ok, stats = verify(rows, ms)
    payload = {
        "ok": bool(ok),
        "as_of": stats.get("latest_trade_date"),
        "generated": date.today().isoformat(),
        "stats": stats,
        "actions": action_stats,
        "rows": rows if ok else [],
    }
    conn = get_conn()
    try:
        set_meta(conn, TECH_KEY, payload)
    finally:
        conn.close()
    out = [{"item": "ok (page will use the NSE universe)", "value": ok}, {"item": "rows computed", "value": len(rows)}]
    out += [{"item": f"corporate actions: {k}", "value": v} for k, v in action_stats.items()]
    out += [{"item": f"verify: {k}", "value": v} for k, v in stats.items() if k != "vs_yahoo"]
    for k, v in stats.get("vs_yahoo", {}).items():
        out.append({"item": f"verify {k} vs {v['vs']}", "value": f"{v['within']} within {v['tol_pp']}pp (n={v['n']})"})
    out.append({"item": "seconds", "value": round(time.monotonic() - t0, 1)})
    return out
