#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${INFLUENCE_PRIVATE_TRACE_ENV_FILE:-$ROOT_DIR/.env.private-trace.local}"

"$ROOT_DIR/scripts/bootstrap-test-db.sh"
"$ROOT_DIR/scripts/bootstrap-private-content-s3.sh"

set -a
source "$ENV_FILE"
set +a

for required_var in \
  LINODE_PRIVATE_CONTENT_ENDPOINT \
  LINODE_PRIVATE_CONTENT_ACCESS_KEY \
  LINODE_PRIVATE_CONTENT_SECRET_KEY \
  LINODE_PRIVATE_CONTENT_BUCKET
do
  if [[ -z "${!required_var:-}" ]]; then
    echo "$required_var is required for local private content S3 smoke validation." >&2
    exit 1
  fi
done

export INFLUENCE_PRIVATE_TRACE_S3_SMOKE=1

cd "$ROOT_DIR"
bun test packages/api/src/__tests__/private-trace-local-s3-smoke.test.ts
