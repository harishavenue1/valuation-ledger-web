"""GET /api/cron_refresh_prices — server-side daily price refresh,
triggered by Vercel Cron (see the "crons" entry in vercel.json) instead
of a browser click or a script on Harish's own Mac. Runs entirely on
Vercel's infrastructure, so it fires every morning regardless of
whether any machine of Harish's happens to be awake — the gap the
previous local-cron-script approach (~/Downloads/daily_ledger_refresh.py)
couldn't close.

Auth is NOT the usual cookie gate (require_auth from _http) — Vercel
Cron requests carry no browser cookie. Vercel signs its own cron
invocations with an `Authorization: Bearer $CRON_SECRET` header
whenever a CRON_SECRET env var exists on the project, so that's what
this checks instead. Fails closed (401) if CRON_SECRET isn't set,
same "no configured secret means no access" stance _auth.py takes for
APP_PASSWORD.

Refreshes prices only (current_price/pe_ratio/market_cap_cr/
week52_high via fetch_price_only) for every ticker in the ledger, one
at a time with a short delay between each — same "gentle, spread-out
requests to Screener.in" intent as the local script it replaces, just
running in the cloud. A small per-invocation time budget stops the
loop before Vercel's own function timeout would kill it mid-request;
any tickers left over just get picked up on tomorrow's run rather than
failing the whole batch (this endpoint always processes the CURRENT
full ticker list from scratch, so nothing is ever silently skipped
forever — only ever delayed a day if the ledger grows large enough to
not fit in one run).

An optional `?limit=N` query param caps how many tickers are processed
— for manual testing only (curl with the Bearer token), never set by
the real cron trigger."""
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import get_all_json, get_conn, set_meta, upsert_json
from _http import send_json
from _screener_fetch import fetch_price_only

DELAY_SECONDS = 1.5  # gap between tickers — the "slowly" part
TIME_BUDGET_SECONDS = 260  # stop refreshing with headroom under the 300s function cap


def _is_authed_cron(handler) -> bool:
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return False  # no secret configured — fail closed
    header = handler.headers.get("Authorization", "")
    return header == f"Bearer {secret}"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not _is_authed_cron(self):
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
                if time.monotonic() - start > TIME_BUDGET_SECONDS:
                    skipped = tickers[i:]
                    break
                price_data, err = fetch_price_only(ticker)
                if err:
                    failed.append({"ticker": ticker, "error": err})
                else:
                    upsert_json(conn, "stocks", ticker, {**stocks.get(ticker, {}), **price_data})
                    ok += 1
                if i < total - 1:
                    time.sleep(DELAY_SECONDS)

            result = {
                "at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "total": total,
                "ok": ok,
                "failed": failed,
                "skipped": skipped,
            }
            set_meta(conn, "last_refresh", {"prices": result})
            send_json(self, 200, {"ok": True, **result})
        finally:
            conn.close()
