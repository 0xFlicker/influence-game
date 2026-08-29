#!/usr/bin/env bash
set -euo pipefail

readonly LINODE_REPOSITORY="0xFlicker/linode-iac"
readonly INFLUENCE_REPOSITORY="0xFlicker/influence-game"
readonly APPROVAL_ENVIRONMENT="production"
readonly APPROVER_LOGIN="0xFlicker"
readonly APPROVER_ID="97764360"
readonly APP_ACTOR_LOGIN="flick-ai-dev[bot]"
readonly APP_ACTOR_ID="270169057"
readonly MAIN_RULESET_ID="20924439"

die() {
  printf 'production approval: %s\n' "$*" >&2
  exit 1
}

require_locator() {
  [[ "${SOURCE_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] || die "source run ID is invalid"
  [[ "${SOURCE_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]] || die "source run attempt is invalid"
  [[ "${SOURCE_ARTIFACT:-}" =~ ^production-approval-request-(candidate|break-glass)-[1-9][0-9]*-[1-9][0-9]*$ ]] \
    || die "source artifact name is invalid"
  [[ "${SOURCE_DIGEST:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || die "source content digest is invalid"
  [ -n "${LINODE_TOKEN:-}" ] || die "LINODE_TOKEN is required"
}

wait_for_source_run() {
  local output_file="$1" deadline
  deadline=$((SECONDS + ${APPROVAL_WAIT_SECONDS:-900}))
  while true; do
    GH_TOKEN="$LINODE_TOKEN" gh api \
      -H 'Accept: application/vnd.github+json' \
      "/repos/$LINODE_REPOSITORY/actions/runs/$SOURCE_RUN_ID" > "$output_file"
    if [ "$(jq -er '.status' "$output_file")" = completed ]; then
      return
    fi
    [ "$SECONDS" -lt "$deadline" ] || die "timed out waiting for source run"
    sleep 5
  done
}

validate_operation() {
  local request_file="$1" kind
  kind="$(jq -er '.kind' "$request_file")"
  case "$kind" in
    candidate)
      jq -e '
        (.operation | keys | sort) == ["qualification"]
        and (.operation.qualification | keys | sort) == ["build", "candidate_sha", "clean_switch_capable", "commit_list", "e2e", "images", "migration_set", "production_baseline", "release_control", "schema_version", "staging"]
        and .operation.qualification.schema_version == 2
        and (.operation.qualification.candidate_sha | test("^[0-9a-f]{40}$"))
        and (.operation.qualification.images | keys | sort) == ["api", "render_worker", "web"]
        and (.operation.qualification.images.api | keys) == ["digest"]
        and (.operation.qualification.images.web | keys) == ["digest"]
        and (.operation.qualification.images.render_worker | keys) == ["digest"]
        and (.operation.qualification.images.api.digest | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.images.web.digest | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.images.render_worker.digest | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.migration_set | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.build | keys | sort) == ["artifact", "digest", "run_attempt", "run_id"]
        and (.operation.qualification.staging | keys | sort) == ["artifact", "digest", "run_attempt", "run_id"]
        and (.operation.qualification.e2e | keys | sort) == ["artifact", "digest", "run_attempt", "run_id", "workflow_sha"]
        and ([.operation.qualification.build, .operation.qualification.staging, .operation.qualification.e2e] | all(.run_id | type == "number" and . > 0))
        and ([.operation.qualification.build, .operation.qualification.staging, .operation.qualification.e2e] | all(.run_attempt | type == "number" and . > 0))
        and ([.operation.qualification.build, .operation.qualification.staging, .operation.qualification.e2e] | all(.artifact | type == "string" and test("^[A-Za-z0-9._-]{1,255}$")))
        and ([.operation.qualification.build, .operation.qualification.staging, .operation.qualification.e2e] | all(.digest | test("^sha256:[0-9a-f]{64}$")))
        and (.operation.qualification.e2e.workflow_sha | test("^[0-9a-f]{40}$"))
        and (.operation.qualification.production_baseline | keys | sort) == ["api_digest", "candidate_sha", "protocol", "runtime_state"]
        and (.operation.qualification.production_baseline.candidate_sha | test("^[0-9a-f]{40}$"))
        and ((.operation.qualification.production_baseline.api_digest == "") or (.operation.qualification.production_baseline.api_digest | test("^sha256:[0-9a-f]{64}$")))
        and (.operation.qualification.production_baseline.protocol | type == "number" and . >= 0)
        and (.operation.qualification.production_baseline.runtime_state | type == "string" and length > 0)
        and (.operation.qualification.release_control | keys | sort) == ["candidate_protocol", "minimum_protocol"]
        and (.operation.qualification.release_control.minimum_protocol | type == "number" and . >= 1)
        and (.operation.qualification.release_control.candidate_protocol | type == "number" and . >= 1)
        and (.operation.qualification.commit_list | type == "array" and all(.[]; test("^[0-9a-f]{40}$")))
        and (.operation.qualification.clean_switch_capable | type == "boolean")
      ' "$request_file" >/dev/null || die "candidate request schema is invalid"
      ;;
    break-glass)
      jq -e '
        (.operation | keys | sort) == ["qualification", "reason"]
        and (.operation.reason | type == "string" and length >= 8 and length <= 240)
        and (.operation.reason | test("^[A-Za-z0-9 .,:_/#()@+-]+$"))
        and (.operation.qualification | keys | sort) == ["candidate_sha", "commit_list", "compare_status", "compatibility_proven", "images", "migration_set", "mode", "production_baseline", "schema_version"]
        and .operation.qualification.schema_version == 2
        and .operation.qualification.mode == "break-glass"
        and (.operation.qualification.candidate_sha | test("^[0-9a-f]{40}$"))
        and (.operation.qualification.images | keys | sort) == ["api", "render_worker", "web"]
        and (.operation.qualification.images.api | keys) == ["digest"]
        and (.operation.qualification.images.web | keys) == ["digest"]
        and (.operation.qualification.images.render_worker | keys) == ["digest"]
        and (.operation.qualification.images.api.digest | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.images.web.digest | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.images.render_worker.digest | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.migration_set | test("^sha256:[0-9a-f]{64}$"))
        and (.operation.qualification.production_baseline | keys | sort) == ["api_digest", "candidate_sha", "protocol", "runtime_state"]
        and (.operation.qualification.production_baseline.candidate_sha | test("^[0-9a-f]{40}$"))
        and ((.operation.qualification.production_baseline.api_digest == "") or (.operation.qualification.production_baseline.api_digest | test("^sha256:[0-9a-f]{64}$")))
        and (.operation.qualification.production_baseline.protocol | type == "number" and . >= 0)
        and (.operation.qualification.production_baseline.runtime_state | type == "string" and length > 0)
        and (.operation.qualification.compatibility_proven | type == "boolean")
        and (.operation.qualification.compare_status | IN("ahead", "behind", "diverged", "identical"))
        and (.operation.qualification.commit_list | type == "array" and all(.[]; test("^[0-9a-f]{40}$")))
      ' "$request_file" >/dev/null || die "break-glass request schema is invalid"
      ;;
    *) die "unsupported production approval kind" ;;
  esac
}

verify_request() {
  local output_dir run_file artifacts_file artifact_file archive_file request_file
  local artifact_id archive_digest actual_archive_digest actual_content_digest kind expected_workflow expected_event expected_actor expected_actor_id
  output_dir="${1:?output directory is required}"
  require_locator
  install -d -m 0700 "$output_dir"
  run_file="$output_dir/source-run.json"
  artifacts_file="$output_dir/source-artifacts.json"
  artifact_file="$output_dir/source-artifact.json"
  archive_file="$output_dir/source-artifact.zip"
  request_file="$output_dir/production-approval-request.json"

  wait_for_source_run "$run_file"
  jq -e --argjson run_id "$SOURCE_RUN_ID" --argjson attempt "$SOURCE_RUN_ATTEMPT" '
    .id == $run_id
    and .repository.full_name == "0xFlicker/linode-iac"
    and .head_branch == "main"
    and (.head_sha | test("^[0-9a-f]{40}$"))
    and .status == "completed"
    and .conclusion == "success"
    and .run_attempt == $attempt
  ' "$run_file" >/dev/null || die "source run provenance is invalid"

  GH_TOKEN="$LINODE_TOKEN" gh api --method GET \
    -H 'Accept: application/vnd.github+json' \
    "/repos/$LINODE_REPOSITORY/actions/runs/$SOURCE_RUN_ID/artifacts?name=$SOURCE_ARTIFACT" > "$artifacts_file"
  jq -e '.total_count == 1 and (.artifacts | length) == 1' "$artifacts_file" >/dev/null \
    || die "source artifact locator is not unique"
  jq '.artifacts[0]' "$artifacts_file" > "$artifact_file"
  artifact_id="$(jq -er '.id' "$artifact_file")"
  archive_digest="$(jq -er '.digest' "$artifact_file")"
  [[ "$archive_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "source archive digest is unavailable"
  jq -e --argjson run_id "$SOURCE_RUN_ID" --arg name "$SOURCE_ARTIFACT" '
    .name == $name and .expired == false and .workflow_run.id == $run_id
  ' "$artifact_file" >/dev/null || die "source artifact metadata is invalid"

  GH_TOKEN="$LINODE_TOKEN" gh api "/repos/$LINODE_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$archive_file"
  actual_archive_digest="sha256:$(sha256sum "$archive_file" | awk '{print $1}')"
  [ "$actual_archive_digest" = "$archive_digest" ] || die "source artifact archive digest mismatch"
  [ "$(unzip -Z1 "$archive_file")" = production-approval-request.json ] \
    || die "source artifact must contain only production-approval-request.json"
  unzip -p "$archive_file" production-approval-request.json > "$request_file"
  actual_content_digest="sha256:$(sha256sum "$request_file" | awk '{print $1}')"
  [ "$actual_content_digest" = "$SOURCE_DIGEST" ] || die "source request content digest mismatch"

  jq -e '
    (. | keys | sort) == ["kind", "operation", "schema_version", "source"]
    and .schema_version == 1
    and (.source | keys | sort) == ["actor", "controller_sha", "repository", "run_attempt", "run_id", "workflow"]
    and .source.repository == "0xFlicker/linode-iac"
    and (.source.run_attempt | type == "number" and . > 0)
    and (.source.run_id | type == "number" and . > 0)
    and (.source.controller_sha | test("^[0-9a-f]{40}$"))
    and (.source.actor | keys | sort) == ["id", "login"]
    and (.source.actor.id | type == "number" and . > 0)
    and (.source.actor.login | type == "string")
  ' "$request_file" >/dev/null || die "source request envelope is invalid"

  kind="$(jq -er '.kind' "$request_file")"
  case "$kind" in
    candidate)
      expected_workflow=".github/workflows/production-candidate.yml"
      expected_event=repository_dispatch
      expected_actor="$APP_ACTOR_LOGIN"
      expected_actor_id="$APP_ACTOR_ID"
      ;;
    break-glass)
      expected_workflow=".github/workflows/promote-prod.yml"
      expected_event=workflow_dispatch
      expected_actor="$APPROVER_LOGIN"
      expected_actor_id="$APPROVER_ID"
      ;;
    *) die "unsupported production approval kind" ;;
  esac

  jq -e \
    --arg workflow "$expected_workflow" \
    --arg event "$expected_event" \
    --arg actor "$expected_actor" \
    --argjson actor_id "$expected_actor_id" \
    --argjson run_id "$SOURCE_RUN_ID" '
    .event == $event
    and (.path == $workflow or (.path | startswith($workflow + "@")))
    and .actor.login == $actor
    and .actor.id == $actor_id
    and .id == $run_id
  ' "$run_file" >/dev/null || die "source workflow or actor is not trusted"
  jq -e \
    --arg workflow "$expected_workflow" \
    --arg actor "$expected_actor" \
    --argjson actor_id "$expected_actor_id" \
    --argjson run_id "$SOURCE_RUN_ID" \
    --argjson run_attempt "$SOURCE_RUN_ATTEMPT" \
    --arg controller_sha "$(jq -er '.head_sha' "$run_file")" '
    .source.workflow == $workflow
    and .source.actor.login == $actor
    and .source.actor.id == $actor_id
    and .source.run_id == $run_id
    and .source.run_attempt == $run_attempt
    and .source.controller_sha == $controller_sha
  ' "$request_file" >/dev/null || die "source request does not match its workflow run"

  validate_operation "$request_file"
  jq -S -n \
    --argjson artifact_id "$artifact_id" \
    --arg artifact_name "$SOURCE_ARTIFACT" \
    --arg archive_digest "$archive_digest" \
    --arg content_digest "$actual_content_digest" \
    --argjson run_id "$SOURCE_RUN_ID" \
    --argjson run_attempt "$SOURCE_RUN_ATTEMPT" \
    --arg kind "$kind" \
    '{schema_version:1,kind:$kind,source_run:{id:$run_id,attempt:$run_attempt},artifact:{id:$artifact_id,name:$artifact_name,archive_digest:$archive_digest,content_digest:$content_digest}}' \
    > "$output_dir/request-provenance.json"
  printf '%s\n' "$kind"
}

validate_main_ruleset_file() {
  local ruleset_file="${1:?ruleset file is required}"
  jq -e --argjson ruleset_id "$MAIN_RULESET_ID" --arg repository "$INFLUENCE_REPOSITORY" '
    .id == $ruleset_id
    and .name == "main"
    and .target == "branch"
    and .source_type == "Repository"
    and .source == $repository
    and .enforcement == "active"
    and (.conditions.ref_name.include | index("refs/heads/main") != null)
  ' "$ruleset_file" >/dev/null || die "Influence main ruleset is unavailable"
}

validate_environment_file() {
  local environment_file="${1:?environment file is required}"
  jq -e --arg reviewer "$APPROVER_LOGIN" --argjson reviewer_id "$APPROVER_ID" '
    ([.protection_rules[]? | select(.type == "required_reviewers")] | length) == 1
    and ([.protection_rules[]? | select(.type == "required_reviewers")][0] as $rule
      | $rule.prevent_self_review == true
      and ($rule.reviewers | length) == 1
      and $rule.reviewers[0].type == "User"
      and $rule.reviewers[0].reviewer.login == $reviewer
      and $rule.reviewers[0].reviewer.id == $reviewer_id)
  ' "$environment_file" >/dev/null \
    || die "Influence production environment must require exact reviewer with self-review prevention"
  jq -e '.can_admins_bypass == false' "$environment_file" >/dev/null \
    || die "Influence production environment must disable administrator bypass"
}

verify_policy() {
  local output_dir="${1:?output directory is required}" require_approval="${2:-true}"
  [ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN is required"
  [ -n "${POLICY_TOKEN:-}" ] || die "POLICY_TOKEN is required"
  [ "${GITHUB_REPOSITORY:-}" = "$INFLUENCE_REPOSITORY" ] || die "approval must run in Influence"
  [[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]] || die "approval run attempt is invalid"
  [ "${GITHUB_ACTOR:-}" = "$APP_ACTOR_LOGIN" ] || die "approval run was not initiated by the trusted App"
  [ -f "${GITHUB_EVENT_PATH:-}" ] || die "approval event metadata is unavailable"
  jq -e --arg actor "$APP_ACTOR_LOGIN" --argjson actor_id "$APP_ACTOR_ID" \
    '.sender.login == $actor and .sender.id == $actor_id' "$GITHUB_EVENT_PATH" >/dev/null \
    || die "approval event sender is not the trusted App"
  [ "${GITHUB_SHA:-}" = "$(git rev-parse HEAD)" ] || die "approval workflow checkout does not match GITHUB_SHA"
  install -d -m 0700 "$output_dir"

  gh api -H 'Accept: application/vnd.github+json' "/repos/$INFLUENCE_REPOSITORY/environments/$APPROVAL_ENVIRONMENT" \
    > "$output_dir/environment.json"
  validate_environment_file "$output_dir/environment.json"

  GH_TOKEN="$POLICY_TOKEN" gh api -H 'Accept: application/vnd.github+json' "/repos/$INFLUENCE_REPOSITORY/rulesets/$MAIN_RULESET_ID" \
    > "$output_dir/main-ruleset.json"
  validate_main_ruleset_file "$output_dir/main-ruleset.json"

  GH_TOKEN="$POLICY_TOKEN" gh api -H 'Accept: application/vnd.github+json' "/repos/$INFLUENCE_REPOSITORY/environments/$APPROVAL_ENVIRONMENT/secrets" \
    > "$output_dir/environment-secrets.json"
  jq -e '.total_count == 0 and (.secrets | length) == 0' "$output_dir/environment-secrets.json" >/dev/null \
    || die "Influence production environment must not contain secrets"

  gh api -H 'Accept: application/vnd.github+json' "/repos/$INFLUENCE_REPOSITORY/git/ref/heads/main" \
    > "$output_dir/main-ref.json"
  jq -e --arg workflow_sha "$GITHUB_SHA" '
    .ref == "refs/heads/main" and .object.type == "commit" and .object.sha == $workflow_sha
  ' "$output_dir/main-ref.json" >/dev/null || die "approval workflow is not the current Influence main revision"

  if [ "$require_approval" = true ]; then
    gh api -H 'Accept: application/vnd.github+json' "/repos/$INFLUENCE_REPOSITORY/actions/runs/$GITHUB_RUN_ID/approvals" \
      > "$output_dir/approval-history.json"
    jq -e --arg reviewer "$APPROVER_LOGIN" --argjson reviewer_id "$APPROVER_ID" '
      [.[]
        | select(.state == "approved")
        | select(.user.login == $reviewer and .user.id == $reviewer_id)
        | select(any(.environments[]?; .name == "production"))] | length >= 1
    ' "$output_dir/approval-history.json" >/dev/null || die "exact Influence production approval is unavailable"
    jq -S -n --arg login "$APPROVER_LOGIN" --argjson id "$APPROVER_ID" '{login:$login,id:$id}' \
      > "$output_dir/approval-reviewer.json"
  fi
}

case "${1:-}" in
  verify-request) verify_request "${2:-verified-request}" ;;
  verify-policy) verify_policy "${2:-verified-policy}" ;;
  verify-preapproval-policy) verify_policy "${2:-verified-policy}" false ;;
  validate-environment-fixture) validate_environment_file "${2:-}" ;;
  validate-main-ruleset-fixture) validate_main_ruleset_file "${2:-}" ;;
  *) die "usage: $0 {verify-request|verify-policy} [output-directory]" ;;
esac
