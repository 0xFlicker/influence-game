#!/usr/bin/env bash
# free-game-draw.sh — Daily draw for the free game queue.
#
# Calls POST /api/free-queue/draw to pick players and create a game.
# Intended to run at 23:00 UTC daily via cron.
#
# Cron entry:
#   0 23 * * * /path/to/scripts/free-game-draw.sh >> /var/log/free-game-draw.log 2>&1
#
# Required env vars (via doppler or direct export):
#   FREE_GAME_API_URL    — API base URL (e.g. http://100.100.251.4:3000)
#   FREE_GAME_CRON_TOKEN — JWT with schedule_free_game permission
# Optional env vars:
#   FREE_GAME_DRAW_KEY   — stable retry key; reuse the missed schedule key for recovery
#
# Usage:
#   doppler run -- ./scripts/free-game-draw.sh
#   FREE_GAME_API_URL=http://localhost:3000 FREE_GAME_CRON_TOKEN=xxx ./scripts/free-game-draw.sh

set -euo pipefail

: "${FREE_GAME_API_URL:?FREE_GAME_API_URL is required}"
: "${FREE_GAME_CRON_TOKEN:?FREE_GAME_CRON_TOKEN is required}"

if [ -z "${FREE_GAME_DRAW_KEY:-}" ]; then
  if command -v uuidgen >/dev/null 2>&1; then
    DRAW_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    DRAW_UUID=$(tr '[:upper:]' '[:lower:]' < /proc/sys/kernel/random/uuid)
  else
    echo "Set FREE_GAME_DRAW_KEY because no UUID generator is available." >&2
    exit 1
  fi
  FREE_GAME_DRAW_KEY="daily-free:manual:$DRAW_UUID"
fi

if [ "${#FREE_GAME_DRAW_KEY}" -gt 200 ] || ! printf '%s' "$FREE_GAME_DRAW_KEY" | grep -q '[^[:space:]]'; then
  echo "FREE_GAME_DRAW_KEY must contain between 1 and 200 characters." >&2
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting free game draw..."
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Idempotency key: $FREE_GAME_DRAW_KEY"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $FREE_GAME_CRON_TOKEN" \
  -H "Idempotency-Key: $FREE_GAME_DRAW_KEY" \
  -H "Content-Type: application/json" \
  "$FREE_GAME_API_URL/api/free-queue/draw")

HTTP_CODE=${RESPONSE##*$'\n'}
BODY=${RESPONSE%$'\n'*}

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] HTTP $HTTP_CODE: $BODY"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Draw completed successfully."
  exit 0
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Draw failed with HTTP $HTTP_CODE" >&2
  exit 1
fi
