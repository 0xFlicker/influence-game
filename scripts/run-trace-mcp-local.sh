#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${INFLUENCE_PRIVATE_TRACE_ENV_FILE:-$ROOT_DIR/.env.private-trace.local}"

"$ROOT_DIR/scripts/bootstrap-test-db.sh" >&2
"$ROOT_DIR/scripts/bootstrap-private-content-s3.sh" >&2

SHARED_CONFIG="${HOUSE_LOCAL_STORAGE_CONFIG:-$HOME/.local/share/thehouse/storage/config.json}"
if [[ -f "$SHARED_CONFIG" ]]; then
  exec bun "$ROOT_DIR/scripts/with-local-storage.ts" bash -c '
    set -euo pipefail
    cd "$1/packages/api"
    DRIZZLE_MIGRATIONS_DIR=./drizzle bun run src/db/migrate.ts >&2
    exec bun run src/trace-mcp/server.ts
  ' local-trace "$ROOT_DIR"
fi

set -a
source "$ENV_FILE"
set +a

for required_var in \
  LINODE_PRIVATE_CONTENT_ENDPOINT \
  LINODE_PRIVATE_CONTENT_ACCESS_KEY \
  LINODE_PRIVATE_CONTENT_SECRET_KEY \
  LINODE_PRIVATE_CONTENT_BUCKET \
  INFLUENCE_TRACE_MCP_CURSOR_SECRET
do
  if [[ -z "${!required_var:-}" ]]; then
    echo "$required_var is required for local Trace MCP private content storage." >&2
    exit 1
  fi
done

cd "$ROOT_DIR/packages/api"

DRIZZLE_MIGRATIONS_DIR=./drizzle bun run src/db/migrate.ts >&2

exec bun run src/trace-mcp/server.ts
