#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
name="history-page-perf-$(date +%s)-$$"
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
games_per_kind="${HISTORY_BENCHMARK_GAMES_PER_KIND:-1000}"
[[ "$games_per_kind" =~ ^[0-9]+$ ]] && (( games_per_kind >= 1000 && games_per_kind <= 100000 )) || { echo "Fixture size must be between 1000 and 100000 games per kind" >&2; exit 1; }
TEST_DATABASE_URL="$url" bun test --max-concurrency 1 packages/api/src/__tests__/house-participation.test.ts
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -v games_per_kind="$games_per_kind" -U influence -d influence_test < scripts/perf/history-fixture.sql
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U influence -d influence_test < scripts/perf/history-page-plan.sql
if [[ "${HISTORY_BENCHMARK_PLAN_ONLY:-0}" == "1" ]]; then exit 0; fi
# The synthetic openings have no valid canonical endings, so use the 1,000
# Influence-only games to compare identical old and new service reads.
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U influence -d influence_test -c "DELETE FROM werewolf_events WHERE game_id LIKE 'history-wolf-%'; DELETE FROM games WHERE id LIKE 'history-wolf-%'; ANALYZE games; ANALYZE werewolf_events;"
HISTORY_BENCHMARK_URL="$url" bun scripts/history-benchmark-local.ts
