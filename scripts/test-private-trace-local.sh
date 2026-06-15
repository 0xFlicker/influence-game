#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${INFLUENCE_PRIVATE_TRACE_ENV_FILE:-$ROOT_DIR/.env.private-trace.local}"

"$ROOT_DIR/scripts/bootstrap-test-db.sh"
"$ROOT_DIR/scripts/bootstrap-private-evidence-s3.sh"

set -a
source "$ENV_FILE"
set +a

export INFLUENCE_PRIVATE_TRACE_S3_SMOKE=1

cd "$ROOT_DIR"
bun test packages/api/src/__tests__/private-trace-local-s3-smoke.test.ts
