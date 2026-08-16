#!/usr/bin/env bash
set -euo pipefail

workflow=.github/workflows/production-approval.yml
controller=scripts/production-approval.sh
ci=.github/workflows/ci.yml

fail() { echo "FAIL: $*" >&2; exit 1; }
require() { grep -Eq -- "$2" "$1" || fail "$3"; }
reject() { ! grep -Eq -- "$2" "$1" || fail "$3"; }

require "$workflow" 'types: \[influence-production-approval-requested\]' "broker is not repository_dispatch-only"
reject "$workflow" 'workflow_dispatch:' "broker must not allow human dispatch"
require "$workflow" "github.actor == 'flick-ai-dev\[bot\]'" "trusted App actor gate is missing"
require "$workflow" 'github.run_attempt == 1' "first-attempt authority gate is missing"
require "$workflow" 'name: production' "protected Influence environment is missing"
require "$workflow" 'deployment: false' "approval-only environment mode is missing"
require "$workflow" 'Reverify exact private request after approval' "protected job does not independently reverify"
require "$workflow" 'verify-preapproval-policy' "unsafe protection can still prompt for approval"
require "$workflow" 'permission-actions: read' "read-only provenance permission is missing"
require "$workflow" 'permission-contents: read' "read-only content permission is missing"
require "$workflow" 'permission-contents: write' "callback dispatch permission is missing"
reject "$workflow" 'permission-(actions|packages|deployments): write' "approval broker has unrelated write authority"
require "$workflow" 'approval_run_id:' "callback run locator is missing"
require "$workflow" 'approval_run_attempt:' "callback attempt locator is missing"
require "$workflow" 'approval_artifact:' "callback artifact locator is missing"
require "$workflow" 'approval_digest:' "callback digest locator is missing"
reject "$workflow" 'client_payload:.*(candidate_sha|api_digest|web_digest|worker_digest|migration_set)' "callback carries candidate authority"

for kind in candidate bootstrap-inventory bootstrap-conversion break-glass; do
  require "$controller" "${kind}" "request kind $kind is not validated"
done
require "$controller" 'source artifact archive digest mismatch' "archive digest verification is missing"
require "$controller" 'source request content digest mismatch' "content digest verification is missing"
require "$controller" 'only first-attempt source runs are accepted' "source rerun rejection is missing"
require "$controller" 'APPROVER_ID="97764360"' "reviewer identity is not pinned"
require "$controller" 'APP_ACTOR_ID="270169057"' "App identity is not pinned"
require "$controller" 'approval event sender is not the trusted App' "event sender ID is not verified"
require "$controller" 'required_approving_review_count == 0' "main PR-only policy is not checked"
require "$controller" 'allow_force_pushes.enabled == false' "force-push protection is not checked"
require "$controller" 'allow_deletions.enabled == false' "deletion protection is not checked"
require "$controller" 'can_admins_bypass == false' "environment bypass protection is not checked"
require "$controller" 'prevent_self_review == true' "self-review protection is not checked"
require "$ci" 'bash scripts/test-production-approval-contract.sh' "approval contract is not in required CI"

bash -n "$controller"
ruby -e 'require "yaml"; YAML.parse_file(ARGV.fetch(0))' "$workflow"
echo "Production approval broker contract tests passed"
