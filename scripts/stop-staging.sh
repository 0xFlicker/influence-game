#!/usr/bin/env bash
# stop-staging.sh — Stop all staging services.

set -euo pipefail

PID_DIR="/home/user/Development/influence/staging/pids"

echo "=== Stopping staging services ==="

for svc in api web; do
  pidfile="$PID_DIR/$svc.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "  Stopping $svc (PID $pid)"
      kill "$pid" 2>/dev/null || true
      for i in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      echo "  $svc stopped"
    else
      echo "  $svc: already stopped (stale PID)"
    fi
    rm -f "$pidfile"
  else
    echo "  $svc: not running"
  fi
done

echo "=== All staging services stopped ==="
