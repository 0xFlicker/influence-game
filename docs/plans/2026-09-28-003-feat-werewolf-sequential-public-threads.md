---
title: Werewolf sequential public threads
type: feat
status: implemented
date: 2026-09-28
---

# Werewolf sequential public threads

## Decision and experiment

Replace the House rewrite with the players' accepted words. Evaluate whether short, causally ordered exchanges are enjoyable to follow before adding strategic memory or a production director. This supersedes the House reading and beat-performance experiments. Existing prototype artifacts remain local research material.

At dawn, roll and persist seeded initiative among living players. Each player gets one opening in that order. Passing on an opening skips the entire thread, as explicitly chosen by the user. Otherwise every other living player gets Speak or Pass in initiative order, followed by one answer from the opener to the group. Repeat that response round only within the configured cap; an entirely silent round, including the opener's answer, ends the thread. After all opening opportunities, vote.

Default to one response round. CLI/API can choose one to three. With N living players and R rounds, the maximum is N × (1 + N × R) daytime model calls: six players cost 42 calls at one round or 114 at three. Passes still cost a call; skipped openings and silent rounds reduce subsequent calls. Night deaths can reduce N before discussion begins.

## Contracts and authority

- A speech call returns exactly nullable `text` and nullable `cue`. Null text means Pass. Require one conversational move, usually 10–30 words; enforce 300 characters. Cue is an optional production note with a 240-character limit, never extra dialogue or private reasoning.
- No separate decision-to-speak call, recursive reply tree, model-authored IDs, gaze targets, emoji conversion, or House rewrite. Target decisions retain their own structured contract.
- Commit each accepted contribution before preparing the next speaker. Give that speaker only the public conversation that currently exists, plus authorized private role information. The engine supplies actor, thread, stage, response round, turn, and public-history position.
- Append the engine-generated reminder last: opener, opening statement, latest spoken statement, whether this player has used their opening, current round/cap, and remaining opportunities. A prior statement does not create a scheduling branch or authoritative addressee.
- Preserve production cues, including passes, for later media work. Current viewer shows passes as small status entries and does not interpret production notes. Original words remain accepted dialogue.
- Canonical events own scheduling and outcomes. Provider results still use strict native contracts, semantic validation, shared retries, planned action/observation bindings, and owner-fenced commits. Recovery must reuse accepted results without redispatch.
- Mystery retains audience-local prefixes and hides pack information. Omniscient can show roles and pack exchanges. Neither exposes private strategy or target reasoning.

## Changed modules and dependencies

| Area | Files and responsibility |
| --- | --- |
| Rules | `packages/engine/src/werewolf/{types,rules,runner}.ts`: rules v5, initiative, sequential scheduling, immediate public acceptance, bounded rounds, pass handling. |
| Agent | `werewolf/{agent,observation}.ts`: exact tiny speech artifact, original public prefix, short-move guidance and final reminder. |
| API durability | `packages/api/src/services/werewolf-{games,runtime}.ts`, `routes/werewolf.ts`: freeze and validate response rounds; reuse the existing provider journal and owner fencing. No new infrastructure or package. |
| Reporting | `werewolf/{report,api-simulate,simulate}.ts`: original contributions by default; `--transcript` adds production notes and turn positions. Remove `--summaries` and House execution entirely. |
| Viewer | `packages/web/src/app/werewolf/{werewolf-viewer,werewolf-lobby}.tsx`: sequential entries, opening headings, answer labels, small pass entries, current thread/round. |
| Guidance | `AGENTS.md`, `CONCEPTS.md`, `docs/werewolf.md`, observability/local-model docs, README, DEVELOPMENT and simulation JSDoc record the new contract. |

This is rules version 5 and requires a fresh game. Earlier experimental logs fail clearly; there is no compatibility rewrite or new SQL migration. Pack negotiation, role actions, voting, victory conditions, and shared character/per-game strategy separation remain under their existing rules.

## Verification

Engine tests cover initiative, one opening per survivor, exact bounded call order for all three caps, prefix causality, pending-call isolation, opening-pass skips, silent-round endings, remaining opportunities, canonical replay, and malformed tiny contracts. API tests cover sequential provider retry/recovery across owner replacement and audience secrecy. Browser journeys exercise CLI creation/readback, character strategy editing, both spectator modes on mobile/desktop, and private pack negotiations.

Provider-free baseline: 2,086 passed, five skipped. Final focused scheduling tests: eight passed. Browser journeys: three passed, with mobile screenshot inspection. Full PostgreSQL baseline: 1,774 passed. `bun run check` (all package type checks and lint) and `git diff --check` passed.

Live trial: `openai:gpt-6-luna`, low reasoning, seed `sequential-threads-1`, six starting players, one wolf, one response round, one-day cap. Five survived the night; five threads produced 30 spoken contributions, 19–31 words each (mean 24.6). No passes, cues, or unavailable contributions. Players referred to preceding challenges and revised claims; repeated suspicions remained. The village eliminated its Seer, reaching the evaluation cap. This establishes live dialogue execution, not strategic quality or game balance. No House model calls ran.

Local artifacts: `packages/engine/docs/simulations/werewolf-threads-live-2026-09-28.private.md` and `.private.json`. The Markdown is an omniscient rendering of the accepted canonical log without further model calls.

## Repeat / continuation hint

Work in the existing Werewolf checkout. Start a fresh v5 API game with `bun run simulate:werewolf:api --preset one_wolf --response-rounds 1 --audience omniscient`; add `--transcript` to inspect production notes and turn positions. Presets are six players/one wolf or eight players/two wolves (`--preset two_wolves`). The API worker's configured provider plays the game. Do not reintroduce House rewriting or a separate should-speak call. Keep player text original, cues opaque, and the next request behind the previous durable commit. Compare repetition, concrete replies, passes, role use, and reading experience before raising the round cap. Provider-free fixtures prove scheduling; dialogue claims require an explicitly opted-in live run. Preserve no-`as any`, direct-House-call discipline, strict schemas, and audience boundaries.
