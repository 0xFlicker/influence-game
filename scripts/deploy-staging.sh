#!/usr/bin/env bash
# deploy-staging.sh — Deploy a tagged release to the staging environment.
#
# Usage:
#   ./scripts/deploy-staging.sh [version-tag]
#
# If no tag is provided, deploys the latest annotated tag.
# Staging binds to the Tailscale IP (100.100.251.4) only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
STAGING_DIR="/home/user/Development/influence/staging"
STAGING_APP="$STAGING_DIR/app"
STAGING_DATA="$STAGING_DIR/data"
PID_DIR="$STAGING_DIR/pids"
LOG_DIR="$STAGING_DIR/logs"
BUN="$HOME/.bun/bin/bun"
TAILSCALE_IP="100.100.251.4"
DOPPLER_CONFIG="stg"

# Resolve version tag
if [ -n "${1:-}" ]; then
  TAG="$1"
else
  TAG=$(cd "$REPO_DIR" && git describe --tags --abbrev=0 2>/dev/null || echo "")
  if [ -z "$TAG" ]; then
    echo "ERROR: No tags found. Pass a version tag as argument."
    exit 1
  fi
fi

echo "=== Deploying $TAG to staging ==="
echo "  Repo:     $REPO_DIR"
echo "  Staging:  $STAGING_APP"
echo "  Data:     $STAGING_DATA"
echo "  Bind:     $TAILSCALE_IP"
echo ""

# Create directories
mkdir -p "$STAGING_APP" "$STAGING_DATA" "$PID_DIR" "$LOG_DIR"

# Stop existing services — kill full process tree + port-based fallback
echo "--- Stopping existing services ---"

# Helper: recursively kill a process and all descendants
kill_tree() {
  local pid=$1 sig=${2:-TERM}
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

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
    fi
    rm -f "$pidfile"
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

# Phase 4: Wait for ports to be free (up to 5s)
for port in 4000 4001; do
  for i in $(seq 1 5); do
    lsof -ti :"$port" >/dev/null 2>&1 || break
    sleep 1
    if [ "$i" -eq 5 ]; then
      echo "  WARNING: Port $port still occupied after 5s"
    fi
  done
done

# Checkout the tag using git worktree (or update existing)
echo "--- Checking out $TAG ---"
cd "$REPO_DIR"
git fetch --tags 2>/dev/null || true

# Verify the tag exists
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "ERROR: Tag $TAG not found."
  exit 1
fi

# Remove old worktree if it exists and re-create
if [ -d "$STAGING_APP/.git" ] || [ -f "$STAGING_APP/.git" ]; then
  git worktree remove "$STAGING_APP" --force 2>/dev/null || true
fi
# Clean up any stale worktree references
git worktree prune 2>/dev/null || true
rm -rf "$STAGING_APP"

git worktree add "$STAGING_APP" "$TAG"
echo "  Checked out $(cd "$STAGING_APP" && git describe --tags --always)"

# Install dependencies
echo "--- Installing dependencies ---"
cd "$STAGING_APP"
$BUN install --frozen-lockfile 2>/dev/null || $BUN install

# Run database migrations
echo "--- Running database migrations ---"
cd "$STAGING_APP/packages/api"
doppler run -c "$DOPPLER_CONFIG" -- $BUN run db:migrate

# Build web frontend
echo "--- Building web frontend ---"
cd "$STAGING_APP/packages/web"
doppler run -c "$DOPPLER_CONFIG" -- $BUN run build

# Start API server (tailnet-only)
echo "--- Starting API server ---"
cd "$STAGING_APP/packages/api"
doppler run -c "$DOPPLER_CONFIG" -- $BUN run start \
  > "$LOG_DIR/api.log" 2>&1 &
API_PID=$!
echo "$API_PID" > "$PID_DIR/api.pid"
echo "  API started (PID $API_PID) — http://$TAILSCALE_IP:4000"

# Start Web server (tailnet-only)
echo "--- Starting web server ---"
cd "$STAGING_APP/packages/web"
doppler run -c "$DOPPLER_CONFIG" -- $BUN run start -H "$TAILSCALE_IP" -p 4001 \
  > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
echo "$WEB_PID" > "$PID_DIR/web.pid"
echo "  Web started (PID $WEB_PID) — http://$TAILSCALE_IP:4001"

# Health check (wait up to 15s for each service)
echo "--- Health check ---"
for i in $(seq 1 15); do
  if curl -sf "http://$TAILSCALE_IP:4000/health" >/dev/null 2>&1; then
    echo "  API healthy"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "  WARNING: API health check failed after 15s. Check $LOG_DIR/api.log"
  fi
  sleep 1
done

for i in $(seq 1 15); do
  if curl -sf "http://$TAILSCALE_IP:4001/" >/dev/null 2>&1; then
    echo "  Web healthy"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "  WARNING: Web health check failed after 15s. Check $LOG_DIR/web.log"
  fi
  sleep 1
done

echo ""
echo "=== Staging deployed: $TAG ==="
echo "  API:  http://$TAILSCALE_IP:4000"
echo "  Web:  http://$TAILSCALE_IP:4001"
echo "  Logs: $LOG_DIR/"
echo "  PIDs: $PID_DIR/"
