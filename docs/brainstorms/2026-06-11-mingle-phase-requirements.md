---
date: 2026-06-11
topic: mingle-phase
---

# Mingle Phase Requirements

## Summary

Mingle becomes the current private-room social phase for new Influence games. It is not a display name for Whisper. New game state, events, persisted rows, prompts, simulator output, frontend types, and current docs should use Mingle vocabulary because Mingle better describes agents moving through rooms, reading the room, and making watchable social decisions.

---

## Problem Frame

The open-room experiment is already product-directionally Mingle, but too much of the codebase still calls the phase Whisper. That old name tells agents and humans the wrong thing: a whisper sounds like a narrow, private aside, while Mingle is a social movement phase where rooms may be empty, solo, crowded, strategic, or quiet.

The goal is not to stage a careful legacy compatibility program for Whisper. The goal is to move the active game forward. Whisper can remain as historical residue where it already exists, but it should no longer be the current game-state concept.

---

## Key Decisions

- **Mingle is a new current phase.** New games emit `MINGLE`; they do not emit `WHISPER` and rely on a display label to paper over it.
- **Whisper is legacy, not a supported alternate name.** Existing old rows, fixtures, specs, or exports can remain where they are useful, but the current runtime should not route through Whisper.
- **Do not purge old games for the rename.** Deleting historical data is unnecessary; it is acceptable if older Whisper games lose full frontend polish while the product moves forward.
- **Prefer direct current-name cleanup over compatibility ceremony.** A small amount of tolerance for old artifacts is fine, but broad normalizer layers, dual naming, and permanent aliases should not become the center of the work.
- **Agent-facing language is the first-class product surface.** The rename succeeds only if agents reason about Mingle as room movement and shared room context, not as a private whisper phase.

---

## Actors

- A1. **Agents** decide where to move, what to say, and how to use private-room information in later votes.
- A2. **Viewer / host** watches the game and needs the phase to read as active social strategy, not a hidden side-channel.
- A3. **Maintainer / planner** needs a clear current-vs-legacy boundary so implementation does not preserve stale Whisper behavior by accident.

---

## Requirements

**Current phase identity**

- R1. New games must use `MINGLE` as the active phase identity for phase changes, current game state, stream events, persisted transcript rows, simulator output, and frontend phase types.
- R2. The active engine state machine must stop using Whisper as the current private-room phase and must model the room phase as Mingle.
- R3. Mingle should be treated as a product concept with its own semantics: agents move through rooms, rooms can have any occupancy, and speech is scoped to current room occupants.
- R4. Current-game docs and rules must describe the phase as Mingle, not as Whisper with a new label.

**Agent and prompt behavior**

- R5. New Mingle prompts, tool names, phase guidelines, system transcript text, and reasoning context must not use Whisper vocabulary unless quoting a historical artifact.
- R6. Mingle prompts must explain the privacy boundary in plain terms: room messages are private to current room occupants, not public, and not necessarily one-to-one.
- R7. Local-model and `--chatty` observability must use Mingle terms so simulation review reflects the current product behavior.

**Data and legacy boundary**

- R8. New persisted rows and current API/WebSocket payloads must use Mingle vocabulary for the phase and private-room message scope.
- R9. Existing Whisper rows, fixtures, old exports, and historical docs may remain as legacy artifacts; they do not need to be backfilled or deleted for this rename.
- R10. The frontend does not need to guarantee polished display of old Whisper games as part of the Mingle cutover.
- R11. Compatibility code should be narrow and local when needed to prevent crashes or broken tests; it should not present Whisper as an equal current phase.

**Docs and validation**

- R12. Shared vocabulary docs must define Mingle as the current room phase and mark Whisper as legacy/historical where it appears.
- R13. Tests must assert that new game execution, current events, current persisted rows, and current prompt surfaces use Mingle rather than Whisper.
- R14. Terminology checks should allow Whisper only in historical specs, legacy fixtures, migration notes, or explicit compatibility tests.

---

## Key Flows

- F1. **New game execution**
  - **Trigger:** A new game enters the private-room social phase.
  - **Actors:** A1, A2
  - **Steps:** The game enters Mingle, agents choose or remain in rooms, agents speak to room occupants, and the game proceeds to the next phase.
  - **Outcome:** All current state, events, transcripts, prompts, and visible labels name Mingle.
  - **Covered by:** R1, R2, R3, R5, R8, R13

- F2. **Historical Whisper artifact encountered**
  - **Trigger:** A test, export, old row, or historical doc still contains Whisper.
  - **Actors:** A3
  - **Steps:** The artifact is either left alone as history or handled by narrow legacy code where needed.
  - **Outcome:** No old game purge is required, and no broad compatibility program is created.
  - **Covered by:** R9, R10, R11, R14

- F3. **Local model simulation review**
  - **Trigger:** A maintainer runs a Mingle-focused simulation with transcript/reasoning observability.
  - **Actors:** A1, A3
  - **Steps:** The simulator prints current Mingle terminology, reasoning remains inspectable, and outputs are saved under the current product language.
  - **Outcome:** The maintainer can evaluate whether agents are making watchable Mingle decisions without Whisper language contaminating the context.
  - **Covered by:** R5, R7, R13

---

## Acceptance Examples

- AE1. **Covers R1, R2, R8, R13.**
  - **Given:** A newly created game reaches the room phase.
  - **When:** The engine emits phase changes and transcript rows for that phase.
  - **Then:** Current events and new rows identify the phase as `MINGLE`, not `WHISPER`.

- AE2. **Covers R5, R6, R7.**
  - **Given:** An agent receives a Mingle decision prompt.
  - **When:** The prompt asks the agent to choose a room or speak.
  - **Then:** The prompt uses Mingle and room-occupant language, and it contains no current-facing Whisper terminology.

- AE3. **Covers R9, R10, R11.**
  - **Given:** A historical game or fixture still contains `WHISPER`.
  - **When:** The Mingle rename ships.
  - **Then:** The artifact is not purged or backfilled solely for the rename, and any handling is limited to preventing unnecessary crashes.

- AE4. **Covers R12, R14.**
  - **Given:** A terminology scan runs after the rename.
  - **When:** It finds Whisper references.
  - **Then:** Each remaining reference is either historical/legacy by intent or fails validation.

---

## Scope Boundaries

In scope:

- Rename the active game-state concept from Whisper to Mingle.
- Make new runtime output, events, rows, types, prompts, simulator labels, and current docs use Mingle.
- Leave old Whisper artifacts in place when deleting or migrating them adds cost without product value.
- Add validation that keeps Whisper out of current-facing surfaces.

Out of scope:

- Purging old games.
- Backfilling every historical transcript row or export.
- Guaranteeing the current frontend can perfectly display old Whisper games.
- Preserving Whisper as a supported synonym for Mingle.
- Reopening the Mingle room rules themselves unless a rename task exposes a direct contradiction.

---

## Dependencies and Assumptions

- Active in-progress games should not be assumed crash-safe during the rename; drain or cancel active runs before deploying a phase identity change.
- Existing persisted transcript `phase` values are text, so historical `WHISPER` rows can remain without a destructive DB cleanup.
- The implementation plan should decide the narrowest places where old Whisper values must still be tolerated to keep tests, fixtures, or admin tools usable.

---

## Sources

- `docs/ideation/2026-06-11-whisper-to-mingle-rename-ideation.html`
- `AGENTS.md`
- `CONCEPTS.md`
- `README.md`
- `docs/reasoning-transcript-observability.md`
- `packages/engine/src/types.ts`
- `packages/engine/src/phase-machine.ts`
- `packages/engine/src/phases/whisper.ts`
- `packages/engine/src/agent.ts`
- `packages/engine/src/simulate.ts`
- `packages/api/src/db/schema.ts`
- `packages/api/src/routes/games.ts`
- `packages/web/src/lib/api.ts`
