# Whole private payload storage cutover

This is **one coordinated maintenance release per environment**. Migrations `0119`–`0122` run together after all writers stop. They are four SQL files in the same database transaction, not multiple application deployments. Do not use rolling/blue-green overlap for this release. Do not merge and let an unattended staging startup substitute for the cutover procedure.

The application never reads the old database bodies as a fallback. PostgreSQL retains authority, identities, permissions, relationships, hashes, versions and small metadata. Private object storage holds exact image bytes and losslessly compressed document bodies. Existing private/public access boundaries remain in place.

## Inventory

The executable inventory is `packages/api/src/services/storage-payload-inventory.ts`. All existing non-null values in these **33 columns** migrate; empty environments use the same schema migrations.

| Contents | Original columns |
| --- | --- |
| Images and original character assets | `visual_artifacts.image`, `visual_render_attempts.image`, `visual_room_library.image`, `agent_content_assets.bytes` |
| Retrospective frozen context | `game_retrospective_inputs.input` |
| Recovery and accepted provider results | `game_checkpoints.snapshot`, `game_turns.intent`, `game_turns.commit_result`, `provider_logical_calls.accepted_value` |
| Cognitive and learning documents | `game_cognitive_artifacts.payload`, `agent_learning_game_evidence.canonical_snapshot`, `.candidate_moments`, `agent_learning_reviews.checkpoint`, `.result` |
| Raw learning/provider evidence, including pending outboxes | `agent_learning_review_calls.validated_checkpoint`, `.request_evidence_body`, `.response_evidence_body`, `agent_learning_review_failure_evidence_outbox.body`, `provider_attempt_evidence_outbox.body`, `provider_health_probe_evidence.record` |
| Editorial, rendering and repair documents | `house_cut_jobs.source`, `.journal`, `.publication`, `game_postgame_media.render_input_snapshot`, `visual_operation_events.evidence`, `visual_render_operations.request`, `visual_repair_jobs.render_context`, `visual_media_requests.input` |
| Immutable character revisions and editor responses | `agent_content_revisions.snapshot`, `agent_revisions.behavior_snapshot`, `.effective_runtime_snapshot`, `account_text_operations.result`, `anonymous_text_operations.result` |

Each SQL column becomes `<old_name>_object`; application property names stay stable. The database checks allow only the seven reference fields, never an embedded body. The private bucket is the existing `PRIVATE_TRACE_STORAGE_*` configuration; it must differ from the public asset bucket. New objects live under `payloads/v1/{codec}/{sha256}`. Images are byte-exact. JSON/text uses gzip. Both stored and uncompressed SHA-256 and byte lengths are verified on reads.

Already-bucket-backed avatars, editorial game assets, private traces and rendered media stay in their existing stores. The isolated staging-render proof fixture also stores its frozen document as an object reference; its disposable proof database is recreated from the exported fixture, not upgraded in place.

### Data deliberately remaining relational

Canonical game events, dialogue/transcript records, publication envelopes, result/rating facts and ownership/lease state remain relational authority. The current execution cursor, XState state and continuity capsules remain transactional operational state. Editable profile fields, game configuration, scene plans, localization geometry, asset IDs, crops, routing state, receipts, diagnostics and indexed aggregates remain structured database records. They are not copies of images, raw provider transcripts or frozen export/context documents. Historical recovery snapshots, complete immutable profile revisions and accepted provider outputs do move.

Preflight rejects any unclassified BYTEA column. It also scans other text/JSON columns for common embedded binary encodings (data URLs, base64 image fields and serialized Node Buffers), reporting only table/column/count. This is a discovery check, not a proof against every conceivable encoding; new storage fields still require source review and registry updates.

## Integrity and failure behavior

Upload uses immutable conditional creation and then downloads the object to verify exact bytes before a reference can commit. Identical bodies reuse objects. Authorization remains on the owning database row; clients receive the existing authorized payload/API response, not raw private storage references. Reference-looking user JSON is treated as document content and cannot cause another object to be read.

Copy is resumable, uses primary-key keyset pages and bounded concurrent uploads, and writes small receipts. Verification re-reads every object. Cutover locks all affected tables and rechecks the original body hash against its receipt inside the schema transaction. Changes during pre-copy, absent receipts or invalid reference metadata abort the transaction. Existing IDs, foreign keys, canonical hashes, accepted outcomes and timestamps remain unchanged. A session setting supplied only by `storage:cutover` prevents ordinary startup from migrating populated bodies, even if copy receipts already exist.

An object outage/corrupt object is an explicit storage error. There is no database-body fallback, silent empty value, lossy migration or historical regeneration. Compression imposes no context-size ceiling. Existing game/provider journal fences remain in place; a storage error must never authorize repeating an uncertain paid dispatch.

## Commands and coordinated release

The CLI requires an explicit `DATABASE_URL`; it never chooses local/staging/production. Supply the private bucket credentials through the environment's existing secret mechanism. Do not put credentials in logs or PRs.

From a source checkout with the environment already selected:

```bash
bun run storage:inventory
bun run storage:copy
bun run storage:verify
# Only after the drain and full stop below:
bun run storage:cutover --writers-stopped
```

The release API image packages the same command, with `DRIZZLE_MIGRATIONS_DIR=/app/drizzle`:

```bash
bun /app/dist/migrate-storage-payloads.js inventory
bun /app/dist/migrate-storage-payloads.js copy
bun /app/dist/migrate-storage-payloads.js verify
bun /app/dist/migrate-storage-payloads.js cutover --writers-stopped
```

1. Pin matching candidate API/gateway/game-worker and web images. Provision/verify the environment's private bucket and credential access. Retain the prior images. Take a full database backup and test restoring it. Record initial inventory and canonical/relational state fingerprints. Budget temporary disk space for the SQL rewrite, WAL and backup as well as bucket capacity.
2. Pre-copy while the old application runs if desired. This does not change old readers or writers and does not deploy an intermediate application. Repeat safely after interruption.
3. Close admissions and drain through the existing deployment controls. Stop **every** gateway, game worker, render/learning/media worker, scheduler, maintenance writer and watcher using that database. Disable automatic restarts during the window. The environment is unavailable during cutover. Do not leave the old release controller's automatic rollback pointing at this incompatible schema.
4. Run the pinned candidate's `cutover --writers-stopped` as a one-shot process with the explicit target database and bucket. It refuses other database connections both before copy/verification and immediately before SQL. The operator attestation covers reconnecting clients that a snapshot of `pg_stat_activity` cannot prove absent. The command takes a migration advisory lock, finishes copying, verifies, applies all four SQL files transactionally, then verifies the references against storage again.
5. Keep the environment closed until verification succeeds. Start only the matching candidate gateway/web first; prove image reads, document reads, existing replay/Studio/export reads, retrospective frontier inspection, and recovery binding without issuing paid calls. Compare saved state fingerprints and inventory. Start matching workers and reopen admission through the environment's coordinated release controls. Record the accepted release identity. **Do not resume the old rolling deployment procedure midway through this window.**
6. Measure actual database/TOAST sizes after the table rewrite. The migration replaces inline bodies rather than leaving dead body columns. Normal vacuum/analyze can refresh statistics; schedule any additional database compaction based on measured remaining space, not a claim that an object upload alone freed disk.

Staging and production each repeat this procedure against their own existing data. Local proof does not certify either live environment. An ordinary automated deployment is expected to fail safely on populated pre-cutover rows; it must not bypass the guard or fabricate migration receipts.

## Interruption and rollback

- Copy interruption: old database bodies remain authoritative. Rerun copy; retained receipts are revalidated against source hashes and bucket contents.
- Verification or SQL failure: keep writers stopped, inspect the error, repair the actual missing/corrupt object or source copy, and rerun. PostgreSQL rolls back all pending migrations together.
- Crash after SQL commit: rerun `cutover` with writers stopped. Copy skips converted columns, Drizzle skips applied migrations, and full object verification runs again. Do not reverse column names or edit the migration journal to force another conversion.
- Post-commit application rollback requires restoring the pre-cutover database backup and matching old images **before reopening writes**. A code-only rollback cannot read the new schema. After new writes have been accepted, restoration would discard them; preserve and reconcile them rather than silently restoring an old backup.

## Retention and orphan objects

Database rollback or deletion can leave an uploaded object unreferenced. This release deliberately retains those immutable objects; it never deletes from the shared payload prefix during row deletion, outbox reconciliation, migration cleanup, or failed transactions. Migration receipts also retain the original reference/hash for audit and recovery. This is an explicit conservative retention policy, not an unimplemented automatic deletion path.

Do not configure blanket TTL deletion on `payloads/v1/`. Deduplication means many rows may share one object, and a private bucket can be shared by a rehearsal/proof database. Any later purge must inventory references from **all** databases and retained backups using that bucket, preserve referenced objects, fence concurrent uploads, apply a retention grace period, and audit deletion. Existing private-trace/public-asset lifecycle tools must remain scoped to their own prefixes. Back up bucket objects alongside reference-only database backups; a database dump alone no longer contains these bodies.

## Local rehearsal evidence

The populated local-development rehearsal moved **73,974 bodies across all 33 columns: 3,666,436,653 uncompressed bytes**. Full object verification passed after cutover. Fingerprints across all 116 application tables preserved every non-body row/value; only the intended new Studio/accounting query metadata is excluded from the comparison and separately checked against its stored input.

Application-level read checks passed for 12 existing images, both existing retrospective inputs and their canonical recovery frontiers, 100 accepted provider results, 20 checkpoints, and all 16 Studio request metadata rows. No provider calls were made. A separate restore of the original database backup rehearses the complete final migration chain from the original schema. The backup and detailed machine-readable receipts remain local, outside Git.

The provider-free suite, PostgreSQL suite and browser evidence are recorded with their actual results in the PR. Staging and production remain pending; local evidence is not live deployment evidence.
