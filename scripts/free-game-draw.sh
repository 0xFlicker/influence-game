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
#
# Usage:
#   doppler run -- ./scripts/free-game-draw.sh
#   FREE_GAME_API_URL=http://localhost:3000 FREE_GAME_CRON_TOKEN=xxx ./scripts/free-game-draw.sh

set -euo pipefail

: "${FREE_GAME_API_URL:?FREE_GAME_API_URL is required}"
: "${FREE_GAME_CRON_TOKEN:?FREE_GAME_CRON_TOKEN is required}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting free game draw..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $FREE_GAME_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  "$FREE_GAME_API_URL/api/free-queue/draw")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] HTTP $HTTP_CODE: $BODY"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Draw completed successfully."
  exit 0
elif [ "$HTTP_CODE" -eq 200 ]; then
  # 200 = idempotent (game already exists for today) or not enough players
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Draw skipped (already done or insufficient players)."
  exit 0
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Draw failed with HTTP $HTTP_CODE" >&2
  exit 1
fi
