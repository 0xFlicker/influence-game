---
date: 2026-06-12
topic: mingle-intent-act
---

# Mingle Intent and Strategy Spectrum Requirements

## Summary

Add a first Mingle-unblocking slice where each agent forms a hidden Mingle intent before room choice, then Mingle prompts and diagnostics let agents talk game on a spectrum. This should make private rooms capable of producing named people, provisional targets, real asks, guarded social reads, and varied strategy, while also capturing strategic reflection records so simulations and the game MCP can validate whether broader agent strategy changed.

---

## Problem Frame

Mingle is meant to be the private strategy bridge between lobby performance and later public consequences. The current behavior can still land in a lobby-shaped local maximum: agents talk cautiously, compare soft reads, avoid naming targets, and often fail to create watchable subgroups with plans.

The current room choice prompt asks agents to pick a neutral room number before anyone has room-count information. The current turn prompt asks agents to be strategic but gives little shape to the range between guarded social read and explicit deal-making. That leaves models free to continue polite social ambiguity even in the phase where private strategy should be available.

This slice should unblock the agent behavior first. It should give agents a private purpose for entering Mingle and permission to name players, test commitments, trade information, or move strategically when that fits their persona and room context.

Validation also needs to see beyond individual room messages. Strategic reflections currently update agent memory, but they are not emitted as structured turn records in local simulation artifacts. That means a run can look better or worse in the room transcript while still leaving us unable to verify whether agents revised plans, threats, allies, or suspicions after Mingle.

---

## Key Decisions

- **Intent over randomness.** Subgroup variety should come from player goals and social reads, not from random room assignment or shuffled defaults.
- **Strategy spectrum over turn quotas.** Agents may stay guarded, social, or indirect, but Mingle should no longer prompt them away from explicit private strategy when their intent supports it.
- **Hidden producer state, not player dialogue.** Mingle intent is a private decision artifact for agent behavior, diagnostics, and simulations; it is not shown to other players as speech.
- **Reflection capture as validation, not gameplay.** Strategic reflection records are producer/debug evidence for evaluating agent strategy; they should not become player-visible messages or another action agents perform for social effect.
- **First slice before allocator redesign.** The existing room-number path can remain for this slice if the new intent meaningfully guides room choice and turn behavior.
- **Current Mingle only.** Requirements, prompts, docs, and validation should use current Mingle language and should not reintroduce Whisper as a current concept or fallback.

---

## Actors

- A1. **Agent** chooses a Mingle room, speaks or moves during Mingle, and carries private strategy into later phases.
- A2. **Viewer / producer** watches the game and reviews hidden reasoning, intent, turn diagnostics, and strategic reflection records in simulation artifacts.
- A3. **Maintainer / planner** needs a bounded first slice that improves behavior without forcing the full room-matching redesign.

---

## Requirements

**Mingle intent**

- R1. Before initial Mingle room choice, each agent must form a hidden Mingle intent that states whom they want to seek, whom they want to avoid, preferred room size, purpose, provisional target, and opening ask.
- R2. Mingle intent must be used by the agent's room choice and first Mingle turn, not only logged as a disconnected reflection.
- R3. Intent may be uncertain or provisional, especially in early rounds, but it must name at least one player or explain why the agent is avoiding a name.
- R4. Intent must stay private to the acting agent and producer/debug surfaces; it must not be delivered as player-visible speech.

**Room choice behavior**

- R5. Room choice should be framed as choosing the best room for the agent's intent, not as picking a neutral number from an empty map.
- R6. Room choice diagnostics should preserve the agent's intent summary alongside the requested and assigned room so simulation review can explain why the agent entered that room.
- R7. A room-choice failure should not systematically collapse all failed choices into the same fixed room when an alternate valid room can be selected without breaking game rules.

**Strategy spectrum behavior**

- R8. Non-solo Mingle turns should offer a range of private-room strategy signals, including naming a target or ally, asking for a commitment, trading information, offering protection, planting doubt, coordinating a public story, or moving rooms for a stated purpose.
- R9. Early-game Mingle should allow provisional target naming when it fits the agent's intent; the agent can also hedge, stay social, or ask exploratory questions without being treated as a failure.
- R10. Strategy signals must stay in character so different personalities produce different levels of game talk, from guarded social probing to explicit deal-making.
- R11. NO_REPLY, guarded replies, and purely social check-ins remain valid when supported by intent, room context, or persona.
- R12. TALK plus movement should be treated as a valid bridge move when the agent wants to leave one room with a message and continue strategy elsewhere.

**Observability and validation**

- R13. Mingle intent, strategy signals when present, movement choice, and hidden reasoning must remain available in structured simulation artifacts without leaking to player-visible messages.
- R14. Simulation review should be able to answer whether Mingle now produces a healthy mix of room spread, social probing, named targets, explicit asks or deals, movement with purpose, and later phase carryover.
- R15. Prompt and behavior validation should protect lobby from becoming overtly strategic while allowing Mingle to become privately explicit.
- R16. Current docs affected by agent decision surfaces or simulation output should be updated when this behavior ships.
- R17. Strategic reflections after decision phases must be captured as structured producer/debug records in local simulation artifacts and MCP-queryable logs, not only as in-memory agent state.
- R18. Strategic reflection records should expose the agent's current certainties, suspicions, allies, threats, and plan, plus hidden thinking and raw reasoning context when available.
- R19. Validation should compare Mingle room behavior against subsequent reflection records and later votes or rumors so a reviewer can tell whether private-room strategy changed the agent's plan.

---

## Key Flows

- F1. **Mingle intent before room choice**
  - **Trigger:** A normal round enters Mingle and open rooms are available.
  - **Actors:** A1, A2
  - **Steps:** The agent reviews game state, memory, recent public context, and Mingle phase guidance; forms a hidden intent; chooses a room using that intent.
  - **Outcome:** The room choice has a visible diagnostic reason for simulation review and is not a context-free room-number pick.
  - **Covered by:** R1, R2, R3, R4, R5, R6

- F2. **Non-solo Mingle turn**
  - **Trigger:** The agent is in a Mingle room with at least one other occupant.
  - **Actors:** A1, A2
  - **Steps:** The agent uses its intent, room occupants, room conversation, and movement options to speak or move on the social-to-strategic spectrum.
  - **Outcome:** The room receives private speech or purposeful movement that may build rapport, test commitments, name people, trade information, or create a later-phase plan.
  - **Covered by:** R8, R9, R10, R11, R12, R13

- F3. **Solo Mingle turn**
  - **Trigger:** The agent is alone in a Mingle room.
  - **Actors:** A1
  - **Steps:** The agent recognizes that TALK has no player audience and either stays silent for a reason or moves toward a better room.
  - **Outcome:** Solo-room behavior does not emit empty strategy theater, and movement remains purposeful.
  - **Covered by:** R11, R12

- F4. **Simulation review**
  - **Trigger:** A maintainer runs a Mingle-focused simulation with chatty or structured artifacts enabled.
  - **Actors:** A2, A3
  - **Steps:** The reviewer inspects room choices, Mingle turns, hidden intent, strategy signals, strategic reflection records, social probes, and later rumors/votes.
  - **Outcome:** The reviewer can tell whether agents escaped lobby-safe behavior and whether Mingle changed agent plans, threat maps, or later actions.
  - **Covered by:** R13, R14, R15, R16, R17, R18, R19

- F5. **Strategic reflection capture**
  - **Trigger:** The engine runs a hidden strategic reflection after a decision phase.
  - **Actors:** A1, A2
  - **Steps:** The agent produces its current strategic assessment; the engine updates agent memory and emits a producer/debug record for simulation analysis.
  - **Outcome:** The reflection is inspectable through local artifacts and MCP tools without becoming player-visible dialogue.
  - **Covered by:** R17, R18, R19

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R6.**
  - **Given:** A new Mingle phase starts with open rooms available.
  - **When:** An agent chooses an initial room.
  - **Then:** The choice is grounded in a hidden Mingle intent that names a purpose and at least one player signal, and the diagnostic record explains the choice.

- AE2. **Covers R8, R9, R10.**
  - **Given:** An early-round agent is in a room with two other players.
  - **When:** The agent talks.
  - **Then:** The prompt allows the agent to name a provisional target, ask for a commitment, test an alliance, or stay more social and guarded without forcing a target name.

- AE3. **Covers R4, R13.**
  - **Given:** A Mingle turn has hidden intent, thinking, and raw reasoning context.
  - **When:** The game records player-visible room speech.
  - **Then:** Other players see only the speech they are allowed to hear, while producer/debug artifacts retain the hidden diagnostic context.

- AE4. **Covers R11, R12.**
  - **Given:** An agent is alone in a Mingle room.
  - **When:** The agent takes a turn.
  - **Then:** The agent either stays silent with a strategic reason or moves toward a room that better serves its intent.

- AE5. **Covers R14, R15, R16.**
  - **Given:** A maintainer compares a Mingle-focused simulation before and after the change.
  - **When:** They review structured turn logs.
  - **Then:** They can measure room spread, named targets, explicit asks or deals, movement with purpose, and whether those signals carry into later phases.

- AE6. **Covers R17, R18, R19.**
  - **Given:** A strategic reflection runs after a Mingle-influenced decision phase.
  - **When:** The maintainer inspects local simulation artifacts through the game MCP or raw JSONL logs.
  - **Then:** They can find a structured reflection record for the agent with certainties, suspicions, allies, threats, plan, and available hidden reasoning context.

---

## Success Criteria

- First Mingle produces more than room-number-only diagnostics; each agent has an inspectable hidden intent.
- Non-solo Mingle messages show a wider spectrum than vague social impressions, including at least some named players, strategic probes, explicit asks, or deals across the phase.
- Lobby remains public-social and does not regress into overt vote planning.
- Structured artifacts remain useful for `--chatty` and local model review without exposing hidden reasoning to players.
- Strategic reflection records are queryable in the same validation workflow as room choices, Mingle turns, rumors, and votes.
- The first slice is small enough for a follow-up plan to implement without committing to preference-matched room allocation.

---

## Scope Boundaries

In scope:

- Hidden Mingle intent before room choice.
- Prompt and decision-surface changes that make room choice and turns use that intent.
- A strategy-spectrum expectation for non-solo Mingle turns.
- Diagnostics and docs needed to validate the new behavior in simulations, including strategic reflection capture.
- Clarifying room-context wording if needed to prevent agents from confusing themselves with other occupants.

Out of scope:

- Preference-matched room allocation as the primary room formation mechanism.
- End-of-Mingle debrief memory extraction beyond any minimal hook required for validation.
- A hard requirement that every non-solo turn must name a target or perform a game move.
- Making strategic reflections player-visible.
- A broader personality-system rewrite outside the Mingle behavior needed for this slice.
- UI work beyond preserving current player/privacy boundaries.
- Any current-path Whisper alias, fallback, or legacy framing.

---

## Dependencies and Assumptions

- The current Mingle phase remains the canonical room phase for new games.
- Hidden `thinking` and `reasoningContext` remain producer/debug artifacts and must not become player-visible strategy.
- Existing simulation artifacts under `packages/engine/docs/simulations/` are the primary validation surface for this prompt and decision-surface work.
- The game MCP should be able to inspect the records needed for validation, including strategic reflection records.
- The planner should decide the exact structured return shape and validation tests, but the product requirement is that intent, strategy signals, and strategic reflections are inspectable when present.

---

## Sources

- `docs/ideation/2026-06-12-mingle-prompt-unblocking-ideation.html`
- `docs/brainstorms/2026-06-11-mingle-phase-requirements.md`
- `AGENTS.md`
- `CONCEPTS.md`
- `README.md`
- `docs/reasoning-transcript-observability.md`
- `packages/engine/src/agent.ts`
- `packages/engine/src/diary-room.ts`
- `packages/engine/src/phases/mingle.ts`
- `packages/engine/src/simulate.ts`
- `packages/engine/src/game-runner.types.ts`
