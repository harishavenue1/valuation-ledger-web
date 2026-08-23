"""POST /api/run_requests — the "Run now" button on Viraj Screen /
Momentum Screeners. None of those 5 scripts can actually execute
inside a Vercel serverless function: viraj_screen.py needs local
Screener.in/Chartink session cookies (moving those to Vercel env vars
would be a real security posture change, not something to do
silently), and even the 4 yfinance-only NSE750 screeners risk Vercel's
execution-time limit and Yahoo Finance's known tendency to rate-limit
or block datacenter/cloud IPs harder than residential ones — a live
750-ticker fetch is not something to gamble on working from Vercel's
network. So this doesn't run anything itself — it just queues a
"please run" flag that ~/Downloads/run_request_poller.py (a local
script polling on the user's own Mac, e.g. via a launchd job every
few minutes) picks up and actually executes, exactly as if run by
hand. The 5 scripts already push their own results when done — this
queue is only a status signal, separate from that data.

Meta shape: {screener_key: {"status": "pending"|"running"|"done"|
"error", "requested_at": iso, "updated_at": iso, "error": str|null}}

POST body either:
  {"action": "request", "screener": "<key>"}                    (web button)
  {"action": "claim", "screener": "<key>"}                       (poller)
  {"action": "complete", "screener": "<key>", "error": str|null} (poller)
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http.server import BaseHTTPRequestHandler

from _db import get_conn, get_meta, set_meta
from _http import read_json_body, require_auth, send_json

VALID_SCREENERS = {
    "viraj_screen", "myLongTermInvestingStrategy", "weekendInvesting",
    "quantBollinger", "Nifty500RelativeStrength",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Polled by ~/Downloads/run_request_poller.py every few minutes —
        # deliberately its own lightweight endpoint rather than pulling
        # the whole /api/stocks bundle (stocks/scenarios/guidance) just
        # to check a handful of status flags every poll.
        if not require_auth(self):
            return
        conn = get_conn()
        try:
            send_json(self, 200, get_meta(conn, "run_requests", {}))
        finally:
            conn.close()

    def do_POST(self):
        if not require_auth(self):
            return
        body = read_json_body(self)
        screener = body.get("screener")
        action = body.get("action")
        if screener not in VALID_SCREENERS:
            send_json(self, 400, {"error": f"screener must be one of {sorted(VALID_SCREENERS)}"})
            return
        if action not in ("request", "claim", "complete"):
            send_json(self, 400, {"error": "action must be request, claim, or complete"})
            return

        conn = get_conn()
        try:
            all_requests = get_meta(conn, "run_requests", {})
            entry = all_requests.get(screener, {})

            if action == "request":
                entry = {"status": "pending", "requested_at": now_iso(), "updated_at": now_iso(), "error": None}
            elif action == "claim":
                entry = {**entry, "status": "running", "updated_at": now_iso()}
            elif action == "complete":
                entry = {**entry, "status": "error" if body.get("error") else "done",
                          "updated_at": now_iso(), "error": body.get("error")}

            all_requests[screener] = entry
            set_meta(conn, "run_requests", all_requests)
            send_json(self, 200, {"ok": True, "entry": entry})
        finally:
            conn.close()
