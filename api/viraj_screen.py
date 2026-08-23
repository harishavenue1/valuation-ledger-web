"""POST /api/viraj_screen — pushed by ~/Downloads/viraj_screen.py (a
local cron script, not the browser) at the end of each run:
{"as_of": "YYYY-MM-DD", "rows": [{category, symbol, name, marketcap,
sales_g, ebit_g, eps_g, dol, dfl, dcl, F1..F3, C1..C3, score, verdict,
about}, ...]}. Same "one JSON blob in meta" pattern as
guidance_tracker.py — the script authenticates the normal way (POST
/api/login, reuse the session cookie) since this endpoint requires the
same auth as everything else, no separate script token.
Read back as part of the /api/stocks bundle (bundle.viraj_screen)."""
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
        if not isinstance(body.get("rows"), list) or not isinstance(body.get("as_of"), str):
            send_json(self, 400, {"error": "as_of (string) and rows (list) are required"})
            return
        conn = get_conn()
        try:
            set_meta(conn, "viraj_screen", {"as_of": body["as_of"], "rows": body["rows"]})
            send_json(self, 200, {"ok": True, "count": len(body["rows"])})
        finally:
            conn.close()
