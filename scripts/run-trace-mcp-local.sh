#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${INFLUENCE_PRIVATE_TRACE_ENV_FILE:-$ROOT_DIR/.env.private-trace.local}"

"$ROOT_DIR/scripts/bootstrap-test-db.sh" >&2
"$ROOT_DIR/scripts/bootstrap-private-evidence-s3.sh" >&2

set -a
source "$ENV_FILE"
set +a

cd "$ROOT_DIR/packages/api"

DRIZZLE_MIGRATIONS_DIR=./drizzle bun run src/db/migrate.ts >&2

exec bun run src/trace-mcp/server.ts
