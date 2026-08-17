#!/usr/bin/env bash
set -euo pipefail

workflow=.github/workflows/production-approval.yml
proof_workflow=.github/workflows/production-approval-proof.yml
controller=scripts/production-approval.sh
ci=.github/workflows/ci.yml

fail() { echo "FAIL: $*" >&2; exit 1; }
require() { grep -Eq -- "$2" "$1" || fail "$3"; }
reject() { ! grep -Eq -- "$2" "$1" || fail "$3"; }

require "$workflow" 'types: \[influence-production-approval-requested\]' "broker is not repository_dispatch-only"
reject "$workflow" 'workflow_dispatch:' "broker must not allow human dispatch"
require "$workflow" "github.actor == 'flick-ai-dev\[bot\]'" "trusted App actor gate is missing"
require "$workflow" 'github.run_attempt == 1' "first-attempt authority gate is missing"
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

for kind in candidate bootstrap-inventory bootstrap-conversion break-glass; do
  require "$controller" "${kind}" "request kind $kind is not validated"
done
require "$controller" 'source artifact archive digest mismatch' "archive digest verification is missing"
require "$controller" 'source request content digest mismatch' "content digest verification is missing"
require "$controller" 'only first-attempt source runs are accepted' "source rerun rejection is missing"
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
require "$controller" '\.operation\.qualification \| keys \| sort' "public qualification fields are not allowlisted"
reject "$controller" 'release_bundle_dir' "public approval schema exposes a private host path"
require "$workflow" 'if: \$\{\{ success\(\) \}\}' "handoff success is reported before callback completion"
require "$workflow" 'Production approval was not handed off' "failed handoff is not reported truthfully"
require "$workflow" 'Private execution locator:' "handoff does not expose its immutable private correlation locator"
require "$workflow" 'status === 429 \|\| status >= 500' "callback retries are not limited to transient failures"
require "$workflow" "headers\?\.\['retry-after'\]" "callback retry does not honor Retry-After"
require "$workflow" 'attempt <= 5' "callback retry budget is not bounded"
require "$workflow" 'Math\.random\(\)' "callback retry backoff has no jitter"
require "$ci" 'bash scripts/test-production-approval-contract.sh' "approval contract is not in required CI"

require "$proof_workflow" 'workflow_dispatch:' "temporary proof cannot be started"
require "$proof_workflow" 'influence-production-approval-proof-requested' "proof is not App-authored"
require "$proof_workflow" 'deployment: false' "proof creates a deployment instead of approval-only evidence"
require "$proof_workflow" 'sender.id == 270169057' "proof does not bind the App ID"
require "$proof_workflow" 'verify-policy proof-policy' "proof does not verify its approval and live policy"
require "$proof_workflow" 'GH_TOKEN: \$\{\{ github\.token \}\}' "proof does not provide GitHub API authority to the policy verifier"
require "$proof_workflow" 'Production callback:.*none' "proof can be mistaken for execution authority"
reject "$proof_workflow" '(TS_OAUTH|SSH_PRIVATE_KEY|DOPPLER|GHCR_TOKEN|root@influence-prod)' "proof workflow contains production authority"

bash -n "$controller"
ruby -e 'require "yaml"; ARGV.each { |f| YAML.parse_file(f) }' "$workflow" "$proof_workflow"
echo "Production approval broker contract tests passed"
