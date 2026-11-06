#!/usr/bin/env bash
# Synthetic, isolated PostgreSQL benchmark. Never connects to an existing DB.
set -euo pipefail
cd "$(dirname "$0")/.."
name="history-perf-$(date +%s)-$$"
container=""
cleanup() { if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
container="$(docker run --rm -d --name "$name" -e POSTGRES_USER=influence \
  -e POSTGRES_PASSWORD=influence -e POSTGRES_DB=influence_test \
  -p 127.0.0.1::5432 postgres:16)"
for attempt in $(seq 1 30); do
  if docker exec "$container" pg_isready -U influence -d influence_test >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 30 ]; then echo "Isolated database did not become ready" >&2; exit 1; fi
  sleep 1
done
port="$(docker port "$container" 5432/tcp | sed -n 's/^127\.0\.0\.1://p')"
[[ "$port" =~ ^[0-9]+$ ]] || { echo "Unexpected isolated database port" >&2; exit 1; }
url="postgresql://influence:influence@127.0.0.1:${port}/influence_test"
# setupTestDB migrates and truncates only the disposable container above.
TEST_DATABASE_URL="$url" bun test packages/api/src/__tests__/house-participation.test.ts
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U influence -d influence_test < scripts/perf/history-fixture.sql
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U influence -d influence_test < scripts/perf/history-plans.sql
HISTORY_BENCHMARK_URL="$url" bun scripts/perf/history-benchmark.ts
