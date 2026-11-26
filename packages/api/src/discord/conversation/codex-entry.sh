#!/bin/sh
set -eu
# The container has only loopback. The turn socket reaches the trusted host bridge.
socat TCP-LISTEN:18791,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/bridge/turn.sock &
mkdir -p /tmp/codex /tmp/work
cp /opt/house/codex.toml /tmp/codex/config.toml
export CODEX_HOME=/tmp/codex
mode="$1"
case "$mode" in
  reply)
    cp /opt/house/AGENTS.md /tmp/work/AGENTS.md
    exec codex exec -c 'model_instructions_file="/opt/house/SOUL.md"' --skip-git-repo-check --ephemeral --cd /tmp/work --model "$2" --output-schema /bridge/reply.json -
    ;;
  consent) exec codex exec -c 'model_instructions_file="/opt/house/CONSENT.md"' --skip-git-repo-check --ephemeral --cd /tmp/work --model "$2" -c 'model_reasoning_effort="none"' -c mcp_servers.house.enabled=false --output-schema /bridge/consent.json - ;;
  *) exit 2 ;;
esac
