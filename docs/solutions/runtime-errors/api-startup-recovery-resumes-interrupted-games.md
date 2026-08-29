---
title: Durable Logical Turns Survive Ordinary API Reloads
date: 2026-08-28
category: runtime-errors
module: api game lifecycle and engine execution
problem_type: runtime_error
component: service_object
symptoms:
  - "Normal API reloads stranded in_progress games at unsupported phase coordinates"
  - "Checkpoint recovery could discard already visible phase work or repeat provider calls"
  - "Startup performed a can-or-cannot-resume classification instead of continuing the committed program"
root_cause: non_atomic_workflow
resolution_type: architecture_change
severity: high
tags: [durable-turns, startup-adoption, game-resume, owner-epochs, canonical-events, xstate, postgres]
related_components: [game-lifecycle, game-ownership, game-runner, provider-call-journal, game-publications]
---

# Durable Logical Turns Survive Ordinary API Reloads

## Problem

The previous recovery path persisted canonical events and phase-boundary checkpoints, then tried to decide which stopped actor coordinates were safe to hydrate. That was the wrong unit of durability. A phase could emit accepted events or viewer output before its checkpoint existed, and the next process then had to choose between replaying work, throwing it away, or leaving the game suspended.

This produced an expanding allowlist of “resumable” phases even though a recovery inside one phase had the same fundamental problem: some work could already have been observed while other in-memory state had not committed.

## Root cause

The engine treated a long-lived in-memory runner as execution authority and treated checkpoints as recovery evidence after the fact. Canonical facts, transcript, XState cursor, player continuity, House continuity, provider acceptance, and viewer delivery were not one atomic commit.

Checkpoint completeness could reduce risk, but it could not answer the only durable question that matters after a reload: which exact logical turn committed?

## Solution

Make a logical game turn the transaction boundary:

1. Persist the exact next intent and deterministic seed before planned remote work.
2. Reconstruct the turn from the last committed XState snapshot and typed cursor.
3. Execute against scratch `GameState`, transcript, continuity, and phase actor.
4. Atomically commit canonical events, transcript rows, player continuity, House notebook/public beat, next snapshot/cursor, accepted provider links, and viewer publications.
5. Publish only the committed result.

If the process stops before step 4, the scratch work is discarded and the same planned turn is reconstructed. If it stops after step 4, the replacement runtime installs the committed result. An ambiguous commit response rereads the turn row instead of repeating effects.

### Startup adoption

Startup now scans current `in_progress` games after the API listener is owned. It expires the prior process owner, acquires a fresh owner epoch, points `game_execution_states.owner_epoch` at that owner, and starts the runner from the unchanged committed cursor.

There is no phase-coordinate resume selector in the active lifecycle. `ready`, `waiting_retry`, and `terminal` execution states are work. `repair_required` is contradictory authority and is not gameplay work.

The one empty-frontier exception closes the owner-claim-to-runner-initialization crash window. Startup may adopt it only when there is no execution row, no canonical event, no durable dialogue, no completion settlement, and the transcript state is empty. `prepareDurableExecution()` then commits the roster bootstrap before background execution begins.

For an `in_progress` game created before logical-turn authority existed, startup also supports a one-time exact cutover from a validated phase-boundary runtime snapshot. It requires the checkpoint to match the canonical head, projection hash, owner head, transcript watermark, token cursor, and structured continuity. The cutover creates one synthetic committed turn containing the already-durable frontier, assigns the validated transcript rows to it, and installs `game_execution_states` without appending or discarding canonical events. From then on the game uses only logical-turn authority. An incomplete or contradictory historical checkpoint is left untouched rather than guessed from prose.

### Provider calls

Stable logical-call coordinates preserve validated accepted values in the provider journal. When a process dies after provider acceptance but before turn commit, the adopted runner revalidates and reuses that accepted value. Provider calls explicitly listed in a turn intent are also fenced to that planned turn and cannot dispatch after it commits.

A transport request that disappears before a terminal attempt record can be established may be retried and spend twice. It still cannot create two accepted game effects.

### House and contestant continuity

House cadence runs inside the phase scratch turn. Byte-exact public House copy, its transcript row, recent beat history, and the opaque private narrative notebook commit together before viewer delivery. No claims, aliases, receipts, or prose parsing are involved.

Diary Q&A and player strategy continuity are reconstructed from their typed durable inputs. Tribunal defense reconstructs accusations only from typed canonical `endgame.speech_recorded` events, never transcript text. Judgment retains typed participants and question/answer history without exposing the House notebook.

### Viewer publications

Turn commit creates a contiguous game-local publication sequence and persists its pacing timestamps. WebSocket reconnect catches up from the client sequence; the web client buffers out-of-order envelopes and deduplicates repeats. Public diary entries use this same feed. Private huddles, thinking, House notebook state, and producer traces do not. The final turn holds completion until settlement finishes, preventing a viewer from seeing a winner before completed read models exist.

### Terminal settlement

Terminal settlement no longer depends on the stopped runner's return object. It reconstructs the result from canonical events, transcript from durable rows, usage from provider accounting, and model/config from the sealed game record. The settlement transaction writes the completed result and side effects, closes the owner, and releases the held completion publication.

Reload between terminal commit and settlement is therefore an ordinary terminal adoption, not a special manual retry workflow.

## Why this works

The design persists a program counter, not a guess about replay safety. The committed XState snapshot and typed cursor decide what runs next; canonical events decide what happened. Scratch state can be thrown away because it was never authority.

The owner epoch remains the single-writer fence. A stale process cannot plan, dispatch a turn-bound provider call, commit effects, or settle after adoption. A replacement owner may settle a terminal turn written by the old owner only when the execution head and canonical hash still match exactly.

The information boundary stays clean: game facts are typed canonical state, while House/player prose is presentation and context. Durability never creates an excuse to reverse-engineer facts from text.

## Prevention rules

- Put every new phase mutation inside a durable logical turn. Do not append an event and promise to checkpoint later.
- Reserve stable provider identity before dispatch. Revalidate accepted replay values under the same exact schema and semantic decoder.
- Use a deterministic turn seed for every rules-owned random path.
- Commit House public copy and notebook state in the same turn; never release either from scratch state.
- Keep private huddles, thinking, notebook, and producer-trace data out of viewer publications; publish accepted diary entries through the ordered viewer feed.
- Derive recovery-time facts from canonical events or typed continuity only. Never parse transcript prose.
- Keep startup adoption listener-first and owner-fenced. A process that failed to bind must not touch game ownership.
- Treat checkpoint capsules and hydration passports as historical/forensic artifacts, not current runtime selectors.
- Prove reload from normal phase, format, endgame, terminal, and initial-start boundaries, plus same-game API adoption to completion.
- Keep corrupt or contradictory authority explicit as `repair_required`; do not manufacture a cursor or ending.

## Verification

The regression suite covers:

- plan-before-dispatch and exact turn-intent replay;
- crash before commit and ambiguous commit response;
- committed mid-Lobby, Format Mingle/Resolve, Reckoning, Tribunal defense, and Judgment reconstruction;
- typed accusation recovery with a transcript-prose canary;
- House public-summary/private-notebook atomicity and no notebook leakage;
- provider accepted-value replay and turn fencing;
- API interruption, owner adoption, same game ID, contiguous turns, one roster initialization, and normal completion;
- terminal reconstruction and held completion release;
- sequenced websocket catch-up and client deduplication.

Producer durable-run inspection reports the safe structural execution cursor, committed heads, any planned turn, and due/scheduled/held publication counts. It deliberately excludes XState snapshots, continuity bodies, intent participants, provider payloads, and prose.

See `docs/statefulness-plan.md` for the current operating contract and remaining multi-process limits.
