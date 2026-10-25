"""GET/POST /api/watchlist — a plain persisted ticker list, not its own
priced dataset. Symbols added here get their columns (price/RSI D-W-M/
3W green/etc.) from bundle.momentum_screeners.nseScreener on the
frontend — no separate fetch pipeline, since nseScreener already
covers the whole NSE 750 universe.

Meta shape: {"tickers": ["CUPID", "SKYGOLD", ...], "groups": {"CUPID": "Priority"}},
deduped, order preserved (most-recently-added last). `groups` is an optional
per-ticker manual override of the Watchlist page's automatic signal buckets
(2026-10-24, "organize our watchlist"); a ticker with no entry uses the
automatic bucket.

Also carries `themes` ({"Pipes": ["WELCORP", ...]}) — the Directory page's Themes tab
(2026-10-25). Absent until the first edit, when the page falls back to the starting set in
src/lib/themes.ts; once saved, this stored copy replaces it wholesale.

Also hosts the Trade Journal (2026-10-25, "checklist + buying record for future review"): a separate meta key, `journal`
= {"checklist": [{"id","text"}], "entries": [{"id","symbol","date","qty","price",...}], "sells": [{"id","symbol","date","qty","price",...}]}, served only on
GET /api/watchlist?journal=1 so the watchlist payload every page loads stays small, and replaced wholesale by
POST {"action": "journal", "tickers": [], "journal": {...}} (single user, last write wins).

Kite -> journal sync (2026-10-25, "record entries on pulling the PF update skill ... alert me to comment on the buy/sell
reason"): the PortfolioAllocation skill POSTs {"action": "journal_sync", "tickers": [], "holdings": [{"symbol","qty","avg","ltp"}],
"as_of", "portfolio_value", "trades": {SYM: {"buy_price","sell_price"}}} after every PF update. The server diffs the holdings against
its own last snapshot (`journal_snap` meta; the first call only stores a baseline) and drops a PENDING buy/sell placeholder per
change into a separate `journal_inbox` meta — it never edits the journal document itself, so a page open on another device cannot
overwrite it. The page merges the inbox on load / focus, asks for the reason, and acks the ids ({"action": "journal_ack", "ids": [...]}).
A trade the user already logged by hand since the last snapshot is netted off, so nothing is entered twice.

POST body: {"action": "add"|"remove", "tickers": ["SYM1", "SYM2", ...]}
        or {"action": "group", "tickers": ["SYM1"], "group": "Priority" | null}
        or {"action": "themes", "tickers": [], "themes": {"Pipes": ["WELCORP", ...], ...}}
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from _db import get_conn, get_meta, set_meta
from _http import read_json_body, require_auth, send_json


def _num(v):
    return float(v) if isinstance(v, (int, float)) and v == v else None


def journal_sync(conn, body, hs):
    """Diff Kite holdings against the last snapshot and queue pending buy/sell placeholders (see the module docstring)."""
    from datetime import date as _date

    as_of = body.get("as_of") if isinstance(body.get("as_of"), str) else _date.today().isoformat()
    pv = _num(body.get("portfolio_value")) or 0.0
    trades = body.get("trades") if isinstance(body.get("trades"), dict) else {}
    holdings = {h["symbol"]: {"qty": float(h["qty"]), "avg": _num(h.get("avg")), "ltp": _num(h.get("ltp"))} for h in hs if h["qty"] > 0}
    doc = get_meta(conn, "journal", {"checklist": None, "entries": [], "sells": []})
    inbox = get_meta(conn, "journal_inbox", [])
    snap = get_meta(conn, "journal_snap", None)
    entries, sells = doc.get("entries") or [], doc.get("sells") or []
    ids = {x.get("id") for x in entries} | {x.get("id") for x in sells} | {x.get("id") for x in inbox}

    def save_snap():
        set_meta(conn, "journal_snap", {"as_of": as_of, "holdings": holdings, "accounted": sorted(i for i in ids if i), "pv": pv or None})

    if snap is None or body.get("baseline"):
        save_snap()
        return {"ok": True, "baseline": True, "created": 0, "holdings": len(holdings)}

    accounted = set(snap.get("accounted") or [])
    manual_buy, manual_sell = {}, {}
    for e in entries:
        if e.get("id") not in accounted and e.get("source") != "kite":
            manual_buy[e.get("symbol")] = manual_buy.get(e.get("symbol"), 0) + (e.get("qty") or 0)
    for x in sells:
        if x.get("id") not in accounted and x.get("source") != "kite":
            manual_sell[x.get("symbol")] = manual_sell.get(x.get("symbol"), 0) + (x.get("qty") or 0)

    tech = {}
    try:
        tech = {r.get("symbol"): r for r in ((get_meta(conn, "bhav_technicals", {}) or {}).get("rows") or [])}
    except Exception:
        tech = {}
    prev_h = snap.get("holdings") or {}
    created = []
    for sym in sorted(set(holdings) | set(prev_h)):
        new, prev = holdings.get(sym), prev_h.get(sym) or {}
        nq, pq = (new or {}).get("qty", 0.0), prev.get("qty", 0.0) or 0.0
        d = nq - pq
        if abs(d) < 1e-6:
            continue
        t = trades.get(sym) if isinstance(trades.get(sym), dict) else {}
        if d > 0:
            adj = d - manual_buy.get(sym, 0)
            if adj <= 1e-6:
                continue
            avg_new, avg_prev = (new or {}).get("avg"), prev.get("avg") or 0.0
            cost_delta = (nq * avg_new - pq * avg_prev) if avg_new else None
            price = _num(t.get("buy_price")) or (cost_delta / d if cost_delta and cost_delta > 0 else None) or (new or {}).get("ltp") or 0.0
            tr = tech.get(sym) or {}
            stub = {
                "id": f"k-{as_of}-{sym}-b{int(round(adj))}", "type": "buy", "source": "kite", "pending": True,
                "symbol": sym, "date": as_of, "qty": round(adj, 4), "price": round(price, 2),
                "allocPct": round(adj * price / pv * 100, 2) if pv > 0 and price > 0 else None, "allocReason": "",
                "stop0": None, "stop": None, "stopMode": "ema33w", "target": None, "fundTrigger": "no", "fundNote": "",
                "ema200Pct": _num(tr.get("pct_200d_ema")), "rsiW": _num(tr.get("rsi_w")),
                "setup": "Other", "reason": "", "state": "", "confidence": 3, "checks": [],
            }
            if not _num(t.get("buy_price")) and not cost_delta:
                stub["priceApprox"] = True
        else:
            adj = -d - manual_sell.get(sym, 0)
            if adj <= 1e-6:
                continue
            price = _num(t.get("sell_price")) or (new or {}).get("ltp") or prev.get("ltp") or 0.0
            stub = {
                "id": f"k-{as_of}-{sym}-s{int(round(adj))}", "type": "sell", "source": "kite", "pending": True,
                "symbol": sym, "date": as_of, "qty": round(adj, 4), "price": round(price, 2),
                "reason": "", "state": "", "plan": "", "lesson": "",
            }
            if not _num(t.get("sell_price")):
                stub["priceApprox"] = True
        if stub["id"] in ids:
            stub["id"] += "x"
        ids.add(stub["id"])
        inbox.append(stub)
        created.append({"symbol": sym, "type": stub["type"], "qty": stub["qty"], "price": stub["price"]})
    set_meta(conn, "journal_inbox", inbox)
    save_snap()
    return {"ok": True, "baseline": False, "created": len(created), "trades": created, "inbox": len(inbox)}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not require_auth(self):
            return
        conn = get_conn()
        try:
            if parse_qs(urlparse(self.path).query).get("journal"):
                doc = get_meta(conn, "journal", {"checklist": None, "entries": [], "sells": []})
                doc["inbox"] = get_meta(conn, "journal_inbox", [])
                # portfolio value + each holding's weight as of the last PF update, so the page can work out allocation % itself
                snap = get_meta(conn, "journal_snap", None) or {}
                pvv = snap.get("pv")
                if pvv:
                    doc["portfolio"] = {
                        "value": pvv, "as_of": snap.get("as_of"),
                        "weights": {k: round(h["qty"] * (h.get("ltp") or 0) / pvv * 100, 2) for k, h in (snap.get("holdings") or {}).items() if h.get("ltp")},
                    }
                send_json(self, 200, doc)
                return
            send_json(self, 200, get_meta(conn, "watchlist", {"tickers": []}))
        finally:
            conn.close()

    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        action = body.get("action")
        tickers = body.get("tickers")
        if action not in ("add", "remove", "group", "themes", "journal", "journal_sync", "journal_ack") or not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
            send_json(self, 400, {"error": "action must be add, remove, group, themes, journal, journal_sync or journal_ack, tickers must be a list of strings"})
            return
        group = body.get("group")
        if action == "group" and group is not None and (not isinstance(group, str) or not group.strip() or len(group) > 40):
            send_json(self, 400, {"error": "group must be a short non-empty string, or null to clear"})
            return
        themes = body.get("themes")
        if action == "themes":
            ok = isinstance(themes, dict) and len(themes) <= 60
            if ok:
                for name, syms in themes.items():
                    if not (isinstance(name, str) and name.strip() and len(name) <= 40 and isinstance(syms, list) and len(syms) <= 300 and all(isinstance(x, str) and 0 < len(x) <= 30 for x in syms)):
                        ok = False
                        break
            if not ok:
                send_json(self, 400, {"error": "themes must be {name: [symbols]} with short names and at most 300 symbols per theme"})
                return
        if action == "journal_ack":
            ids = body.get("ids")
            if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
                send_json(self, 400, {"error": "ids must be a list of strings"})
                return
            conn = get_conn()
            try:
                gone = set(ids)
                inbox = [x for x in get_meta(conn, "journal_inbox", []) if x.get("id") not in gone]
                set_meta(conn, "journal_inbox", inbox)
                send_json(self, 200, {"ok": True, "inbox": len(inbox)})
            finally:
                conn.close()
            return
        if action == "journal_sync":
            hs = body.get("holdings")
            if not isinstance(hs, list) or len(hs) > 600 or not all(isinstance(h, dict) and isinstance(h.get("symbol"), str) and isinstance(h.get("qty"), (int, float)) for h in hs):
                send_json(self, 400, {"error": "holdings must be a list of {symbol, qty, avg, ltp}"})
                return
            conn = get_conn()
            try:
                send_json(self, 200, journal_sync(conn, body, hs))
            finally:
                conn.close()
            return
        if action == "journal":
            doc = body.get("journal")
            ok = isinstance(doc, dict) and isinstance(doc.get("entries"), list) and len(doc["entries"]) <= 3000 and (doc.get("checklist") is None or (isinstance(doc["checklist"], list) and len(doc["checklist"]) <= 100))
            ok = ok and (doc.get("sells") is None or (isinstance(doc["sells"], list) and len(doc["sells"]) <= 6000))
            ok = ok and len(json.dumps(doc)) <= 3_000_000
            if not ok:
                send_json(self, 400, {"error": "journal must be {checklist: [...], entries: [...]} within size limits"})
                return
            conn = get_conn()
            try:
                set_meta(conn, "journal", {"checklist": doc.get("checklist"), "entries": doc["entries"], "sells": doc.get("sells") or []})
                send_json(self, 200, {"ok": True, "entries": len(doc["entries"])})
            finally:
                conn.close()
            return
        conn = get_conn()
        try:
            data = get_meta(conn, "watchlist", {"tickers": []})
            current = data.get("tickers", [])
            groups = data.get("groups") or {}
            if action == "themes":
                data["themes"] = {k.strip(): list(dict.fromkeys(v)) for k, v in themes.items()}
            elif action == "add":
                for t in tickers:
                    if t not in current:
                        current.append(t)
            elif action == "remove":
                current = [t for t in current if t not in tickers]
                for t in tickers:
                    groups.pop(t, None)
            else:
                for t in tickers:
                    if t not in current:
                        continue
                    if group is None:
                        groups.pop(t, None)
                    else:
                        groups[t] = group.strip()
            data["tickers"] = current
            data["groups"] = groups
            set_meta(conn, "watchlist", data)
            send_json(self, 200, data)
        finally:
            conn.close()
