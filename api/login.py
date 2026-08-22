import os
import sys
from http.server import BaseHTTPRequestHandler

# Vercel's Python runtime imports this entrypoint via importlib by
# absolute path, which — unlike a normal `python script.py` run —
# doesn't add this file's own directory to sys.path. Without this, the
# `from _xxx import ...` lines below fail with ModuleNotFoundError even
# though the sibling files are right here (confirmed live 2026-08-22 —
# every /api/* endpoint 500'd with exactly that error until this was
# added to all six of them).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _auth import check_password, clear_cookie_header, set_cookie_header
from _http import read_json_body, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = read_json_body(self)
        if check_password(body.get("password", "")):
            send_json(self, 200, {"ok": True}, {"Set-Cookie": set_cookie_header()})
        else:
            send_json(self, 401, {"error": "wrong password"})

    def do_DELETE(self):
        send_json(self, 200, {"ok": True}, {"Set-Cookie": clear_cookie_header()})
