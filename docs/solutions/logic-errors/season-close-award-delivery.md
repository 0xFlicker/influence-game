---
module: Seasons and awards
tags: [season-finalization, badges, idempotency]
problem_type: logic_error
---

# Season badges missing after closeout

Season finalization froze honors and qualification, but reusable badges were allocated only after championship activation. A successfully finalized season with no running championship therefore had no account or agent badges.

The finalize HTTP action now reconciles season badges immediately after durable finalization. A separate permission-protected preview and reconciliation action handles seasons finalized before the fix and delivery failures. The plan reads only frozen honors and finalization receipts, with the confirmed one-completed-game threshold. Season-row locking and atomic grant delivery make retries safe; existing original achievements are retained even when revoked or replaced. New championship outboxes no longer include season rewards, and legacy outboxes preserve existing overlapping grants.

Tests cover the real finalize route without an event, authenticated management, read-only previews, concurrent retries, immutable evidence, existing revocations, atomic rollback and retry, missing historical evidence, subsequent-season exclusion, and legacy outbox overlap. No schema migration or data reset is required.
