# Recovery capture review — 2026-11-05

Scope: correlation and explicit orphan-index repair only. No schema migration,
new HTTP route, public projection change, model calls, scheduling change or
production control operation.

Review findings addressed:

- Initial implementation supported only the old canonical-event field. Actual
  staging verification exposed the durable-turn path. Added committed turn/time/
  owner checks and immutable commit-result decision/action/hash proof, plus regressions.
  The commit event hash must match the exact canonical event and its own payload.
- Loading every turn payload on ordinary appends was unnecessary. Correlation
  resolves historical provenance only when the accepted attempt's owner differs;
  explicit index repair still validates either binding fully.
- SQL and JSON parse exceptions can contain private evidence. Logs now retain
  SQLSTATE/constraint only; operator parse failures use fixed safe messages.
- Retrying uncertain connection failures could duplicate writes. Only PostgreSQL
  known-aborted serialization/deadlock transactions retry, with a bounded count.
- Recovery must not overwrite owner attribution or regenerate a trace. It reads
  and hashes the existing object, preserves its owner, validates journal/canonical
  linkage, and writes only an audited producer-only index. Inactive original owner
  requirement avoids racing a live capture writer. Preview is read-only; apply
  requires a reason. Conflicting or redacted existing records are not replaced.
- Cross-epoch linking updates only validated row IDs and the original owner's
  accounting rollup. Existing conflict checks still reject mismatched actions or
  event links; legacy records without accepted journal proof are not guessed.

Verified staging behavior: the new reader reduces ten missing captures to one,
without changing any records. The orphan preview verifies the remaining exact
accepted decision and returns applied=false. This is not a deployment or repair.
The original insert's SQLSTATE remains unknown; the bounded retry is a general
transient-failure improvement, not an assertion that the observed failure was a
deadlock. Production draining mitigates interruptions, not all recovery failures.

Validation results are recorded in the PR. Full database tests use only the newly
created disposable influence_capture_recovery_20261105 database; final focused
review tests use the separate empty influence_capture_review_20261105 database. No shared staging,
production, or localhost development database is used for tests.

CI follow-up: PostgreSQL shard 1 on 1a883e9b exposed a correction authorization
fixture that called the real scheduling route with a running, overdue event.
Its 17 local delivery timers survived into later fixtures and raced TRUNCATE
(40P01), then retried against the replaced data. The authorization fixture now
pauses its event before requesting correction and asserts it stays paused with
no other match admitted. This retains the real route and scheduler acknowledgement
while avoiding unrelated timed launches; no production scheduler behavior changes.
The correction and scheduling files pass together: 18 tests, 124 assertions.
The earlier full local run was interrupted by the Mac disconnect (including an
839-second hook timeout); it is not counted as a passing baseline and is rerun.
