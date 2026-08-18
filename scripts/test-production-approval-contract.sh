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
reject "$workflow" 'github.run_attempt == 1' "normal GitHub reruns are disabled"
require "$workflow" 'Reject untrusted approval invocation' "untrusted broker invocations can finish green"
require "$workflow" 'exit 1' "untrusted broker invocation is not failed explicitly"
require "$workflow" 'name: production' "protected Influence environment is missing"
require "$workflow" 'deployment: false' "approval-only environment mode is missing"
require "$workflow" 'Reverify exact private request after approval' "protected job does not independently reverify"
require "$workflow" 'verify-preapproval-policy' "unsafe protection can still prompt for approval"
require "$workflow" 'permission-actions: read' "read-only provenance permission is missing"
require "$workflow" 'permission-contents: read' "read-only content permission is missing"
require "$workflow" 'permission-environments: read' "environment-secrets read permission is missing"
require "$workflow" 'permission-contents: write' "callback dispatch permission is missing"
reject "$workflow" 'permission-(actions|packages|deployments): write' "approval broker has unrelated write authority"
require "$workflow" 'approval_run_id:' "callback run locator is missing"
require "$workflow" 'approval_run_attempt:' "callback attempt locator is missing"
require "$workflow" 'approval_artifact:' "callback artifact locator is missing"
require "$workflow" 'approval_digest:' "callback digest locator is missing"
reject "$workflow" 'client_payload:.*(candidate_sha|api_digest|web_digest|worker_digest|migration_set)' "callback carries candidate authority"

for kind in candidate break-glass; do
  require "$controller" "${kind}" "request kind $kind is not validated"
done
reject "$controller" 'bootstrap-inventory' "obsolete bootstrap inventory approval remains supported"
reject "$controller" 'bootstrap-conversion' "retired bootstrap conversion approval remains supported"
reject "$workflow" 'influence-production-bootstrap-conversion-approved' "retired bootstrap callback remains callable"
require "$controller" 'source artifact archive digest mismatch' "archive digest verification is missing"
require "$controller" 'source request content digest mismatch' "content digest verification is missing"
require "$controller" 'source run attempt is invalid' "positive source-attempt validation is missing"
require "$controller" 'APPROVER_ID="97764360"' "reviewer identity is not pinned"
require "$controller" 'APP_ACTOR_ID="270169057"' "App identity is not pinned"
require "$controller" 'approval event sender is not the trusted App' "event sender ID is not verified"
require "$controller" 'MAIN_RULESET_ID="20924439"' "main ruleset identity is not pinned"
require "$controller" 'Influence main ruleset is unavailable' "active main ruleset is not required"
reject "$controller" 'bypass_pull_request_allowances|allow_force_pushes|required_approving_review_count' "ruleset contents are being second-guessed"
require "$controller" 'can_admins_bypass == false' "environment bypass protection is not checked"
require "$controller" 'prevent_self_review == true' "self-review protection is not checked"
require "$controller" 'production environment must not contain secrets' "environment secret absence is not checked"
require "$controller" 'approval workflow is not the current Influence main revision' "stale broker revisions remain authoritative"
require "$controller" 'length >= 1' "legitimate repeat approval cannot be revalidated"
require "$controller" '\.operation\.qualification \| keys \| sort' "public qualification fields are not allowlisted"
reject "$controller" 'release_bundle_dir' "public approval schema exposes a private host path"
require "$workflow" 'if: \$\{\{ success\(\) \}\}' "handoff success is reported before callback completion"
require "$workflow" 'Production approval was not handed off' "failed handoff is not reported truthfully"
require "$workflow" 'Private execution locator:' "handoff does not expose its immutable private correlation locator"
reject "$workflow" 'retry-after|attempt <= 5|Math\.random\(\)' "approval callback contains a custom retry loop"
require "$ci" 'bash scripts/test-production-approval-contract.sh' "approval contract is not in required CI"
[ ! -e .github/workflows/production-approval-proof.yml ] || fail "temporary approval proof workflow was reintroduced"
if grep -R -Fq 'influence-production-approval-proof-requested' .github/workflows; then
  fail "temporary approval proof dispatch event was reintroduced"
fi

bash -n "$controller"
ruby -e 'require "yaml"; YAML.parse_file(ARGV.fetch(0))' "$workflow"
echo "Production approval broker contract tests passed"
