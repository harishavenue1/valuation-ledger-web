# Valuation Ledger — fast web version

A rebuild of the [Valuation Ledger](https://github.com/harishavenue1/valuation-ledger) Streamlit
app as a proper React + Postgres web app on Vercel — no cold-sleep, no full-page rerun per click,
no synchronous GitHub API write blocking every save.

**Stack:**
- Frontend: React + TypeScript + Vite + Tailwind, static-built and served from Vercel's CDN.
- Backend: Python serverless functions under `api/` (one file per endpoint, Vercel's zero-config
  Python runtime — no framework).
- Data: Postgres (JSONB blobs, one row per ticker per table — mirrors the old app's
  `cache/*.json` layout so migration is a straight load).
- Fetching: `api/_screener_fetch.py` is an unmodified copy of the old app's `screener_fetch.py` —
  same Screener.in scraping/parsing logic, works fully anonymously (no session cookie needed).
- Compute: `src/lib/model.ts` is a line-for-line TypeScript port of `app.py`'s
  `compute_model()`/`headline_cagr()`/`default_case_state()` — same formulas, same sequencing.
  Runs entirely client-side, so every scenario edit recomputes CAGR instantly with zero
  round-trip; only the save itself (debounced 500ms) goes to the server.

## Why this is actually faster

The old Streamlit Community Cloud deploy was slow for three concrete reasons, not just "Streamlit
is slow" in the abstract:
1. **Cold-sleep** — the free tier sleeps after inactivity; first visit costs 30-60s waking it up.
2. **Full-script rerun** — Streamlit reruns the entire `app.py` top to bottom on every click/input.
3. **Synchronous GitHub Contents API sync** — every scenario edit did a live GitHub API write
   before the UI could update.

This version has none of those: Vercel's static hosting has no cold-sleep, React only re-renders
what changed, and scenario saves are a single async Postgres upsert (milliseconds), debounced so a
burst of edits costs one write.

## Local development

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and APP_PASSWORD
npm i -g vercel        # if you don't already have it
vercel dev             # serves both the Vite frontend and /api/*.py together
```

`vercel dev` will ask you to log in to Vercel and link the project the first time — that's a
one-time setup step, do it yourself in the terminal.

`npm run dev` alone (Vite only, no API) also works for pure frontend iteration — it'll show the
login screen since there's no backend to authenticate against.

## One-time setup to deploy

You'll need to do these yourself (account creation, secrets, and the first deploy are not
something I can do on your behalf):

1. **Push this repo to GitHub** (a new repo, e.g. `valuation-ledger-web`).
2. **Create a Vercel account** (if you don't have one) at vercel.com and import the GitHub repo.
3. **Add a Postgres database** — easiest is Vercel's own Storage tab (Vercel Postgres, powered by
   Neon): Project → Storage → Create Database → Postgres. This auto-populates `DATABASE_URL` (or
   `POSTGRES_URL`) as a project env var — nothing more to wire up. Supabase/Neon directly also
   work fine; just set `DATABASE_URL` yourself in Project → Settings → Environment Variables.
4. **Set `APP_PASSWORD`** under Project → Settings → Environment Variables — pick whatever
   password you want to gate the site with.
5. **Migrate the existing data** (16 companies, scenarios, guidance) from the old repo:
   ```bash
   cd scripts
   DATABASE_URL="<paste the same connection string>" ../.venv/bin/python migrate_from_json.py
   ```
   Run this once, from your own machine, pointed at the real deployed database — it reads
   `~/valuation-ledger/cache/*.json` and inserts everything.
6. **Deploy** — push to GitHub (Vercel auto-deploys on push once the repo is imported), or run
   `vercel --prod` from this directory.
7. Visit the deployed URL, log in with `APP_PASSWORD`, confirm all 16 companies are there.

## Project layout

```
src/
  lib/model.ts     compute engine (CAGR/EPS/PBT math) — client-side, no server round-trip
  lib/api.ts        typed fetch wrappers for /api/*
  pages/            Summary, Companies, Detail, Settings, Login
api/
  _db.py            Postgres helpers (shared, not a route — see the underscore convention below)
  _auth.py          cookie-based password gate
  _screener_fetch.py  unmodified copy of the old app's Screener.in fetch/parse logic
  _http.py          small JSON request/response + auth-guard helpers
  login.py          POST (check password, set cookie) / DELETE (log out)
  stocks.py         GET — the one bootstrap payload the frontend loads on first render
  fetch_company.py  POST (full fetch+add) / DELETE (remove) / PATCH (toggle owned)
  refresh_price.py  POST — price-only refresh for one ticker
  scenario.py       POST — save one case's driver state for one ticker
  guidance.py       POST — save management-guidance research for one ticker
scripts/
  migrate_from_json.py   one-off loader from the old repo's cache/*.json into Postgres
```

Files under `api/` prefixed with `_` are shared modules, not routes — Vercel's zero-config file
routing skips underscore-prefixed files when deciding what becomes a Serverless Function.

## What's intentionally different from the old app

- **No GitHub sync** — Postgres is the only store; no `GITHUB_TOKEN`, no Contents API, no
  "why did my edit disappear on redeploy" (the original reason the old app needed GitHub sync in
  the first place — Streamlit Cloud's container disk is ephemeral; Vercel + a real database isn't).
- **"Refresh all prices" runs in parallel** (5 tickers at a time, client-orchestrated) instead of
  one long server-side loop — keeps each serverless call well inside its timeout and finishes
  faster besides.
- **Settings** no longer has a Screener.in session-cookie field — fetching has worked fully
  anonymously since 2026-08-15 (verified against both a large-cap and a micro-cap SME ticker), so
  there's nothing to configure there anymore.
