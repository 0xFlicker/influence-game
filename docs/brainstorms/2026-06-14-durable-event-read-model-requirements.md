---
date: 2026-06-14
topic: durable-event-read-model
---

# Durable Event Read Model Requirements

## Summary

API-backed Influence games should gain an API-only durable truth read model that loads persisted Postgres canonical events, validates their integrity, replays them into the canonical game projection, and exposes operator-grade diagnostics through an admin read endpoint. This slice makes the durable event log inspectable before adding admin UI, production RPC, simulation import, or checkpoint resume.

---

## Problem Frame

The durable game-run kernel now writes API canonical events, owner epochs, checkpoint capsules, and private evidence manifests. That makes interrupted runs more durable, but the database rows are still mostly a write-side safety rail. Operators can see redacted counts through kernel health, yet cannot ask the API what the ordered event log actually proves about a suspended or completed game.

This matters before resume. A future `GameRunner.fromCheckpoint()` should not depend on an event store that has never been read back, validated, replayed, and compared against checkpoint boundaries. The next safest step is to make one API game's durable log explain where the run is.

---

## Key Decisions

- **API-only before UI.** The first delivery exposes durable truth through services and an admin endpoint, while the admin panel is deferred.
- **Admin/operator before public RPC.** The response shape should be future-RPC-ready, but this slice remains authenticated admin infrastructure.
- **Diagnostics before resume.** Replay and warnings are in scope; continuing a suspended runner is not.
- **On-demand replay before projection storage.** Materialized projection tables are deferred until replay cost or query volume justifies them.
- **Redacted evidence summaries only.** Evidence manifest presence and coverage are visible, but raw prompts, responses, reasoning, object keys, and source pointers remain out of the durable-run endpoint.

---

## Actors

- A1. **Operator or maintainer** inspects suspended, completed, or suspicious games.
- A2. **Admin API client** requests durable run truth for one game.
- A3. **Durable read service** loads ordered Postgres rows and validates event integrity.
- A4. **Projection replay reducer** rebuilds canonical board truth from canonical events.
- A5. **Future UI or RPC consumer** can reuse the response contract after this slice proves the read model.

---

## Requirements

**Event Retrieval and Integrity**

- R1. The API must provide a durable read service that loads a game's persisted canonical events in sequence order.
- R2. The read service must validate that each event row's game ID, sequence, event type, payload version, and hash agree with the stored canonical envelope.
- R3. The read service must detect sequence gaps, duplicate conflicts, unsupported payload versions, wrong-game envelopes, and hash mismatches as diagnostics rather than silently trusting the log.
- R4. The read service must treat games with no durable events as inspectable pre-kernel or empty-log cases, not as server errors.

**Projection Replay**

- R5. The API must replay valid persisted events through the engine's canonical projection reducer.
- R6. Replay failures must return machine-readable diagnostics and enough context for an operator to locate the failing sequence.
- R7. The projection result must expose durable board truth such as last sequence, round, phase, player statuses, alive/eliminated counts, vote/council state, accepted outcomes, and winner state when present.
- R8. The projection read must not infer XState cursor, in-flight phase state, LLM context, or resume eligibility from canonical events alone.

**Admin Durable-Run Endpoint**

- R9. The API must expose an admin-only read endpoint for one game's durable run state.
- R10. The endpoint response must include game identity/status, latest owner/kernel health, event head, replay status, projection summary, diagnostics, checkpoint summaries, and evidence manifest summaries.
- R11. The endpoint must use a versioned response shape so a later UI or RPC surface can consume it without reinterpreting ad hoc fields.
- R12. The endpoint must be permission-gated with the existing admin read boundary.

**Checkpoint Readiness**

- R13. The endpoint must list checkpoint capsules by event boundary, including kind, phase, round, last event sequence, event-head hash, projection hash, hydrateable flag, hydration status, transcript cursor, token-cost cursor presence, and degraded reason.
- R14. Checkpoint output must make `hydrateable=false` and missing hydration inputs visible whenever a checkpoint is forensic only.
- R15. Checkpoint output must not expose any action that suggests resume is supported in this slice.

**Private Evidence Boundary**

- R16. Evidence manifest output must be redacted to summary information such as counts by evidence type, event-sequence coverage, retention class, redaction status, and storage-provider presence.
- R17. The durable-run endpoint must not return raw prompts, raw model responses, `thinking`, `reasoningContext`, storage buckets, storage keys, or private source pointers.
- R18. Evidence manifest summary failures must appear as diagnostics without blocking event replay when event replay itself is still valid.

**Validation and Compatibility**

- R19. Automated tests must prove that persisted API events replay through the same canonical projection contract as simulator JSONL and engine event replay.
- R20. Automated tests must cover empty/pre-kernel games, corrupted or incomplete logs, admin auth gating, redacted evidence summaries, and non-hydrateable checkpoint summaries.
- R21. A local smoke verification must run against a real API-backed game and Postgres to prove the endpoint can inspect events/checkpoints written by the live durable kernel path.

---

## Key Flows

- F1. Inspect a durable run
  - **Trigger:** An operator requests durable truth for one API game.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The endpoint checks admin permissions, loads durable run rows, validates event integrity, replays the projection, loads checkpoint/evidence summaries, and returns diagnostics.
  - **Outcome:** The operator can see what the durable log proves and where it stops.
  - **Covered by:** R1-R14, R16-R18

- F2. Empty or pre-kernel game is inspected
  - **Trigger:** An operator requests durable truth for a game with no persisted canonical events.
  - **Actors:** A1, A2, A3
  - **Steps:** The read service returns an empty-log status with owner/kernel metadata when available.
  - **Outcome:** The API stays useful for older games without pretending a projection exists.
  - **Covered by:** R4, R9-R12

- F3. Corrupt or incomplete log is inspected
  - **Trigger:** Event rows contain a sequence gap, metadata mismatch, hash mismatch, or unsupported payload version.
  - **Actors:** A1, A3, A4
  - **Steps:** The read service records diagnostics, replay stops or returns partial-safe status according to the failing condition, and the endpoint reports the failing sequence.
  - **Outcome:** Operators see the exact durable-store problem before resume or UI depends on the log.
  - **Covered by:** R2, R3, R6

- F4. Live-kernel smoke verification
  - **Trigger:** A local API-backed game has produced durable events and checkpoint capsules.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The operator calls the admin endpoint for that game and compares diagnostics, projection summary, checkpoint readiness, and redacted evidence summary against the run.
  - **Outcome:** The read model is proven against the actual append/checkpoint path, not only inserted fixtures.
  - **Covered by:** R19-R21

---

## Acceptance Examples

- AE1. Covers R1-R7.
  - **Given:** A game has contiguous persisted canonical events.
  - **When:** The admin durable-run endpoint is requested.
  - **Then:** The response reports a successful replay and a projection whose last sequence matches the event head.

- AE2. Covers R2, R3, R6.
  - **Given:** A persisted event row's envelope hash no longer matches the stored event hash.
  - **When:** The durable read service loads that log.
  - **Then:** The response includes a hash-mismatch diagnostic tied to the event sequence.

- AE3. Covers R4.
  - **Given:** A pre-kernel game has no rows in the durable event log.
  - **When:** The admin durable-run endpoint is requested.
  - **Then:** The response is successful and says no durable projection is available yet.

- AE4. Covers R13-R15.
  - **Given:** A game has checkpoint capsules written by the durable kernel.
  - **When:** The endpoint returns checkpoint summaries.
  - **Then:** Each checkpoint preserves its event boundary and reports `hydrateable=false` with missing hydration inputs.

- AE5. Covers R16-R18.
  - **Given:** A game has private evidence manifests with storage pointers.
  - **When:** The endpoint returns evidence summaries.
  - **Then:** The response excludes storage bucket, storage key, raw prompt, raw response, `thinking`, `reasoningContext`, and source-pointer internals.

- AE6. Covers R19-R21.
  - **Given:** A local API-backed smoke game completes or suspends after writing durable events.
  - **When:** The endpoint is called against that game.
  - **Then:** The response replays persisted events, reports checkpoint readiness, redacts evidence summary, and has no happy-path diagnostics.

---

## Success Criteria

- A suspended or completed API game can be inspected through the API without manual SQL.
- Persisted API events replay through the same canonical projection contract as simulator JSONL events.
- Diagnostics make event-store incompleteness visible before checkpoint hydration work depends on it.
- Checkpoint output clearly communicates forensic readiness without advertising resume.
- Evidence manifest summaries prepare for future Linode S3 raw logs without exposing private evidence.

---

## Scope Boundaries

In scope:

- Durable event read services.
- Admin-only durable-run API response.
- Event integrity diagnostics.
- Canonical projection replay from persisted events.
- Checkpoint readiness summaries.
- Redacted evidence manifest summaries.
- Automated tests and one local API-backed smoke verification.

Out of scope:

- Admin UI panel or viewer changes.
- Production RPC publishing or external client auth.
- Public replay APIs.
- Raw S3 evidence browsing.
- Simulation import into Postgres.
- Redis, pub/sub, or horizontal scaling.
- Materialized projection tables.
- `GameRunner.fromCheckpoint()` or any resume action.

---

## Dependencies and Assumptions

- The durable game-run kernel remains the write-side source for API event rows, owner epochs, checkpoint capsules, and evidence manifests.
- The canonical projection reducer remains the authority for deriving board state from canonical events.
- Existing admin auth and permission middleware are sufficient for this first operator-only API surface.
- Local smoke verification can run against a real Postgres-backed API game before the slice is considered complete. Local Postgres runs in Docker; sandboxed agents usually need elevated sandbox access for DB-backed commands against `127.0.0.1:54320`.

---

## Outstanding Questions

Resolve before planning:

- None.

Deferred to planning:

- Exact route path and response field names.
- Whether the first endpoint returns the full projection or a projection summary plus enough details for inspection.
- Whether diagnostics should allow partial projection when replay fails after a valid prefix, or return only failure metadata.
- Exact pagination/filtering shape for any event-list access beyond the head and diagnostics.

---

## Sources

- `AGENTS.md`
- `CONCEPTS.md`
- `docs/ideation/2026-06-14-durable-event-read-model-ideation.html`
- `docs/brainstorms/2026-06-13-durable-game-run-kernel-requirements.md`
- `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md`
- `packages/api/src/services/game-events.ts`
- `packages/api/src/services/game-kernel-health.ts`
- `packages/api/src/services/game-checkpoints.ts`
- `packages/api/src/services/game-evidence.ts`
- `packages/api/src/services/evidence-access.ts`
- `packages/api/src/db/schema.ts`
- `packages/api/src/routes/admin.ts`
- `packages/web/src/app/admin/admin-panel.tsx`
- `packages/web/src/app/games/[slug]/game-viewer.tsx`
- `packages/engine/src/game-projection.ts`
- `packages/engine/src/game-runner.types.ts`
- `packages/engine/src/__tests__/canonical-event-replay.test.ts`
- `packages/engine/src/__tests__/simulate-config.test.ts`
