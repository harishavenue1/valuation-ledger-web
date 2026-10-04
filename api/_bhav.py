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
DEEP_DAYS = 1830  # the NSE-750 keep 5y (what the Yahoo nse750PriceCache holds), so the store can replace it
STATE_KEY = "bhav_state"
TECH_KEY = "bhav_technicals"
MCAP_KEY = "bhav_mcaps"
MCAP_REFRESH_DAYS = 14
DB_MAX_MB = 400  # refuse to grow the database past this
JUMP_LO, JUMP_HI = 0.77, 1.30  # day-over-day close ratio outside this = candidate split/bonus
SMALL_LO, SMALL_HI = 0.93, 1.08  # inside (JUMP_LO, SMALL_LO] / [SMALL_HI, JUMP_HI): small-bonus candidates, only ever acted on with a Yahoo record
SPLITCHECK_KEY = "bhav_splitcheck"
ATH_KEY = "bhav_ath"
ATH_FLOOR = date(2020, 6, 1)  # NSE's archive of these files starts here
SPLITCHECK_DAYS = 14
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


def prune_dead(conn):
    """Delete every chunk of a symbol that has none in the current or previous
    quarter (delisted, merged, finished rights-entitlement tickers...). They are
    never shown (the page only lists symbols with a recent bar) and only take
    space. Returns the number of chunk rows removed."""
    today = date.today()
    first_of_q = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
    keep_from = quarter_of((first_of_q - timedelta(days=1)).isoformat())
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM bhav_chunks WHERE symbol IN (SELECT symbol FROM bhav_chunks GROUP BY symbol HAVING max(q) < %s)",
            (keep_from,),
        )
        removed = cur.rowcount
        cur.execute("DELETE FROM bhav_actions WHERE symbol NOT IN (SELECT DISTINCT symbol FROM bhav_chunks)")
    conn.commit()
    return removed


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
    # splitlines (not StringIO) and NULs stripped: a few old files are damaged,
    # and one (2022-08-08) is not a CSV at all — a ZIP/Excel file published under
    # the CSV name — which has no SYMBOL/SERIES header and yields nothing.
    lines = [ln for ln in text.replace("\0", "").splitlines() if ln.strip()]
    if not lines or "SYMBOL" not in lines[0] or "SERIES" not in lines[0]:
        return None, {}
    for raw in csv.DictReader(lines):
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

def run_store(budget_s=200, deep_symbols=None):
    """Fetch every weekday in the last STORE_DAYS not yet checked (today and
    yesterday always re-checked: NSE publishes late), newest first, then merge
    them into the store. Gentle on purpose (2 workers) and resumable.

    deep_symbols (the NSE-750) additionally get history back to DEEP_DAYS —
    days older than STORE_DAYS keep only their rows, so the rest of the market
    stays at two years and the database grows by the 750 stocks' extra three."""
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
    deep_start = today - timedelta(days=DEEP_DAYS) if deep_symbols else start
    always = {today, today - timedelta(days=1)}
    todo = []
    d = today
    while d >= deep_start:
        if d.weekday() < 5 and (d in always or d.isoformat() not in checked):
            todo.append(d)
        d -= timedelta(days=1)

    t0 = time.monotonic()
    session = requests.Session()
    fetched, copies, missing, blocked, errors, unparseable = {}, 0, 0, 0, 0, 0
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
                try:
                    trade, rows = parse_day(text)
                except Exception:
                    trade, rows = None, {}
                if trade is None:
                    unparseable += 1
                    if day not in always:  # an old damaged file never gets better; today's might
                        checked.add(day.isoformat())
                elif trade == day.isoformat():
                    if day < start:  # only the deep window reaches here: NSE-750 rows only
                        rows = {sym: r for sym, r in rows.items() if sym in deep_symbols}
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
        cutoff = (today - timedelta(days=DEEP_DAYS)).isoformat()  # keep the deep window's "checked" marks even on a run without deep_symbols
        state["checked"] = sorted(c for c in checked if c >= cutoff)
        # names refresh weekly
        if (state.get("names_as_of") or "") < (today - timedelta(days=7)).isoformat() or not state.get("names_has_sme"):
            names = fetch_names(session)
            if names:
                state["names"], state["names_as_of"], state["names_has_sme"] = names, today.isoformat(), True
        set_meta(conn, STATE_KEY, state)
        pruned = prune_dead(conn)
        size = db_size_mb(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT min(q), count(DISTINCT symbol) FROM bhav_chunks")
            earliest_q, n_symbols = cur.fetchone()
            cur.execute("SELECT count(DISTINCT symbol) FROM bhav_chunks WHERE q = %s", (earliest_q,))
            n_earliest = cur.fetchone()[0]
            deep_bars = deep_syms_n = None
            if deep_symbols:
                cur.execute("SELECT sum(jsonb_array_length(data->'d')), count(DISTINCT symbol) FROM bhav_chunks WHERE symbol = ANY(%s)", (list(deep_symbols),))
                deep_bars, deep_syms_n = cur.fetchone()
        yahoo_idx = get_meta(conn, "nse750PriceCache", {}) or {}
    finally:
        conn.close()

    return [
        {"item": "dead-symbol chunk rows pruned", "value": pruned},
        {"item": "weekdays requested", "value": len(todo)},
        {"item": "trading days stored", "value": stored_days},
        {"item": "holiday copies skipped", "value": copies},
        {"item": "unparseable files skipped", "value": unparseable},
        {"item": "files not found (404)", "value": missing},
        {"item": "blocked (403) / errors", "value": f"{blocked} / {errors}"},
        {"item": "chunk rows written", "value": written},
        {"item": "latest trade date", "value": state.get("last_trade")},
        {"item": "stopped early", "value": stop or (time.monotonic() - t0 > budget_s)},
        {"item": "database MB", "value": round(size, 1)},
        {"item": "earliest quarter stored / symbols in it", "value": f"{earliest_q} / {n_earliest}"},
        {"item": "symbols stored", "value": n_symbols},
        {"item": "NSE-750 bars in the store / symbols", "value": f"{deep_bars} / {deep_syms_n}"},
        {"item": "Yahoo price cache bars / symbols (for comparison)", "value": f"{yahoo_idx.get('rows_total')} / {yahoo_idx.get('symbols_cached')}"},
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


def find_small_candidates(df):
    """[(symbol, ex_iso, ratio)] for day-over-day moves INSIDE the plain-jump band
    but big enough to be a small bonus (1:10 = 0.909, 1:5 = 0.833, 1:4 = 0.8).
    Ordinary moves look the same, so these are never acted on without a matching
    Yahoo split record (sweep_small_actions)."""
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
    idx = np.where(((ratio > JUMP_LO) & (ratio <= SMALL_LO)) | ((ratio >= SMALL_HI) & (ratio < JUMP_HI)))[0]
    dates = df["date"].dt.date.astype(str).to_numpy()
    return [(sym[i], dates[i], float(ratio[i])) for i in idx]


def _small_factor(ratio, near):
    """Factor for a small-band candidate from Yahoo split ratios dated near it —
    a direct match only (the day's residual move must stay within about 12%), no
    clean-ratio snapping, because an ordinary -9% day next to a real split must
    not be mistaken for a second one."""
    for sr in near:
        if ratio < 1 and not (1.03 < sr < 1.4):
            continue
        if ratio > 1 and not (0.7 < sr < 0.97):
            continue
        if 0.88 <= ratio * sr <= 1.14:
            return 1.0 / sr
    return None


def sweep_small_actions(df, actions, budget_s=60, key=SPLITCHECK_KEY):
    """Find small bonuses (the plain jump detector's blind band) by asking Yahoo
    for each affected symbol's split record, at most once per SPLITCHECK_DAYS,
    oldest-checked first and resumable across runs. Records source 'yahoo-small'."""
    from concurrent.futures import ThreadPoolExecutor

    t0 = time.monotonic()
    cands = find_small_candidates(df)
    known = {(s, ex) for s, rows in actions.items() for ex, _f_, _src in rows}
    by_symbol = collections.defaultdict(list)
    for sym, ex, ratio in cands:
        if (sym, ex) not in known:
            by_symbol[sym].append((ex, ratio))
    conn = get_conn()
    try:
        checked = get_meta(conn, key, None) or {}
    finally:
        conn.close()
    cutoff = (date.today() - timedelta(days=SPLITCHECK_DAYS)).isoformat()
    todo = sorted((s for s in by_symbol if checked.get(s, "") < cutoff), key=lambda s: checked.get(s, ""))
    stats = collections.Counter()
    stats["candidate_symbols"] = len(by_symbol)
    stats["to_check"] = len(todo)
    for i in range(0, len(todo), 24):
        if time.monotonic() - t0 > budget_s:
            break
        batch = todo[i:i + 24]
        with ThreadPoolExecutor(max_workers=4) as pool:
            looked = list(pool.map(_lookup_symbol, batch))
        rows = []
        for sym, split_list, _known_to_yahoo in looked:
            if split_list is None:
                stats["yahoo_failed"] += 1
                continue
            checked[sym] = date.today().isoformat()
            stats["checked"] += 1
            have = [date.fromisoformat(ex) for ex, _f_, src in actions.get(sym, []) if src not in ("rejected", "nodata")]
            for ex, ratio in by_symbol[sym]:
                ex_d = date.fromisoformat(ex)
                near = [sr for sd, sr in split_list if abs((sd - ex_d).days) <= 4 and not any(abs((sd - h).days) <= 4 for h in have)]
                f = _small_factor(ratio, near)
                if f is not None:
                    rows.append((sym, ex, float(f), "yahoo-small"))
                    stats["small_bonus_found"] += 1
        if rows:
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
    wconn = get_conn()
    try:
        set_meta(wconn, key, checked)
    finally:
        wconn.close()
    return dict(stats)


def derive_rejected_from_reference(df, actions, ref):
    """Demergers (SIEMENS, EDELWEISS, HERITGFOOD…) are not splits: Yahoo has no
    split record, so a big drop gets 'rejected' — yet Yahoo's own adjusted series
    is continuous across it. For those NSE-750 events, take the factor straight
    from the Yahoo cache: the factor that makes our raw close ratio equal its
    ratio across the ex-date (accepted only where Yahoo's own day move is within
    ±15% and ours is a >20% drop/rise, so a real crash is never smoothed away).
    Recorded as source 'yahoo-derived'."""
    todo = [(s, ex) for s, rows in actions.items() for ex, f, src in rows if src == "rejected" and s in ref]
    if not todo:
        return {"derived_candidates": 0}
    close = {s: g.set_index(g["date"].dt.date.astype(str))["c"] for s, g in df[df["symbol"].isin({t[0] for t in todo})].groupby("symbol")}
    out, stats = [], collections.Counter()
    for sym, ex in todo:
        sc = close.get(sym)
        yc = {r[0]: r[4] for r in ref[sym] if r[4]}
        if sc is None or ex not in sc.index or ex not in yc:
            stats["no_data"] += 1
            continue
        sd = [d for d in sc.index if d < ex]
        yd = [d for d in yc if d < ex]
        if not sd or not yd:
            stats["no_data"] += 1
            continue
        s_prev, y_prev = float(sc[max(sd)]), yc[max(yd)]
        s_ex, y_ex = float(sc[ex]), yc[ex]
        s_move, y_move = s_ex / s_prev, y_ex / y_prev
        if (s_move <= 0.8 or s_move >= 1.25) and 0.85 <= y_move <= 1.15:
            f = (y_prev / y_ex) * (s_ex / s_prev)
            out.append((sym, ex, round(float(f), 5), "yahoo-derived"))
            stats["derived"] += 1
        else:
            stats["kept_rejected"] += 1
    if out:
        wconn = get_conn()
        try:
            with wconn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO bhav_actions (symbol, ex_date, factor, source) VALUES %s ON CONFLICT (symbol, ex_date) DO UPDATE SET factor = EXCLUDED.factor, source = EXCLUDED.source",
                    out,
                )
            wconn.commit()
        finally:
            wconn.close()
    stats["derived_events"] = ", ".join(f"{s} {ex} x{f}" for s, ex, f, _ in out)[:400]
    return dict(stats)


# ── all-time high (history older than the store) ─────────────────────────────

def run_ath_backfill(budget_s=230):
    """True all-time highs. The store keeps ~2 years, so 'ATH' from it alone is a
    2-year high (TATVA is 44% off its real ATH and showed -9%). This walks the
    older NSE files back to ATH_FLOOR, newest first, WITHOUT keeping their daily
    bars: per symbol it keeps only the highest split-adjusted high. State lives in
    meta bhav_ath: basis B (first day of the stored window; fixed), next_end (the
    earliest day already folded in), ath {symbol: [high, date]} on B's price basis
    — publish() multiplies by the factors of corporate actions dated >= B and takes
    the max with the stored window. Resumable; every run re-links on next_end."""
    from concurrent.futures import ThreadPoolExecutor

    t0 = time.monotonic()
    conn = get_conn()
    try:
        ensure_tables(conn)
        st = get_meta(conn, ATH_KEY, None) or {}
    finally:
        conn.close()
    if st.get("done"):
        return [{"item": "ATH backfill", "value": f"already complete down to {st.get('next_end')} ({len(st.get('ath') or {})} symbols)"}]
    basis = st.get("basis") or (date.today() - timedelta(days=STORE_DAYS)).isoformat()
    end = date.fromisoformat(st.get("next_end") or basis)
    ath = st.get("ath") or {}

    days = []
    d = end
    while d >= ATH_FLOOR:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    session = requests.Session()
    fetched, copies, missing, blocked, unparseable = {}, 0, 0, 0, 0
    fetch_budget = max(30, budget_s * 0.45)
    stop = False
    exhausted = True
    for i in range(0, len(days), 16):
        if stop or time.monotonic() - t0 > fetch_budget:
            exhausted = False
            break
        batch = days[i:i + 16]

        def one(day):
            time.sleep(0.15)
            return day, fetch_file(day, session)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda day: _safe(one, day), batch))
        nb = 0
        for res in results:
            if res is None:
                continue
            day, (status, text) = res
            if status == 200 and text:
                try:
                    trade, rows = parse_day(text)
                except Exception:
                    trade, rows = None, {}
                if trade is None:
                    unparseable += 1
                elif trade == day.isoformat():
                    fetched[trade] = rows
                else:
                    copies += 1
            elif status == 404:
                missing += 1
            elif status == 403:
                nb += 1
        blocked += nb
        if nb >= len(batch) // 2:
            stop = True
    if not fetched:
        return [{"item": "ATH backfill", "value": "no files fetched"}, {"item": "blocked", "value": blocked}]

    recs = [(sym, dt, r[0], r[1], r[2], r[3], r[4] or 0.0) for dt, rows in fetched.items() for sym, r in rows.items()]
    df = pd.DataFrame(recs, columns=["symbol", "date", "o", "h", "l", "c", "v"])
    df["date"] = pd.to_datetime(df["date"])
    for k in ("o", "h", "l", "c", "v"):
        df[k] = pd.to_numeric(df[k], errors="coerce").astype("float64")
    df = df.dropna(subset=["c"]).sort_values(["symbol", "date"]).reset_index(drop=True)
    earliest = df["date"].min().date().isoformat()

    jumps = [j for j in find_jumps(df) if j[1] < basis]
    conn = get_conn()
    try:
        actions = load_actions(conn)
    finally:
        conn.close()
    cstats = confirm_jumps(jumps, actions, budget_s=max(15, budget_s - (time.monotonic() - t0) - 25))
    conn = get_conn()
    try:
        actions = load_actions(conn)
    finally:
        conn.close()
    actions_lt = {s: [a for a in rows if a[0] < basis] for s, rows in actions.items()}
    old = df[df["date"] < pd.Timestamp(basis)].copy()
    adj = adjust_frame(old, actions_lt, jumps)
    if not adj.empty:
        idx = adj.groupby("symbol", sort=False)["h"].idxmax()
        for i in idx:
            sym, hv, dt = adj.at[i, "symbol"], float(adj.at[i, "h"]), adj.at[i, "date"].date().isoformat()
            if hv == hv and hv > 0 and (sym not in ath or hv > ath[sym][0]):
                ath[sym] = [round(hv, 2), dt]
    known_now = {(sy, ex) for sy, rws in actions.items() for ex, _f_, _src in rws}
    pending = [j for j in jumps if (j[0], j[1]) not in known_now]
    clean = not pending
    if clean:
        st["next_end"] = earliest
        st["done"] = bool(exhausted and not stop)
    st.update({"basis": basis, "ath": ath, "updated": date.today().isoformat()})
    conn = get_conn()
    try:
        set_meta(conn, ATH_KEY, st)
    finally:
        conn.close()
    return [
        {"item": "days folded in (this run)", "value": len(fetched)},
        {"item": "range this run", "value": f"{earliest} .. {max(fetched)}"},
        {"item": "holiday copies / 404 / unparseable / blocked", "value": f"{copies} / {missing} / {unparseable} / {blocked}"},
        {"item": "jumps flagged", "value": cstats.get("flagged")},
        {"item": "split decisions", "value": ", ".join(f"{k}:{v}" for k, v in cstats.items() if k not in ("flagged", "pending_before"))},
        {"item": "advanced to (next_end)", "value": st.get("next_end") if clean else f"NOT advanced ({len(pending)} split lookups still pending — this block is redone next run)"},
        {"item": "complete", "value": bool(st.get("done"))},
        {"item": "symbols with an old ATH", "value": len(ath)},
        {"item": "seconds", "value": round(time.monotonic() - t0, 1)},
    ]


def ath_adjustments(conn_actions, basis, ath):
    """{symbol: old-history ATH on TODAY's basis}: the stored B-basis high times
    the factors of every real action dated on/after the basis day."""
    out = {}
    for sym, (hv, _dt) in ath.items():
        f = 1.0
        for ex, factor, src in conn_actions.get(sym, []):
            if ex >= basis and src not in ("rejected", "nodata") and abs(factor - 1) > 1e-9:
                f *= factor
        out[sym] = hv * f
    return out


# ── weekly bars for the Charts page ──────────────────────────────────────────

def symbol_bars(sym, tf="w", since_days=DEEP_DAYS):
    """Bars [(key_iso, o, h, l, c, v), ...] for ONE symbol — tf "d" (one per trading
    day), "w" (keyed on the week's Monday) or "m" (first of the month) — from the
    store's daily bars (split/bonus-adjusted like everything else here), plus the
    last trade date. NSE official closes, Mon-Fri weeks keyed on their Monday —
    what TradingView shows — instead of Yahoo's mis-dated, sometimes split
    weekly bars. None when the symbol isn't in the store."""
    since = (date.today() - timedelta(days=since_days)).isoformat()
    conn = get_conn()
    try:
        ensure_tables(conn)
        cols = {k: [] for k in ("d", "o", "h", "l", "c", "v")}
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM bhav_chunks WHERE symbol = %s AND q >= %s ORDER BY q", (sym, quarter_of(since)))
            for (ch,) in cur.fetchall():
                for k in cols:
                    cols[k].extend(ch[k])
            cur.execute("SELECT ex_date, factor, source FROM bhav_actions WHERE symbol = %s", (sym,))
            acts = [(ex.isoformat(), float(f), src) for ex, f, src in cur.fetchall()]
    finally:
        conn.close()
    if not cols["d"]:
        return None
    df = pd.DataFrame({"symbol": sym, "date": pd.to_datetime(cols["d"]), **{k: pd.to_numeric(pd.Series(cols[k]), errors="coerce").astype("float64") for k in ("o", "h", "l", "c", "v")}})
    df = df[df["date"] >= pd.Timestamp(since)].sort_values("date").reset_index(drop=True)
    if df.empty:
        return None
    jumps = find_jumps(df)
    df = adjust_frame(df, {sym: acts} if acts else {}, jumps)
    df = df.dropna(subset=["o", "h", "l", "c"])
    if df.empty:
        return None
    if tf == "d":
        out = [(r.date.date().isoformat(), float(r.o), float(r.h), float(r.l), float(r.c), float(r.v) if r.v == r.v else 0.0) for r in df.itertuples()]
        return out, df["date"].max().date().isoformat()
    if tf == "m":
        df["wk"] = df["date"].dt.to_period("M").dt.start_time
    else:
        df["wk"] = df["date"] - pd.to_timedelta(df["date"].dt.weekday, unit="D")
    wk = df.groupby("wk", sort=True).agg(o=("o", "first"), h=("h", "max"), l=("l", "min"), c=("c", "last"), v=("v", "sum")).reset_index()
    out = [(r.wk.date().isoformat(), float(r.o), float(r.h), float(r.l), float(r.c), float(r.v) if r.v == r.v else 0.0) for r in wk.itertuples()]
    return out, df["date"].max().date().isoformat()


def symbol_weekly(sym, since_days=DEEP_DAYS):
    return symbol_bars(sym, "w", since_days)


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


def compute_technicals(df, names, ath_extra=None):
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
    if ath_extra:  # history older than the stored window
        ath = pd.concat([ath, pd.Series(ath_extra, dtype="float64")], axis=1).max(axis=1)
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

# ── the "4% Scan" (Arthon Advisors / @thechartist26, #IEC2026) ────────────────

SCAN4 = {"min_chg_pct": 4.0, "min_vol_x": 4.0, "mcap_lo": 500, "mcap_hi": 10000, "min_traded_cr": 10.0, "min_price": 10.0}


def compute_four_pct_scan(df, rows):
    """Six filters, run every evening after the close: price up more than 4%
    on the day, volume at least 4x the previous day's (up 300%+), market cap
    Rs 500-10,000 Cr, traded value (price x volume) above Rs 10 Cr, price above
    Rs 10, NSE-listed (everything in this store is). Runs over EVERY NSE stock in
    the store, not just the NSE-750. Returns (matching rows, funnel counts)."""
    if df.empty or not rows:
        return [], {}
    last_date = df["date"].max()
    g = df.groupby("symbol", sort=False)["v"]
    prev_vol = g.apply(lambda s: s.iloc[-2] if len(s) > 1 else np.nan)
    last_vol = g.last()
    funnel = {"universe": 0, "price_up": 0, "volume_x4": 0, "mcap_band": 0, "traded_value": 0, "price_over_10": 0}
    out = []
    for r in rows:
        if r.get("as_of") != last_date.date().isoformat():
            continue  # didn't trade on the latest session
        funnel["universe"] += 1
        sym = r["symbol"]
        chg = r.get("change_pct")
        if chg is None or not chg > SCAN4["min_chg_pct"]:
            continue
        funnel["price_up"] += 1
        pv, lv = prev_vol.get(sym), last_vol.get(sym)
        if pv is None or lv is None or not pv > 0 or not lv / pv >= SCAN4["min_vol_x"]:
            continue
        funnel["volume_x4"] += 1
        mc = r.get("market_cap_cr")
        if mc is None or not SCAN4["mcap_lo"] <= mc <= SCAN4["mcap_hi"]:
            continue
        funnel["mcap_band"] += 1
        traded = r["price"] * lv / 1e7
        if not traded > SCAN4["min_traded_cr"]:
            continue
        funnel["traded_value"] += 1
        if not r["price"] > SCAN4["min_price"]:
            continue
        funnel["price_over_10"] += 1
        out.append(
            {
                "symbol": sym,
                "name": r.get("name") or sym,
                "price": r["price"],
                "change_pct": chg,
                "volume": int(lv),
                "prev_volume": int(pv),
                "vol_x_prev": round(float(lv / pv), 1),
                "traded_value_cr": round(float(traded), 1),
                "market_cap_cr": mc,
                "deliv_pct": r.get("deliv_pct"),
                "pct_from_52w_high": r.get("pct_from_52w_high"),
                "as_of": r["as_of"],
            }
        )
    out.sort(key=lambda x: -x["vol_x_prev"])
    for i, x in enumerate(out, 1):
        x["rank"] = i
    return out, funnel


# ── "Gap-Up Hold" (@FibTraderR, 2026-10-04) ──────────────────────────────────
#
# "When a stock creates a gap-up, sustains that gap for 4 to 5 trading sessions,
# and the overall trend supports the move, it can signal strong buying interest
# and the potential beginning of a major rally" (examples: Morepen Labs, CG
# Power, Adani Green). The tweet gives no numbers, so these are explicit,
# adjustable defaults: a GAP is the day's open above the previous day's HIGH by
# at least GAP["min_gap_pct"]; it is SUSTAINED while no session since (the gap
# day included) trades down into the gap, i.e. every low stays above that
# previous high; it must have held for GAP["sessions"] sessions after the gap
# day; the TREND supports it when the close is above the 50D and 200D EMA (OHLC4,
# this account's convention); and a small liquidity floor keeps out untradeable
# names.

GAP = {"min_gap_pct": 2.0, "sessions": (4, 5), "min_price": 10.0, "min_traded_cr": 1.0}


def compute_gap_hold(df, rows):
    """[matching rows], funnel counts. df = adjusted daily bars, rows = the
    published technicals (latest bar, EMA distances, market cap...)."""
    if df.empty or not rows:
        return [], {}
    last_date = df["date"].max()
    need = max(GAP["sessions"]) + 2
    tail = df.groupby("symbol", sort=False).tail(need + 20)  # +20 for the gap-day volume baseline
    by_sym = {sym: g for sym, g in tail.groupby("symbol", sort=False)}
    funnel = {"universe": 0, "gap_in_window": 0, "gap_held": 0, "trend_ok": 0, "liquid": 0}
    out = []
    for r in rows:
        if r.get("as_of") != last_date.date().isoformat():
            continue
        funnel["universe"] += 1
        g = by_sym.get(r["symbol"])
        if g is None or len(g) < need:
            continue
        o, h, l, c, v = (g[k].to_numpy(dtype=float) for k in ("o", "h", "l", "c", "v"))
        dts = g["date"].dt.date.astype(str).to_numpy()
        n = len(g)
        best = None
        for k in GAP["sessions"]:  # gap day is k sessions before the latest bar
            gi = n - 1 - k
            if gi < 1 or not h[gi - 1] > 0:
                continue
            gap_pct = (o[gi] / h[gi - 1] - 1) * 100
            if gap_pct < GAP["min_gap_pct"]:
                continue
            funnel["gap_in_window"] += 1
            if not float(np.min(l[gi:])) > h[gi - 1]:
                continue  # the gap got filled
            if best is None or gap_pct > best[1]:
                best = (gi, gap_pct, k)
        if best is None:
            continue
        funnel["gap_held"] += 1
        gi, gap_pct, k = best
        p50, p200 = r.get("pct_50d_ema"), r.get("pct_200d_ema")
        if p50 is None or p200 is None or not (p50 > 0 and p200 > 0):
            continue
        funnel["trend_ok"] += 1
        price = r["price"]
        traded = price * v[-1] / 1e7
        if not (price > GAP["min_price"] and traded >= GAP["min_traded_cr"]):
            continue
        funnel["liquid"] += 1
        base = v[max(0, gi - 20):gi]
        out.append(
            {
                "symbol": r["symbol"],
                "name": r.get("name") or r["symbol"],
                "price": price,
                "change_pct": r.get("change_pct"),
                "gap_date": dts[gi],
                "gap_pct": round(float(gap_pct), 1),
                "gap_zone_low": round(float(h[gi - 1]), 2),
                "gap_open": round(float(o[gi]), 2),
                "sessions_held": k,
                "pct_above_gap": round(float((price / h[gi - 1] - 1) * 100), 1),
                "gap_day_vol_x": round(float(v[gi] / base.mean()), 1) if len(base) >= 5 and base.mean() > 0 else None,
                "pct_50d_ema": p50,
                "pct_200d_ema": p200,
                "pct_from_52w_high": r.get("pct_from_52w_high"),
                "market_cap_cr": r.get("market_cap_cr"),
                "traded_value_cr": round(float(traded), 1),
                "as_of": r["as_of"],
            }
        )
    out.sort(key=lambda x: -x["gap_pct"])
    for i, x in enumerate(out, 1):
        x["rank"] = i
    return out, funnel


# ── "Momentum Pullback Scan" (CMA Gurvinder Malhotra @cmagurvinder, 2026-10-04) ──
#
# Key filters as printed in his infographic: Market Cap > Rs1,000 Cr; Close > the
# close 1 month ago; Avg volume (63 days) > Avg volume (252 days); recent
# contraction in volume; Close > 10 EMA; 10 EMA > 20 EMA; 20 EMA > 50 EMA; price
# closed higher than 1 day ago; pullback towards the 10 EMA. "Recent contraction"
# and "towards" have no numbers in the post, so: the last 5 sessions' average
# volume is below the last 20's, and the close is within 3% above the 10 EMA.
# EMAs on OHLC4 and compared with the close (this account's convention). Helper
# columns for his entry/risk notes: trigger = highest high of the last 5 sessions
# ("break above pullback high"), stop = lower of the last-5-session low and the
# 10 EMA ("below recent swing low or 10 EMA, whichever is lower").

PB = {"min_mcap_cr": 1000, "max_above_ema10_pct": 3.0, "vol_fast": 63, "vol_slow": 252, "vol_short": 5, "vol_mid": 20}


def compute_pullback_mom(df, rows):
    if df.empty or not rows:
        return [], {}
    last_date = df["date"].max()
    need = PB["vol_slow"]
    funnel = {"universe": 0, "mcap_1000cr": 0, "month_up_day_up": 0, "ema_stack": 0, "near_10ema": 0, "vol_trend": 0, "vol_contraction": 0}
    cand = []
    for r in rows:
        if r.get("as_of") != last_date.date().isoformat():
            continue
        funnel["universe"] += 1
        mc = r.get("market_cap_cr")
        if mc is None or not mc > PB["min_mcap_cr"]:
            continue
        funnel["mcap_1000cr"] += 1
        m1, ch = r.get("monthly_pct"), r.get("change_pct")
        if m1 is None or ch is None or not (m1 > 0 and ch > 0):
            continue
        funnel["month_up_day_up"] += 1
        p20, p50 = r.get("pct_20d_ema"), r.get("pct_50d_ema")
        if p20 is None or p50 is None:
            continue
        cand.append(r)
    if not cand:
        return [], funnel
    syms = {r["symbol"] for r in cand}
    tail = df[df["symbol"].isin(syms)].groupby("symbol", sort=False).tail(need + 5)
    by_sym = {sym: g for sym, g in tail.groupby("symbol", sort=False)}
    out = []
    for r in cand:
        g = by_sym.get(r["symbol"])
        if g is None or len(g) < need:
            continue
        o, h, l, c, v = (g[k].to_numpy(dtype=float) for k in ("o", "h", "l", "c", "v"))
        price = float(c[-1])
        ema10 = float(pd.Series((o + h + l + c) / 4).ewm(span=10, adjust=False).mean().iloc[-1])
        ema20 = price / (1 + r["pct_20d_ema"] / 100)
        ema50 = price / (1 + r["pct_50d_ema"] / 100)
        if not (price > ema10 > ema20 > ema50):
            continue
        funnel["ema_stack"] += 1
        above10 = (price / ema10 - 1) * 100
        if not above10 <= PB["max_above_ema10_pct"]:
            continue
        funnel["near_10ema"] += 1
        v63, v252 = float(np.mean(v[-PB["vol_fast"]:])), float(np.mean(v[-PB["vol_slow"]:]))
        if not v63 > v252 > 0:
            continue
        funnel["vol_trend"] += 1
        v5, v20 = float(np.mean(v[-PB["vol_short"]:])), float(np.mean(v[-PB["vol_mid"]:]))
        if not 0 < v5 < v20:
            continue
        funnel["vol_contraction"] += 1
        hi10 = float(np.max(h[-10:]))
        trigger = float(np.max(h[-5:]))
        stop = min(float(np.min(l[-5:])), ema10)
        out.append(
            {
                "symbol": r["symbol"],
                "name": r.get("name") or r["symbol"],
                "price": round(price, 2),
                "change_pct": r.get("change_pct"),
                "monthly_pct": r.get("monthly_pct"),
                "ema10": round(ema10, 2),
                "pct_vs_10ema": round(above10, 1),
                "pct_vs_20ema": r["pct_20d_ema"],
                "pct_vs_50ema": r["pct_50d_ema"],
                "vol63_x_252": round(v63 / v252, 2),
                "vol5_x_20": round(v5 / v20, 2),
                "off_10d_high_pct": round((price / hi10 - 1) * 100, 1),
                "trigger_price": round(trigger, 2),
                "stop_price": round(stop, 2),
                "risk_pct": round((price - stop) / price * 100, 1),
                "market_cap_cr": r.get("market_cap_cr"),
                "pct_from_52w_high": r.get("pct_from_52w_high"),
                "as_of": r["as_of"],
            }
        )
    out.sort(key=lambda x: -x["monthly_pct"])
    for i, x in enumerate(out, 1):
        x["rank"] = i
    return out, funnel


# ── Microcap Momentum (Techno Charts, "Microcap Swing Trading Strategy") ──────
#
# As described by the video's own summary (no captions to check against):
# universe = Nifty Microcap 250; momentum score = a weighted blend of the
# 6-month return (70%) and 1-month return (30%), adjusted for 3-month price
# volatility; hold the top 10 equal-weight; rebalance monthly (sell what drops
# out of the top 10, buy the new entrants). Assumptions used here: score =
# (0.7*R6m + 0.3*R1m) / annualised volatility of daily returns over the last 63
# sessions (all in %), R6m/R1m on calendar offsets like the other pages. The
# month's portfolio is the top 10 on the first publish of each calendar month.

MICRO = {"w6m": 0.7, "w1m": 0.3, "vol_days": 63, "top_n": 10, "show_n": 20, "min_bars": 130}
MICRO_URLS = (
    "https://nsearchives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv",
    "https://archives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv",
    "https://www.niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv",
)
MICRO_UNIVERSE_KEY = "bhav_microcap250"
MICRO_SNAPSHOT_KEY = "bhav_microcap_snapshot"


def load_microcap_universe():
    """{symbol: industry} for the Nifty Microcap 250, cached in meta for a week
    (index reconstitutions are semi-annual). Falls back to a stale copy."""
    conn = get_conn()
    try:
        cached = get_meta(conn, MICRO_UNIVERSE_KEY, None) or {}
    finally:
        conn.close()
    if cached.get("symbols") and cached.get("fetched", "") >= (date.today() - timedelta(days=7)).isoformat():
        return cached["symbols"]
    for url in MICRO_URLS:
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code != 200 or "Symbol" not in r.text[:200]:
                continue
            sy = {x["Symbol"].strip(): x.get("Industry", "").strip() for x in csv.DictReader(io.StringIO(r.text)) if x.get("Symbol")}
            if len(sy) >= 200:
                conn = get_conn()
                try:
                    set_meta(conn, MICRO_UNIVERSE_KEY, {"fetched": date.today().isoformat(), "symbols": sy})
                finally:
                    conn.close()
                return sy
        except Exception:
            continue
    return cached.get("symbols") or {}


def compute_microcap_momentum(df, rows, universe, snapshot):
    """(rows to show, new snapshot, funnel). snapshot = last stored
    {month, as_of, top10, entries, exits}."""
    if df.empty or not rows or not universe:
        return [], snapshot, {"error": "no universe" if not universe else "no data"}
    last_date = df["date"].max()
    month = last_date.strftime("%Y-%m")
    by_row = {r["symbol"]: r for r in rows if r.get("as_of") == last_date.date().isoformat()}
    funnel = {"universe": len(universe), "traded_latest_session": 0, "enough_history": 0, "scored": 0}
    scored = []
    syms = [s_ for s_ in universe if s_ in by_row]
    funnel["traded_latest_session"] = len(syms)
    sub = df[df["symbol"].isin(set(syms))]
    for sym, g in sub.groupby("symbol", sort=False):
        c = g["c"].to_numpy(dtype=float)
        d = g["date"].to_numpy()
        if len(c) < MICRO["min_bars"]:
            continue
        funnel["enough_history"] += 1
        t6 = np.datetime64(pd.Timestamp(d[-1]) - pd.DateOffset(months=6))
        j6 = int(np.searchsorted(d, t6, side="right")) - 1
        if j6 < 0 or c[j6] <= 0:
            continue
        r6 = (c[-1] / c[j6] - 1) * 100
        r1 = by_row[sym].get("monthly_pct")
        if r1 is None:
            continue
        rets = np.diff(np.log(c[-(MICRO["vol_days"] + 1):]))
        vol = float(np.std(rets, ddof=1) * np.sqrt(252) * 100) if len(rets) > 10 else 0.0
        if not vol > 0:
            continue
        score = (MICRO["w6m"] * r6 + MICRO["w1m"] * r1) / vol
        v = g["v"].to_numpy(dtype=float)
        avg_traded = float(np.mean(c[-20:] * v[-20:]) / 1e7)
        funnel["scored"] += 1
        r = by_row[sym]
        scored.append(
            {
                "symbol": sym,
                "name": r.get("name") or sym,
                "sector": universe.get(sym, ""),
                "price": r["price"],
                "change_pct": r.get("change_pct"),
                "r6m": round(float(r6), 1),
                "r1m": r1,
                "vol3m": round(vol, 1),
                "score": round(float(score), 2),
                "avg_traded_cr": round(avg_traded, 2),
                "market_cap_cr": r.get("market_cap_cr"),
                "pct_from_52w_high": r.get("pct_from_52w_high"),
                "as_of": r["as_of"],
            }
        )
    scored.sort(key=lambda x: -x["score"])
    for i, x in enumerate(scored, 1):
        x["rank"] = i
    top10 = [x["symbol"] for x in scored[: MICRO["top_n"]]]
    snap = snapshot or {}
    if snap.get("month") != month:  # first publish of a new month = the rebalance
        prev = snap.get("top10") or []
        snap = {"month": month, "as_of": last_date.date().isoformat(), "top10": top10, "entries": [t for t in top10 if t not in prev], "exits": [t for t in prev if t not in top10], "prev_top10": prev}
    held, entries, exits = set(snap["top10"]), set(snap.get("entries") or []), set(snap.get("exits") or [])
    out = []
    by_sym = {x["symbol"]: x for x in scored}
    for x in scored:
        sym, rank = x["symbol"], x["rank"]
        if sym in held:
            status = "Fading" if rank > MICRO["top_n"] else ("Entry" if sym in entries else "Hold")
        elif sym in exits:
            status = "Exit"
        elif rank <= MICRO["top_n"]:
            status = "Rising"
        else:
            status = ""
        x["status"] = status
        if rank <= MICRO["show_n"] or sym in held or sym in exits:
            out.append(x)
    funnel["portfolio_month"] = month
    funnel["portfolio"] = snap["top10"]
    return out, snap, funnel


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
        ath_state = get_meta(conn, ATH_KEY, None) or {}
        if ath_state.get("basis") and ath_state.get("ath"):
            since = min(since, ath_state["basis"])  # keep every stored day, not a rolling 2y: the old-history ATH is anchored at the basis day
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
    action_stats = confirm_jumps(jumps, actions, budget_s=max(20, budget_s - (time.monotonic() - t0) - 100))
    conn = get_conn()
    try:
        actions = load_actions(conn)
    finally:
        conn.close()
    action_stats.update({f"small_{k}": v for k, v in sweep_small_actions(df, actions, budget_s=max(15, min(80, budget_s - (time.monotonic() - t0) - 90))).items()})

    conn = get_conn()
    try:
        actions = load_actions(conn)
        state = get_meta(conn, STATE_KEY, None) or {}
        ms = get_meta(conn, "momentum_screeners", {}) or {}
    finally:
        conn.close()
    df = adjust_frame(df, actions, jumps)
    ath_extra = None
    if ath_state.get("ath"):
        known_ex = {(s_, ex) for s_, rws in actions.items() for ex, _f_, src in rws if src != "nodata"}
        cut_syms = {sym for sym, ex, _r in jumps if (sym, ex) not in known_ex}  # history cut at an unresolved jump: old highs can't be trusted either
        ath_extra = {k: v for k, v in ath_adjustments(actions, ath_state["basis"], ath_state["ath"]).items() if k not in cut_syms}
    rows = compute_technicals(df, state.get("names") or {}, ath_extra=ath_extra)
    ath_levels = {}
    try:  # {symbol: [ATH price, date]} for the Charts page's ATH line (kept out of the big rows payload)
        win = df.loc[df.groupby("symbol", sort=False)["h"].idxmax()].set_index("symbol")
        old_dates = {k: v[1] for k, v in (ath_state.get("ath") or {}).items()}
        for r_ in rows:
            sym = r_["symbol"]
            if sym not in win.index:
                continue
            wv, wd = float(win.at[sym, "h"]), win.at[sym, "date"].date().isoformat()
            ev = (ath_extra or {}).get(sym)
            if ev is not None and ev > wv:
                ath_levels[sym] = [round(float(ev), 2), old_dates.get(sym)]
            else:
                ath_levels[sym] = [round(wv, 2), wd]
    except Exception:
        ath_levels = {}
    shares, cap_stats = refresh_shares([r["symbol"] for r in rows], budget_s=max(0, min(150, budget_s - (time.monotonic() - t0) - 40)))
    for r in rows:
        n = shares.get(r["symbol"])
        r["market_cap_cr"] = round(r["price"] * n / 1e7) if n else None
    action_stats.update(cap_stats)
    scan_rows, scan_funnel = [], {}
    try:
        scan_rows, scan_funnel = compute_four_pct_scan(df, rows)
    except Exception as e:  # the scan must never block the page's own publish
        scan_funnel = {"error": str(e)[:120]}
    gap_rows, gap_funnel = [], {}
    try:
        gap_rows, gap_funnel = compute_gap_hold(df, rows)
    except Exception as e:
        gap_funnel = {"error": str(e)[:120]}
    pb_rows, pb_funnel = [], {}
    try:
        pb_rows, pb_funnel = compute_pullback_mom(df, rows)
    except Exception as e:
        pb_funnel = {"error": str(e)[:120]}
    mc_rows, mc_funnel, mc_snap = [], {}, None
    try:
        conn = get_conn()
        try:
            prev_snap = get_meta(conn, MICRO_SNAPSHOT_KEY, None)
        finally:
            conn.close()
        mc_rows, mc_snap, mc_funnel = compute_microcap_momentum(df, rows, load_microcap_universe(), prev_snap)
    except Exception as e:
        mc_funnel = {"error": str(e)[:120]}
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
        if ok and ath_levels:
            set_meta(conn, "bhav_ath_levels", {"as_of": stats.get("latest_trade_date"), "levels": ath_levels})
        if ok:
            if mc_snap:
                set_meta(conn, MICRO_SNAPSHOT_KEY, mc_snap)
                set_meta(conn, "bhav_scan_microcap", {"as_of": stats.get("latest_trade_date"), "rows": mc_rows, "funnel": mc_funnel, "snapshot": mc_snap, "params": MICRO})
            set_meta(conn, "bhav_scan_pullback", {"as_of": stats.get("latest_trade_date"), "rows": pb_rows, "funnel": pb_funnel, "filters": PB})
            set_meta(conn, "bhav_scan_gap", {"as_of": stats.get("latest_trade_date"), "rows": gap_rows, "funnel": gap_funnel, "filters": GAP})
            set_meta(conn, "bhav_scan4", {"as_of": stats.get("latest_trade_date"), "rows": scan_rows, "funnel": scan_funnel, "filters": SCAN4})
    finally:
        conn.close()
    out = [{"item": "ok (page will use the NSE universe)", "value": ok}, {"item": "rows computed", "value": len(rows)}, {"item": "4% scan matches / funnel", "value": f"{len(scan_rows)} / {scan_funnel}"}, {"item": "gap-up hold matches / funnel", "value": f"{len(gap_rows)} / {gap_funnel}"}, {"item": "pullback momentum matches / funnel", "value": f"{len(pb_rows)} / {pb_funnel}"}, {"item": "microcap momentum rows / funnel", "value": f"{len(mc_rows)} / {mc_funnel}"}]
    out += [{"item": f"corporate actions: {k}", "value": v} for k, v in action_stats.items()]
    out += [{"item": f"verify: {k}", "value": v} for k, v in stats.items() if k != "vs_yahoo"]
    for k, v in stats.get("vs_yahoo", {}).items():
        out.append({"item": f"verify {k} vs {v['vs']}", "value": f"{v['within']} within {v['tol_pp']}pp (n={v['n']})"})
    out.append({"item": "seconds", "value": round(time.monotonic() - t0, 1)})
    return out


# ── price-cache replacement (step 2) ─────────────────────────────────────────

def _deep_frame(symbols, since_days=1826):
    """The NSE-750's bars from the store, back since_days (raw prices)."""
    since = (date.today() - timedelta(days=since_days)).isoformat()
    conn = get_conn()
    try:
        ensure_tables(conn)
        df = load_frame(conn, since)
    finally:
        conn.close()
    if symbols:
        df = df[df["symbol"].isin(set(symbols))]
    return df.reset_index(drop=True)


def resolve_deep_actions(symbols, budget_s=200, ref=None):
    """Confirm/decide split-bonus events across the NSE-750's whole 5 years (the
    daily publish only looks at the last two), so the price-cache replacement
    can adjust that far back."""
    t0 = time.monotonic()
    df = _deep_frame(symbols)
    jumps = find_jumps(df)
    conn = get_conn()
    try:
        actions = load_actions(conn)
    finally:
        conn.close()
    stats = confirm_jumps(jumps, actions, budget_s=max(10, budget_s - (time.monotonic() - t0) - 100))
    conn = get_conn()
    try:
        actions = load_actions(conn)
    finally:
        conn.close()
    stats.update({f"small_{k}": v for k, v in sweep_small_actions(df, actions, budget_s=max(10, budget_s - (time.monotonic() - t0)), key=SPLITCHECK_KEY + "_deep").items()})
    if ref:
        conn = get_conn()
        try:
            actions = load_actions(conn)
        finally:
            conn.close()
        stats.update({f"derive_{k}": v for k, v in derive_rejected_from_reference(df, actions, ref).items()})
    return {"bars": len(df), "symbols": int(df["symbol"].nunique()), **stats}


def store_price_data(symbols, since_days=1826):
    """{symbol: [[date, open, high, low, close, volume], ...]} — exactly the shape
    nse750PriceCache's shards decode to, built from the store with splits/bonuses
    back-adjusted (a still-unresolved jump cuts that stock's history)."""
    df = _deep_frame(symbols, since_days)
    if df.empty:
        return {}
    conn = get_conn()
    try:
        actions = load_actions(conn)
    finally:
        conn.close()
    jumps = find_jumps(df)
    df = adjust_frame(df, actions, jumps)
    df = df.dropna(subset=["o", "h", "l", "c"])
    out = {}
    for sym, g in df.groupby("symbol", sort=False):
        dates = g["date"].dt.date.astype(str).tolist()
        o, h, l, c = (g[k].round(2).tolist() for k in ("o", "h", "l", "c"))
        v = [int(x) if x == x else None for x in g["v"].tolist()]
        out[sym] = [list(r) for r in zip(dates, o, h, l, c, v)]
    return out
