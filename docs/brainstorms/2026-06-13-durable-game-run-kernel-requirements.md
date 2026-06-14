---
date: 2026-06-13
topic: durable-game-run-kernel
---

# Durable Game Run Kernel Requirements

## Summary

API-backed Influence games should gain a durable game-run kernel that persists ordered canonical events, binds API game identity into engine event identity, and enforces single-writer ownership. This first delivery prepares checkpoint and private evidence boundaries, but it must not claim crash-safe resume.

---

## Problem Frame

Active API games are still vulnerable to process loss. The current statefulness plan says running games live in memory, API games do not yet write a durable event table, and restart behavior is cleanup rather than recovery.

Simulation runs have moved ahead of API runs: they can write canonical accepted-domain event JSONL alongside transcript, progress, and agent-turn artifacts. API runs still create a runner in process, stream viewer events, and persist transcript/results at terminal paths. The next slice should close that runtime gap without pretending that checkpoint hydration is complete.

---

## Key Decisions

- **Durable kernel before resume.** The first delivery proves ordered event identity and ownership before it attempts to reconstruct a stopped runner.
- **Postgres is the first workflow kernel.** Use the existing database as the authoritative ordered event/checkpoint/lease/manifest store before introducing new workflow infrastructure.
- **Simulation and API share the emission contract.** API persistence should consume the same canonical event surface that simulator JSONL already consumes.
- **Accepted mutations stay single-writer.** LLM calls may run in parallel inside a game turn, but accepted domain facts must append and mutate in one ordered sequence.
- **Raw evidence stays private.** Raw prompts, model responses, `thinking`, `reasoningContext`, and producer/debug records can be retained for debugging, but they are not public UX events or canonical board state.
- **Checkpoint work is boundary-first.** The first delivery may write checkpoint capsules or checkpoint metadata, but working `fromCheckpoint()` resume is deferred until hydration is proven.

---

## Actors

- A1. **Engine runner and phase modules** emit accepted canonical game events when domain facts change.
- A2. **API lifecycle owner** starts, owns, and completes one game run at a time.
- A3. **Durable event consumer** persists accepted canonical events and rejects identity or ordering mismatches.
- A4. **Operator or maintainer** inspects run state, event heads, ownership, and evidence pointers while debugging.
- A5. **Future resume process** consumes checkpoint capsules after resume semantics are proven.
- A6. **Producer/debug tooling** follows private evidence manifests without exposing hidden reasoning to players or viewers.

---

## Requirements

**Run Identity and Event Authority**

- R1. API-backed games must use the API game id as the canonical engine event game id before the first accepted event is emitted.
- R2. The durable event append path must reject events whose game identity does not match the API game being run.
- R3. The durable event append path must preserve per-game event ordering and reject non-contiguous sequences.
- R4. API games must persist canonical accepted-domain events continuously during the run, not only after the game completes.
- R5. The simulator JSONL path and API persistence path must consume the same canonical event emission contract.

**Single-Writer Ownership**

- R6. A game may have only one active owner allowed to append accepted events or mutate live game state.
- R7. Ownership must be durable enough that a stale worker cannot continue appending accepted events after another owner takes over.
- R8. Ownership must allow parallel LLM work inside the active owner while preserving sequential accepted-event commits.
- R9. Owner loss must result in an honest non-completed state rather than silent cancellation or duplicate execution.

**Checkpoint Boundary**

- R10. Checkpoint capsules must be keyed to the last persisted canonical event sequence they cover.
- R11. Checkpoint capsules must distinguish replayable board facts from non-replayable runtime context.
- R12. The first delivery must not advertise `fromCheckpoint()` resume unless a stopped runner can be reconstructed from stored state.
- R13. Checkpoint metadata should make future hydration work measurable even when full resume is deferred.

**Private Evidence Boundary**

- R14. Private LLM evidence must be addressable from durable metadata without becoming canonical board state.
- R15. Evidence manifests must support producer/debug lookup of raw prompts, model responses, reasoning context, and normalized agent-turn records.
- R16. Public/player-visible outputs must not expose hidden reasoning or producer/debug records through event persistence.
- R17. Existing public-read profile-picture object storage behavior must not be reused as the raw evidence access policy.

**Operational Readiness**

- R18. Startup and operator views must be able to distinguish running, completed, cancelled, and suspended-or-needs-inspection game states.
- R19. The kernel must provide enough status to tell whether a game has durable events, checkpoint boundaries, and private evidence manifests.
- R20. Existing terminal transcript/result persistence should remain compatible while event persistence is introduced.

---

## Key Flows

- F1. API game starts with bound event identity
  - **Trigger:** An API-backed game transitions into execution.
  - **Actors:** A1, A2, A3
  - **Steps:** The API loads the game record/config and player records, constructs the runner inputs, binds the API game id into the engine run, and begins event emission.
  - **Outcome:** The first roster event and every later canonical event belong to the API game id.
  - **Covered by:** R1, R2, R5

- F2. Accepted domain event persists during execution
  - **Trigger:** A phase accepts a vote, room allocation, power action, elimination, jury result, or other canonical fact.
  - **Actors:** A1, A3
  - **Steps:** The engine emits the canonical event, the durable append path verifies identity and sequence, and the event becomes part of the API game's ordered log.
  - **Outcome:** API runs have the same replayable accepted-domain facts that simulation runs write to event JSONL.
  - **Covered by:** R3, R4, R5

- F3. Single owner commits results from parallel work
  - **Trigger:** A phase launches multiple LLM calls or collects multiple agent actions.
  - **Actors:** A1, A2, A3
  - **Steps:** The active owner may process calls concurrently, but only the owner commits accepted facts to the event log and live state in sequence.
  - **Outcome:** The game can use parallel thinking without parallel XState or `GameState` mutation.
  - **Covered by:** R6, R7, R8

- F4. Game stops before resume exists
  - **Trigger:** The server restarts, deploys, or loses ownership mid-game.
  - **Actors:** A2, A4, A5
  - **Steps:** The kernel preserves durable events and any checkpoint boundary metadata, marks the game for inspection or suspension, and avoids claiming automatic recovery.
  - **Outcome:** The run is not silently corrupted, duplicated, or described as crash-safe.
  - **Covered by:** R9, R10, R12, R18, R19

- F5. Producer/debug evidence is retained privately
  - **Trigger:** A model call, agent turn, or producer/debug artifact is produced during a game.
  - **Actors:** A3, A6
  - **Steps:** The system records searchable metadata and source pointers for the private evidence while keeping raw content behind a private object-storage boundary.
  - **Outcome:** Maintainers can debug raw LLM behavior without leaking hidden reasoning into public projections or canonical board state.
  - **Covered by:** R14, R15, R16, R17

---

## Acceptance Examples

- AE1. Covers R1, R2, R4.
  - **Given:** An API game with id `G` starts running.
  - **When:** The runner emits its roster event.
  - **Then:** The persisted canonical event belongs to `G`, and an event with a different game id is rejected.

- AE2. Covers R3, R4.
  - **Given:** The last persisted event for a game has sequence `12`.
  - **When:** The API event append path receives sequence `14`.
  - **Then:** The append is rejected because the log is no longer contiguous.

- AE3. Covers R6, R7, R8.
  - **Given:** Two workers attempt to process the same game.
  - **When:** One worker already owns the active epoch.
  - **Then:** The other worker cannot append accepted events for that game.

- AE4. Covers R9, R12, R18.
  - **Given:** A server restarts while a game is in progress.
  - **When:** full checkpoint hydration is not yet implemented.
  - **Then:** The game is marked as needing inspection or suspension, not completed, duplicated, or advertised as resumed.

- AE5. Covers R14, R16, R17.
  - **Given:** An agent turn includes `thinking` and `reasoningContext`.
  - **When:** public event or viewer data is read.
  - **Then:** hidden reasoning is excluded, while producer/debug tooling can follow a private evidence manifest.

---

## Success Criteria

- API-backed games persist ordered canonical events under the API game identity during execution.
- Event persistence rejects wrong-game and out-of-order appends.
- A single durable owner controls accepted event commits for a game.
- The first delivery cannot be mistaken for crash-safe resume.
- Private evidence manifests can point to raw LLM artifacts without exposing them through public or canonical state.
- Simulation JSONL and API event persistence can be validated through a shared replay/projection expectation.

---

## Scope Boundaries

In scope:

- Bind API game identity into engine canonical events.
- Persist API canonical events durably as the first production event-store slice.
- Add a durable single-writer ownership contract for game execution.
- Define and optionally write checkpoint boundary records keyed to event sequence.
- Define private evidence manifests and access boundaries for future raw Linode Object Storage logs.
- Preserve existing transcript/result persistence while the kernel is introduced.

Out of scope for this delivery:

- Working `GameRunner.fromCheckpoint()` or full XState hydration resume.
- Viewer public projection endpoints and WebSocket cursor catch-up.
- Replacing XState or making canonical replay choose phase transitions.
- Treating raw prompts, reasoning, or agent-turn records as canonical board state.
- Using object storage as the ordered domain event store.
- Allowing multiple workers to mutate the same game's accepted state in parallel.

---

## Dependencies and Assumptions

- The canonical game event spine remains the accepted-domain-event foundation.
- API event persistence depends on stable game identity before any production event table can be authoritative.
- Checkpoint hydration will need a later plan for XState snapshots, runner data, token usage, and agent continuity.
- Private evidence retention will need a later policy for object ACLs, retention, redaction, and producer-only access.
- Existing Linode/Postgres infrastructure remains acceptable for the first workflow kernel.

---

## Outstanding Questions

Resolve before planning:

- None.

Deferred to planning:

- Which event append failures should fail the running game immediately, and which can mark it suspended for inspection?
- What exact owner-loss state should replace today's startup cleanup behavior?
- Which checkpoint fields are required for the first forensic capsule if resume is deferred?
- What private evidence should be written in the first implementation versus only represented by manifest shape?

---

## Sources

- `AGENTS.md`
- `CONCEPTS.md`
- `docs/statefulness-plan.md`
- `docs/brainstorms/2026-06-11-canonical-game-event-spine-requirements.md`
- `docs/ideation/2026-06-13-simulation-api-statefulness-unification-ideation.html`
- `docs/reasoning-transcript-observability.md`
- `docs/local-model-evaluation.md`
- `README.md`
- `packages/engine/src/canonical-events.ts`
- `packages/engine/src/canonical-event-log.ts`
- `packages/engine/src/game-state.ts`
- `packages/engine/src/game-runner.ts`
- `packages/engine/src/game-projection.ts`
- `packages/engine/src/simulate.ts`
- `packages/api/src/db/schema.ts`
- `packages/api/src/routes/games.ts`
- `packages/api/src/services/game-lifecycle.ts`
- `packages/api/src/services/ws-manager.ts`
- `packages/api/src/lib/storage.ts`
