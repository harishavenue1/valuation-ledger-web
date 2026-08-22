"""POST /api/guidance — save management-guidance research for one
ticker (revenue_growth base/bull/bear seeds + source text/urls/
confidence/as_of). Read back as part of the /api/stocks bundle; the
frontend's defaultCaseState() (src/lib/model.ts) uses it to seed
Revenue Growth % for any case that hasn't been hand-edited yet."""
from http.server import BaseHTTPRequestHandler

from _db import get_conn, upsert_json
from _http import read_json_body, require_auth, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        data = body.get("data")
        if not ticker or not isinstance(data, dict):
            send_json(self, 400, {"error": "ticker and data are required"})
            return
        conn = get_conn()
        try:
            upsert_json(conn, "guidance", ticker, data)
            send_json(self, 200, {"ok": True})
        finally:
            conn.close()
