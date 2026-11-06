#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
name="public-shelf-perf-$(date +%s)-$$"
container=""
cleanup() { if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
container="$(docker run --rm -d --name "$name" -e POSTGRES_USER=influence \
  -e POSTGRES_PASSWORD=influence -e POSTGRES_DB=influence_test -p 127.0.0.1::5432 postgres:16)"
for attempt in $(seq 1 30); do
  if docker exec "$container" pg_isready -U influence -d influence_test >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 30 ]; then echo "Isolated database did not become ready" >&2; exit 1; fi
  sleep 1
done
port="$(docker port "$container" 5432/tcp | sed -n 's/^127\.0\.0\.1://p')"
[[ "$port" =~ ^[0-9]+$ ]] || { echo "Unexpected isolated database port" >&2; exit 1; }
url="postgresql://influence:influence@127.0.0.1:${port}/influence_test"
TEST_DATABASE_URL="$url" JWT_SECRET="public-shelf-test-only-secret" bun test --max-concurrency 1 packages/api/src/__tests__/games-initial-shelf.test.ts packages/api/src/__tests__/episode-presentation.test.ts
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U influence -d influence_test < scripts/perf/public-games-fixture.sql
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U influence -d influence_test < scripts/perf/public-games-plan.sql
PUBLIC_SHELF_BENCHMARK_URL="$url" bun scripts/perf/public-games-benchmark.ts
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U influence -d influence_test < scripts/perf/season-episode-fixture.sql
PUBLIC_SHELF_BENCHMARK_URL="$url" bun packages/api/src/scripts/benchmark-season-episode.ts
