---
module: API persistence
problem_type: architecture
component: private object storage
tags: [storage, postgres, migration, retrospective, images, recovery]
date: 2026-10-17
---

# Keep body persistence separate from relational acceptance

Images and frozen documents had accumulated in PostgreSQL BYTEA, JSONB and TEXT columns, including large images duplicated across render attempts and accepted artifacts. A retrospective size gate then turned a storage choice into a game suspension.

The storage migration replaces 33 body columns with checked immutable private-object references and migrates every existing body. Store and verify the object before accepting its reference; keep permissions, ownership fences, accepted event coordinates, semantic hashes and relationships in PostgreSQL. Storage may happen within an existing owning transaction when its decision depends on locked state, but the reference cannot commit before the object is verified. No database-body fallback is permitted.

Use `payloadColumn` for schema references, `storeFields`/`storeJson` for writes, and explicit `loadPayloads`/`readJson` at owning reads. A reference-shaped user document is data, not an instruction to load a private object. The decoder marks actual database references; hydration preserves non-plain operational objects such as Maps and Dates.

Audit raw SQL and PL/pgSQL functions separately from TypeScript. Column renames do not rewrite field names embedded in trigger function bodies. The learning failure-evidence trigger and immutable visual-repair trigger both require updates. Bounded primary-key pagination is preferable to sorting large body tables by constructed JSON keys.

The migration must be run with every writer stopped, including development watchers and automatic restarts. Populated-data startup is guarded even after pre-copy. All four schema migrations execute in one maintenance transaction; a missing copy aborts the whole transaction. Never infer a successful migration from an uploaded object or a copied receipt alone. Verify all objects after commit, compare non-body state fingerprints, and measure reclaimed table/TOAST space.

Test adapters belong only in tests. Browser fixtures and the API child process need a shared isolated object store; an in-memory parent-only adapter cannot prove child reads. The browser harness explicitly preloads its filesystem object store, while normal application startup always uses the configured private bucket.

See [the operational runbook](../../deployment/private-payload-storage-cutover.md) for inventory, backup/restore boundaries, the packaged cutover command, and conservative object retention.
