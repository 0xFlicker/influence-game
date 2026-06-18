---
date: 2026-06-17
topic: thin-strategic-decision-fields
---

# Thin Strategic Decision Fields Requirements

## Summary

Replace the current low-value packet-use marker fields on strategic agent actions with one flat nullable private field: `decisionLog`. The new field keeps the existing single forced action-tool path, preserves local-model friendliness, and gives later strategic reflection concrete decision receipts to reconcile on the normal reflection cadence.

---

## Problem Frame

Strategy Thread packets already give agents a compact private posture across rounds, but the current per-action marker fields do not do enough gameplay work. `strategyPacketUse` classifies whether the agent followed, revised, ignored, or deferred a packet, while `strategyPacketUseRationale` gives a short reason. That is useful as validation evidence, but weak as an in-the-moment record of what the agent just decided and whether its strategy should change.

The product need is narrower than a full task list or notebook. When an agent pivots during Mingle, Vote, Power, Council, or endgame, the engine needs a small private receipt that can later help reflection update the Strategy Thread. The receipt should answer: what did I just do strategically, and why?

This slice should also respect local model fragility. The project should not add parallel action-plus-strategy tools, larger nested schemas, or provider/model profile work as part of this change.

---

## Key Decisions

- **Flat field over nested object.** `decisionLog` stays as a flat nullable field on existing action outputs so local structured-output calls have less schema complexity.
- **Decision receipt, not task list.** The slice records the strategic meaning of the current action; it does not introduce open tasks, TODOs, notebooks, commitments, or relationship graphs.
- **Action-level receipt, reflection-level update.** Actions may explain strategy pivots, but Strategy Thread updates remain owned by strategic reflection.
- **Single-tool compatibility.** Existing forced phase-action tools remain the main path; parallel tool calls are deferred until local model reliability is better understood.
- **Private producer/debug boundary.** Decision logs are private decision context and may be reflected back to the same agent, but must not become player-visible speech or canonical board facts.

---

## Actors

- A1. Agent records the strategic meaning of its own action without exposing that motive to other players.
- A2. Strategic reflection consumes recent decision logs to revise the agent's private Strategy Thread when needed.
- A3. Maintainer reviews simulation artifacts to see whether action-level decision logs caused meaningful strategic updates.

---

## Requirements

**Action output fields**

- R1. Strategic action outputs must replace `strategyPacketUse` and `strategyPacketUseRationale` with `decisionLog`.
- R2. `decisionLog` must be nullable and private; when present, it records the strategic meaning of the current action in compact natural language.
- R3. `decisionLog` must be anchored to the action that produced it, either by surrounding turn metadata or by concise wording that names the triggering decision.
- R4. The new field must remain optional in behavior even when strict tool schemas require the key; local models may return null when no strategic note is warranted.

**Prompt behavior**

- R6. `## Your Recent Decisions` must remain separate from public transcript and conversation summaries.
- R7. Recent decision entries that include a decision log must make the timing and action anchor obvious to the agent.
- R8. Prompt wording must frame decision logs as private receipts to learn from, not orders to repeat.
- R9. Strategy Thread and Strategic Assessment sections must stay distinct from decision logs so current posture, prior reflection, and action receipts do not blur together.

**Reflection behavior**

- R10. Strategic reflection must be able to consume recent decision logs when deciding whether to revise the Strategy Thread.
- R11. If strategic reflection is disabled for a run, decision logs should still be emitted as private producer/debug records where action records already exist.

**Observability and validation**

- R14. Private action records in simulation artifacts must expose the new fields when present.
- R15. Validation should be able to trace a decision log from an action record to a later strategic reflection or Strategy Thread update.
- R16. Documentation must replace packet-use validation language with decision-log validation language.
- R17. Existing tests that assert packet-use marker behavior should be updated to assert the thinner field behavior instead.

**Compatibility and scope control**

- R18. The change must preserve the existing single-tool action-call architecture.
- R19. The slice must not add provider/model profiles, token budget tuning, parallel tool orchestration, or fallback branches for action-plus-strategy tools.
- R20. The slice must not add a strategy task list, notebook, TODO lifecycle, MemoryStore persistence, or checkpoint hydration.
- R21. Decision logs must not contain raw hidden reasoning or native reasoning context; those remain separate producer/debug artifacts.

---

## Key Flows

- F1. Action records a strategic decision receipt
  - **Trigger:** An agent takes a strategic action with meaningful private motive.
  - **Actors:** A1, A3
  - **Steps:** The agent returns the normal phase action plus a compact `decisionLog`; the phase continues using the normal action result; the private action record preserves the decision log.
  - **Outcome:** Later review can see what the agent thought the action meant without parsing raw thinking.
  - **Covered by:** R1, R2, R3, R14, R21

- F2. Reflection reconciles recent strategic receipts
  - **Trigger:** A later strategic reflection runs after one or more private decision logs.
  - **Actors:** A1, A2
  - **Steps:** Strategic reflection receives recent decision logs alongside existing game context; it updates or preserves the Strategy Thread based on current evidence.
  - **Outcome:** Strategy changes because of concrete prior decisions rather than vague packet-use labels.
  - **Covered by:** R10, R15

- F3. Prompt carries decision logs forward without mixing memory types
  - **Trigger:** A later agent prompt is built after one or more private decision logs exist.
  - **Actors:** A1
  - **Steps:** The prompt shows recent decision logs in `## Your Recent Decisions`, Strategy Thread in its own section, and Strategic Assessment in its own section.
  - **Outcome:** The agent sees when a decision was made and why it mattered while public transcript context remains separate.
  - **Covered by:** R6, R7, R8, R9

- F4. Local model returns no decision log
  - **Trigger:** A local model completes an action where no meaningful private receipt is needed.
  - **Actors:** A1
  - **Steps:** The action output carries a null `decisionLog`; the phase accepts the normal action and emits no misleading strategy claim.
  - **Outcome:** The new surface stays low-noise and does not force strategy prose every turn.
  - **Covered by:** R4, R11, R18

---

## Acceptance Examples

- AE1. Covers R1, R2, R14.
  - **Given:** An agent takes a Mingle turn that changes its read on another player.
  - **When:** The private action record is emitted.
  - **Then:** The record includes the normal action response and a private `decisionLog` summarizing the strategic change.

- AE2. Covers R4, R10, R11.
  - **Given:** An agent casts a vote with a private decision log.
  - **When:** The next scheduled strategic reflection runs.
  - **Then:** The reflection can use that vote's decision log when deciding whether to revise the Strategy Thread.

- AE3. Covers R6, R7, R8, R9.
  - **Given:** An agent has recent decision logs, a Strategy Thread, and a Strategic Assessment.
  - **When:** A later prompt is built.
  - **Then:** The prompt keeps decision receipts in `## Your Recent Decisions` and does not inline private motives into public transcript summaries.

- AE4. Covers R18, R19.
  - **Given:** An action records a decision log during a phase where immediate reflection would be disruptive.
  - **When:** The runner handles the action.
  - **Then:** The phase does not add an immediate action-plus-reflection model call path.

- AE5. Covers R20, R21.
  - **Given:** A decision log exists in private producer/debug artifacts.
  - **When:** Player-visible transcript or canonical events are produced.
  - **Then:** The decision log and raw reasoning remain out of player-visible and canonical truth surfaces.

---

## Success Criteria

- Later strategic reflections cite or visibly incorporate prior decision logs in at least some local simulation runs.
- Private action records stop producing low-value packet-use classifications as the main strategic linkage signal.
- Local model runs keep the single forced action-tool shape and do not add new parallel-tool failure modes.
- Maintainers can search simulation artifacts for decision logs and follow them into later reflection or Strategy Thread updates.
- Prompt review shows recent decision logs are anchored and separate from public transcript summaries, Strategy Thread, and Strategic Assessment.

---

## Scope Boundaries

In scope:

- Replacing `strategyPacketUse` and `strategyPacketUseRationale` on strategic action outputs.
- Adding a flat nullable `decisionLog` field to strategic actions.
- Feeding decision logs into strategic reflection.
- Updating private agent-turn records, tests, docs, and glossary language for the new fields.

Deferred for later:

- Provider or model profiles for local model token budgets and structured-output behavior.
- Parallel action-plus-strategy tools.
- Strategy notebooks, task lists, TODO lifecycles, commitment ledgers, relationship graphs, or social-debt models.
- MemoryStore persistence and checkpoint hydration of decision logs.

Outside this slice:

- Player-visible display of decision logs, hidden thinking, or reasoning context.
- Treating decision logs as mandatory immediate reflection commands.
- Scoring agents based on whether they followed, revised, ignored, or deferred a Strategy Thread.

---

## Dependencies and Assumptions

- The existing Strategy Thread packet remains the compact private strategy state.
- Strategic reflection remains the owner of Strategy Thread updates.
- `## Your Recent Decisions` remains the prompt lane for private action receipts.
- Strict tool schemas may require nullable strategic keys even when values are null.
- Local model reliability is a design constraint for this slice, but provider/model tuning is handled separately.

---

## Sources

- `docs/ideation/2026-06-17-strategic-upgrade-slice-ideation.html`
- `docs/brainstorms/2026-06-12-strategy-thread-carry-forward-packet-requirements.md`
- `docs/reasoning-transcript-observability.md`
- `docs/local-model-evaluation.md`
- `CONCEPTS.md`
- `packages/engine/src/agent.ts`
- `packages/engine/src/diary-room.ts`
- `packages/engine/src/game-runner.types.ts`
- `packages/engine/src/context-builder.ts`
- `packages/engine/src/memory-store.ts`
- `packages/engine/src/phases/phase-runner-context.ts`
