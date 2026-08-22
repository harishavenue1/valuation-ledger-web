#!/usr/bin/env python3
"""One-off: load the old ~/valuation-ledger repo's cache/*.json files
into this app's Postgres database. Run once after DATABASE_URL is set
(locally, pointed at the real deployed DB — this talks straight to
Postgres, no Vercel dev server needed).

Usage:
    DATABASE_URL=postgres://... python3 scripts/migrate_from_json.py [path-to-old-repo]

Defaults to ~/valuation-ledger if no path given.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from _clean import clean_stock  # noqa: E402
from _db import get_conn, set_meta, upsert_json  # noqa: E402


def load(path):
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/valuation-ledger")
    cache = os.path.join(src, "cache")
    print(f"Reading from {cache}")

    all_stocks = load(os.path.join(cache, "all_stocks.json"))
    scenarios = load(os.path.join(cache, "scenarios.json"))
    guidance_tracker = load(os.path.join(cache, "guidance_tracker.json"))
    last_refresh = load(os.path.join(cache, "last_refresh.json"))
    guidance_dir = os.path.join(cache, "guidance")
    guidance = {}
    if os.path.isdir(guidance_dir):
        for fname in os.listdir(guidance_dir):
            if fname.endswith(".json"):
                guidance[fname[:-5]] = load(os.path.join(guidance_dir, fname))

    conn = get_conn()
    try:
        for ticker, data in all_stocks.items():
            # all_stocks.json is the old app's RAW cache (its own
            # load_raw_all_stocks() docstring says so) — Screener's
            # occasional trailing "TTM" column is still in there, same
            # clean_stock() step the old app applied at load time.
            upsert_json(conn, "stocks", ticker, clean_stock(data))
        print(f"  stocks: {len(all_stocks)}")

        for ticker, data in scenarios.items():
            upsert_json(conn, "scenarios", ticker, data)
        print(f"  scenarios: {len(scenarios)}")

        for ticker, data in guidance.items():
            upsert_json(conn, "guidance", ticker, data)
        print(f"  guidance: {len(guidance)}")

        if guidance_tracker:
            set_meta(conn, "guidance_tracker", guidance_tracker)
            print("  guidance_tracker: set")
        if last_refresh:
            set_meta(conn, "last_refresh", last_refresh)
            print("  last_refresh: set")
    finally:
        conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
