from http.server import BaseHTTPRequestHandler

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
