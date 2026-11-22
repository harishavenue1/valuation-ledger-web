#!/usr/bin/env python3
"""Local stand-in for Vercel's Python functions (2026-11-22: the Hobby project was paused for Fluid Active CPU until 2026-12-20).

Serves every api/<name>.py `handler` class on http://localhost:3000/api/<name> so `npm run dev` (Vite, port 5173, proxies /api -> 3000) works against the same Postgres database.
Needs DATABASE_URL (the Neon / Vercel Postgres connection string) in .env.local; APP_PASSWORD falls back to the app password saved in ~/.viraj_config.json.
Run: .venv/bin/python scripts/local_server.py    (or scripts/run_local.sh to start the API and the web page together)
"""
import importlib.util, json, os, sys
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

class Router(BaseHTTPRequestHandler):
    def _dispatch(self):
        path = urlparse(self.path).path.strip("/")
        parts = path.split("/")
        mod = module_for(parts[1]) if len(parts) >= 2 and parts[0] == "api" else None
        h = getattr(mod, "handler", None) if mod else None
        fn = getattr(h, "do_" + self.command, None) if h else None
        if not fn:
            self.send_response(404 if not h else 405); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(b'{"error": "no such api route"}'); return
        try:
            fn(self)
        except Exception as e:  # keep the server alive; show what broke
            import traceback; traceback.print_exc()
            try:
                self.send_response(500); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)[:300]}).encode())
            except Exception:
                pass
    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _dispatch
    def log_message(self, fmt, *a):
        sys.stderr.write("%s %s\n" % (self.command, self.path[:110]))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    print(f"local API on http://localhost:{port}  database: {'configured' if (os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')) else 'MISSING - add DATABASE_URL to .env.local'}")
    ThreadingHTTPServer(("127.0.0.1", port), Router).serve_forever()
