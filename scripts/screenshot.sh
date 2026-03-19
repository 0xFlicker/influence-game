#!/bin/bash
# Take a headless Chrome screenshot of a URL.
# Usage: ./scripts/screenshot.sh <url> [output-path] [width] [height]
#
# Examples:
#   ./scripts/screenshot.sh http://localhost:3001
#   ./scripts/screenshot.sh http://localhost:3001 /tmp/lobby.png
#   ./scripts/screenshot.sh http://localhost:3001/game/abc /tmp/game.png 1280 720
#   ./scripts/screenshot.sh https://influencer-staging.tail8a79ed.ts.net/

set -euo pipefail

URL="${1:?Usage: screenshot.sh <url> [output-path] [width] [height]}"
OUTPUT="${2:-/tmp/screenshot-$(date +%s).png}"
WIDTH="${3:-1280}"
HEIGHT="${4:-720}"

google-chrome-stable \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --screenshot="$OUTPUT" \
  --window-size="${WIDTH},${HEIGHT}" \
  "$URL" 2>/dev/null

echo "$OUTPUT"
