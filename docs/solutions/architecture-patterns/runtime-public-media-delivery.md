---
module: storage
tags: [aws, runtime-config, historical-playback]
problem_type: architecture
---

# Runtime delivery aliases preserve image promotion and historical identity

The same immutable web image is promoted from staging to production. Embedding an environment-specific storage origin through `NEXT_PUBLIC_*` would bind that image to the wrong environment. Public media routing therefore uses the existing server public-runtime-config response and a request-scoped React context. Worker fetches read the same three nonsecret runtime values. An explicit legacy context does not inherit AWS settings from the server process.

Resolve storage locations at presentation/fetch boundaries while retaining original game/profile documents, URL-indexed evidence maps and accepted hashes. Public playback JSON that embeds media URLs is a separate publication: prepare a versioned derived document and receipt, then require verified upload and a transactional pointer change. See the [compatibility guide](../../deployment/aws-object-storage-preparation.md) and [reference census](../../deployment/aws-storage-reference-census.md).


Historical publication reconciliation now has a file-only planner in `scripts/public-playback-pointer.ts`. It requires verified target versions and original/current metadata identity before producing a full-row compare-and-swap. Lock game then media, preserve concurrent attempt fields and publication identity, and refuse inverse updates after any later accepted row change. The PostgreSQL rehearsal is isolated from shared databases. A successful SQL rehearsal is not evidence that the live reference census or writer fence is complete.
