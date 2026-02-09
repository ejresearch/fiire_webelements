#!/usr/bin/env bash
# Quick local server for FIIRE — needed so API calls aren't blocked by CORS
# Usage: ./serve.sh (then open http://localhost:8000/studio.html)
cd "$(dirname "$0")"
echo "FIIRE dev server → http://localhost:8000/studio.html"
python3 -m http.server 8000
