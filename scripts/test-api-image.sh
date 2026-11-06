#!/usr/bin/env bash
set -euo pipefail

# Isolated, provider-free verification of the actual deployment image. No host
# ports, existing databases, Doppler values or provider credentials are used.
image="${1:?Usage: test-api-image.sh <image>}"
scope="influence-api-check-$$-${RANDOM}"
db="${scope}-db"
api="${scope}-api"
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    docker logs "$api" 2>/dev/null || true
    docker logs "$db" 2>/dev/null || true
  fi
  docker rm -fv "$api" "$db" >/dev/null 2>&1 || true
  docker network rm "$scope" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker network create --internal "$scope" >/dev/null
docker run --rm --network none --entrypoint bun "$image" dist/check-visual-runtime.js
docker run --rm --network none --entrypoint bun "$image" dist/check-audio-runtime.js
docker run -d --name "$db" --network "$scope" \
  -e POSTGRES_USER=influence -e POSTGRES_PASSWORD=fixture-only \
  -e POSTGRES_DB=image_check postgres:16 >/dev/null
for attempt in {1..60}; do
  # The entrypoint's temporary initialization server accepts Unix sockets
  # before restarting. TCP is available only on the final server.
  if docker exec "$db" pg_isready -h 127.0.0.1 -U influence -d image_check >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$db" pg_isready -h 127.0.0.1 -U influence -d image_check

# Exercise the actual commands packaged in this candidate image against the
# isolated database. Migrations install the lookup functions; the index build
# must run outside their transaction. The check must fail closed before build.
fixture_database_url="postgresql://influence:fixture-only@${db}:5432/image_check"
docker run --rm --network "$scope" -e DATABASE_URL="$fixture_database_url" \
  --entrypoint bun "$image" dist/migrate.js
if check_output="$(docker run --rm --network "$scope" -e DATABASE_URL="$fixture_database_url" \
  --entrypoint bun "$image" dist/public-browse-indexes.js --check 2>&1)"; then
  echo "Browse index check unexpectedly passed before the indexes were built" >&2
  exit 1
fi
if [[ "$check_output" != *"Required index games_public_browse_order_idx is missing"* ]]; then
  echo "Browse index check failed for an unexpected reason: $check_output" >&2
  exit 1
fi
index_count="$(docker exec "$db" psql -U influence -d image_check -Atqc \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('games_public_browse_order_idx', 'games_public_browse_kind_idx', 'games_public_browse_status_idx', 'games_public_browse_season_idx', 'games_public_browse_kind_status_idx')")"
if [ "$index_count" != 0 ]; then
  echo "Browse index check unexpectedly created indexes" >&2
  exit 1
fi
docker run --rm --network "$scope" -e DATABASE_URL="$fixture_database_url" \
  --entrypoint bun "$image" dist/public-browse-indexes.js
docker run --rm --network "$scope" -e DATABASE_URL="$fixture_database_url" \
  --entrypoint bun "$image" dist/public-browse-indexes.js --check
# A second build must safely recognize the verified existing definitions.
docker run --rm --network "$scope" -e DATABASE_URL="$fixture_database_url" \
  --entrypoint bun "$image" dist/public-browse-indexes.js

echo "Packaged browse indexes built and verified against the isolated database"

for role in gateway game-worker; do
  docker run -d --name "$api" --network "$scope" \
    -e DATABASE_URL="$fixture_database_url" \
    -e GIT_SHA=1111111111111111111111111111111111111111 \
    -e PRIVY_APP_ID=image-check -e PRIVY_APP_SECRET=fixture-only \
    -e JWT_SECRET=provider-free-image-check-secret-only \
    -e ADMIN_ADDRESS=0x1111111111111111111111111111111111111111 \
    -e MANAGED_AUTH_MODE=disabled -e INFLUENCE_API_STARTUP_MODE=validation \
    -e INFLUENCE_API_ROLE="$role" -e INFLUENCE_DEPLOYMENT_ENVIRONMENT=prod "$image" >/dev/null
  healthy=false
  for attempt in {1..120}; do
    if docker exec "$api" bun -e '
      const response = await fetch("http://127.0.0.1:3001/health", { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (!response.ok || health.status !== "ok" || health.runtimeRole !== process.env.INFLUENCE_API_ROLE || health.releaseControl.runtimeState !== "validation") process.exit(1);
    ' >/dev/null 2>&1; then healthy=true; break; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$api")" != true ]; then break; fi
    sleep 1
  done
  if [ "$healthy" != true ]; then echo "API image failed startup: $role" >&2; exit 1; fi
  echo "API image healthy in validation mode: $role"
  docker rm -fv "$api" >/dev/null
done
