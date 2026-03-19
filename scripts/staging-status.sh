#!/usr/bin/env bash
# staging-status.sh — Check the status of staging services.

set -euo pipefail

STAGING_DIR="/home/user/Development/influence/staging"
PID_DIR="$STAGING_DIR/pids"
LOG_DIR="$STAGING_DIR/logs"
TAILSCALE_IP="100.100.251.4"

echo "=== Staging Status ==="

# Check version
if [ -d "$STAGING_DIR/app" ]; then
  VERSION=$(cd "$STAGING_DIR/app" && git describe --tags --always 2>/dev/null || echo "unknown")
  echo "  Version: $VERSION"
else
  echo "  Version: not deployed"
fi

# Check services
for svc in api web; do
  pidfile="$PID_DIR/$svc.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "  $svc: running (PID $pid)"
    else
      echo "  $svc: dead (stale PID $pid)"
    fi
  else
    echo "  $svc: not running"
  fi
done

# Health check
if curl -sf "http://$TAILSCALE_IP:4000/health" >/dev/null 2>&1; then
  echo "  API health: OK"
else
  echo "  API health: FAIL"
fi

# Log tails
echo ""
for svc in api web; do
  logfile="$LOG_DIR/$svc.log"
  if [ -f "$logfile" ]; then
    echo "--- Last 5 lines of $svc log ---"
    tail -5 "$logfile"
    echo ""
  fi
done
