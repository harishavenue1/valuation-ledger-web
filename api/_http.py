"""Small shared helpers for the BaseHTTPRequestHandler-style Vercel
Python functions in this directory — read a JSON body, send a JSON
response, and a require_auth guard shared by every endpoint except
login itself."""
import json

from _auth import is_authed


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw)


def send_json(handler, status, payload, extra_headers=None):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    for k, v in (extra_headers or {}).items():
        handler.send_header(k, v)
    handler.end_headers()
    handler.wfile.write(body)


def require_auth(handler) -> bool:
    """Returns True and does nothing if authed; sends a 401 and returns
    False otherwise — caller should `return` immediately when False."""
    if is_authed(handler.headers.get("Cookie")):
        return True
    send_json(handler, 401, {"error": "unauthorized"})
    return False
