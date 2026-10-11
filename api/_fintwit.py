"""Fintwit feed — the tweets of a short list of accounts the user follows, kept in one Postgres meta row
(`fintwit`) so the Business page's Tweets tab can show them without scrolling X.

X has no free, credential-less read API any more (the embed endpoint is rate-limited, the open mirrors
are gone), so this module only STORES and SERVES: tweets arrive through POST /api/momentum_screeners
({"fintwit": true, "tweets": [...]}) from whatever fetched them — a session in the user's own logged-in
browser today, an X API token cron if one is ever added. Dedup is by tweet id; 120 days / 4,000 tweets kept."""
from datetime import datetime, timedelta, timezone

from _db import get_meta, set_meta

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
