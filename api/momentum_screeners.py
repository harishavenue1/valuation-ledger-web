"""POST /api/momentum_screeners — pushed by 4 local skill scripts after
each run (myLongTermInvestingStrategy, weekendInvesting, quantBollinger,
Nifty500RelativeStrength — all now NSE 750-scoped), one push per
screener: {"screener": "<key>", "label": "<display name>",
"as_of": "YYYY-MM-DD", "rows": [...]}. Row shape differs per screener
(each has its own columns) — stored and returned as-is, the frontend
renders each tab according to its own known fields. Unlike
guidance_tracker/viraj_screen (single blob, whole-thing overwritten
each save), this upserts just the one screener's key within the
stored dict, since the 4 scripts run independently on their own
schedules and shouldn't clobber each other's latest data.
Read back as part of the /api/stocks bundle (bundle.momentum_screeners)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http.server import BaseHTTPRequestHandler

from _db import get_conn, get_meta, set_meta
from _http import read_json_body, require_auth, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        screener = body.get("screener")
        if not isinstance(screener, str) or not screener:
            send_json(self, 400, {"error": "screener (string) is required"})
            return
        if not isinstance(body.get("rows"), list) or not isinstance(body.get("as_of"), str):
            send_json(self, 400, {"error": "as_of (string) and rows (list) are required"})
            return
        conn = get_conn()
        try:
            all_screeners = get_meta(conn, "momentum_screeners", {})
            all_screeners[screener] = {
                "label": body.get("label", screener),
                "as_of": body["as_of"],
                "rows": body["rows"],
            }
            set_meta(conn, "momentum_screeners", all_screeners)
            send_json(self, 200, {"ok": True, "count": len(body["rows"])})
        finally:
            conn.close()
