#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONTAINER_NAME="${INFLUENCE_MINIO_CONTAINER:-influence-private-evidence-s3}"
MINIO_IMAGE="${INFLUENCE_MINIO_IMAGE:-quay.io/minio/minio:latest}"
HOST_PORT="${INFLUENCE_MINIO_PORT:-19000}"
CONSOLE_PORT="${INFLUENCE_MINIO_CONSOLE_PORT:-19001}"
ROOT_USER="${MINIO_ROOT_USER:-influence}"
ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-influence-private}"
PRIVATE_BUCKET="${LINODE_PRIVATE_EVIDENCE_BUCKET:-influence-private-evidence-local}"
ENV_FILE="${INFLUENCE_PRIVATE_TRACE_ENV_FILE:-$ROOT_DIR/.env.private-trace.local}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to bootstrap the local private evidence S3 endpoint." >&2
  exit 1
fi

case "$PRIVATE_BUCKET" in
  *[!a-z0-9.-]*|.*|*.)
    echo "Unsafe bucket name: $PRIVATE_BUCKET" >&2
    exit 1
    ;;
esac

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  if ! docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    docker start "$CONTAINER_NAME" >/dev/null
  fi
else
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e MINIO_ROOT_USER="$ROOT_USER" \
    -e MINIO_ROOT_PASSWORD="$ROOT_PASSWORD" \
    -p "${HOST_PORT}:9000" \
    -p "${CONSOLE_PORT}:9001" \
    "$MINIO_IMAGE" server /data --console-address ":9001" >/dev/null
fi

endpoint="http://127.0.0.1:${HOST_PORT}"

for _ in {1..30}; do
  if curl -fsS "$endpoint/minio/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "$endpoint/minio/health/ready" >/dev/null 2>&1; then
  echo "Local private evidence S3 endpoint '$CONTAINER_NAME' did not become ready." >&2
  exit 1
fi

LINODE_PRIVATE_EVIDENCE_ENDPOINT="$endpoint" \
LINODE_PRIVATE_EVIDENCE_ACCESS_KEY="$ROOT_USER" \
LINODE_PRIVATE_EVIDENCE_SECRET_KEY="$ROOT_PASSWORD" \
LINODE_PRIVATE_EVIDENCE_BUCKET="$PRIVATE_BUCKET" \
  bun run "$ROOT_DIR/packages/api/src/scripts/ensure-private-evidence-bucket.ts"

cat > "$ENV_FILE" <<EOF
LINODE_PRIVATE_EVIDENCE_ENDPOINT=$endpoint
LINODE_PRIVATE_EVIDENCE_ACCESS_KEY=$ROOT_USER
LINODE_PRIVATE_EVIDENCE_SECRET_KEY=$ROOT_PASSWORD
LINODE_PRIVATE_EVIDENCE_BUCKET=$PRIVATE_BUCKET
EOF

cat <<EOF
Local private evidence S3 is ready.

Endpoint:
  $endpoint

Private evidence bucket:
  $PRIVATE_BUCKET

Environment written to:
  $ENV_FILE

Load it for API/Trace MCP commands with:
  set -a
  source "$ENV_FILE"
  set +a
EOF
