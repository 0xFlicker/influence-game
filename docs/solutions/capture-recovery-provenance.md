---
module: game evidence
problem_type: recovery
summary: Preserve private capture provenance across adopted durable turns
---

# Accepted capture recovery

A provider result can be accepted by one worker, replayed from its durable journal,
and committed to canonical gameplay by a later worker. The original private trace
must retain its original owner epoch. Matching only the committing epoch incorrectly
reports missing captures. Matching any historical decision ID would be too broad.

The correlation reader now follows only a terminal, usable, accepted provider
attempt for the same game and deterministic decision ID. It requires either the
legacy canonical-event binding or the current durable-turn binding: committed turn,
matching commit time and owner, and that turn's immutable commit result containing
the exact canonical decision/action. It links only those validated sidecar IDs;
it never changes their owner, object content, or canonical gameplay. Unrelated,
uncommitted, conflicting, and cross-game evidence remains excluded. No public
projection or authorization changes are made.

PostgreSQL failures retain SQLSTATE and a sanitized constraint name, not SQL,
parameters, model text or driver detail. Only serialization failures and deadlocks
(40001/40P01, known-aborted transactions) retry, at most three total attempts.
Connection failures with uncertain commit outcomes do not retry blindly.

## Orphan index recovery

An object upload can succeed before its index transaction fails. This fix does not
scan buckets or automatically repair historical records. The explicit operator tool
reads the existing private object, verifies a separately reviewed SHA-256, checks
its game/owner/decision against the accepted journal and canonical event, and emits
a read-only plan by default. The original capture owner must be inactive so repair
does not race a live capture writer. It never calls a model or rewrites the object.

From `packages/api`, with the intended environment's existing private storage and
DB configuration, run:

```sh
bun src/scripts/recover-private-trace-index.ts --game GAME_ID --key PRIVATE_OBJECT_KEY --sha256 sha256:REVIEWED_HASH
```

Review the environment, original key/hash, plan and existing record state before
any application. Applying an existing staging or production repair requires separate
review/authorization; no existing-game repair is included in this change. Once
approved, use the same arguments plus `--apply --reason 'ISSUE: reviewed repair'`.
The tool restores one producer-only index with original ownership and records its
recovery time, database role and reason. Concurrent identical applications serialize
and create at most one index. Existing conflicting or redacted/expired records are
not replaced or resurrected. Normal correlation can subsequently link eligible
cognition and accounting sidecars. Non-decision traces and evidence without a
provable accepted journal binding require separate investigation, not guessed links.

Deployment draining reduces interrupted-owner cases but does not eliminate crashes
or incomplete evidence indexing. This change requires no schema migration. Existing
legacy links remain supported. It does not guarantee every historical orphan can be
repaired, nor establish the original SQLSTATE for failures whose old logs omitted it.

## Verification

Isolated PostgreSQL coverage includes both legacy and durable commit bindings,
unchanged provenance, idempotency, unrelated-owner and uncommitted-turn rejection,
missing-index preview/apply, concurrent apply, hash/cross-game rejection and secret
exclusion. Error tests cover nested PostgreSQL causes, bounded transient retries,
and no retry on uncertain connection failures. A read-only staging run recognized
nine previously misclassified captures; the remaining orphan index was not repaired.

The original staging orphan's recovery plan was also exercised in read-only mode:
it matched the original owner, accepted decision and canonical event, and returned
`alreadyIndexed: false, applied: false`. This is validation of the plan, not a live
repair or deployment. Diagnostic scripts ran separately from the deployed worker.
