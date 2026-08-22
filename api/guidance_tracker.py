"""POST /api/guidance_tracker — save the whole Guidance Tracker state:
{"quarters": [labels...], "tracked": [tickers...],
 "cells": {ticker: {quarter_label: {"note": str, "tag": ""|"Beat"|"Neutral"|"Miss"}}}}.
Read back as part of the /api/stocks bundle (bundle.guidance_tracker).
Saved whole rather than per-cell — the old app wrote the same way (one
JSON blob), and the grid is small enough (a handful of tracked
companies × quarters) that this is simpler than per-cell endpoints."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http.server import BaseHTTPRequestHandler

from _db import get_conn, set_meta
from _http import read_json_body, require_auth, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        if not isinstance(body.get("quarters"), list) or not isinstance(body.get("tracked"), list) or not isinstance(
            body.get("cells"), dict
        ):
            send_json(self, 400, {"error": "quarters, tracked, and cells are required"})
            return
        conn = get_conn()
        try:
            set_meta(conn, "guidance_tracker", body)
            send_json(self, 200, {"ok": True})
        finally:
            conn.close()
