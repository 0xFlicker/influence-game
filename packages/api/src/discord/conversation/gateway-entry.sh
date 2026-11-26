#!/bin/sh
set -eu
/opt/house-discord/house-discord-relay &
relay=$!
/opt/house-discord/bun /opt/house-discord/gateway.ts &
gateway=$!
shutdown() {
  kill -TERM "$gateway" 2>/dev/null || true
  wait "$gateway" || true
  kill -TERM "$relay" 2>/dev/null || true
}
trap shutdown TERM INT
while kill -0 "$relay" 2>/dev/null && kill -0 "$gateway" 2>/dev/null; do sleep 2; done
shutdown
exit 1
