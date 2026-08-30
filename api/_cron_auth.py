"""Shared auth gate for Vercel-Cron-triggered GET handlers living on
otherwise cookie-gated endpoint files (refresh_price.py, fetch_company.py,
momentum_screeners.py — see each file's do_GET for why they're folded in
here rather than their own files: the Hobby plan's 12-Serverless-
Functions-per-deployment cap, hit live 2026-08-30).

Vercel signs its own cron invocations with `Authorization: Bearer
$CRON_SECRET` whenever a CRON_SECRET env var exists on the project —
that's what this checks, instead of the usual cookie (cron requests
carry no browser cookie). Fails closed if CRON_SECRET isn't set, same
stance _auth.py takes for APP_PASSWORD."""
import os


def is_authed_cron(handler) -> bool:
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return False
    header = handler.headers.get("Authorization", "")
    return header == f"Bearer {secret}"
