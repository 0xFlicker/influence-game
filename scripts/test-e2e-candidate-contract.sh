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
require_literal "$ci_workflow" "release-image scope job" "release-scope:"
require_literal "$ci_workflow" "manual release override" 'github.event_name == '\''workflow_dispatch'\'''
require_literal "$ci_workflow" "release input comparison" 'git diff --quiet "$comparison_base" "$GITHUB_SHA" --'
require_literal "$ci_workflow" "API image inputs" "packages/api/"
require_literal "$ci_workflow" "web image inputs" "packages/web/"
require_literal "$ci_workflow" "engine image inputs" "packages/engine/"
require_literal "$ci_workflow" "render-worker media inputs" "music/house-highlights-variants/"
require_literal "$ci_workflow" "Docker build scope dependency" "needs: [check, release-scope]"
require_literal "$ci_workflow" "Docker build release scope gate" "needs.release-scope.outputs.release_required == 'true'"
require_literal "$ci_workflow" "API digest artifact" "digest-api"
require_literal "$ci_workflow" "web digest artifact" "digest-web"
require_literal "$ci_workflow" "render-worker digest artifact" "digest-render-worker"
require_literal "$ci_workflow" "rerunnable stable digest artifacts" 'name: ${{ matrix.digest_artifact }}'
require_literal "$ci_workflow" "idempotent failed-matrix replacement" "overwrite: true"
require_literal "$ci_workflow" "cross-attempt digest aggregation" "pattern: digest-*"
require_literal "$ci_workflow" "three-digest completeness check" 'expected exactly three service digest artifacts'
require_literal "$ci_workflow" "migration-set identity" "migration_set"
require_literal "$ci_workflow" "full candidate SHA" "candidate_sha"
require_literal "$ci_workflow" "staging API digest" "api_digest"
require_literal "$ci_workflow" "staging web digest" "web_digest"
require_literal "$ci_workflow" "staging worker digest" "worker_digest"
require_literal "$ci_workflow" "manifest content identity" "manifest_digest"
require_literal "$ci_workflow" "Docker push digest parser" "awk '\$2 == \"digest:\" { print \$3 }'"
require_literal "$ci_workflow" "manifest-gated staging dispatch" "needs: release-manifest"
require_literal "$ci_workflow" "build run ID pass-through" "build_run_id: String(context.runId)"
require_literal "$ci_workflow" "actual build attempt pass-through" "build_run_attempt: process.env.GITHUB_RUN_ATTEMPT"

require_literal "$e2e_workflow" "staging deploy run input" "staging_run_id"
require_literal "$e2e_workflow" "staging deploy attempt input" "staging_run_attempt"
require_literal "$e2e_workflow" "staging receipt artifact input" "staging_receipt_artifact"
require_literal "$e2e_workflow" "staging receipt digest input" "staging_receipt_digest"
require_literal "$e2e_workflow" "successful candidate dispatch" "event_type: 'influence-production-candidate-qualified'"
require_literal "$e2e_workflow" "least-privilege repository dispatch token" "permission-contents: write"
require_literal "$e2e_workflow" "E2E run ID evidence" "e2e_run_id: context.runId"
require_literal "$e2e_workflow" "E2E run attempt evidence" "e2e_run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT)"
require_literal "$e2e_workflow" "immutable E2E evidence artifact locator" "e2e_evidence_artifact: process.env.E2E_EVIDENCE_ARTIFACT"
require_literal "$e2e_workflow" "immutable E2E evidence digest locator" "e2e_evidence_digest:"
require_literal "$e2e_workflow" "trusted E2E workflow SHA evidence" 'trusted_workflow_sha: $trusted_workflow_sha'
require_literal "$e2e_workflow" "candidate SHA evidence" 'candidate_sha: $candidate_sha'
require_literal "$e2e_workflow" "API digest evidence" 'api: {digest: $api_digest}'
require_literal "$e2e_workflow" "web digest evidence" 'web: {digest: $web_digest}'
require_literal "$e2e_workflow" "worker digest evidence" 'render_worker: {digest: $worker_digest}'
require_literal "$e2e_workflow" "receipt bound to staging identity" 'expected_receipt="staging-deployment-receipt-${STAGING_RUN_ID}-${STAGING_RUN_ATTEMPT}"'
require_literal "$e2e_workflow" "release-control capability gate" "STAGING_MIN_RELEASE_CONTROL_PROTOCOL"
require_literal "$e2e_workflow" "durable staging E2E evidence" "staging-e2e-evidence.json"
require_literal "$e2e_workflow" "attempt-specific candidate evidence artifact" 'E2E_EVIDENCE_ARTIFACT: staging-e2e-evidence-${{ inputs.candidate_sha }}-${{ github.run_id }}-${{ github.run_attempt }}'
require_literal "$e2e_workflow" "strict evidence artifact upload" "if-no-files-found: error"
require_literal "$e2e_workflow" "candidate evidence job summary" "## Influence staging release evidence"
require_literal "$e2e_workflow" "staging receipt evidence link" 'actions/runs/$STAGING_RUN_ID/attempts/$STAGING_RUN_ATTEMPT'
require_literal "$e2e_workflow" "E2E evidence link" 'actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT'
require_literal "$e2e_workflow" "main-ref secret boundary" "if: \${{ github.ref == 'refs/heads/main' }}"
require_literal "$e2e_workflow" "candidate bound to trusted main history" 'git merge-base --is-ancestor "$expected_sha" "$GITHUB_SHA"'
require_literal "$e2e_workflow" "exact deployed source checkout" 'git checkout --detach "$expected_sha"'

e2e_line="$(grep -n 'name: Run E2E tests' "$e2e_workflow" | cut -d: -f1)"
evidence_line="$(grep -n 'name: Create immutable staging E2E evidence' "$e2e_workflow" | cut -d: -f1)"
upload_line="$(grep -n 'name: Upload immutable staging E2E evidence' "$e2e_workflow" | cut -d: -f1)"
dispatch_line="$(grep -n 'name: Report qualified production candidate' "$e2e_workflow" | cut -d: -f1)"
if [ "$e2e_line" -ge "$evidence_line" ] || [ "$evidence_line" -ge "$upload_line" ] || [ "$upload_line" -ge "$dispatch_line" ]; then
  echo "::error::candidate evidence must be created and uploaded after E2E succeeds but before callback" >&2
  exit 1
fi

actual_payload_fields="$({
  sed -n '/client_payload: {/,/^              }/p' "$e2e_workflow" \
    | grep -oE '^[[:space:]]+[a-z0-9_]+:' \
    | tr -d ' :' \
    | grep -v '^client_payload$' || true
} | LC_ALL=C sort -u)"
expected_payload_fields="$(printf '%s\n' \
  e2e_evidence_artifact \
  e2e_evidence_digest \
  e2e_run_attempt \
  e2e_run_id | LC_ALL=C sort)"
if [ "$actual_payload_fields" != "$expected_payload_fields" ]; then
  printf 'unexpected candidate callback fields:\n%s\n' "$actual_payload_fields" >&2
  exit 1
fi

if ! grep -Fq 'run: bash scripts/test-e2e-candidate-contract.sh' "$ci_workflow"; then
  echo "::error::required CI does not exercise the staging E2E candidate contract" >&2
  exit 1
fi

if grep -Fq 'image_tag:' "$e2e_workflow"; then
  echo "::error::E2E candidate workflow must not accept a mutable or shortened image tag" >&2
  exit 1
fi

expected_push_digest="sha256:$(printf 'a%.0s' {1..64})"
docker_push_output="59054e8: digest: ${expected_push_digest} size: 2404"
parsed_push_digest="$(awk '$2 == "digest:" { print $3 }' <<< "$docker_push_output" | tail -n 1)"
if [ "$parsed_push_digest" != "$expected_push_digest" ]; then
  echo "::error::Docker push digest parser did not extract the immutable digest" >&2
  exit 1
fi

echo "E2E production-candidate contract regression test passed"
