"""Fintwit feed — the tweets of a short list of accounts the user follows, kept in one Postgres meta row
(`fintwit`) so the Business page's Tweets tab can show them without scrolling X.

X has no free, credential-less read API any more (the embed endpoint is rate-limited, the open mirrors
are gone), so this module only STORES and SERVES: tweets arrive through POST /api/momentum_screeners
({"fintwit": true, "tweets": [...]}) from whatever fetched them — a session in the user's own logged-in
browser today, an X API token cron if one is ever added. Dedup is by tweet id; 120 days / 4,000 tweets kept."""
import os
from datetime import datetime, timedelta, timezone

import requests

from _db import get_conn, get_meta, set_meta

KEY = "fintwit"
KEEP_DAYS = 120
MAX_TWEETS = 4000
HANDLES = {
    "amitabhvatsya": "Mindful Investor",
    "mohan_koushik1": "Koushik Mohan",
    "jeevanpatwa": "jeevan patwa",
    "Akash17971": "Akash Chaudhary",
    "soicfinance": "Intrinsic Compounding",
    "Asan_research": "ASAN",
    "imhiteshmodi": "Hitesh Modi",
    "suru27": "kumar saurabh",
    "Patterns0001": "Patterns",
    "MithunSarkari": "Mithun Sarkar",
}


def _clean(t):
    h = (t.get("h") or "").lstrip("@")
    if not t.get("id") or not h or not t.get("t") or not t.get("d"):
        return None
    return {
        "id": str(t["id"]),
        "h": h,
        "n": t.get("n") or HANDLES.get(h, h),
        "t": str(t["t"])[:4000],
        "d": str(t["d"]),
        "k": t.get("k") or "post",  # post | reply | repost | quote
        "likes": t.get("likes"),
        "rts": t.get("rts"),
        "views": t.get("views"),
        "img": bool(t.get("img")),
    }


def ingest(conn, tweets):
    state = get_meta(conn, KEY, None) or {}
    have = {t["id"]: t for t in state.get("tweets") or []}
    added = 0
    for raw in tweets:
        t = _clean(raw)
        if t is None:
            continue
        if t["id"] not in have:
            added += 1
        have[t["id"]] = {**have.get(t["id"], {}), **t}  # newer counts (likes/views) overwrite
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()
    kept = sorted((t for t in have.values() if t["d"] >= cutoff), key=lambda t: t["d"], reverse=True)[:MAX_TWEETS]
    state = {"tweets": kept, "handles": HANDLES, "updated": datetime.now(timezone.utc).isoformat()}
    set_meta(conn, KEY, state)
    return {"added": added, "total": len(kept)}


def feed(conn):
    state = get_meta(conn, KEY, None) or {}
    return {"tweets": state.get("tweets") or [], "handles": HANDLES, "updated": state.get("updated")}


# ── fetching through X's official API (server-side, no browser) ──────────────
# Needs ONE secret: an X API bearer token in the Vercel environment variable X_BEARER_TOKEN. Nothing else is
# stored; without it the runner just says so.

API = "https://api.x.com/2"


def fetch_from_api(days=3):
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    if not token:
        return {"error": "X_BEARER_TOKEN is not set in the Vercel environment — add an X API bearer token to enable the daily pull"}
    headers = {"Authorization": f"Bearer {token}", "User-Agent": "valuation-ledger"}
    r = requests.get(f"{API}/users/by", params={"usernames": ",".join(HANDLES), "user.fields": "name"}, headers=headers, timeout=25)
    if r.status_code != 200:
        return {"error": f"X API users lookup failed: HTTP {r.status_code} {r.text[:200]}"}
    users = {u["id"]: u for u in (r.json().get("data") or [])}
    start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out, failed = [], []
    for uid, u in users.items():
        resp = requests.get(
            f"{API}/users/{uid}/tweets",
            params={
                "max_results": 100,
                "start_time": start,
                "tweet.fields": "created_at,public_metrics,referenced_tweets,attachments,note_tweet",
            },
            headers=headers,
            timeout=25,
        )
        if resp.status_code != 200:
            failed.append(f"{u['username']}: HTTP {resp.status_code}")
            continue
        for tw in resp.json().get("data") or []:
            refs = {x.get("type") for x in tw.get("referenced_tweets") or []}
            m = tw.get("public_metrics") or {}
            out.append(
                {
                    "id": tw["id"],
                    "h": u["username"],
                    "n": u.get("name"),
                    "t": (tw.get("note_tweet") or {}).get("text") or tw.get("text") or "",
                    "d": tw.get("created_at"),
                    "k": "repost" if "retweeted" in refs else "reply" if "replied_to" in refs else "quote" if "quoted" in refs else "post",
                    "likes": m.get("like_count"),
                    "rts": m.get("retweet_count"),
                    "views": m.get("impression_count"),
                    "img": bool((tw.get("attachments") or {}).get("media_keys")),
                }
            )
    conn = get_conn()
    try:
        res = ingest(conn, out)
    finally:
        conn.close()
    return {**res, "fetched": len(out), "failed": failed}
