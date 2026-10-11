"""Concall guidance — "what management said": forward-looking statements pulled out of the company's
concall TRANSCRIPT PDFs (the BSE-filed documents linked from its Screener.in page), for the Business page's
Guidance tab.

Pipeline per company: Screener profile -> its latest transcripts -> download the PDF -> pypdf text -> keep
sentences that (a) look forward-looking AND carry a figure or fiscal year, (b) sound like management (first
person, not a question) and (c) are not boilerplate. Stored in meta `concall_guidance`; a daily runner works
through holdings/watchlist first, then the biggest companies. Pattern matching, not comprehension: every line
links back to the transcript."""
import io
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

from _db import get_conn, get_meta, set_meta

KEY = "concall_guidance"
EXTRACT_VERSION = 3  # bump when the extraction rules change: stored transcripts are then re-parsed
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129 Safari/537.36"
MAX_PDF_BYTES = 12_000_000
MAX_PAGES = 90
CALLS_PER_COMPANY = 2
LINES_PER_CALL = 10

FWD = re.compile(
    r"\b(guid(e|es|ed|ance)|expect(s|ed|ing)?|expected to|target(s|ed|ing)?|aim(s|ed|ing)?|aspir(e|es|ing)|plan(s|ned|ning)? to|"
    r"to (double|triple|grow|reach|touch|cross|add|invest|set up|commission|scale|achieve|deliver)|will (grow|reach|touch|add|invest|be able|see|deliver|achieve|cross)|"
    r"going to|should (be able to|reach|grow|see|touch|cross)|on track to|looking (at|to)|ambition|visibility|confident (of|about|that)|"
    r"by (the end of )?(fy\s?\d{2}|20\d{2}|march|next year)|next (two|three|2|3|5) years|medium.term|run.?rate|"
    r"going forward|in the coming (quarters|years|months)|(next|coming) (quarter|year|fiscal))\b",
    re.IGNORECASE,
)
QUANT = re.compile(
    r"(\d[\d,.]*\s?(%|per ?cent|x\b|times|crores?|cr\b|lakh|bn\b|billion|mn\b|million|gw|mw|gwh|mwp|tonnes?|mt|units|stores|plants|bps|basis points|kms?|rooms|beds))|"
    r"\bfy\s?-?\d{2}\b|\b20\d{2}\b",
    re.IGNORECASE,
)
FIRST_PERSON = re.compile(r"\b(we|our|us|i|my|management|company)\b", re.IGNORECASE)
BOILERPLATE = re.compile(
    r"forward.looking statements?|safe harbou?r|risks and uncertainties|disclaimer|this (call|presentation) may|"
    r"please (press|dial)|transcript|moderator|good (morning|afternoon|evening)|thank you|next question|operator|"
    r"registered office|bse limited|national stock exchange|scrip code|security code",
    re.IGNORECASE,
)
INLINE_SPEAKER = re.compile(r"^((?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|CA|Shri)?\s*[A-Z][A-Za-z.'\-]+(?: [A-Za-z.'\-]+){0,3})\s*:\s+(\S.*)$")
NOT_A_SPEAKER = re.compile(
    r"^(encl|enclosure|page|sub|subject|ref|reference|tel|fax|email|e-?mail|note|notes|source|date|to|from|cc|regd|cin|corporate identity number|management|participants|"
    r"moderator|operator|disclaimer|attachment|annexure|dear sir|yours faithfully|thanking you|for|dated|place|time|venue|link|website|transcript|audio)$",
    re.IGNORECASE,
)
ANALYST_TALK = re.compile(
    r"\b(sir|madam|ma'am|my (first|second|next|last|final) question|my question|you (mentioned|said|are|have|guided|indicated|spoke)|your (comment|guidance|margin|target|presentation|opening)|"
    r"can you|could you|would you|will you|just (wanted|want) to|i wanted to|i would like to understand|congratulations|thanks? for|thank you for taking)\b",
    re.IGNORECASE,
)


def types_of(t):
    out = []
    if re.search(r"revenue|sales|top.?line|turnover|growth|cagr", t, re.I):
        out.append("Revenue")
    if re.search(r"margin|ebitda|\bopm\b|\bpat\b|profit|\beps\b|earnings", t, re.I):
        out.append("Margin")
    if re.search(r"capex|capacity|plant|expansion|invest|facility|commission|\bgw\b|\bmw\b|tonnes?", t, re.I):
        out.append("Capex")
    if re.search(r"order|inflow|intake|pipeline|backlog", t, re.I):
        out.append("Orders")
    return out or ["Other"]


def _horizon(t):
    """The latest fiscal year the sentence names ("... by financial year 2029, compared with FY26" -> FY29)."""
    ys = [int(m.group(1)[-2:]) for m in re.finditer(r"\bFY\s?-?(\d{2,4})E?\b", t, re.I)]
    ys += [int(m.group(1)[-2:]) for m in re.finditer(r"\b(?:financial|fiscal) year\s+(?:ending\s+)?(?:march\s+)?(?:FY\s?)?(20\d{2}|\d{2})\b", t, re.I)]
    ys += [int(m.group(1)[-2:]) for m in re.finditer(r"\bby\s+(?:the end of\s+)?(?:FY\s?)?(20\d{2})\b", t, re.I)]
    ys = [y for y in ys if 20 <= y <= 45]
    return f"FY{max(ys)}" if ys else None


def pdf_text(content):
    from pypdf import PdfReader

    rd = PdfReader(io.BytesIO(content))
    pages = rd.pages[:MAX_PAGES]
    return "\n".join((p.extract_text() or "") for p in pages), len(rd.pages)


def _blocks(text):
    """[(speaker, text)] — inline 'Name: words' labels; repeated page headers/footers removed."""
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.split("\n")]
    lines = [l for l in lines if l]
    counts = {}
    for l in lines:
        if len(l) < 70:
            counts[l] = counts.get(l, 0) + 1
    lines = [l for l in lines if not re.match(r"^Page \d+ of \d+$", l) and not (len(l) < 70 and counts.get(l, 0) >= 4)]
    blocks, speaker, buf = [], None, []
    for l in lines:
        m = INLINE_SPEAKER.match(l)
        label = m.group(1).strip() if m else ""
        # a real speaker label is a person's name (2+ words); single words are headings like "Symbol:" or "Encl:"
        if m and len(m.group(1)) <= 40 and not re.search(r"\d", label) and len(label.split()) >= 2 and not NOT_A_SPEAKER.match(label):
            if buf:
                blocks.append((speaker, " ".join(buf)))
            speaker, buf = m.group(1).strip(), [m.group(2)]
        else:
            buf.append(l)
    if buf:
        blocks.append((speaker, " ".join(buf)))
    return blocks


def _management_speakers(blocks):
    """Speakers whose talk is answers, not questions: few '?' and little 'your/sir/question' language."""
    st = {}
    for who, body in blocks:
        if not who or re.search(r"moderator|operator", who, re.I):
            continue
        sents = [x for x in re.split(r"(?<=[.!?])\s+", body) if len(x) > 15]
        q = sum(1 for x in sents if "?" in x)
        a = len(ANALYST_TALK.findall(body))
        n = st.setdefault(who, [0, 0, 0, 0])
        n[0] += len(sents)
        n[1] += q
        n[2] += a
        n[3] += len(body)
    return {w for w, (n, q, a, ch) in st.items() if ch > 800 and n and q / n < 0.15 and a / max(1, n) < 0.12}


def extract_lines(text, limit=LINES_PER_CALL):
    """Management guidance sentences from a transcript's text, strongest first."""
    blocks = _blocks(text)
    mgmt = _management_speakers(blocks)
    out, seen = [], set()
    for who, body in blocks:
        if mgmt and who not in mgmt:
            continue  # questions from analysts, moderator, host
        for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9₹])", body):
            s = re.sub(r"\s+", " ", s).strip()
            if not (40 <= len(s) <= 420) or "?" in s or BOILERPLATE.search(s) or ANALYST_TALK.search(s):
                continue
            if re.search(r"[A-Za-z]\d{3,}|\d{3,}[A-Za-z]{3,}", s):  # PDF text glitches such as "like002080%"
                continue
            if not (FWD.search(s) and QUANT.search(s) and FIRST_PERSON.search(s)):
                continue
            key = re.sub(r"[^a-z0-9]", "", s.lower())[:70]
            if key in seen:
                continue
            seen.add(key)
            strength = 1
            if re.search(r"[\d,.]+\s?(%|per ?cent|crores?|cr\b|bn\b|billion|x\b|times|gw|mw)", s, re.I):
                strength += 1
            if _horizon(s):
                strength += 1
            if re.search(r"guid(e|es|ed|ance)|expect|target|aim", s, re.I):
                strength += 1
            out.append({"text": s, "who": who, "types": types_of(s), "horizon": _horizon(s), "strength": strength})
    out.sort(key=lambda x: -x["strength"])
    return out[:limit]


def process_company(symbol, get_profile, prev=None):
    """{'calls': [...], 'checked': iso} — newest transcripts first; a transcript already parsed (same URL) is reused."""
    done = {c["url"]: c for c in ((prev or {}).get("calls") or []) if not c.get("error") and c.get("v") == EXTRACT_VERSION}
    prof = get_profile(symbol)
    calls = []
    for c in (prof.get("concalls") or []):
        url = (c.get("links") or {}).get("Transcript")
        if not url:
            continue
        calls.append((c.get("date") or "", url, (c.get("links") or {}).get("PPT")))
        if len(calls) >= CALLS_PER_COMPANY:
            break
    results = []
    for date, url, ppt in calls:
        if url in done:
            results.append(done[url])
            continue
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Referer": "https://www.bseindia.com/"}, timeout=40)
            if r.status_code != 200 or r.content[:4] != b"%PDF" or len(r.content) > MAX_PDF_BYTES:
                results.append({"date": date, "url": url, "ppt": ppt, "lines": [], "error": f"HTTP {r.status_code}" if r.status_code != 200 else "not a PDF / too large"})
                continue
            text, pages = pdf_text(r.content)
            results.append({"date": date, "url": url, "ppt": ppt, "v": EXTRACT_VERSION, "pages": pages, "chars": len(text), "lines": extract_lines(text)})
        except Exception as e:
            results.append({"date": date, "url": url, "ppt": ppt, "lines": [], "error": str(e)[:120]})
    return {"calls": results, "fin": prof.get("fin"), "checked": datetime.now(timezone.utc).isoformat()}


def run_concall_guidance(name_map, budget_s=230, workers=3, recheck_days=14):
    """Daily runner: holdings/watchlist first, then the biggest companies; each company's latest transcripts are
    parsed once and reused until a newer transcript appears."""
    from _business import build_universe, fetch_profile

    t0 = time.monotonic()
    conn = get_conn()
    try:
        state = get_meta(conn, KEY, None) or {}
    finally:
        conn.close()
    comps = state.get("companies") or {}
    universe = build_universe(name_map)
    cutoff = datetime.now(timezone.utc).timestamp() - recheck_days * 86400

    def stale(sym):
        c = comps.get(sym)
        if not c or datetime.fromisoformat(c["checked"]).timestamp() < cutoff:
            return True
        return any(call.get("v") != EXTRACT_VERSION and not call.get("error") for call in c.get("calls") or [])  # parsed with older rules

    todo = [u for u in universe if stale(u[0])]
    todo.sort(key=lambda u: (u[2], (comps.get(u[0]) or {}).get("checked", "")))
    stats = {"universe": len(universe), "queued": len(todo), "done": 0, "with_lines": 0, "failed": 0}

    def one(u):
        if time.monotonic() - t0 > budget_s:
            return u[0], None
        try:
            return u[0], process_company(u[0], fetch_profile, comps.get(u[0]))
        except Exception as e:
            return u[0], {"calls": [], "checked": datetime.now(timezone.utc).isoformat(), "error": str(e)[:120]}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for sym, res in pool.map(one, todo):
            if res is None:
                continue
            comps[sym] = res
            stats["done"] += 1
            if any(c.get("lines") for c in res.get("calls", [])):
                stats["with_lines"] += 1
            if res.get("error"):
                stats["failed"] += 1
    conn = get_conn()
    try:
        set_meta(conn, KEY, {"companies": comps, "updated": datetime.now(timezone.utc).isoformat()})
    finally:
        conn.close()
    stats["total_companies"] = len(comps)
    stats["elapsed_s"] = round(time.monotonic() - t0, 1)
    return stats


def feed(conn):
    """What the Guidance tab needs: per company, per call, the strongest lines (kept compact)."""
    state = get_meta(conn, KEY, None) or {}
    out, fin = {}, {}
    for sym, c in (state.get("companies") or {}).items():
        if c.get("fin"):
            fin[sym] = c["fin"]
        calls = []
        for call in c.get("calls") or []:
            lines = [{k: l[k] for k in ("text", "who", "types", "horizon", "strength")} for l in (call.get("lines") or []) if l.get("strength", 0) >= 2][:6]
            if lines:
                calls.append({"date": call.get("date"), "url": call.get("url"), "ppt": call.get("ppt"), "lines": lines})
        if calls:
            out[sym] = calls
    return {"companies": out, "fin": fin, "updated": state.get("updated")}
