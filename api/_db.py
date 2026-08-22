"""Shared Postgres helper for the /api serverless functions.

Files prefixed with "_" aren't turned into their own Vercel Serverless
Functions (same underscore convention as everywhere else in Vercel's
zero-config file routing) — this module is imported by the real
endpoints, not deployed as one itself.

Schema is plain JSONB blobs keyed by ticker, not a normalized relational
model — deliberately mirrors the old cache/*.json file-per-concern
layout (stocks / scenarios / guidance / last_refresh) this replaces, so
migrating the existing data is a straight load-and-insert (see
scripts/migrate_from_json.py) rather than a field-by-field remap. A
Postgres row read/write is milliseconds; the old app's slowness was
Streamlit's rerun model plus a synchronous GitHub Contents API round
trip per save, not the data being JSON-shaped.
"""
import os
import psycopg2
import psycopg2.extras

_DDL = """
CREATE TABLE IF NOT EXISTS stocks (
  ticker TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scenarios (
  ticker TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS guidance (
  ticker TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
"""

_schema_ready = False


def get_conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL (or POSTGRES_URL) env var is not set")
    # "prefer" (not "require"): hosted Postgres (Vercel Postgres/Neon,
    # Supabase, etc.) all enforce SSL server-side regardless, so this
    # still ends up encrypted against them — but it also lets a local
    # Postgres with no SSL configured work for `vercel dev`/local testing
    # without a separate connection string just for that case.
    conn = psycopg2.connect(url, sslmode="prefer", connect_timeout=10)
    global _schema_ready
    if not _schema_ready:
        with conn.cursor() as cur:
            cur.execute(_DDL)
        conn.commit()
        _schema_ready = True
    return conn


def get_json(conn, table, key):
    with conn.cursor() as cur:
        cur.execute(f"SELECT data FROM {table} WHERE ticker = %s", (key,))
        row = cur.fetchone()
        return row[0] if row else None


def get_all_json(conn, table):
    with conn.cursor() as cur:
        cur.execute(f"SELECT ticker, data FROM {table}")
        return {ticker: data for ticker, data in cur.fetchall()}


def upsert_json(conn, table, key, data):
    with conn.cursor() as cur:
        cur.execute(
            f"""INSERT INTO {table} (ticker, data, updated_at) VALUES (%s, %s, now())
                ON CONFLICT (ticker) DO UPDATE SET data = EXCLUDED.data, updated_at = now()""",
            (key, psycopg2.extras.Json(data)),
        )
    conn.commit()


def delete_json(conn, table, key):
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {table} WHERE ticker = %s", (key,))
    conn.commit()


def get_meta(conn, key, default=None):
    with conn.cursor() as cur:
        cur.execute("SELECT data FROM meta WHERE key = %s", (key,))
        row = cur.fetchone()
        return row[0] if row else default


def set_meta(conn, key, data):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO meta (key, data) VALUES (%s, %s)
               ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data""",
            (key, psycopg2.extras.Json(data)),
        )
    conn.commit()
