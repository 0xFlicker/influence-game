#!/usr/bin/env bash
set -euo pipefail

if [[ "${INFLUENCE_GAME_WORKER:-}" != "1" ]]; then
  echo "Refusing to start a durable game worker without explicit opt-in." >&2
  echo "Run: INFLUENCE_GAME_WORKER=1 bun run dev:game-worker" >&2
  exit 1
fi

exec doppler run --project social-strategy-agent --config dev -- \
  env "PORT=${GAME_WORKER_PORT:-3002}" \
  INFLUENCE_API_ROLE=game-worker \
  "POSTGAME_MEDIA_WORKER_TOKEN=${POSTGAME_MEDIA_WORKER_TOKEN:-local-render-worker}" \
  "POSTGAME_MEDIA_PUBLIC_BASE_URL=${POSTGAME_MEDIA_PUBLIC_BASE_URL:-http://127.0.0.1:3000}" \
  bun run dev:api:service
