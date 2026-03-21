#!/usr/bin/env bash
# stop-staging.sh — Stop all staging services.

set -euo pipefail

PID_DIR="/home/user/Development/influence/staging/pids"
STAGING_APP="/home/user/Development/influence/staging/app"

# Recursively kill a process and all descendants
kill_tree() {
  local pid=$1 sig=${2:-TERM}
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

echo "=== Stopping staging services ==="

# Phase 1: PID-file based kill (tree-recursive)
for svc in api web; do
  pidfile="$PID_DIR/$svc.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "  Stopping $svc (PID $pid) tree"
      kill_tree "$pid" TERM
      for i in $(seq 1 5); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -0 "$pid" 2>/dev/null && kill_tree "$pid" 9 || true
      echo "  $svc stopped"
    else
      echo "  $svc: already stopped (stale PID)"
    fi
    rm -f "$pidfile"
  else
    echo "  $svc: not running"
  fi
done

# Phase 2: Port-based fallback — kill anything still on staging ports
for port in 4000 4001; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  Killing stale processes on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

# Phase 3: Kill orphaned processes with deleted staging CWD
orphans=""
for pid_dir in /proc/[0-9]*/cwd; do
  link=$(readlink "$pid_dir" 2>/dev/null || true)
  if echo "$link" | grep -q "$STAGING_APP.*deleted"; then
    orphan_pid=$(echo "$pid_dir" | cut -d/ -f3)
    orphans="$orphans $orphan_pid"
  fi
done
if [ -n "$orphans" ]; then
  echo "  Killing orphaned processes with stale staging CWD:$orphans"
  kill -9 $orphans 2>/dev/null || true
fi

echo "=== All staging services stopped ==="
