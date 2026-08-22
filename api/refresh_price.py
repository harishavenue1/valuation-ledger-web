"""POST /api/refresh_price — lightweight price-only refresh for one
ticker (current_price/pe_ratio/market_cap_cr/week52_high), merged onto
the existing stored record rather than replacing it. Called per-ticker
from the frontend with limited concurrency (see Summary.tsx's
"Refresh all prices") instead of one long server-side loop — keeps each
call comfortably inside a serverless function's timeout and refreshes
the whole ledger in parallel rather than one ticker at a time."""
from http.server import BaseHTTPRequestHandler

from _db import get_conn, get_json, upsert_json
from _http import read_json_body, require_auth, send_json
from _screener_fetch import fetch_price_only


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        if not ticker:
            send_json(self, 400, {"error": "ticker is required"})
            return
        price_data, err = fetch_price_only(ticker)
        if err:
            send_json(self, 502, {"error": err})
            return
        conn = get_conn()
        try:
            existing = get_json(conn, "stocks", ticker) or {}
            merged = {**existing, **price_data}
            upsert_json(conn, "stocks", ticker, merged)
            send_json(self, 200, {"stock": merged})
        finally:
            conn.close()
