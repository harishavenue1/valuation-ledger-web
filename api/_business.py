"""Business Radar — the qualitative side of the app: what is each company DOING
(orders won, capacity added, acquisitions, approvals, launches, guidance) as
opposed to what its chart is doing.

Source: Google News RSS, one query per company, anonymous (no key, no stored
credential). Each headline is tagged by keyword, ₹ amounts are pulled out of it
("order worth ₹820 crore" -> 820), and everything accumulates in one Postgres
meta row (`business_radar`) for ~120 days, so the page gets richer every day the
cron runs. BSE's own announcements API would be the primary source, but it
answers 403 (Akamai) from the machines this was tried on.

Honest limits: headlines, not filings; keyword tagging, not understanding. The
page links every item so the reader judges the substance, and it shows order
value against market cap so size is visible at a glance."""
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import requests

from _db import get_conn, get_meta, set_meta

RADAR_KEY = "business_radar"
KEEP_DAYS = 120
MIN_MCAP_CR = 1000  # universe: every stock above this (plus holdings/watchlist whatever their size)
QUERY_TERMS = (
    "order OR contract OR capex OR expansion OR acquisition OR approval OR launch OR guidance OR capacity "
    'OR partnership OR "joint venture" OR demerger OR outlook OR "order book" OR plant'
)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"

# tag -> regex over the lower-cased headline. A headline can carry several tags.
TAGS = {
    "Order": r"(order|contract)s?\b.{0,60}(worth|₹|rs\.?|crore|\bcr\b|bag|win|secur|receiv|award|book)|(bags?|bagged|wins?|secures?|receives?|awarded|lands?)\b.{0,40}(order|contract)|letter of award|work order|\bloa\b|\bl1\b",
    "Capex": r"capex|capital expenditure|capacity (expansion|addition|increase)|expand(s|ing)? (its )?(capacity|manufacturing|production)|new (plant|facility|factory|unit)|greenfield|brownfield|commission(s|ed|ing)\b|commercial production|to invest|investment of|set(s|ting)? up",
    "M&A / JV": r"acqui(re|res|red|sition)|takeover|merger|amalgamat|joint venture|\bjv\b|buys? (a )?stake|stake (buy|sale|acquisition)|demerger|spin.?off|subsidiary",
    "Approval / Launch": r"usfda|\bfda\b|\bcdsco\b|\bdcgi\b|(receives?|gets?|secures?|bags?) (regulatory |final |tentative )?(approval|clearance|nod)|patent|certification|launch(es|ed)?\b|unveil|new product|product launch|clinical trial|commercial production",
    "Partnership": r"partner(s|ship)?\b|tie.?up|\bmou\b|collaborat|supply agreement|alliance|distribution agreement|licen[cs]e agreement",
    "Funding": r"\bqip\b|preferential|warrants?\b|fund ?raise|raises? (rs|₹)|rights issue|\bipo\b",
    "Outlook": r"order ?book|order backlog|guidance|expects?\b|aims? to|\btargets?\b|to double|plans? to|revenue target|medium.term|visibility|growth (plan|target|roadmap)|outperform|record (revenue|profit|order)",
    "Concall / Presentation": r"earnings call|concall|conference call|investor (presentation|day|meet)|analyst (meet|day)|management commentary|transcript",
    "Risk": r"downgrade|probe\b|raid|penalty|fraud|default|resign|plunge|slump|tax demand|show.?cause|sebi (order|notice)|insolvency|fire\b|ban\b",
}
TAG_RE = {k: re.compile(v) for k, v in TAGS.items()}
# a headline needs at least one growth/risk tag to be kept at all
STOP = {"limited", "ltd", "ltd.", "the", "and", "of", "co", "company", "corporation", "corp", "&", "plc", "pvt", "private"}

_AMT_RE = re.compile(r"(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)\s?(lakh crore|crore|crores|cr\b|lakh|bn\b|billion|mn\b|million)", re.IGNORECASE)
_UNIT_CR = {"lakh crore": 1e5, "crore": 1.0, "crores": 1.0, "cr": 1.0, "lakh": 0.01, "bn": 100.0, "billion": 100.0, "mn": 0.1, "million": 0.1}


_USD_RE = re.compile(r"(?:us ?\$|\$|usd)\s?([\d,]+(?:\.\d+)?)\s?(bn\b|billion|mn\b|million)", re.IGNORECASE)
USD_INR = 88.0  # rough: only used to put dollar headlines on the same crore scale


_NOT_A_DEAL_SIZE = re.compile(r"order ?book|backlog|pipeline|market ?cap|m-?cap|valuation|turnover|revenue|\bsales\b|net worth|\bdebt\b|borrowing|\bprofit|\bpat\b|ebitda|\bcash\b|\bgdv\b")


def amount_cr(title):
    """Largest ₹ amount in the headline, in crore (None if there is none). Dollar amounts are converted at a
    flat USD_INR, so they are indicative."""
    best = None
    for rx, scale in ((_USD_RE, None), (_AMT_RE, True)):
        for m in rx.finditer(title):
            around = title[max(0, m.start() - 35): m.end() + 25].lower()
            if _NOT_A_DEAL_SIZE.search(around):
                continue  # an order BOOK, market cap, revenue... is a size, not a new deal
            num, unit = m.group(1), m.group(2).lower()
            try:
                v = float(num.replace(",", "")) * (_UNIT_CR[unit] if scale else (1e9 if unit in ("bn", "billion") else 1e6) * USD_INR / 1e7)
            except (ValueError, KeyError):
                continue
            best = v if best is None else max(best, v)
    return round(best, 1) if best is not None else None


def core_name(name):
    return re.sub(r"\b(limited|ltd\.?)\s*$", "", (name or "").strip(), flags=re.IGNORECASE).strip(" .,&")


def _tokens(name):
    return [t for t in re.findall(r"[a-z0-9]+", core_name(name).lower()) if t not in STOP and len(t) > 1]


def relevant(title, name):
    """The headline has to actually mention the company (first name token, and the second one when the
    first is short) — Google's search matches loosely and returns lookalikes."""
    toks = _tokens(name)
    if not toks:
        return False
    t = title.lower()
    if toks[0] not in t:
        return False
    return len(toks) < 2 or len(toks[0]) > 4 or toks[1] in t


_NOT_AN_ORDER = re.compile(r"assessment|income.?tax|\bi-t\b|\btax\b|\bgst\b|nclt|high court|supreme court|sebi|penalty|draft order|show.?cause|demand notice|interim order")
_CALENDAR_NOISE = re.compile(r"\bdate\b|date,|results? (preview|date)|analyst outlook|record date|ex-date|price targets?|target (of|price)|upside|initiates coverage|gets .?(buy|sell|hold)|buy, sell or hold|stocks to (buy|watch)|\baccumulate\b|for target|target rs|recommends?\b|brokerage|top picks?|\bbuy\b.{0,25}target")


def classify(title):
    t = title.lower()
    if _CALENDAR_NOISE.search(t):
        return []
    tags = [k for k, rx in TAG_RE.items() if rx.search(t)]
    if "Order" in tags and _NOT_AN_ORDER.search(t):
        tags.remove("Order")
    return tags


def fetch_company(name, session, days=7):
    q = f'"{core_name(name)}" ({QUERY_TERMS}) when:{days}d'
    r = session.get(
        "https://news.google.com/rss/search",
        params={"q": q, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"},
        headers={"User-Agent": UA},
        timeout=20,
    )
    if r.status_code == 429:
        raise RuntimeError("rate-limited")
    r.raise_for_status()
    out = []
    for it in ET.fromstring(r.content).iter("item"):
        title = (it.findtext("title") or "").strip()
        src = (it.findtext("source") or "").strip()
        if src and title.endswith(" - " + src):
            title = title[: -(len(src) + 3)]
        try:
            d = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).date().isoformat()
        except Exception:
            continue
        if not relevant(title, name):
            continue
        tags = classify(title)
        if not tags:
            continue
        out.append({"d": d, "t": title, "s": src, "u": it.findtext("link") or "", "g": tags, "a": amount_cr(title)})
    return out


def _title_key(t):
    return re.sub(r"[^a-z0-9]+", "", t.lower())[:70]


def build_universe(name_map):
    """[(symbol, name, priority)] — priority 0 for holdings/watchlist, 1 for the rest, ordered by market cap."""
    conn = get_conn()
    try:
        tech = get_meta(conn, "bhav_technicals", None) or {}
        shared = get_meta(conn, "momentum_screeners", {}) or {}
        wl = get_meta(conn, "watchlist", {"tickers": []}) or {}
    finally:
        conn.close()
    prio = set(wl.get("tickers") or [])
    for r in ((shared.get("portfolioAllocation") or {}).get("rows") or []):
        if r.get("symbol") and not r.get("is_fund"):
            prio.add(r["symbol"])
    uni = {}
    for r in tech.get("rows") or []:
        sym, mc = r.get("symbol"), r.get("market_cap_cr") or 0
        if sym and r.get("name") and (mc >= MIN_MCAP_CR or sym in prio):
            uni[sym] = (r["name"], mc)
    for sym, nm in (name_map or {}).items():
        uni.setdefault(sym, (nm, 0))
    rows = [(s, n, 0 if s in prio else 1, mc) for s, (n, mc) in uni.items()]
    rows.sort(key=lambda x: (x[2], -x[3]))
    return [(s, n, p) for s, n, p, _ in rows]


def sector_lookup(sector_map):
    """{symbol: sector}: the NSE-750 sector map plus the index-directory lists (Midcap 150 / Smallcap 250 / Microcap 250)."""
    out = dict(sector_map or {})
    conn = get_conn()
    try:
        scan = get_meta(conn, "bhav_scan_indexdir", None) or {}
    finally:
        conn.close()
    for r in scan.get("rows") or []:
        if r.get("symbol") and r.get("sector") and r["symbol"] not in out:
            out[r["symbol"]] = r["sector"]
    return out


def fetch_sector(symbol, session):
    """Screener.in's own sector (first level of the company page's peer breadcrumb), the same naming the
    NSE index lists use ("Telecommunication", "Capital Goods"...). '' when there is no page."""
    from bs4 import BeautifulSoup

    for path in (f"/company/{quote_plus(symbol)}/consolidated/", f"/company/{quote_plus(symbol)}/"):
        r = session.get("https://www.screener.in" + path, headers={"User-Agent": UA, "Referer": "https://www.screener.in/"}, timeout=25)
        if r.status_code == 200 and "company-profile" in r.text:
            a = BeautifulSoup(r.text, "html.parser").select("#peers p.sub a")
            return a[0].get_text(" ", strip=True) if a else ""
    return ""


def run_radar(name_map, sector_map=None, budget_s=235, workers=8, recheck_hours=20):
    t0 = time.monotonic()
    conn = get_conn()
    try:
        state = get_meta(conn, RADAR_KEY, None) or {}
    finally:
        conn.close()
    items = state.get("items") or {}
    checked = state.get("checked") or {}
    universe = build_universe(name_map)
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=recheck_hours)).isoformat()
    # never-checked first, then the stalest; holdings/watchlist always lead their group
    todo = [u for u in universe if checked.get(u[0], "") < cutoff]
    todo.sort(key=lambda u: (u[2], checked.get(u[0], "")))
    session = requests.Session()
    stats = {"universe": len(universe), "queued": len(todo), "fetched": 0, "failed": 0, "new_items": 0, "rate_limited": False}

    def one(u):
        if time.monotonic() - t0 > budget_s:
            return u, "skipped", None
        sym, name, _ = u
        try:
            return u, "ok", fetch_company(name, session)
        except RuntimeError:
            return u, "rate", None
        except Exception:
            return u, "fail", None

    drop_before = (now - timedelta(days=KEEP_DAYS)).date().isoformat()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for (sym, name, _), status, found in pool.map(one, todo):
            if status == "ok":
                stats["fetched"] += 1
                checked[sym] = now.isoformat()
                have = {_title_key(x["t"]) for x in items.get(sym, [])}
                for it in found:
                    k = _title_key(it["t"])
                    if k not in have:
                        have.add(k)
                        items.setdefault(sym, []).append(it)
                        stats["new_items"] += 1
            elif status == "rate":
                stats["rate_limited"] = True
            elif status == "fail":
                stats["failed"] += 1
    # sectors for stocks outside the NSE index lists: a few hundred per run from Screener.in, remembered
    sector_cache = state.get("sector_cache") or {}
    known = sector_lookup(sector_map)
    missing = [u[0] for u in universe if u[0] not in known and u[0] not in sector_cache]
    stats["sector_missing"] = len(missing)
    if missing and time.monotonic() - t0 < budget_s - 20:
        def sec_one(sym):
            if time.monotonic() - t0 > budget_s:
                return sym, None
            try:
                return sym, fetch_sector(sym, session)
            except Exception:
                return sym, None

        with ThreadPoolExecutor(max_workers=5) as pool:
            for sym, sec in pool.map(sec_one, missing[:300]):
                if sec is not None:
                    sector_cache[sym] = sec
        stats["sector_missing"] = len([m for m in missing if m not in sector_cache])
    # a headline that matches several companies' names ("Kalpataru Projects" vs "Kalpataru") belongs to the one whose
    # name matches it most fully; re-done every run so it also repairs history
    owners = {}
    names = {u[0]: u[1] for u in universe}
    for sym, its in items.items():
        toks = _tokens(names.get(sym) or "")
        for it in its:
            k = _title_key(it["t"])
            score = sum(1 for t in toks if t in it["t"].lower())
            if score > owners.get(k, (-1, None))[0]:
                owners[k] = (score, sym)
    for sym in list(items):
        items[sym] = [x for x in items[sym] if owners.get(_title_key(x["t"]), (0, sym))[1] in (sym, None) or owners[_title_key(x["t"])][0] == sum(1 for t in _tokens(names.get(sym) or "") if t in x["t"].lower())]
    for sym in list(items):
        for it in items[sym]:  # re-derive from the headline so every logic fix applies to history too
            it["g"] = classify(it["t"])
            it["a"] = amount_cr(it["t"])
        items[sym] = [x for x in items[sym] if x["g"]]
        items[sym] = sorted((x for x in items[sym] if x["d"] >= drop_before), key=lambda x: x["d"], reverse=True)[:40]
        if not items[sym]:
            del items[sym]
    payload = {
        "as_of": now.date().isoformat(),
        "updated": now.isoformat(),
        "items": items,
        "checked": checked,
        "names": {s: n for s, n, _ in universe},
        "sectors": {s: v for s, v in {**{k: v for k, v in sector_cache.items() if v}, **known}.items() if s in items or s in checked},
        "sector_cache": sector_cache,
        "stats": stats,
        "keep_days": KEEP_DAYS,
    }
    conn = get_conn()
    try:
        set_meta(conn, RADAR_KEY, payload)
    finally:
        conn.close()
    stats["companies_with_items"] = len(items)
    stats["elapsed_s"] = round(time.monotonic() - t0, 1)
    return stats


# ── company profile (Screener.in page, no login) ─────────────────────────────

PROFILE_TTL_DAYS = 7


def _clean(t):
    return re.sub(r"\s*\[\d+(?:,\s*\d+)*\]", "", t or "").strip()


def fetch_profile(symbol):
    """Business profile from the company's Screener.in page: About + Key Points (segments, capacity,
    strategy as the company describes them), pros/cons, compounded growth, concall/presentation links,
    sector. Cached in meta for PROFILE_TTL_DAYS."""
    from bs4 import BeautifulSoup

    key = "bp:" + symbol
    conn = get_conn()
    try:
        cached = get_meta(conn, key, None)
    finally:
        conn.close()
    if cached and cached.get("fetched"):
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["fetched"])).days
        if age < PROFILE_TTL_DAYS:
            return cached
    headers = {"User-Agent": UA, "Referer": "https://www.screener.in/"}
    html = None
    for path in (f"/company/{quote_plus(symbol)}/consolidated/", f"/company/{quote_plus(symbol)}/"):
        r = requests.get("https://www.screener.in" + path, headers=headers, timeout=25)
        if r.status_code == 200 and "company-profile" in r.text:
            html = r.text
            break
    if html is None:
        return {"symbol": symbol, "error": "no Screener.in page found", "fetched": datetime.now(timezone.utc).isoformat()}
    sp = BeautifulSoup(html, "html.parser")
    about = sp.select_one(".company-profile div.sub.about")
    key_pts = sp.select_one(".company-profile div.sub.commentary")
    prof = sp.select_one(".company-profile")
    if about is None and prof is not None:  # layout drift: fall back to the whole block
        about = prof
    ratios = {}
    for li in sp.select("#top-ratios li"):
        nm = li.select_one(".name")
        val = li.select_one(".value")
        if nm and val:
            ratios[nm.get_text(" ", strip=True)] = val.get_text(" ", strip=True)
    growth = {}
    for tb in sp.select("table.ranges-table"):
        title = tb.select_one("th")
        if not title:
            continue
        rows = {}
        for tr in tb.select("tr")[1:]:
            tds = [td.get_text(" ", strip=True) for td in tr.select("td")]
            if len(tds) == 2:
                rows[tds[0].rstrip(":")] = tds[1]
        growth[title.get_text(" ", strip=True)] = rows
    peers = [a.get_text(" ", strip=True) for a in sp.select("#peers p.sub a")]
    concalls = []
    box = sp.select_one("div.documents.concalls")
    if box:
        for li in box.select("li"):
            dt = li.select_one("div")
            links = {}
            for a in li.select("a"):
                href, label = a.get("href") or "", a.get_text(" ", strip=True)
                if href.startswith("http") and label:
                    links[label] = href
            if links:
                concalls.append({"date": dt.get_text(" ", strip=True) if dt else "", "links": links})
    web = next((a.get("href") for a in sp.select(".company-links a") if "Website" in a.get_text()), None) or next(
        (a.get("href") for a in sp.select("a") if a.get("href", "").startswith("http") and "bseindia" not in a["href"] and "nseindia" not in a["href"] and "screener" not in a["href"] and "Website" in a.get_text()),
        None,
    )
    out = {
        "symbol": symbol,
        "fetched": datetime.now(timezone.utc).isoformat(),
        "name": (sp.select_one("h1") or sp.select_one("title")).get_text(" ", strip=True) if (sp.select_one("h1") or sp.select_one("title")) else symbol,
        "about": _clean(about.get_text("\n", strip=True)).replace("About\n", "", 1) if about is not None else "",
        "key_points": _clean(key_pts.get_text("\n", strip=True)).replace("Key Points\n", "", 1) if key_pts is not None else "",
        "pros": [li.get_text(" ", strip=True) for li in sp.select("div.pros li")],
        "cons": [li.get_text(" ", strip=True) for li in sp.select("div.cons li")],
        "ratios": ratios,
        "growth": growth,
        "classification": peers[:4],
        "concalls": concalls[:8],
        "website": web,
    }
    conn = get_conn()
    try:
        set_meta(conn, key, out)
    finally:
        conn.close()
    return out
