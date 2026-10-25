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
= {"checklist": [{"id","text"}], "entries": [{"id","symbol","date","qty","price",...}]}, served only on
GET /api/watchlist?journal=1 so the watchlist payload every page loads stays small, and replaced wholesale by
POST {"action": "journal", "tickers": [], "journal": {...}} (single user, last write wins).

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


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not require_auth(self):
            return
        conn = get_conn()
        try:
            if parse_qs(urlparse(self.path).query).get("journal"):
                send_json(self, 200, get_meta(conn, "journal", {"checklist": None, "entries": []}))
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
        if action not in ("add", "remove", "group", "themes", "journal") or not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
            send_json(self, 400, {"error": "action must be add, remove, group, themes or journal, tickers must be a list of strings"})
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
        if action == "journal":
            doc = body.get("journal")
            ok = isinstance(doc, dict) and isinstance(doc.get("entries"), list) and len(doc["entries"]) <= 3000 and (doc.get("checklist") is None or (isinstance(doc["checklist"], list) and len(doc["checklist"]) <= 100))
            ok = ok and len(json.dumps(doc)) <= 3_000_000
            if not ok:
                send_json(self, 400, {"error": "journal must be {checklist: [...], entries: [...]} within size limits"})
                return
            conn = get_conn()
            try:
                set_meta(conn, "journal", {"checklist": doc.get("checklist"), "entries": doc["entries"]})
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
