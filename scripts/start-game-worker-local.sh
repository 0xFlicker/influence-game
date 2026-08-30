#!/usr/bin/env bash
set -euo pipefail

if [[ "${INFLUENCE_GAME_WORKER:-}" != "1" ]]; then
  echo "Refusing to start a durable game worker without explicit opt-in." >&2
  echo "Run: INFLUENCE_GAME_WORKER=1 bun run dev:game-worker" >&2
  exit 1
fi
if [[ "${DATABASE_URL:-}" != postgresql://*@127.0.0.1:54320/influence_rehearsal_* ]]; then
  echo "Refusing worker start: DATABASE_URL must be an explicit local influence_rehearsal_* database." >&2
  exit 1
fi

PID_FILE="${INFLUENCE_GAME_WORKER_PID_FILE:-${TMPDIR:-/tmp}/influence-game-worker-local.pid}"
if [[ -e "$PID_FILE" ]]; then echo "Refusing worker start: PID record already exists: $PID_FILE" >&2; exit 1; fi
printf '%s %s\n' "$$" "$(ps -p $$ -o lstart=)" > "$PID_FILE"
cleanup() { rm -f "$PID_FILE"; }
trap cleanup EXIT INT TERM

env PORT="${REHEARSAL_WORKER_PORT:-3101}" INFLUENCE_API_ROLE=game-worker \
  POSTGAME_MEDIA_PUBLIC_BASE_URL="http://127.0.0.1:${REHEARSAL_WORKER_PORT:-3101}" \
  bun run dev:api:service
