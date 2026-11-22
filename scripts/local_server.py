#!/usr/bin/env python3
"""Small server for the Python API (+ the built web page): your Mac, Docker, Render (2026-11-22: the Vercel Hobby project was paused for Fluid Active CPU until 2026-12-20).

Serves every api/<name>.py `handler` class on http://localhost:3000/api/<name> so `npm run dev` (Vite, port 5173, proxies /api -> 3000) works against the same Postgres database.
Needs DATABASE_URL (the Neon / Vercel Postgres connection string) in .env.local; APP_PASSWORD falls back to the app password saved in ~/.viraj_config.json.
Run: .venv/bin/python scripts/local_server.py    (or scripts/run_local.sh to start the API and the web page together)

Production mode (2026-11-22, Render): when ./dist exists the same server also serves the built web page (single-page-app fallback to index.html), gzips big JSON / text responses (Vercel did that
for free), answers /healthz without touching the database, and binds HOST (default 127.0.0.1; the Dockerfile sets 0.0.0.0) on PORT (Render sets it).
"""
import gzip, importlib.util, io, json, mimetypes, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, "api")
sys.path.insert(0, API)

def load_env():
    for name in (".env.local", ".env"):
        p = os.path.join(ROOT, name)
        if os.path.exists(p):
            for line in open(p):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not os.environ.get("APP_PASSWORD"):
        try:
            os.environ["APP_PASSWORD"] = json.load(open(os.path.expanduser("~/.viraj_config.json")))["valuation_ledger_password"]
        except Exception:
            pass
load_env()
# A value pasted into a dashboard often carries a trailing newline (2026-11-22: Render's CRON_SECRET did, so the scheduler's bearer header never matched): trim every setting we read.
for _k in ("DATABASE_URL", "POSTGRES_URL", "APP_PASSWORD", "CRON_SECRET", "HOURLY_PING_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "X_BEARER_TOKEN"):
    if os.environ.get(_k):
        os.environ[_k] = os.environ[_k].strip()

_mods = {}
def module_for(name):
    if name not in _mods:
        path = os.path.join(API, name + ".py")
        if not os.path.isfile(path) or name.startswith("_"):
            return None
        spec = importlib.util.spec_from_file_location("api_" + name, path)
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        _mods[name] = m
    return _mods[name]

DIST = os.path.join(ROOT, "dist")
GZIP_TYPES = ("application/json", "text/", "application/javascript", "image/svg+xml")

class Router(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # one request per connection: handlers write their own Content-Length, no keep-alive bookkeeping

    def _finish(self, real, buf):
        raw = buf.getvalue()
        head, sep, body = raw.partition(b"\r\n\r\n")
        if sep and len(body) > 1024 and b"gzip" in (self.headers.get("Accept-Encoding") or "").encode() and b"content-encoding" not in head.lower():
            ct = next((l.split(b":", 1)[1].strip().decode() for l in head.split(b"\r\n") if l.lower().startswith(b"content-type:")), "")
            if any(ct.startswith(t) for t in GZIP_TYPES):
                z = gzip.compress(body, 5)
                lines = [l for l in head.split(b"\r\n") if not l.lower().startswith(b"content-length:")]
                lines += [b"Content-Encoding: gzip", b"Vary: Accept-Encoding", b"Content-Length: " + str(len(z)).encode()]
                raw = b"\r\n".join(lines) + sep + z
        real.write(raw)

    def _static(self, path):
        rel = os.path.normpath(path.lstrip("/"))
        f = os.path.join(DIST, rel)
        if rel.startswith("..") or not os.path.isfile(f):
            f = os.path.join(DIST, "index.html")  # single-page-app routes (/summary, /company/X ...)
        if not os.path.isfile(f):
            return False
        body = open(f, "rb").read()
        ct = mimetypes.guess_type(f)[0] or "application/octet-stream"
        self.send_response(200); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if "/assets/" in f else "no-cache")
        self.end_headers(); self.wfile.write(body)
        return True

    def _dispatch(self):
        path = urlparse(self.path).path
        if path == "/healthz":
            self.send_response(200); self.send_header("Content-Type", "text/plain"); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"ok"); return
        parts = path.strip("/").split("/")
        is_api = parts[0] == "api"
        if not is_api:
            if self.command == "GET" and os.path.isdir(DIST):
                real, buf = self.wfile, io.BytesIO(); self.wfile = buf
                try:
                    ok = self._static(path)
                finally:
                    self.wfile = real
                if ok:
                    self._finish(real, buf); return
            self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers(); return
        mod = module_for(parts[1]) if len(parts) >= 2 else None
        h = getattr(mod, "handler", None) if mod else None
        fn = getattr(h, "do_" + self.command, None) if h else None
        if not fn:
            self.send_response(404 if not h else 405); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(b'{"error": "no such api route"}'); return
        real, buf = self.wfile, io.BytesIO(); self.wfile = buf
        try:
            fn(self)
        except Exception as e:  # keep the server alive; show what broke
            import traceback; traceback.print_exc()
            buf = io.BytesIO(); self.wfile = buf
            self.send_response(500); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)[:300]}).encode())
        finally:
            self.wfile = real
        self._finish(real, buf)
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _dispatch
    def log_message(self, fmt, *a):
        sys.stderr.write("%s %s\n" % (self.command, self.path[:110]))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000")); host = os.environ.get("HOST", "127.0.0.1")
    print(f"server on http://{host}:{port}  database: {'configured' if (os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')) else 'MISSING - add DATABASE_URL to .env.local'}")
    ThreadingHTTPServer((host, port), Router).serve_forever()
