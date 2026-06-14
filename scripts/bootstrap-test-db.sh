#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${INFLUENCE_POSTGRES_CONTAINER:-influence-postgres}"
IMAGE="${INFLUENCE_POSTGRES_IMAGE:-postgres:16}"
HOST_PORT="${INFLUENCE_POSTGRES_PORT:-54320}"
POSTGRES_USER="${POSTGRES_USER:-influence}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-influence}"
DEV_DB="${INFLUENCE_DEV_DB:-influence_dev}"
TEST_DB="${INFLUENCE_TEST_DB:-influence_test}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to bootstrap the local Influence Postgres container." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  if ! docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    docker start "$CONTAINER_NAME" >/dev/null
  fi
else
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB="$DEV_DB" \
    -p "${HOST_PORT}:5432" \
    "$IMAGE" >/dev/null
fi

for _ in {1..30}; do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; then
  echo "Postgres container '$CONTAINER_NAME' did not become ready." >&2
  exit 1
fi

ensure_database() {
  local db_name="$1"
  case "$db_name" in
    ""|*[!a-zA-Z0-9_]*)
      echo "Unsafe database name: $db_name" >&2
      exit 1
      ;;
  esac

  local exists
  exists="$(
    docker exec "$CONTAINER_NAME" \
      psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" \
      | tr -d '[:space:]'
  )"

  if [[ "$exists" != "1" ]]; then
    docker exec "$CONTAINER_NAME" createdb -U "$POSTGRES_USER" "$db_name"
  fi
}

ensure_database "$DEV_DB"
ensure_database "$TEST_DB"

cat <<EOF
Local Postgres is ready.

Dev database:
  postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${HOST_PORT}/${DEV_DB}

Test database:
  postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${HOST_PORT}/${TEST_DB}
EOF
