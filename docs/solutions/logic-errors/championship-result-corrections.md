# Preserve evidence when correcting championship results

A completed championship result is derived from a canonical game. Overwriting its score row or reusing an old award allocation destroys the explanation of what changed and can resurrect a revoked badge on retry.

Migration 0148 retains old results under `(match_id, entry_id, revision)` and binds each to its actual game. A correction requires the exact current game/revision, a reason, an idempotency key, and both championship and award management authority. Resettle recomputes from the same canonical game; replay retains that game and admits a fresh exact-match attempt using the frozen competition build. Neither operation edits canonical outcome evidence.

Serialize correction, settlement and delivery on the event row. Supersede only champion allocations for the affected game type, revoke linked recipient-replacement descendants, and allocate a new generation after current results settle. Keep season and finalist allocations intact. Carry explicit manual revocations forward; an old allocation must never deliver or reinstate after supersession. Recipient correction creates a new linked grant with new evidence and revokes the original atomically.

## Operator recovery

Use Admin → Championships → completed match → correction. Review the exact game and scoring revision, choose resettle or replay, and enter the reason. A paused event remains paused; resettlement can finish while paused, but a fresh replay dispatch waits for resume. A final event explicitly corrected reopens for reconciliation. Review scoring history, standings and award history after the worker reconciles. Use the current award grant for subsequent revoke/reinstate or recipient correction.

## Verification

The correction PostgreSQL suite covers historical migration, immutable games and result history, recipient chains, manual revocations, authority, delayed retries, cancelled replacement recovery, and final-event reconciliation. A provider-free local browser rehearsal exercises actual producer routes and forms against a separate per-process database. It verifies unchanged canonical evidence, no extra game during resettlement, current award recipients, paused state, and narrow-screen history rendering. See `docs/championship-validation.md` for exact completed checks.
