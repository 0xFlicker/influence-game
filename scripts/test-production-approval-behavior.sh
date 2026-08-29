#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROLLER="$ROOT_DIR/scripts/production-approval.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
expect_failure() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$label unexpectedly succeeded"; fi
}
expect_failure_with() {
  local label="$1" expected="$2" output
  shift 2
  if output="$("$@" 2>&1)"; then fail "$label unexpectedly succeeded"; fi
  grep -Fq -- "$expected" <<< "$output" || fail "$label returned the wrong diagnostic: $output"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
baseline=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
digest=sha256:$(printf 'c%.0s' {1..64})
mkdir -p "$tmp/mock-bin"

cat > "$tmp/mock-bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
endpoint="${@: -1}"
case "$endpoint" in
  */actions/runs/*/artifacts\?*) cat "$GH_ARTIFACTS" ;;
  */actions/runs/*) cat "$GH_RUN" ;;
  */actions/artifacts/*/zip) cat "$GH_ARCHIVE" ;;
  *) echo "unexpected gh endpoint: $endpoint" >&2; exit 1 ;;
esac
MOCK_GH
chmod +x "$tmp/mock-bin/gh"

write_operation() {
  local kind="$1" output="$2"
  case "$kind" in
    candidate)
      jq -S -n --arg sha "$sha" --arg baseline "$baseline" --arg digest "$digest" '{qualification:{
        schema_version:2,candidate_sha:$sha,
        images:{api:{digest:$digest},web:{digest:$digest},render_worker:{digest:$digest}},migration_set:$digest,
        build:{run_id:10,run_attempt:1,artifact:"manifest",digest:$digest},
        staging:{run_id:11,run_attempt:1,artifact:"receipt",digest:$digest},
        e2e:{run_id:12,run_attempt:1,workflow_sha:$sha,artifact:"evidence",digest:$digest},
        production_baseline:{candidate_sha:$baseline,api_digest:$digest,protocol:1,runtime_state:"accepted"},
        release_control:{minimum_protocol:1,candidate_protocol:1},commit_list:[$sha],clean_switch_capable:true
      }}' > "$output"
      ;;
    break-glass)
      jq -S -n --arg sha "$sha" --arg baseline "$baseline" --arg digest "$digest" '{qualification:{
        schema_version:2,mode:"break-glass",candidate_sha:$sha,
        production_baseline:{candidate_sha:$baseline,api_digest:$digest,protocol:1,runtime_state:"accepted"},
        images:{api:{digest:$digest},web:{digest:$digest},render_worker:{digest:$digest}},migration_set:$digest,
        compare_status:"ahead",commit_list:[$sha],compatibility_proven:true
      },reason:"operator-approved recovery"}' > "$output"
      ;;
  esac
}

source_contract() {
  case "$1" in
    candidate) printf '%s\t%s\t%s\t%s\n' .github/workflows/production-candidate.yml repository_dispatch 'flick-ai-dev[bot]' 270169057 ;;
    break-glass) printf '%s\t%s\t%s\t%s\n' .github/workflows/promote-prod.yml workflow_dispatch 0xFlicker 97764360 ;;
  esac
}

verify_kind() {
  local kind="$1" case_dir="$tmp/$kind" workflow event actor actor_id artifact content_digest archive_digest
  mkdir -p "$case_dir/archive"
  write_operation "$kind" "$case_dir/operation.json"
  IFS=$'\t' read -r workflow event actor actor_id <<< "$(source_contract "$kind")"
  jq -S -n --arg kind "$kind" --arg workflow "$workflow" --arg actor "$actor" --argjson actor_id "$actor_id" --arg sha "$sha" --slurpfile operation "$case_dir/operation.json" \
    '{schema_version:1,kind:$kind,source:{repository:"0xFlicker/linode-iac",workflow:$workflow,run_id:123,run_attempt:1,controller_sha:$sha,actor:{login:$actor,id:$actor_id}},operation:$operation[0]}' \
    > "$case_dir/archive/production-approval-request.json"
  content_digest="sha256:$(sha256sum "$case_dir/archive/production-approval-request.json" | awk '{print $1}')"
  (cd "$case_dir/archive" && zip -X -q "$case_dir/artifact.zip" production-approval-request.json)
  archive_digest="sha256:$(sha256sum "$case_dir/artifact.zip" | awk '{print $1}')"
  artifact="production-approval-request-${kind}-123-1"
  jq -S -n --arg workflow "$workflow" --arg event "$event" --arg actor "$actor" --argjson actor_id "$actor_id" --arg sha "$sha" \
    '{id:123,repository:{full_name:"0xFlicker/linode-iac"},head_branch:"main",head_sha:$sha,status:"completed",conclusion:"success",run_attempt:1,path:$workflow,event:$event,actor:{login:$actor,id:$actor_id}}' > "$case_dir/run.json"
  jq -S -n --arg name "$artifact" --arg digest "$archive_digest" '{total_count:1,artifacts:[{id:789,name:$name,digest:$digest,expired:false,workflow_run:{id:123}}]}' > "$case_dir/artifacts.json"
  result="$(PATH="$tmp/mock-bin:$PATH" GH_RUN="$case_dir/run.json" GH_ARTIFACTS="$case_dir/artifacts.json" GH_ARCHIVE="$case_dir/artifact.zip" \
    SOURCE_RUN_ID=123 SOURCE_RUN_ATTEMPT=1 SOURCE_ARTIFACT="$artifact" SOURCE_DIGEST="$content_digest" LINODE_TOKEN=test APPROVAL_WAIT_SECONDS=1 \
    bash "$CONTROLLER" verify-request "$case_dir/verified")"
  [ "$result" = "$kind" ] || fail "$kind was not verified"
  jq -e --arg kind "$kind" '.kind == $kind and .artifact.id == 789 and .source_run.attempt == 1' "$case_dir/verified/request-provenance.json" >/dev/null \
    || fail "$kind provenance was not frozen"
}

for kind in candidate break-glass; do verify_kind "$kind"; done

retired_dir="$tmp/bootstrap-conversion"
mkdir -p "$retired_dir/archive"
jq -S -n --arg digest "$digest" '{schema_version:1,kind:"bootstrap-conversion",source:{repository:"0xFlicker/linode-iac",workflow:".github/workflows/bootstrap-production-ingress.yml",run_id:123,run_attempt:1,controller_sha:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",actor:{login:"0xFlicker",id:97764360}},operation:{accepted_color:"blue",inventory:{run_id:20,run_attempt:1,artifact:"production-ingress-inventory-20-1",digest:$digest}}}' \
  > "$retired_dir/archive/production-approval-request.json"
retired_content_digest="sha256:$(sha256sum "$retired_dir/archive/production-approval-request.json" | awk '{print $1}')"
(cd "$retired_dir/archive" && zip -X -q "$retired_dir/artifact.zip" production-approval-request.json)
retired_archive_digest="sha256:$(sha256sum "$retired_dir/artifact.zip" | awk '{print $1}')"
jq -S -n --arg sha "$sha" '{id:123,repository:{full_name:"0xFlicker/linode-iac"},head_branch:"main",head_sha:$sha,status:"completed",conclusion:"success",run_attempt:1,path:".github/workflows/bootstrap-production-ingress.yml",event:"workflow_dispatch",actor:{login:"0xFlicker",id:97764360}}' > "$retired_dir/run.json"
jq -S -n --arg digest "$retired_archive_digest" '{total_count:1,artifacts:[{id:789,name:"production-approval-request-bootstrap-conversion-123-1",digest:$digest,expired:false,workflow_run:{id:123}}]}' > "$retired_dir/artifacts.json"
expect_failure "retired bootstrap conversion request" env PATH="$tmp/mock-bin:$PATH" GH_RUN="$retired_dir/run.json" GH_ARTIFACTS="$retired_dir/artifacts.json" GH_ARCHIVE="$retired_dir/artifact.zip" \
  SOURCE_RUN_ID=123 SOURCE_RUN_ATTEMPT=1 SOURCE_ARTIFACT=production-approval-request-bootstrap-conversion-123-1 SOURCE_DIGEST="$retired_content_digest" LINODE_TOKEN=test APPROVAL_WAIT_SECONDS=1 \
  bash "$CONTROLLER" verify-request "$retired_dir/verified"

jq -S -n '{protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:[{type:"User",reviewer:{login:"0xFlicker",id:97764360}}]}],can_admins_bypass:false,deployment_branch_policy:null}' > "$tmp/environment.json"
bash "$CONTROLLER" validate-environment-fixture "$tmp/environment.json"
jq '.protection_rules[0].reviewers[0].reviewer.id = 1' "$tmp/environment.json" > "$tmp/wrong-reviewer-environment.json"
expect_failure_with "wrong required reviewer" "must require exact reviewer with self-review prevention" bash "$CONTROLLER" validate-environment-fixture "$tmp/wrong-reviewer-environment.json"
jq '.protection_rules[0].prevent_self_review = false' "$tmp/environment.json" > "$tmp/self-review-environment.json"
expect_failure_with "self review allowed" "must require exact reviewer with self-review prevention" bash "$CONTROLLER" validate-environment-fixture "$tmp/self-review-environment.json"
jq '.can_admins_bypass = true' "$tmp/environment.json" > "$tmp/admin-bypass-environment.json"
expect_failure_with "admin bypass allowed" "must disable administrator bypass" bash "$CONTROLLER" validate-environment-fixture "$tmp/admin-bypass-environment.json"

jq -S -n '{id:20924439,name:"main",target:"branch",source_type:"Repository",source:"0xFlicker/influence-game",enforcement:"active",conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},rules:[]}' > "$tmp/ruleset.json"
bash "$CONTROLLER" validate-main-ruleset-fixture "$tmp/ruleset.json"
jq '.enforcement = "disabled"' "$tmp/ruleset.json" > "$tmp/disabled-ruleset.json"
expect_failure "disabled main ruleset" bash "$CONTROLLER" validate-main-ruleset-fixture "$tmp/disabled-ruleset.json"
jq '.conditions.ref_name.include = ["refs/heads/dev"]' "$tmp/ruleset.json" > "$tmp/wrong-target-ruleset.json"
expect_failure "ruleset missing main" bash "$CONTROLLER" validate-main-ruleset-fixture "$tmp/wrong-target-ruleset.json"

candidate_dir="$tmp/candidate"
candidate_content_digest="sha256:$(sha256sum "$candidate_dir/archive/production-approval-request.json" | awk '{print $1}')"
jq '.actor = {login:"attacker",id:1}' "$candidate_dir/run.json" > "$candidate_dir/wrong-actor-run.json"
expect_failure "wrong source actor" env PATH="$tmp/mock-bin:$PATH" GH_RUN="$candidate_dir/wrong-actor-run.json" GH_ARTIFACTS="$candidate_dir/artifacts.json" GH_ARCHIVE="$candidate_dir/artifact.zip" \
  SOURCE_RUN_ID=123 SOURCE_RUN_ATTEMPT=1 SOURCE_ARTIFACT=production-approval-request-candidate-123-1 SOURCE_DIGEST="$candidate_content_digest" LINODE_TOKEN=test APPROVAL_WAIT_SECONDS=1 \
  bash "$CONTROLLER" verify-request "$tmp/rejected"
jq '.path = ".github/workflows/production-candidate.yml.evil"' "$candidate_dir/run.json" > "$candidate_dir/prefix-run.json"
expect_failure "workflow prefix collision" env PATH="$tmp/mock-bin:$PATH" GH_RUN="$candidate_dir/prefix-run.json" GH_ARTIFACTS="$candidate_dir/artifacts.json" GH_ARCHIVE="$candidate_dir/artifact.zip" \
  SOURCE_RUN_ID=123 SOURCE_RUN_ATTEMPT=1 SOURCE_ARTIFACT=production-approval-request-candidate-123-1 SOURCE_DIGEST="$candidate_content_digest" LINODE_TOKEN=test APPROVAL_WAIT_SECONDS=1 \
  bash "$CONTROLLER" verify-request "$tmp/rejected"
rerun_dir="$tmp/candidate-rerun"
mkdir -p "$rerun_dir/archive"
jq '.source.run_attempt = 2' "$candidate_dir/archive/production-approval-request.json" > "$rerun_dir/archive/production-approval-request.json"
rerun_content_digest="sha256:$(sha256sum "$rerun_dir/archive/production-approval-request.json" | awk '{print $1}')"
(cd "$rerun_dir/archive" && zip -X -q "$rerun_dir/artifact.zip" production-approval-request.json)
rerun_archive_digest="sha256:$(sha256sum "$rerun_dir/artifact.zip" | awk '{print $1}')"
jq '.run_attempt = 2' "$candidate_dir/run.json" > "$rerun_dir/run.json"
jq -S -n --arg digest "$rerun_archive_digest" '{total_count:1,artifacts:[{id:790,name:"production-approval-request-candidate-123-2",digest:$digest,expired:false,workflow_run:{id:123}}]}' > "$rerun_dir/artifacts.json"
PATH="$tmp/mock-bin:$PATH" GH_RUN="$rerun_dir/run.json" GH_ARTIFACTS="$rerun_dir/artifacts.json" GH_ARCHIVE="$rerun_dir/artifact.zip" \
  SOURCE_RUN_ID=123 SOURCE_RUN_ATTEMPT=2 SOURCE_ARTIFACT=production-approval-request-candidate-123-2 SOURCE_DIGEST="$rerun_content_digest" LINODE_TOKEN=test APPROVAL_WAIT_SECONDS=1 \
  bash "$CONTROLLER" verify-request "$rerun_dir/verified" >/dev/null
jq -e '.source_run.attempt == 2' "$rerun_dir/verified/request-provenance.json" >/dev/null \
  || fail "successful source rerun provenance was not retained"

bash -n "$CONTROLLER"
echo "Production approval broker behavior tests passed"
