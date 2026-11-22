#!/bin/bash
# Start the local API (port 3000) and the web page (http://localhost:5173) together. Ctrl+C stops both.
cd "$(dirname "$0")/.."
.venv/bin/python scripts/local_server.py &
API=$!
trap "kill $API 2>/dev/null" EXIT
npm run dev -- --host 127.0.0.1
