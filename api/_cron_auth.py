"""Shared auth gate for GET handlers living on otherwise cookie-gated
endpoint files (refresh_price.py, fetch_company.py, momentum_screeners.py
— see each file's do_GET for why they're folded in here rather than
their own files: the Hobby plan's 12-Serverless-Functions-per-
deployment cap, hit live 2026-08-30). Two callers, two credentials:

  - Vercel Cron signs its own invocations with `Authorization: Bearer
    $CRON_SECRET` whenever a CRON_SECRET env var exists on the project
    (cron requests carry no browser cookie, so this is checked instead
    of the usual cookie gate).
  - The "▶️ Run now" button in the browser (RunButton.tsx, "cloud"
    mode — 2026-08-30, "refresh on click from any machine, not just
    the Mac") calls these same GET endpoints directly with the normal
    session cookie already used everywhere else in the app, so an
    already-logged-in browser (phone, work laptop, any machine — not
    just the one with the local poller) can trigger an on-demand
    refresh without waiting for the next scheduled cron run.

is_authed_cron_or_cookie() accepts either. Fails closed if neither
matches — same stance _auth.py takes for APP_PASSWORD."""
import os

from _auth import is_authed


def is_authed_cron(handler) -> bool:
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return False
    header = handler.headers.get("Authorization", "")
    return header == f"Bearer {secret}"


def is_authed_cron_or_cookie(handler) -> bool:
    return is_authed_cron(handler) or is_authed(handler.headers.get("Cookie"))
