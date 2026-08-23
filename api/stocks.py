"""GET /api/stocks — the single bootstrap payload the frontend loads on
first render: every stock, every saved scenario, every guidance record,
plus last_refresh/guidance_tracker meta. One round trip, then every
interaction after that is computed client-side (src/lib/model.ts) —
this is the actual "fast" fix versus the old app's full-page Streamlit
rerun on every click."""
import os
import sys
from http.server import BaseHTTPRequestHandler

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
        conn = get_conn()
        try:
            payload = {
                "stocks": get_all_json(conn, "stocks"),
                "scenarios": get_all_json(conn, "scenarios"),
                "guidance": get_all_json(conn, "guidance"),
                "guidance_tracker": get_meta(conn, "guidance_tracker", {"quarters": [], "tracked": [], "cells": {}}),
                "viraj_screen": get_meta(conn, "viraj_screen", {"as_of": None, "rows": []}),
                "momentum_screeners": get_meta(conn, "momentum_screeners", {}),
                "run_requests": get_meta(conn, "run_requests", {}),
                "last_refresh": get_meta(conn, "last_refresh", {}),
            }
            send_json(self, 200, payload)
        finally:
            conn.close()
