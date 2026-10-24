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

POST body: {"action": "add"|"remove", "tickers": ["SYM1", "SYM2", ...]}
        or {"action": "group", "tickers": ["SYM1"], "group": "Priority" | null}
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http.server import BaseHTTPRequestHandler

from _db import get_conn, get_meta, set_meta
from _http import read_json_body, require_auth, send_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not require_auth(self):
            return
        conn = get_conn()
        try:
            send_json(self, 200, get_meta(conn, "watchlist", {"tickers": []}))
        finally:
            conn.close()

    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        action = body.get("action")
        tickers = body.get("tickers")
        if action not in ("add", "remove", "group") or not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
            send_json(self, 400, {"error": "action must be add, remove or group, tickers must be a list of strings"})
            return
        group = body.get("group")
        if action == "group" and group is not None and (not isinstance(group, str) or not group.strip() or len(group) > 40):
            send_json(self, 400, {"error": "group must be a short non-empty string, or null to clear"})
            return
        conn = get_conn()
        try:
            data = get_meta(conn, "watchlist", {"tickers": []})
            current = data.get("tickers", [])
            groups = data.get("groups") or {}
            if action == "add":
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
