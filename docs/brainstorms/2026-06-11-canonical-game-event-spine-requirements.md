---
date: 2026-06-11
topic: canonical-game-event-spine
---

# Canonical Game Event Spine Requirements

## Summary

Influence should introduce a canonical domain event stream under `GameState` so accepted game facts can be replayed into a board-state projection. XState remains the phase authority and resume cursor, while MCP/search surfaces read from projections instead of inferring state from transcript text.

---

## Problem Frame

The simulator already writes useful observability artifacts, especially `game-N-turns.jsonl` and `game-N-progress.jsonl`. Those logs are good for watching agent decisions, but they are not a complete source of truth for rebuilding the game. Some important state changes happen through direct `GameState` mutations, and some accepted outcomes come from tally logic or fallback randomness that replay must not re-roll.

The statefulness plan already recognizes that active games are not crash-safe and that XState snapshots plus `GameState` snapshots are part of resume. The event-spine idea narrows that into a stronger foundation: make domain changes appendable and replayable first, then let MCP indexes, simulator analysis, and later API persistence become read models over the same accepted facts.

---

## Key Decisions

- **GameState is the domain authority.** Canonical game events are appended where accepted game facts mutate `GameState`, not reconstructed from transcripts after the fact.
- **XState remains the phase authority.** The reducer rebuilds board/domain state; it does not decide which phase is legal or what phase should run next.
- **Accepted outcomes are canonical, not model suggestions.** Agent responses and observability turns can explain decisions, but canonical events record the outcomes the game accepted.
- **Replay parity comes before runtime persistence.** The first milestone should prove that event replay matches live game state before API games depend on the event store for resume.
- **MCP is a projection consumer.** Game MCP tools query read models derived from canonical events; they do not drive gameplay.

---

## Actors

- A1. **Engine runner / phase modules** accept agent actions, tally outcomes, and append canonical domain events at mutation points.
- A2. **GameState reducer** applies canonical events to produce a rebuildable board-state projection.
- A3. **XState phase machine** remains responsible for phase sequencing and phase resume position.
- A4. **House MC / MCP client** queries derived read models for evidence-backed narration and analysis.
- A5. **Maintainer / operator** uses replay parity and source pointers to debug simulations and eventually support safer API runtime persistence.

---

## Requirements

**Domain authority and event scope**

- R1. The engine must define a canonical game event stream for accepted domain facts that are required to rebuild `GameState`.
- R2. Canonical events must be appended at the source of accepted mutation, not inferred later from `TranscriptEntry`, `AgentTurnEvent`, or formatted transcript text.
- R3. The canonical event stream must be distinct from the existing observability stream; `GameStreamEvent` and `AgentTurnEvent` may remain viewer/debug surfaces.
- R4. The reducer must rebuild board/domain state only and must not determine phase legality or select the next phase.
- R5. XState actor state must be persisted or restored separately when resume work depends on phase position.

**Event content**

- R6. Every canonical event must carry stable ordering, game identity, round, phase, event type, timestamp, actor or system source, visibility tier, payload version, and enough payload data to apply the event.
- R7. Events that settle random, fallback, wheel, or tie-break outcomes must record the accepted result so replay is deterministic.
- R8. Events that correspond to agent decisions must be able to link to the relevant observability record without making hidden reasoning part of player-visible state.
- R9. Event visibility must support at least producer, audience, and player-visible access modes for downstream MCP/query surfaces.

**Reducer and projection**

- R10. A replay reducer must rebuild current players, player statuses, round number, shields, vote state, empowered player, council candidates, room allocations, jury state, endgame stage, finalists, winner state, and round results where those fields exist in current `GameState`.
- R11. The reducer projection must be rebuildable from the canonical event log without reading transcript prose.
- R12. Replay must not call tally or candidate-selection logic that can produce a different accepted outcome than the original run.
- R13. Event schema changes must remain replayable for old logs through explicit version handling or documented migration.

**Validation**

- R14. Tests must compare replayed projections against live `GameRunner.getStateSnapshot()` at phase boundaries and game completion.
- R15. Tests must cover deterministic edge cases for tie resolution, wheel/fallback outcomes, shields, auto-elimination, council votes, jury/endgame transitions, and room allocations.
- R16. Tests must prevent direct `GameState` mutation paths from bypassing canonical event append when the mutation is required for replay.

**Simulator, MCP, and API migration**

- R17. The first durable output should be simulator-side canonical event JSONL written alongside the existing turn and progress JSONL files.
- R18. MCP indexes and SQLite/FTS read models must be derivable from canonical events and must preserve source pointers back to the originating event.
- R19. API games must not depend on the event spine for crash-safe resume until replay parity and checkpoint boundaries are proven.
- R20. Later API persistence may store the same canonical events in Postgres and use projections/checkpoints to reduce reliance on process-local `activeGames`.

---

## Key Flows

- F1. **Canonical event append during live simulation**
  - **Trigger:** A phase module accepts a player action or resolves a game outcome.
  - **Actors:** A1, A2
  - **Steps:** The engine appends a canonical event, applies it to live `GameState`, and continues existing phase execution.
  - **Outcome:** The same accepted fact exists in live state and in the replayable event log.
  - **Covered by:** R1, R2, R6, R7, R16, R17

- F2. **Replay projection rebuild**
  - **Trigger:** A maintainer or test asks to rebuild state from a completed event log.
  - **Actors:** A2, A5
  - **Steps:** The reducer reads canonical events in sequence, applies each event, and emits a board-state projection.
  - **Outcome:** The rebuilt projection matches the live snapshot for all domain fields in scope.
  - **Covered by:** R10, R11, R12, R14, R15

- F3. **House or MCP query over a read model**
  - **Trigger:** The House MC or an external agent asks about player state, events, conversations, or reasoning-adjacent evidence.
  - **Actors:** A4, A5
  - **Steps:** The MCP reads a projection or index derived from canonical events, filters by visibility, and returns cited results.
  - **Outcome:** The answer is evidence-backed and does not require the MCP to infer game state from prose.
  - **Covered by:** R8, R9, R18

- F4. **Future API persistence adoption**
  - **Trigger:** The API begins persisting canonical events for live games.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** The API stores canonical events, stores or loads the XState resume cursor separately, and uses projections/checkpoints for catch-up state.
  - **Outcome:** Runtime persistence can evolve toward stateless app servers without replacing XState or relying only on transcript rows.
  - **Covered by:** R5, R19, R20

---

## Acceptance Examples

- AE1. **Covers R1, R2, R6, R14.**
  - **Given:** A running game enters a vote phase and accepts player votes.
  - **When:** The phase resolves the empowered player.
  - **Then:** The canonical log contains vote and empower-resolution events, and replay produces the same empowered player as the live snapshot.

- AE2. **Covers R7, R12, R15.**
  - **Given:** A tied outcome is resolved by a wheel or fallback choice.
  - **When:** The event log is replayed later.
  - **Then:** Replay uses the recorded accepted result and does not call randomness again.

- AE3. **Covers R3, R8, R9.**
  - **Given:** An agent turn includes hidden `thinking` and `reasoningContext`.
  - **When:** A player-visible projection is queried.
  - **Then:** Hidden reasoning is excluded, while producer-level queries can follow source pointers to the privileged observability record.

- AE4. **Covers R4, R5.**
  - **Given:** A game is resumed from persisted data.
  - **When:** Domain state is rebuilt from canonical events.
  - **Then:** The restored XState actor still supplies the phase position; the reducer does not infer the current phase transition path.

- AE5. **Covers R17, R18.**
  - **Given:** A simulator run completes.
  - **When:** A local MCP index is built.
  - **Then:** The index can be rebuilt from canonical event JSONL and every result can cite an event source pointer.

---

## Success Criteria

- A short replay fixture can rebuild `GameState` domain fields from canonical events without transcript parsing.
- Replay parity tests fail when a replay-relevant mutation bypasses canonical event append.
- Random or fallback outcomes are replay-stable across repeated reducer runs.
- The simulator still writes existing turn/progress artifacts while adding canonical events.
- MCP read models can be rebuilt from canonical events and can enforce visibility tiers.

---

## Scope Boundaries

In scope:

- Define the canonical domain-event concept and the required replay surface.
- Prove reducer parity for current `GameState` fields before making API runtime behavior depend on events.
- Add simulator-side canonical event output as the first durable artifact.
- Keep MCP, SQLite FTS, and House queries as projection consumers.

Out of scope:

- Replacing XState or encoding phase sequencing in the reducer.
- Making MCP tools drive gameplay.
- Treating `AgentTurnEvent` as the complete domain log.
- Claiming crash-safe resume before checkpoint and XState persistence work lands.
- Capturing every prompt-context snapshot as canonical game state.
- Building cross-session model-evaluation dashboards before the event spine exists.

---

## Dependencies and Assumptions

- The current statefulness plan remains the broader recovery context; this brainstorm narrows the domain-event prerequisite.
- Existing transcript and turn logs remain valuable observability outputs, but they are not sufficient as an authoritative state log.
- API persistence work will need ownership/locking rules before multiple instances can append events for the same game.
- Agent conversation history may still be lossy on resume; canonical events rebuild game state, not exact LLM context.

---

## Outstanding Questions

Deferred to planning:

- Which exact `GameState` fields are included in the first parity snapshot, and which transcript-only fields are excluded?
- What is the smallest event vocabulary that covers current normal-round, Mingle, and endgame mutations?
- How should old canonical event payloads be versioned or migrated once event schema changes?
- Should simulator canonical events live in a new file or be folded into the existing progress JSONL once the shape stabilizes?

---

## Sources

- `docs/ideation/2026-06-11-game-mcp-house-mc-ideation.html`
- `docs/statefulness-plan.md`
- `docs/reasoning-transcript-observability.md`
- `README.md`
- `CONCEPTS.md`
- `packages/engine/src/game-state.ts`
- `packages/engine/src/phase-machine.ts`
- `packages/engine/src/game-runner.ts`
- `packages/engine/src/game-runner.types.ts`
- `packages/engine/src/transcript-logger.ts`
- `packages/engine/src/simulate.ts`
- `packages/api/src/services/game-lifecycle.ts`
- `packages/api/src/services/ws-manager.ts`
- `packages/api/src/db/schema.ts`
- `packages/engine/src/__tests__/stream-listener.test.ts`
- [MCP Resources specification](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [XState persistence documentation](https://stately.ai/docs/persistence)
- [Martin Fowler on Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
