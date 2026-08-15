#!/usr/bin/env bash
set -euo pipefail

ci_workflow=.github/workflows/ci.yml
e2e_workflow=.github/workflows/e2e-staging.yml

require_literal() {
  local file="$1"
  local label="$2"
  local text="$3"

  if ! grep -Fq "$text" "$file"; then
    echo "::error::${file} is missing ${label}" >&2
    exit 1
  fi
}

require_literal "$ci_workflow" "release manifest aggregation job" "release-manifest:"
require_literal "$ci_workflow" "API digest artifact" "digest-api"
require_literal "$ci_workflow" "web digest artifact" "digest-web"
require_literal "$ci_workflow" "render-worker digest artifact" "digest-render-worker"
require_literal "$ci_workflow" "three-digest completeness check" 'expected exactly three service digest artifacts'
require_literal "$ci_workflow" "migration-set identity" "migration_set"
require_literal "$ci_workflow" "full candidate SHA" "candidate_sha"
require_literal "$ci_workflow" "staging API digest" "api_digest"
require_literal "$ci_workflow" "staging web digest" "web_digest"
require_literal "$ci_workflow" "staging worker digest" "worker_digest"
require_literal "$ci_workflow" "manifest content identity" "manifest_digest"
require_literal "$ci_workflow" "manifest-gated staging dispatch" "needs: release-manifest"
require_literal "$ci_workflow" "build run ID pass-through" "build_run_id: String(context.runId)"
require_literal "$ci_workflow" "actual build attempt pass-through" "build_run_attempt: process.env.GITHUB_RUN_ATTEMPT"

require_literal "$e2e_workflow" "staging deploy run input" "staging_run_id"
require_literal "$e2e_workflow" "staging deploy attempt input" "staging_run_attempt"
require_literal "$e2e_workflow" "staging receipt artifact input" "staging_receipt_artifact"
require_literal "$e2e_workflow" "staging receipt digest input" "staging_receipt_digest"
require_literal "$e2e_workflow" "successful candidate dispatch" "event_type: 'influence-production-candidate-qualified'"
require_literal "$e2e_workflow" "E2E run ID evidence" "e2e_run_id: context.runId"
require_literal "$e2e_workflow" "E2E run attempt evidence" "e2e_run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT)"
require_literal "$e2e_workflow" "candidate SHA evidence" "candidate_sha: process.env.CANDIDATE_SHA"
require_literal "$e2e_workflow" "API digest evidence" "api_digest: process.env.API_DIGEST"
require_literal "$e2e_workflow" "web digest evidence" "web_digest: process.env.WEB_DIGEST"
require_literal "$e2e_workflow" "worker digest evidence" "worker_digest: process.env.WORKER_DIGEST"
require_literal "$e2e_workflow" "receipt bound to staging identity" 'expected_receipt="staging-deployment-receipt-${STAGING_RUN_ID}-${STAGING_RUN_ATTEMPT}"'
require_literal "$e2e_workflow" "release-control capability gate" "STAGING_MIN_RELEASE_CONTROL_PROTOCOL"
require_literal "$e2e_workflow" "durable staging E2E evidence" "staging-e2e-evidence.json"
require_literal "$e2e_workflow" "candidate evidence job summary" "## Influence staging release evidence"
require_literal "$e2e_workflow" "staging receipt evidence link" 'actions/runs/$STAGING_RUN_ID/attempts/$STAGING_RUN_ATTEMPT'
require_literal "$e2e_workflow" "E2E evidence link" 'actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT'
require_literal "$e2e_workflow" "main-ref secret boundary" "if: \${{ github.ref == 'refs/heads/main' }}"
require_literal "$e2e_workflow" "candidate bound to executing main commit" 'if [ "$expected_sha" != "$GITHUB_SHA" ]'

e2e_line="$(grep -n 'name: Run E2E tests' "$e2e_workflow" | cut -d: -f1)"
dispatch_line="$(grep -n 'name: Report qualified production candidate' "$e2e_workflow" | cut -d: -f1)"
if [ "$e2e_line" -ge "$dispatch_line" ]; then
  echo "::error::candidate callback must occur only after E2E succeeds" >&2
  exit 1
fi

if grep -Fq 'image_tag:' "$e2e_workflow"; then
  echo "::error::E2E candidate workflow must not accept a mutable or shortened image tag" >&2
  exit 1
fi

echo "E2E production-candidate contract regression test passed"
