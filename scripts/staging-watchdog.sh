#!/usr/bin/env bash
# staging-watchdog.sh — Cron-based watchdog for staging services.
#
# Checks if API and Web processes are alive. Restarts dead services
# with the correct Doppler config. Intended to run every minute via cron:
#
#   * * * * * /home/user/Development/influence/workspace/influence-game/scripts/staging-watchdog.sh
#
# Logs restarts to $LOG_DIR/watchdog.log

set -euo pipefail

STAGING_DIR="/home/user/Development/influence/staging"
STAGING_APP="$STAGING_DIR/app"
PID_DIR="$STAGING_DIR/pids"
LOG_DIR="$STAGING_DIR/logs"
BUN="$HOME/.bun/bin/bun"
TAILSCALE_IP="100.100.251.4"
DOPPLER_CONFIG="stg"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"

export PATH="$HOME/.bun/bin:$PATH"

log() {
  echo "[$(date -Iseconds)] $*" >> "$WATCHDOG_LOG"
}

# Exit if staging app directory doesn't exist (not deployed yet)
if [ ! -d "$STAGING_APP/packages/api" ]; then
  exit 0
fi

# Ensure directories exist
mkdir -p "$PID_DIR" "$LOG_DIR"

restart_api() {
  log "API is dead — restarting"
  cd "$STAGING_APP/packages/api"
  doppler run -c "$DOPPLER_CONFIG" -- "$BUN" run start \
    >> "$LOG_DIR/api.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_DIR/api.pid"
  log "API restarted (PID $pid)"
}

restart_web() {
  log "Web is dead — restarting"
  cd "$STAGING_APP/packages/web"
  doppler run -c "$DOPPLER_CONFIG" -- "$BUN" run start -H "$TAILSCALE_IP" -p 4001 \
    >> "$LOG_DIR/web.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_DIR/web.pid"
  log "Web restarted (PID $pid)"
}

# Check API
api_pidfile="$PID_DIR/api.pid"
if [ -f "$api_pidfile" ]; then
  api_pid=$(cat "$api_pidfile")
  if ! kill -0 "$api_pid" 2>/dev/null; then
    restart_api
  fi
else
  # No PID file — check if staging was ever deployed
  if [ -f "$STAGING_APP/packages/api/package.json" ]; then
    log "API PID file missing — restarting"
    restart_api
  fi
fi

# Check Web
web_pidfile="$PID_DIR/web.pid"
if [ -f "$web_pidfile" ]; then
  web_pid=$(cat "$web_pidfile")
  if ! kill -0 "$web_pid" 2>/dev/null; then
    restart_web
  fi
else
  if [ -f "$STAGING_APP/packages/web/package.json" ]; then
    log "Web PID file missing — restarting"
    restart_web
  fi
fi
