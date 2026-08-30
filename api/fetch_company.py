"""POST /api/fetch_company — full fetch (fundamentals + quarterly + EMA)
for one ticker via Screener.in, upserted into the stocks table.
DELETE — remove a company (and its saved scenarios) from the ledger.
PATCH — toggle the "owned" flag without a full re-fetch.

GET /api/fetch_company — the same full fetch, but for EVERY ticker in
the ledger, triggered by Vercel Cron (see vercel.json's "crons")
instead of the "🔄 Refresh all now" (full) button — weekly, Sunday
5:00 AM IST, not daily: fundamentals don't change day to day (see
refresh_price.py's own docstring), so this heavier fetch_one() sweep
only needs to run often enough to catch new quarterly results, not
every morning. Folded into this file rather than its own
cron_refresh_full.py (a separate file was the original design, but the
Hobby plan's 12-Serverless-Functions-per-deployment cap was already
maxed out — hit live 2026-08-30 deploying 3 new cron files) — auth is
the only thing that differs: see _cron_auth.py, checked here instead
of the usual cookie gate since cron requests carry no browser cookie.
Deliberately does NOT also touch the guidance_tracker "tracked" list
the way a manual Retrieve/Add does — these tickers are already
tracked, this is just a refresh, not a first-time add.

Round-robin cursor ("full_refresh_cursor" in meta): fetch_one() is
heavy enough (resolve + page + 2 EMA chart calls + PE-history chart
calls per ticker) that one run may not fit every ticker inside the
function's time budget as the ledger grows. Progress resumes from the
stored cursor each run, wrapping around the ticker list, so which
tickers get covered rotates rather than always stalling on the same
alphabetical prefix."""
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# See login.py's comment on this line — Vercel's Python runtime doesn't
# put this file's own directory on sys.path, so sibling `_xxx` imports
# fail without it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _clean import clean_stock
from _cron_auth import is_authed_cron
from _db import delete_json, get_all_json, get_conn, get_json, get_meta, set_meta, upsert_json
from _http import read_json_body, require_auth, send_json
from _screener_fetch import fetch_one

CRON_DELAY_SECONDS = 3  # gap between tickers — heavier per-ticker load than the price cron
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
        data, err = fetch_one(ticker)
        if err:
            send_json(self, 502, {"error": err})
            return
        data = clean_stock(data)
        conn = get_conn()
        try:
            existing = get_json(conn, "stocks", data["ticker"]) or {}
            data["owned"] = existing.get("owned", False)
            upsert_json(conn, "stocks", data["ticker"], data)
            # Any fetch (Summary's Retrieve or the Guidance Tracker's own
            # Add form) also adds to the tracker's "tracked" list — ported
            # from the old app's retrieve_companies(), which both callers
            # shared. One-directional: removing from the tracker doesn't
            # touch the main company list.
            tracker = get_meta(conn, "guidance_tracker", {"quarters": [], "tracked": [], "cells": {}})
            tracked = tracker.setdefault("tracked", [])
            if data["ticker"] not in tracked:
                tracked.append(data["ticker"])
                set_meta(conn, "guidance_tracker", tracker)
            send_json(self, 200, {"stock": data})
        finally:
            conn.close()

    def do_DELETE(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        if not ticker:
            send_json(self, 400, {"error": "ticker is required"})
            return
        conn = get_conn()
        try:
            delete_json(conn, "stocks", ticker)
            delete_json(conn, "scenarios", ticker)
            delete_json(conn, "guidance", ticker)
            send_json(self, 200, {"ok": True})
        finally:
            conn.close()

    def do_PATCH(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        ticker = (body.get("ticker") or "").strip()
        if not ticker:
            send_json(self, 400, {"error": "ticker is required"})
            return
        conn = get_conn()
        try:
            stock = get_json(conn, "stocks", ticker)
            if not stock:
                send_json(self, 404, {"error": "unknown ticker"})
                return
            stock["owned"] = bool(body.get("owned", False))
            upsert_json(conn, "stocks", ticker, stock)
            send_json(self, 200, {"stock": stock})
        finally:
            conn.close()

    def do_GET(self):
        if not is_authed_cron(self):
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
            order = all_tickers[cursor:] + all_tickers[:cursor]
            if limit:
                order = order[:limit]
            total = len(order)

            ok, failed, skipped = 0, [], []
            for i, ticker in enumerate(order):
                if time.monotonic() - start > CRON_TIME_BUDGET_SECONDS:
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
                    time.sleep(CRON_DELAY_SECONDS)

            attempted = total - len(skipped)
            if n:
                set_meta(conn, "full_refresh_cursor", (cursor + attempted) % n)

            result = {
                "at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "total": total, "ok": ok, "failed": failed, "skipped": skipped,
            }
            set_meta(conn, "last_refresh", {**get_meta(conn, "last_refresh", {}), "full": result})
            send_json(self, 200, {"ok": True, **result})
        finally:
            conn.close()
