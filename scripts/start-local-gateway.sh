#!/usr/bin/env bash
set -euo pipefail

if [[ "${DATABASE_URL:-}" != postgresql://*@127.0.0.1:54320/influence_rehearsal_* ]]; then
  echo "Refusing gateway start: DATABASE_URL must be an explicit local influence_rehearsal_* database." >&2
  exit 1
fi

exec env PORT="${GATEWAY_PORT:-3100}" INFLUENCE_API_ROLE=gateway \
  POSTGAME_MEDIA_PUBLIC_BASE_URL="http://127.0.0.1:${GATEWAY_PORT:-3100}" \
  bun run dev:api:service
