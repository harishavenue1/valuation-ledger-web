"""POST /api/scenario — upsert one case's driver state for one ticker.
Called debounced (500ms after the last edit) from Detail.tsx, so a
burst of keystrokes costs one write, not one per keystroke."""
from http.server import BaseHTTPRequestHandler

from _db import get_conn, get_json, upsert_json
from _http import read_json_body, require_auth, send_json

VALID_CASES = {"base", "bull", "bear", "mgmt"}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        case = body.get("case")
        state = body.get("state")
        if not ticker or case not in VALID_CASES or not isinstance(state, dict):
            send_json(self, 400, {"error": "ticker, case, and state are required"})
            return
        conn = get_conn()
        try:
            current = get_json(conn, "scenarios", ticker) or {}
            current[case] = state
            upsert_json(conn, "scenarios", ticker, current)
            send_json(self, 200, {"ok": True})
        finally:
            conn.close()
