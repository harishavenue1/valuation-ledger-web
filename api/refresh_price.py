"""POST /api/refresh_price — lightweight price-only refresh for one
ticker (current_price/pe_ratio/market_cap_cr/week52_high), merged onto
the existing stored record rather than replacing it. Called per-ticker
from the frontend with limited concurrency (see Summary.tsx's
"Refresh all prices") instead of one long server-side loop — keeps each
call comfortably inside a serverless function's timeout and refreshes
the whole ledger in parallel rather than one ticker at a time.

GET /api/refresh_price — the same price-only refresh, but for EVERY
ticker in the ledger, one at a time, triggered by Vercel Cron (see
vercel.json's "crons") instead of a browser click — daily, 5:00 AM IST,
so prices are fresh every morning regardless of whether any machine of
Harish's is awake. Folded into this file rather than its own
cron_refresh_prices.py (a separate file was the original design, but
the Hobby plan's 12-Serverless-Functions-per-deployment cap was
already maxed out — hit live 2026-08-30 deploying that as a 13th file)
— auth is the only thing that differs: see _cron_auth.py, checked here
instead of the usual cookie gate since cron requests carry no browser
cookie."""
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# See login.py's comment on this line — Vercel's Python runtime doesn't
# put this file's own directory on sys.path, so sibling `_xxx` imports
# fail without it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _cron_auth import is_authed_cron_or_cookie
from _db import get_all_json, get_conn, get_json, get_meta, set_meta, upsert_json
from _http import read_json_body, require_auth, send_json
from _screener_fetch import fetch_price_only

CRON_DELAY_SECONDS = 1.5  # gap between tickers on the full-ledger cron sweep — the "slowly" part
CRON_TIME_BUDGET_SECONDS = 260  # stop with headroom under the 300s function cap


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

    def do_GET(self):
        if not is_authed_cron_or_cookie(self):
            send_json(self, 401, {"error": "unauthorized"})
            return

        limit = None
        query = parse_qs(urlparse(self.path).query)
        if query.get("limit"):
            try:
                limit = int(query["limit"][0])
            except ValueError:
                limit = None

        start = time.monotonic()
        conn = get_conn()
        try:
            stocks = get_all_json(conn, "stocks")
            tickers = sorted(stocks.keys())
            if limit:
                tickers = tickers[:limit]
            total = len(tickers)

            ok, failed, skipped = 0, [], []
            for i, ticker in enumerate(tickers):
                if time.monotonic() - start > CRON_TIME_BUDGET_SECONDS:
                    skipped = tickers[i:]
                    break
                price_data, err = fetch_price_only(ticker)
                if err:
                    failed.append({"ticker": ticker, "error": err})
                else:
                    upsert_json(conn, "stocks", ticker, {**stocks.get(ticker, {}), **price_data})
                    ok += 1
                if i < total - 1:
                    time.sleep(CRON_DELAY_SECONDS)

            result = {
                "at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "total": total, "ok": ok, "failed": failed, "skipped": skipped,
            }
            set_meta(conn, "last_refresh", {**get_meta(conn, "last_refresh", {}), "prices": result})
            send_json(self, 200, {"ok": True, **result})
        finally:
            conn.close()
