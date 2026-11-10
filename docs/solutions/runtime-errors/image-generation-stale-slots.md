---
module: Agent creation
tags: [image-generation, cancellation, recovery, inference-accounting]
problem_type: runtime_error
date: 2026-11-07
---

# Expired image execution must not retain account capacity

An interrupted provider request left a dispatched inference reservation without a
receipt. The draft was discarded, but admission counted the unresolved financial
record as a live execution forever. A subsequent image remained queued.

Keep financial state separate from execution ownership. Image reservations now
have a two-minute lease, renewed every 15 seconds during provider work. Admission
and worker maintenance release expired execution. An undispatched hold can be
refunded once; a dispatched request retains its debit and uncertain outcome.
Recovery never retries a paid provider or invents a receipt.

The owner activity feed includes queued drafts, prepared artwork, older portrait
and agent-preparation jobs, and orphan reservations. Cancellation fences the job
and releases its slot under the same owner/account locks as dispatch. The worker
checks that fence at the durable provider boundary. Late receipts remain stored;
late output cannot update a cancelled draft or the accepted profile.

Tests use PostgreSQL and mocked transport to cover concurrent starts, cancellation
before reservation, cancellation during HTTP, late success, expired leases,
idempotent refunds, owner isolation and the preparation save boundary. Browser
journeys prove visibility and cancellation preserve editor drafts. See the
[execution and billing contract](../../agent-generations.md).
