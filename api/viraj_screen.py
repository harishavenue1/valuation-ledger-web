"""POST /api/viraj_screen — pushed by ~/Downloads/viraj_screen.py (a
local cron script, not the browser) at the end of each run:
{"as_of": "YYYY-MM-DD", "rows": [{category, symbol, name, marketcap,
sales_g, ebit_g, eps_g, dol, dfl, dcl, F1..F3, C1..C3, score, verdict,
about}, ...]}. Same "one JSON blob in meta" pattern as
guidance_tracker.py — the script authenticates the normal way (POST
/api/login, reuse the session cookie) since this endpoint requires the
same auth as everything else, no separate script token.
Read back as part of the /api/stocks bundle (bundle.viraj_screen).

GET /api/viraj_screen — runs the SAME screen entirely on Vercel
(auth: api/_cron_auth.py's is_authed_cron_or_cookie — either
Vercel Cron's Bearer secret, or the normal browser session cookie for
an on-demand "Run now" click from any machine). Added 2026-08-30 after
actually testing the two things viraj_screen.py's own comments assumed
needed a login cookie: neither does. momoindiascreener.in's screen
pages, Screener.in's Quarterly Results table, AND Chartink's
/screener/process scan endpoint (the exact ad-hoc scan_clause POSTs
this script uses, not a saved/premium screen) all returned full,
correct data to a plain anonymous request when checked live — the
chartink_session cookie the original script insists on turns out to
gate saved/premium screens (see chartink_access.md's Combined Winners
example), not raw scan_clause scans. So unlike the 4 yfinance momentum
screeners, this one needed NO stored credentials at all to move to
Vercel — no security-posture trade-off to weigh.

Ported from ~/Downloads/viraj_screen.py's core logic (fetch 3
momoindiascreener.in screens -> Screener.in fundamentals per unique
symbol -> 3 Chartink scan_clause chart checks -> 6-rule validate() ->
build_rows()/build_combined()), unchanged math throughout. Drops:
fetch_about()/summarise_about() (the pushed payload has never included
"about" since 2026-08-23 — Excel-only, and Excel export itself is
dropped here same as every other cron port); the local parquet-less
per-run state is fine since this always runs fresh. Writes straight to
Postgres instead of a self-POST.

Time-budgeted (stops fetching fundamentals with headroom under the
300s function cap) — any tickers left over just get a "NO DATA" score
via validate(None, ...) rather than blocking the rest.

An optional `?limit=N` query param caps how many unique tickers get a
fundamentals fetch — manual testing only, never set by the real cron
trigger."""
import html as htmllib
import json
import os
import re
import sys
import time
from datetime import date
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests
from bs4 import BeautifulSoup

from _cron_auth import is_authed_cron_or_cookie
from _db import get_conn, set_meta
from _http import read_json_body, require_auth, send_json

VIRAJ_SCREEN_ID, T2T_SCREEN_ID, SHARPE_SCREEN_ID = 55, 377, 1
SCREEN_TOP_N = 45
FUND_DELAY_SECONDS = 1.0  # gap between tickers' Screener.in fetch — same pacing as the local script
TIME_BUDGET_SECONDS = 260  # stop fetching fundamentals with headroom under the 300s function cap

MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
          "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def _vj_fetch_momo_screen(screen_id, label, top_n=SCREEN_TOP_N):
    r = requests.get(f"https://momoindiascreener.in/screens/{screen_id}",
                      headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    r.raise_for_status()
    match = re.search(r'data-page="({.*?})"', r.text)
    data = json.loads(htmllib.unescape(match.group(1)))
    stocks = []
    for row in data["props"]["results"][:top_n]:
        inst = row.get("nse_instrument", {})
        stocks.append({
            "symbol": inst.get("symbol", ""),
            "name": inst.get("name", ""),
            "marketcap": row.get("marketcap", "—"),
            "price": row.get("close", "—"),
            "screen": label,
        })
    return stocks


def _vj_parse_number(s):
    if not s:
        return None
    try:
        return float(str(s).strip().replace(",", "").replace("%", ""))
    except Exception:
        return None


def _vj_yoy(curr, prev):
    if curr is None or prev is None or prev == 0:
        return None
    return round((curr - prev) / abs(prev) * 100, 1)


def _vj_parse_quarter_label(label):
    m = re.match(r"([A-Za-z]{3})[a-z]*\s*(\d{4})", (label or "").strip())
    if not m:
        return None
    mon = m.group(1).lower()
    if mon not in MONTHS:
        return None
    return (int(m.group(2)), MONTHS[mon])


def _vj_find_year_ago_index(q_labels, latest_idx):
    latest = _vj_parse_quarter_label(q_labels[latest_idx])
    if not latest:
        return None
    target = (latest[0] - 1, latest[1])
    for i, lbl in enumerate(q_labels):
        if _vj_parse_quarter_label(lbl) == target:
            return i
    return None


def _vj_fetch_fundamentals(ticker):
    """Anonymous — no session cookie needed (verified live 2026-08-30,
    same finding as _screener_fetch.py's fetch_one() docstring already
    documented for the main ledger's own fetches)."""
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
               "Referer": "https://www.screener.in/"}
    for url in [f"https://www.screener.in/company/{ticker}/consolidated/",
                f"https://www.screener.in/company/{ticker}/"]:
        r = None
        for attempt in range(3):
            try:
                r = requests.get(url, headers=headers, timeout=15)
            except Exception:
                time.sleep(2)
                continue
            if r.status_code == 429:
                time.sleep(8 * (attempt + 1))
                continue
            break
        if r is None or r.status_code != 200:
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        qr = next((s for s in soup.find_all("section")
                   if s.find("h2") and ("Quarterly" in s.find("h2").text or "Half" in s.find("h2").text)), None)
        if not qr:
            continue
        table = qr.find("table")
        if not table:
            continue
        quarters = [th.get_text(strip=True) for th in table.find("thead").find_all("th")]
        rows = {}
        for tr in table.find("tbody").find_all("tr"):
            cells = tr.find_all("td")
            if len(cells) < 2:
                continue
            rows[cells[0].get_text(strip=True)] = [_vj_parse_number(td.get_text(strip=True)) for td in cells[1:]]
        sales_row = next((v for k, v in rows.items() if any(x in k.lower() for x in ["sales", "revenue"])), None)
        if not sales_row or len(sales_row) < 5:
            continue
        q_labels = quarters[1:]
        n = len(sales_row)
        ci = n - 1
        pi = _vj_find_year_ago_index(q_labels, ci)
        if pi is None:
            continue
        op_row = next((v for k, v in rows.items() if "operating profit" in k.lower()), None)
        eps_row = next((v for k, v in rows.items() if "eps" in k.lower()), None)
        s_curr, s_prev = sales_row[ci], sales_row[pi]
        op_curr = op_row[ci] if op_row and ci < len(op_row) else None
        op_prev = op_row[pi] if op_row and pi < len(op_row) else None
        e_curr = eps_row[ci] if eps_row and ci < len(eps_row) else None
        e_prev = eps_row[pi] if eps_row and pi < len(eps_row) else None
        sales_g = _vj_yoy(s_curr, s_prev)
        ebit_g = _vj_yoy(op_curr, op_prev)
        eps_g = None
        if e_curr is not None and e_prev is not None:
            if e_prev < 0 and e_curr > 0:
                eps_g = "T"
            elif e_prev > 0 and e_curr > 0:
                eps_g = _vj_yoy(e_curr, e_prev)
        dol = round(ebit_g / sales_g, 2) if (ebit_g and sales_g and sales_g != 0) else None
        dfl = round(eps_g / ebit_g, 2) if (isinstance(eps_g, float) and ebit_g and ebit_g != 0) else None
        dcl = round(dol * dfl, 2) if (dol and dfl) else None
        return {"sales_g": sales_g, "ebit_g": ebit_g, "eps_g": eps_g,
                "op_curr": op_curr, "op_prev": op_prev, "dol": dol, "dfl": dfl, "dcl": dcl}
    return None


def _vj_chartink_scan(clause):
    """Anonymous — no chartink_session cookie needed for an ad-hoc
    scan_clause POST (verified live 2026-08-30; the cookie gates
    saved/premium screens, not this)."""
    s = requests.Session()
    h = {"User-Agent": "Mozilla/5.0"}
    r = s.get("https://chartink.com/screener/", headers=h, timeout=15)
    csrf_m = re.search(r'meta name="csrf-token" content="([^"]+)"', r.text)
    if not csrf_m:
        return None
    resp = s.post("https://chartink.com/screener/process",
                   headers={**h, "X-CSRF-TOKEN": csrf_m.group(1), "X-Requested-With": "XMLHttpRequest",
                            "Content-Type": "application/x-www-form-urlencoded"},
                   data={"scan_clause": clause}, timeout=20)
    return {x["nsecode"] for x in resp.json().get("data", [])}


def _vj_run_chart_checks(tickers):
    rsi = _vj_chartink_scan("( {cash} ( weekly rsi( 14 ) > 66 ) )")
    ema200 = _vj_chartink_scan("( {cash} ( latest close > latest ema( close,200 ) ) )")
    contraction = _vj_chartink_scan("""( {cash} (
        abs( latest ema(close,10) - latest ema(close,20) ) < abs( 3 days ago ema(close,10) - 3 days ago ema(close,20) )
        and abs( latest ema(close,10) - latest ema(close,20) ) < abs( 1 days ago ema(close,10) - 1 days ago ema(close,20) )
    ) )""")
    rsi, ema200, contraction = rsi or set(), ema200 or set(), contraction or set()
    return {t: {"rsi": t in rsi, "ema200": t in ema200, "contraction": t in contraction} for t in tickers}


def _vj_validate(fund, chart):
    if not fund:
        return {"score": 0, "max_score": 6, "rules": {}, "verdict": "NO DATA"}
    c = chart or {}
    f1 = bool(fund.get("dol") and fund["dol"] > 1.5)
    f2 = (isinstance(fund.get("dfl"), float) and fund["dfl"] < 1.2) if fund.get("dfl") is not None else None
    f3 = bool(fund.get("op_curr") and fund.get("op_prev") and fund["op_curr"] > fund["op_prev"])
    c1, c2, c3 = c.get("rsi", False), c.get("ema200", False), c.get("contraction", False)
    rules = {"F1": f1, "F2": f2, "F3": f3, "C1": c1, "C2": c2, "C3": c3}
    score = sum(1 for v in rules.values() if v is True)
    max_score = sum(1 for v in rules.values() if v is not None)
    sales_ok = fund.get("sales_g") and fund["sales_g"] > 0
    hard_fails = sum([not f1, f2 is False, not f3])
    if not sales_ok:
        verdict = "SKIP — sales declining"
    elif hard_fails >= 2:
        verdict = "SKIP"
    elif score == max_score and max_score >= 5:
        verdict = "⭐ ENTRY READY"
    elif not c3 and score >= max_score - 1:
        verdict = "WATCHLIST — await EMA contraction"
    elif score >= max_score - 1:
        verdict = "WATCHLIST"
    else:
        verdict = "SKIP"
    return {"score": score, "max_score": max_score, "rules": rules, "verdict": verdict}


def _vj_fmt_pct(v):
    if v is None:
        return "—"
    if isinstance(v, str):
        return v
    return f"{v:+.0f}%"


def _vj_fmt_num(v):
    return "—" if v is None else f"{v:.2f}"


def _vj_tick(v):
    return "✅" if v is True else ("❌" if v is False else "—")


def _vj_build_rows(stocks, fund_data, chart_data, category):
    rows = []
    for s in stocks:
        t = s["symbol"]
        fund = fund_data.get(t)
        val = _vj_validate(fund, chart_data.get(t, {}))
        r = val["rules"]
        rows.append({
            "category": category, "symbol": t, "name": s["name"], "marketcap": s.get("marketcap", "—"),
            "price": s.get("price", "—"),
            "sales_g": _vj_fmt_pct(fund["sales_g"] if fund else None),
            "ebit_g": _vj_fmt_pct(fund["ebit_g"] if fund else None),
            "eps_g": _vj_fmt_pct(fund["eps_g"] if fund else None),
            "dol": _vj_fmt_num(fund["dol"] if fund else None),
            "dfl": _vj_fmt_num(fund["dfl"] if fund else None),
            "dcl": _vj_fmt_num(fund["dcl"] if fund else None),
            "F1": _vj_tick(r.get("F1")), "F2": _vj_tick(r.get("F2")), "F3": _vj_tick(r.get("F3")),
            "C1": _vj_tick(r.get("C1")), "C2": _vj_tick(r.get("C2")), "C3": _vj_tick(r.get("C3")),
            "score": f"{val['score']}/{val['max_score']}", "verdict": val["verdict"],
        })
    return rows


def _vj_verdict_rank(r):
    v = r["verdict"]
    if "ENTRY READY" in v:
        return 0
    if "WATCHLIST" in v:
        return 1
    return 2


def _vj_build_combined(eq_rows, t2t_rows, sharpe_rows):
    seen_sym = {}
    for r in eq_rows + t2t_rows + sharpe_rows:
        sym = r["symbol"]
        if sym not in seen_sym:
            seen_sym[sym] = dict(r)
        else:
            seen_sym[sym]["category"] += f", {r['category']}"
    return sorted(seen_sym.values(), key=_vj_verdict_rank)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        if not isinstance(body.get("rows"), list) or not isinstance(body.get("as_of"), str):
            send_json(self, 400, {"error": "as_of (string) and rows (list) are required"})
            return
        conn = get_conn()
        try:
            set_meta(conn, "viraj_screen", {"as_of": body["as_of"], "rows": body["rows"]})
            send_json(self, 200, {"ok": True, "count": len(body["rows"])})
        finally:
            conn.close()

    def do_GET(self):
        if not is_authed_cron_or_cookie(self):
            send_json(self, 401, {"error": "unauthorized"})
            return

        limit = None
        query = parse_qs(urlparse(self.path).query)
        if query.get("limit"):
            try:
                limit = int(query["limit"][0])
            except ValueError:
                limit = None

        start = time.monotonic()
        try:
            eq_stocks = _vj_fetch_momo_screen(VIRAJ_SCREEN_ID, "EQ")
            t2t_stocks = _vj_fetch_momo_screen(T2T_SCREEN_ID, "T2T")
            sharpe_stocks = _vj_fetch_momo_screen(SHARPE_SCREEN_ID, "Sharpe")
        except Exception as e:
            send_json(self, 502, {"error": f"momoindiascreener.in fetch failed: {e}"})
            return

        all_stocks = eq_stocks + t2t_stocks + sharpe_stocks
        seen, unique_stocks = set(), []
        for s in all_stocks:
            if s["symbol"] not in seen:
                seen.add(s["symbol"])
                unique_stocks.append(s)
        if limit:
            unique_stocks = unique_stocks[:limit]
        allowed = {s["symbol"] for s in unique_stocks}
        eq_stocks = [s for s in eq_stocks if s["symbol"] in allowed]
        t2t_stocks = [s for s in t2t_stocks if s["symbol"] in allowed]
        sharpe_stocks = [s for s in sharpe_stocks if s["symbol"] in allowed]

        fund_data, skipped_time_budget = {}, []
        for i, s in enumerate(unique_stocks):
            if time.monotonic() - start > TIME_BUDGET_SECONDS:
                skipped_time_budget = [x["symbol"] for x in unique_stocks[i:]]
                break
            fund_data[s["symbol"]] = _vj_fetch_fundamentals(s["symbol"])
            if i < len(unique_stocks) - 1:
                time.sleep(FUND_DELAY_SECONDS)

        try:
            chart_data = _vj_run_chart_checks([s["symbol"] for s in unique_stocks])
        except Exception as e:
            send_json(self, 502, {"error": f"Chartink scan failed: {e}"})
            return

        eq_rows = _vj_build_rows(eq_stocks, fund_data, chart_data, "EQ")
        t2t_rows = _vj_build_rows(t2t_stocks, fund_data, chart_data, "T2T")
        sharpe_rows = _vj_build_rows(sharpe_stocks, fund_data, chart_data, "Sharpe")
        combined = _vj_build_combined(eq_rows, t2t_rows, sharpe_rows)

        conn = get_conn()
        try:
            set_meta(conn, "viraj_screen", {"as_of": date.today().isoformat(), "rows": combined})
        finally:
            conn.close()

        send_json(self, 200, {
            "ok": True,
            "universe": len(unique_stocks),
            "fetched": len(fund_data),
            "skipped_time_budget": len(skipped_time_budget),
            "pushed": len(combined),
            "elapsed_s": round(time.monotonic() - start, 1),
        })
