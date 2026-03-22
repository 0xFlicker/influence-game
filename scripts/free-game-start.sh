#!/usr/bin/env bash
# free-game-start.sh — Start today's free game.
#
# Calls POST /api/free-queue/start to begin the daily free game.
# Intended to run at 00:00 UTC daily via cron (1 hour after draw).
#
# Cron entry:
#   0 0 * * * /path/to/scripts/free-game-start.sh >> /var/log/free-game-start.log 2>&1
#
# Required env vars (via doppler or direct export):
#   FREE_GAME_API_URL    — API base URL (e.g. http://100.100.251.4:3000)
#   FREE_GAME_CRON_TOKEN — JWT with schedule_free_game permission
#
# Usage:
#   doppler run -- ./scripts/free-game-start.sh
#   FREE_GAME_API_URL=http://localhost:3000 FREE_GAME_CRON_TOKEN=xxx ./scripts/free-game-start.sh

set -euo pipefail

: "${FREE_GAME_API_URL:?FREE_GAME_API_URL is required}"
: "${FREE_GAME_CRON_TOKEN:?FREE_GAME_CRON_TOKEN is required}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting today's free game..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $FREE_GAME_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  "$FREE_GAME_API_URL/api/free-queue/start")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] HTTP $HTTP_CODE: $BODY"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Free game started successfully."
  exit 0
elif [ "$HTTP_CODE" -eq 404 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] No waiting free game found (draw may not have run or had insufficient players)."
  exit 0
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Start failed with HTTP $HTTP_CODE" >&2
  exit 1
fi
