"""POST /api/fetch_company — full fetch (fundamentals + quarterly + EMA)
for one ticker via Screener.in, upserted into the stocks table.
DELETE — remove a company (and its saved scenarios) from the ledger.
PATCH — toggle the "owned" flag without a full re-fetch."""
import os
import sys
from http.server import BaseHTTPRequestHandler

# See login.py's comment on this line — Vercel's Python runtime doesn't
# put this file's own directory on sys.path, so sibling `_xxx` imports
# fail without it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _clean import clean_stock
from _db import delete_json, get_conn, get_json, upsert_json
from _http import read_json_body, require_auth, send_json
from _screener_fetch import fetch_one


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        if not ticker:
            send_json(self, 400, {"error": "ticker is required"})
            return
        data, err = fetch_one(ticker)
        if err:
            send_json(self, 502, {"error": err})
            return
        data = clean_stock(data)
        conn = get_conn()
        try:
            existing = get_json(conn, "stocks", data["ticker"]) or {}
            data["owned"] = existing.get("owned", False)
            upsert_json(conn, "stocks", data["ticker"], data)
            send_json(self, 200, {"stock": data})
        finally:
            conn.close()

    def do_DELETE(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        if not ticker:
            send_json(self, 400, {"error": "ticker is required"})
            return
        conn = get_conn()
        try:
            delete_json(conn, "stocks", ticker)
            delete_json(conn, "scenarios", ticker)
            delete_json(conn, "guidance", ticker)
            send_json(self, 200, {"ok": True})
        finally:
            conn.close()

    def do_PATCH(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        if not ticker:
            send_json(self, 400, {"error": "ticker is required"})
            return
        conn = get_conn()
        try:
            stock = get_json(conn, "stocks", ticker)
            if not stock:
                send_json(self, 404, {"error": "unknown ticker"})
                return
            stock["owned"] = bool(body.get("owned", False))
            upsert_json(conn, "stocks", ticker, stock)
            send_json(self, 200, {"stock": stock})
        finally:
            conn.close()
