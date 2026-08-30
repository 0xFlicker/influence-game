#!/usr/bin/env bash
set -euo pipefail

PID_FILE="${INFLUENCE_GAME_WORKER_PID_FILE:-${TMPDIR:-/tmp}/influence-game-worker-local.pid}"
if [[ ! -r "$PID_FILE" ]]; then echo "No companion local game worker is recorded."; exit 0; fi
read -r pid recorded_start < "$PID_FILE"
current_start="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"
if [[ -z "$current_start" || "$current_start" != "$recorded_start" ]]; then
  echo "Refusing to signal an unverified PID; removing stale companion record." >&2
  rm -f "$PID_FILE"
  exit 1
fi
kill -TERM "$pid"
echo "Stopped companion local game worker $pid. Its foreground terminal may also be stopped with Ctrl-C."
