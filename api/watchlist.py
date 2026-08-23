"""GET/POST /api/watchlist — a plain persisted ticker list, not its own
priced dataset. Symbols added here get their columns (price/RSI D-W-M/
3W green/etc.) from bundle.momentum_screeners.nseScreener on the
frontend — no separate fetch pipeline, since nseScreener already
covers the whole NSE 750 universe.

Meta shape: {"tickers": ["CUPID", "SKYGOLD", ...]}, deduped, order
preserved (most-recently-added last).

POST body: {"action": "add"|"remove", "tickers": ["SYM1", "SYM2", ...]}
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
        if action not in ("add", "remove") or not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
            send_json(self, 400, {"error": "action must be add or remove, tickers must be a list of strings"})
            return
        conn = get_conn()
        try:
            data = get_meta(conn, "watchlist", {"tickers": []})
            current = data.get("tickers", [])
            if action == "add":
                for t in tickers:
                    if t not in current:
                        current.append(t)
            else:
                current = [t for t in current if t not in tickers]
            data["tickers"] = current
            set_meta(conn, "watchlist", data)
            send_json(self, 200, data)
        finally:
            conn.close()
