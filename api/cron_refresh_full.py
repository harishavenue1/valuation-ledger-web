"""GET /api/cron_refresh_full — weekly full-fundamentals refresh,
triggered by Vercel Cron (see vercel.json's "crons"). Sibling of
cron_refresh_prices.py, same CRON_SECRET auth gate, same "run entirely
on Vercel so it doesn't need any machine of Harish's to be awake"
motivation — but WEEKLY, not daily, and using fetch_one() (P&L,
quarterly results, EMA, PE history) instead of fetch_price_only().

Why weekly instead of daily: refresh_price.py's own docstring already
explains fundamentals don't change day to day, so running the full,
much heavier fetch_one() for every ticker every day would be needless
load on Screener.in for data that's mostly unchanged — this is exactly
the "occasional full refresh" the app's "🔄 Refresh all now" (full)
button is for, just on a schedule instead of a click. Weekly still
keeps EMA/PE-history reasonably current and catches new quarterly
results promptly.

Mirrors fetch_company.py's do_POST for the actual upsert (clean_stock,
preserve the existing "owned" flag) — deliberately does NOT also touch
the guidance_tracker "tracked" list the way a manual Retrieve/Add does;
these tickers are already tracked, this is just a refresh.

Round-robin cursor: fetch_one() is heavy enough (resolve + page + 2
EMA chart calls + PE-history chart calls per ticker) that one weekly
run may not fit every ticker inside the function's time budget as the
ledger grows. Rather than always refreshing the same alphabetical
prefix and never reaching the tail, progress is resumed from a stored
"full_refresh_cursor" (meta) each run, wrapping around the ticker list
— so which tickers get covered rotates, and everything is refreshed
roughly once every N runs even if N > 1 week's worth fits in a run.

An optional `?limit=N` query param caps how many tickers are processed
— manual testing only, never set by the real cron trigger."""
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _clean import clean_stock
from _db import get_all_json, get_conn, get_meta, set_meta, upsert_json
from _http import send_json
from _screener_fetch import fetch_one

DELAY_SECONDS = 3  # gap between tickers — heavier per-ticker load than the price cron, so slower still
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
            all_tickers = sorted(stocks.keys())
            n = len(all_tickers)
            cursor = get_meta(conn, "full_refresh_cursor", 0) if n else 0
            cursor = cursor % n if n else 0
            # Rotate the list so this run starts at the cursor and wraps —
            # keeps ticker identity (not index) as the source of truth.
            order = all_tickers[cursor:] + all_tickers[:cursor]
            if limit:
                order = order[:limit]
            total = len(order)

            ok, failed, skipped = 0, [], []
            for i, ticker in enumerate(order):
                if time.monotonic() - start > TIME_BUDGET_SECONDS:
                    skipped = order[i:]
                    break
                data, err = fetch_one(ticker)
                if err:
                    failed.append({"ticker": ticker, "error": err})
                else:
                    data = clean_stock(data)
                    data["owned"] = stocks.get(data["ticker"], {}).get("owned", False)
                    upsert_json(conn, "stocks", data["ticker"], data)
                    ok += 1
                if i < total - 1:
                    time.sleep(DELAY_SECONDS)

            # Advance the cursor past whatever was actually attempted this
            # run (ok + failed), not just "ok" — a ticker that failed still
            # got its turn and shouldn't be retried every single run ahead
            # of everything else.
            attempted = total - len(skipped)
            if n:
                set_meta(conn, "full_refresh_cursor", (cursor + attempted) % n)

            result = {
                "at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "total": total,
                "ok": ok,
                "failed": failed,
                "skipped": skipped,
            }
            set_meta(conn, "last_refresh", {**get_meta(conn, "last_refresh", {}), "full": result})
            send_json(self, 200, {"ok": True, **result})
        finally:
            conn.close()
