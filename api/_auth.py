"""Cookie-based access gate — same threat model as the old Streamlit
app's check_password() (a single shared password, not per-user
accounts), just stateless: the cookie IS an HMAC of a fixed message
keyed by APP_PASSWORD, so any server instance can verify it without a
session store. Set APP_PASSWORD as a Vercel env var; there is no
separate signing secret to configure.
"""
import hmac
import hashlib
import os
from http.cookies import SimpleCookie

COOKIE_NAME = "vl_auth"
_MESSAGE = b"valuation-ledger-authenticated-session"


def _token() -> str:
    password = os.environ.get("APP_PASSWORD", "")
    return hmac.new(password.encode("utf-8"), _MESSAGE, hashlib.sha256).hexdigest()


def check_password(candidate: str) -> bool:
    password = os.environ.get("APP_PASSWORD", "")
    if not password:
        # No password configured — fail closed rather than open.
        return False
    return hmac.compare_digest(candidate or "", password)


def is_authed(cookie_header: str | None) -> bool:
    if not cookie_header:
        return False
    jar = SimpleCookie()
    jar.load(cookie_header)
    morsel = jar.get(COOKIE_NAME)
    if not morsel:
        return False
    return hmac.compare_digest(morsel.value, _token())


def _secure_attr() -> str:
    # "Secure" cookies are dropped by browsers/http.cookiejar on plain
    # HTTP — fine in production (Vercel deployments are always HTTPS,
    # and Vercel sets VERCEL=1 there) but it silently broke local
    # `vercel dev`/testing over http://localhost, where the cookie would
    # never come back and every request looked unauthenticated. Only
    # require it when actually deployed.
    return "; Secure" if os.environ.get("VERCEL") else ""


def set_cookie_header() -> str:
    return f"{COOKIE_NAME}={_token()}; Path=/; HttpOnly{_secure_attr()}; SameSite=Lax; Max-Age=2592000"


def clear_cookie_header() -> str:
    return f"{COOKIE_NAME}=; Path=/; HttpOnly{_secure_attr()}; SameSite=Lax; Max-Age=0"
