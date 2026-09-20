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

from _db import get_all_json, get_conn, get_meta
from _http import require_auth, send_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not require_auth(self):
            return
        query = parse_qs(urlparse(self.path).query)
        screeners_param = (query.get("screeners") or [None])[0]

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

            payload = {
                "stocks": get_all_json(conn, "stocks"),
                "scenarios": get_all_json(conn, "scenarios"),
                "guidance": get_all_json(conn, "guidance"),
                "guidance_tracker": get_meta(conn, "guidance_tracker", {"quarters": [], "tracked": [], "cells": {}}),
                "viraj_screen": get_meta(conn, "viraj_screen", {"as_of": None, "rows": []}),
                "momentum_screeners": {},
                "run_requests": get_meta(conn, "run_requests", {}),
                "watchlist": get_meta(conn, "watchlist", {"tickers": []}),
                "last_refresh": get_meta(conn, "last_refresh", {}),
            }
            send_json(self, 200, payload)
        finally:
            conn.close()
