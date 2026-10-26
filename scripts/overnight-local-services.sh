#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
role="${1:-}"
evidence_dir="${INFLUENCE_LOCAL_TASK_EVIDENCE_DIR:-$repo_dir/../evidence}"
if [[ -z "${INFLUENCE_LOCAL_TASK_EVIDENCE_DIR:-}" && -f "$repo_dir/.overnight-evidence-dir.local" ]]; then
  evidence_dir="$(cat "$repo_dir/.overnight-evidence-dir.local")"
fi
export INFLUENCE_LOCAL_TASK_BUDGET="${INFLUENCE_LOCAL_TASK_BUDGET:-$evidence_dir/spend-ledger.json}"
export INFLUENCE_LOCAL_UPLOAD_DIR="${INFLUENCE_LOCAL_UPLOAD_DIR:-/Users/user/Development/influence-game/packages/api/.local-uploads}"
export CHARACTER_CUTOUT_MODE=local
export CUTOUT_API_URL=http://host.docker.internal:3000
export INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED=true
export POSTGAME_MEDIA_WORKER_TOKEN=local-render-worker
export POSTGAME_MEDIA_PUBLIC_BASE_URL=http://127.0.0.1:3000
test -f "$INFLUENCE_LOCAL_TASK_BUDGET"
case "$role" in
  api|worker)
    export PORT=3000 INFLUENCE_API_ROLE=gateway
    if [[ "$role" == worker ]]; then export PORT=3002 INFLUENCE_API_ROLE=game-worker; fi
    cd "$repo_dir/packages/api"
    export DRIZZLE_MIGRATIONS_DIR=./drizzle
    exec doppler run --project social-strategy-agent --config dev --preserve-env -- bun run src/index.ts
    ;;
  web)
    cd "$repo_dir/packages/web"
    export PORT=3001 API_URL=http://127.0.0.1:3000 WS_URL=ws://127.0.0.1:3000 API_BACKEND_URL=http://127.0.0.1:3000
    exec doppler run --project social-strategy-agent --config dev --preserve-env -- bun run dev
    ;;
  *) echo 'Usage: bash scripts/overnight-local-services.sh api|worker|web' >&2; exit 2 ;;
esac
