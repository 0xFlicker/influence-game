---
module: storage
tags: [aws, runtime-config, historical-playback]
problem_type: architecture
---

# Runtime delivery aliases preserve image promotion and historical identity

The same immutable web image is promoted from staging to production. Embedding an environment-specific storage origin through `NEXT_PUBLIC_*` would bind that image to the wrong environment. Public media routing therefore uses the existing server public-runtime-config response and a request-scoped React context. Worker fetches read the same three nonsecret runtime values. An explicit legacy context does not inherit AWS settings from the server process.

Resolve storage locations at presentation/fetch boundaries while retaining original game/profile documents, URL-indexed evidence maps and accepted hashes. Public playback JSON that embeds media URLs is a separate publication: prepare a versioned derived document and receipt, then require verified upload and a transactional pointer change. See the [compatibility guide](../../deployment/aws-object-storage-preparation.md) and [reference census](../../deployment/aws-storage-reference-census.md).
