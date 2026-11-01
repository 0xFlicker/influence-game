---
title: Keep gameplay image bytes out of attempt evidence and identify client deadlines
date: 2026-11-01
module: provider execution and private evidence
problem_type: runtime_error
tags: [provider-journal, images, signed-urls, timeouts, private-storage]
---

Visual context preparation expanded stored PNGs into base64 strings. Both prepared
and captured requests repeated those strings in every attempt. Production samples
also ended at roughly 45.1 seconds without a remote HTTP response: the generic
`transport_timeout` label hid the application's short generation deadline.

Use stable image identities in frozen context and private evidence; sign private
GET URLs only at dispatch. Reuse the existing content-addressed binary payload
store and verify bytes before signing. Keep signed credentials out of evidence.
Never put an expiring URL into a context hash. Do not upload private images to the
public asset bucket to make local evaluation work; use reachable HTTPS private
storage. Storage/signing errors must survive SDK wrapping and stop further paid
attempts. An interrupted upload can leave an unreferenced immutable object; retain
it for the existing storage inventory, never delete shared hashes on retry or when
deleting one game's evidence.

Default API generation to 300 seconds. Attribute explicit SDK/application
deadlines separately from remote timeout responses, transport failures, unknown
timeouts and cancellation. Keep original error classes and transport timing.
Client-deadline failures stay in the durable journal but do not trigger shared
provider-outage circuit breakers. A local abort does not prove remote work stopped.

Tests use deterministic storage and the actual SDK with fake HTTP responses,
including wrapped storage failures, URL refresh, cancellation and real short
client timers. PostgreSQL tests cover binary identity and health isolation.

Scope explicitly excludes converting or deleting existing evidence. Original
historical objects, references and hashes remain untouched.

Release with the stack’s stopped-writer/drain procedure: newly prepared visual
contexts use image identities instead of data URLs, which changes context hashes.
Do not replace a live writer midway through an unfinished logical call. Existing
frozen evidence is not rewritten to match the new representation.
