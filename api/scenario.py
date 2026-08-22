"""POST /api/scenario — upsert one case's driver state for one ticker.
Called debounced (500ms after the last edit) from Detail.tsx, so a
burst of keystrokes costs one write, not one per keystroke.
DELETE — "Clear estimates": drops the saved case entirely (not just
resets it to defaults) so it re-derives from guidance/last-actual
values fresh on next load, same as the old app's Clear button
(scenarios.pop(ticker, case))."""
import os
import sys
from http.server import BaseHTTPRequestHandler

# See login.py's comment on this line — Vercel's Python runtime doesn't
# put this file's own directory on sys.path, so sibling `_xxx` imports
# fail without it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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

    def do_DELETE(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        case = body.get("case")
        if not ticker or case not in VALID_CASES:
            send_json(self, 400, {"error": "ticker and case are required"})
            return
        conn = get_conn()
        try:
            current = get_json(conn, "scenarios", ticker) or {}
            current.pop(case, None)
            upsert_json(conn, "scenarios", ticker, current)
            send_json(self, 200, {"ok": True})
        finally:
            conn.close()
