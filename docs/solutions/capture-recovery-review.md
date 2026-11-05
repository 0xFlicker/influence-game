# Recovery capture review — 2026-11-05

Scope: correlation and explicit orphan-index repair only. No schema migration,
new HTTP route, public projection change, model calls, scheduling change or
production control operation.

Review findings addressed:

- Initial implementation supported only the old canonical-event field. Actual
  staging verification exposed the durable-turn path. Added committed turn/time/
  owner checks and immutable commit-result decision/action proof, plus regressions.
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
created disposable influence_capture_recovery_20261105 database. No shared staging,
production, or localhost development database is used for tests.
