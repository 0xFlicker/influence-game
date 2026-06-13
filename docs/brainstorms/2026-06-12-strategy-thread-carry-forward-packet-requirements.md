---
date: 2026-06-12
topic: strategy-thread-carry-forward-packet
---

# Strategy Thread Carry-Forward Packet Requirements

## Summary

Add a v1 Strategy Thread / Carry-Forward Packet for each agent: compact private strategy state that survives across rounds inside the live agent, appears in future prompts, and helps later Mingle, vote, power, and council decisions remember the agent's current plan without forcing overt game talk.

---

## Problem Frame

Mingle intent now gives agents a useful private purpose for one Mingle phase, and strategic reflection gives them a structured hidden assessment after decision phases. The missing layer is continuity between those moments.

Without a durable prompt-visible strategy packet, an agent can enter Mingle with a useful plan, make a guarded or explicit social move, then later act as if that plan was only a one-off prompt artifact. That weakens the watchable social game the project is aiming for: players should seem like they remember what they were testing, who mattered to them, and what they intended to try next.

This first slice should solve the continuity problem without absorbing the whole memory roadmap. It should not become a commitment ledger, relationship graph, or restart-safe persistence system.

---

## Key Decisions

- **Packet-only first slice.** v1 proves strategy continuity with one compact carry-forward object before adding commitment ledgers, social-debt models, or relationship graphs.
- **Simulation-first.** v1 is compatible with API games that keep the runner alive, but it does not promise resume-safe hydration after process reset.
- **Context, not commands.** The packet guides later choices and prompts, but agents remain allowed to stay guarded, social, playful, quiet, or indirect when that fits persona and context.
- **Meaningful update boundaries.** Packet updates should happen at strategy/reflection boundaries, not after every individual agent action.
- **Hidden producer state.** Strategy packets are private agent/producer state and must not be delivered as player-visible dialogue.

---

## Actors

- A1. **Agent** carries a compact private strategy across rounds and uses it when choosing rooms, speaking, voting, using power, or deciding whom to trust.
- A2. **Viewer / producer** inspects hidden strategy packet records through simulation artifacts and the game MCP to understand whether strategy carried forward.
- A3. **Maintainer / planner** needs a bounded first slice that improves agent continuity without committing to the full memory system.

---

## Requirements

**Packet shape and lifecycle**

- R1. Each agent must have a private Strategy Thread / Carry-Forward Packet that summarizes its current objective, target posture, coalition posture, next intended social probe, important uncertainty, and abandon-or-revise trigger.
- R2. The packet must be compact enough to include in future prompts without crowding out game state, private room messages, or strategic reflection.
- R3. The packet may contain uncertainty and provisional reads; it must not require a named target when the agent's current strategy is intentionally exploratory.
- R4. Packet state must survive across rounds within the live agent for the duration of the current game run.
- R5. Packet state must be removed or revised when eliminated players, contradicted evidence, or later events make an entry stale.

**Prompt behavior**

- R6. Future decision prompts must surface the packet as private strategy context distinct from memory notes, vote history, and strategic reflection.
- R7. Prompt wording must frame the packet as guidance the agent may revise, not as instructions that must be obeyed.
- R8. Mingle room choice and Mingle turn prompts must be able to use the packet when forming a new Mingle intent or deciding whether to continue, test, or abandon a prior plan.
- R9. Vote, power, council, rumor, and diary/reflection prompts should be able to use the packet when it is relevant to the decision at hand.

**Packet updates**

- R10. The packet must be initialized or refreshed after meaningful strategy assessment boundaries, including strategic reflection when enabled.
- R11. A packet update must state what the agent is carrying forward, what changed since the prior packet, and what would make the agent revise course.
- R12. A failed packet update must be non-fatal and must not emit a misleading successful strategy record.
- R13. Packet updates must keep hidden `thinking` and `reasoningContext` as debug artifacts only; public player speech must not include them.

**Observability and validation**

- R14. Packet creation and update records must be available in structured simulation turn artifacts as hidden producer/debug records.
- R15. The game MCP validation path must be able to find packet records alongside Mingle intent, Mingle turns, strategic reflections, and later decisions.
- R16. Simulation review must be able to answer whether a packet influenced a later room choice, private-room behavior, vote, power action, council vote, rumor, or reflection.
- R17. The validation surface should distinguish successful carry-forward from a justified pivot, so agents are not punished for revising a bad plan.

**Privacy and compatibility**

- R18. Strategy packets must not become player-visible messages, room metadata, or public transcript copy.
- R19. v1 must remain compatible with API games that construct live agents with an optional memory store, but it does not need to hydrate packet state from persisted memory after process reset.
- R20. v1 docs must state that resume-safe strategy hydration, commitment ledgers, relationship graphs, and scoring dashboards are deferred follow-up work.

---

## Key Flows

- F1. **Packet initialization from early evidence**
  - **Trigger:** An agent reaches the first strategy/reflection boundary after enough public or private context exists to form a carry-forward read.
  - **Actors:** A1, A2
  - **Steps:** The agent reviews current game state, memory, recent private/public signals, and any strategic reflection; produces a compact packet; the engine keeps it private and prompt-visible for later decisions.
  - **Outcome:** Later prompts have a live strategy thread instead of relying only on one-off Mingle intent.
  - **Covered by:** R1, R2, R3, R4, R6, R10, R14

- F2. **Mingle uses prior strategy without forcing it**
  - **Trigger:** A later Mingle phase starts.
  - **Actors:** A1
  - **Steps:** The agent sees its packet while forming Mingle intent, then chooses a room and turn behavior that can continue, test, or abandon the carried-forward strategy.
  - **Outcome:** Mingle behavior can show continuity while still allowing guarded, social, playful, or silent choices.
  - **Covered by:** R3, R7, R8, R16, R17

- F3. **Later decision uses or revises strategy**
  - **Trigger:** The agent reaches a vote, power, council, rumor, or diary/reflection decision after a packet exists.
  - **Actors:** A1, A2
  - **Steps:** The agent considers the packet alongside current game state; it either acts consistently with the packet, records why it pivoted, or updates the packet after reflection.
  - **Outcome:** Reviewers can tell whether the agent remembered its strategy or consciously changed course.
  - **Covered by:** R9, R11, R15, R16, R17

- F4. **Stale packet revision**
  - **Trigger:** A player named in the packet is eliminated, a planned target becomes impossible, or later evidence contradicts the packet.
  - **Actors:** A1
  - **Steps:** The agent revises or removes the stale part of the packet at the next meaningful update boundary.
  - **Outcome:** Agents do not carry impossible or contradicted plans forward as if they were still live.
  - **Covered by:** R5, R7, R10, R11

- F5. **Simulation validation**
  - **Trigger:** A maintainer reviews a simulation run with structured turn logs and MCP search.
  - **Actors:** A2, A3
  - **Steps:** The reviewer traces packet records through later Mingle intent, Mingle turns, strategic reflection, and decision records.
  - **Outcome:** The reviewer can identify concrete carry-forward examples and justified pivots without reading player-visible transcript alone.
  - **Covered by:** R14, R15, R16, R17, R18

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4, R6, R14.**
  - **Given:** An agent has completed a strategic reflection after a round with Mingle and voting.
  - **When:** The strategy packet is updated.
  - **Then:** The packet records a compact current objective, uncertainty, next social probe, and revise trigger, and a hidden producer/debug record appears in structured turn artifacts.

- AE2. **Covers R3, R7, R8, R17.**
  - **Given:** An agent's packet says it wants to test whether Mira is quietly coordinating against Vex.
  - **When:** The next Mingle starts.
  - **Then:** The agent may seek Mira, seek Vex, ask a guarded social question, or defer the test if room context makes the plan poor.

- AE3. **Covers R9, R11, R16, R17.**
  - **Given:** An agent carries a packet that says Atlas is a useful ally unless he dodges a promised vote.
  - **When:** Atlas votes differently than expected.
  - **Then:** A later decision or reflection can mark the plan weakened or pivot to a new target, and the validation path can see that this was a revision rather than amnesia.

- AE4. **Covers R5, R10, R11.**
  - **Given:** A packet names a player who is eliminated before the next Mingle.
  - **When:** The agent reaches the next packet update boundary.
  - **Then:** The packet removes or reframes that player-dependent plan instead of injecting impossible strategy into later prompts.

- AE5. **Covers R13, R18.**
  - **Given:** A packet update includes hidden thinking or raw reasoning context.
  - **When:** Player-visible transcript entries are emitted.
  - **Then:** Other players see only allowed speech, while producer/debug artifacts retain hidden strategy context.

- AE6. **Covers R15, R16, R20.**
  - **Given:** A maintainer runs a local simulation with structured turn logs.
  - **When:** They search through the game MCP for strategy packet, Mingle intent, Mingle turn, reflection, and later decision records.
  - **Then:** They can find at least one linked example of carry-forward or pivot without requiring resume-safe persistence.

---

## Success Criteria

- Agents show visible continuity across rounds: later choices refer to current strategic posture rather than only immediate prompt context.
- The packet preserves a spectrum of play and does not create a target-naming quota.
- Structured simulation artifacts expose packet updates and enough linked context for MCP-based review.
- Reviewers can find examples where a packet influenced later Mingle, vote, power, council, rumor, or reflection behavior.
- Reviewers can also find justified pivots where agents revised stale or contradicted strategy.
- API games remain compatible when the live runner is uninterrupted, while resume-safe hydration remains explicitly deferred.

---

## Scope Boundaries

In scope:

- A compact private strategy packet stored on the live agent during a game run.
- Prompt presentation of that packet as revisable private strategy context.
- Hidden producer/debug records for packet creation and updates.
- Simulation and MCP validation of packet carry-forward or justified pivot behavior.
- Docs and glossary updates for the new Strategy Thread / Carry-Forward Packet concept.

Deferred for later:

- Persisting and hydrating strategy packet state through `MemoryStore` after API process reset.
- Full commitment ledger, social-debt model, or relationship graph.
- Aggregate dashboards or scoring metrics for strategy quality across many batches.
- End-of-Mingle debrief extraction beyond what is already covered by strategic reflection and packet updates.

Outside this slice:

- Mandatory target naming.
- Hard requirements that every turn performs a concrete strategic act.
- Player-visible display of packet state, hidden thinking, or raw reasoning context.
- Preference-matched room allocation or a broader Mingle room-formation redesign.
- Current-path Whisper aliases, fallback terminology, or legacy framing.

---

## Dependencies and Assumptions

- Mingle remains the current private-room phase for new games.
- Strategic reflection remains a natural place to update strategy, especially in simulations where reflection capture is enabled.
- Structured turn logs under `packages/engine/docs/simulations/` and the game MCP remain the primary validation path for local model behavior.
- Hidden `thinking` and `reasoningContext` remain producer/debug artifacts and must not become player-visible speech.
- Planning will decide the exact structured packet fields and update trigger mechanics, while preserving the product requirements above.

---

## Sources

- `docs/ideation/2026-06-12-multi-round-strategy-propagation-ideation.html`
- `docs/brainstorms/2026-06-12-mingle-intent-act-requirements.md`
- `docs/plans/2026-06-12-001-feat-mingle-strategy-observability-plan.md`
- `AGENTS.md`
- `CONCEPTS.md`
- `docs/local-model-evaluation.md`
- `docs/reasoning-transcript-observability.md`
- `packages/api/src/services/game-lifecycle.ts`
- `packages/api/src/db/memory-store.ts`
- `packages/engine/src/agent.ts`
- `packages/engine/src/game-runner.types.ts`
- `packages/engine/src/memory-store.ts`
- `packages/engine/src/phases/mingle.ts`
