"""GET /api/stocks — the single bootstrap payload the frontend loads on
first render: every stock, every saved scenario, every guidance record,
plus last_refresh/guidance_tracker meta. One round trip, then every
interaction after that is computed client-side (src/lib/model.ts) —
this is the actual "fast" fix versus the old app's full-page Streamlit
rerun on every click.

`momentum_screeners` is deliberately NOT included in this default
response (added 2026-09-20, "check for more optimizations" audit) —
it's a single ~2.1MB JSONB blob in the `meta` table (see _db.py) and
was previously pulled in full on every page load regardless of which
page (if any) actually used it; measured at the time, it was 88% of
the ~2.4MB bundle. Every screener page now calls `?screeners=a,b,c`
instead (see App.tsx's `useScreeners` hook), which uses Postgres's `->`
JSON path operator to pull only the requested sub-keys out of that
blob server-side — so neither the DB round trip nor the browser
payload carries screener data the current page doesn't need. Pages
that don't touch momentum_screeners at all (Summary, Companies,
Guidance Tracker, Watchlist's own base list, Guide, Settings) now pay
nothing for it."""
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# See login.py's comment on this line — Vercel's Python runtime doesn't
# put this file's own directory on sys.path, so sibling `_xxx` imports
# fail without it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gzip
import json
import time

from _db import DB_VERSION, get_all_json, get_conn, get_meta
from _http import require_auth, send_json

# 2026-11-22 (optimization): the stock list went out in full on every page load (~950 KB read from the database each time; the host showed 30 GiB sent in a month).
# 1. Fields no page reads are cut IN THE QUERY (jsonb minus), so they are not even fetched: ~180 KB of ~655 KB.
# 2. The finished response is kept for 30 s and dropped as soon as any write goes through _db (DB_VERSION); a write from another process is picked up when the 30 s run out.
DROP_FIELDS = [
    "balance_sheet_years", "reserves", "q_operating_profit_growth_pct", "pe_trailing_averages", "cfo", "equity_capital", "cash_conversion_cycle", "inventory_days",
    "working_capital_days_annual", "days_payable", "roe_series", "roce_series", "cash_conversion_pct", "face_value",
    "price_history_52w",  # the sparkline that used it is gone from Summary
]
CACHE_SECONDS = 30
_cache = {"v": -1, "t": 0.0, "body": b"", "gz": b""}


def _slim_stocks(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT ticker, data - %s::text[] FROM stocks", (DROP_FIELDS,))
        return {ticker: data for ticker, data in cur.fetchall()}


def _send_cached(h, accept_gzip):
    body, enc = (_cache["gz"], True) if accept_gzip and _cache["gz"] else (_cache["body"], False)
    h.send_response(200)
    h.send_header("Content-Type", "application/json")
    h.send_header("Content-Length", str(len(body)))
    if enc:
        h.send_header("Content-Encoding", "gzip")
    h.send_header("Vary", "Accept-Encoding")
    h.end_headers()
    h.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not require_auth(self):
            return
        query = parse_qs(urlparse(self.path).query)
        screeners_param = (query.get("screeners") or [None])[0]
        accept_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "")
        if not screeners_param and _cache["body"] and _cache["v"] == DB_VERSION[0] and time.time() - _cache["t"] < CACHE_SECONDS:
            _send_cached(self, accept_gzip)  # before opening a database connection: just connecting to the hosted database costs ~1.5 s
            return

        conn = get_conn()
        try:
            if screeners_param:
                keys = [k.strip() for k in screeners_param.split(",") if k.strip()]
                result = {}
                with conn.cursor() as cur:
                    for key in keys:
                        # `data -> %s` extracts just that one sub-object
                        # from the stored JSONB blob server-side —
                        # avoids ever loading the full ~2.1MB row into
                        # Postgres's result set, let alone this
                        # function's memory or the response body.
                        cur.execute("SELECT data -> %s FROM meta WHERE key = 'momentum_screeners'", (key,))
                        row = cur.fetchone()
                        if row and row[0] is not None:
                            result[key] = row[0]
                send_json(self, 200, {"momentum_screeners": result})
                return

            v0 = DB_VERSION[0]
            payload = {
                "stocks": _slim_stocks(conn),
                "scenarios": get_all_json(conn, "scenarios"),
                "guidance": get_all_json(conn, "guidance"),
                "guidance_tracker": get_meta(conn, "guidance_tracker", {"quarters": [], "tracked": [], "cells": {}}),
                "viraj_screen": get_meta(conn, "viraj_screen", {"as_of": None, "rows": []}),
                "momentum_screeners": {},
                "run_requests": get_meta(conn, "run_requests", {}),
                "watchlist": get_meta(conn, "watchlist", {"tickers": []}),
                "last_refresh": get_meta(conn, "last_refresh", {}),
            }
            body = json.dumps(payload).encode("utf-8")
            _cache.update(v=v0, t=time.time(), body=body, gz=gzip.compress(body, 5) if len(body) > 1024 else b"")
            _send_cached(self, accept_gzip)
        finally:
            try:
                conn.close()
            except Exception:
                pass
