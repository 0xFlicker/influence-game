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
- Close the main context with the engine-generated reminder: opener, opening statement, latest spoken statement, whether this player has used their opening, current round/cap, and remaining opportunities. Append a separate final discussion task quoting the opener's latest accepted speech for replies; an opener's answer receives the current round's replies instead. Select quotes by public day/thread/actor coordinates. A prior statement does not create a scheduling branch or authoritative addressee.
- Preserve production cues, including passes, for later media work. Current viewer shows passes as small status entries and does not interpret production notes. Original words remain accepted dialogue.
- Canonical events own scheduling and outcomes. Provider results still use strict native contracts, semantic validation, shared retries, planned action/observation bindings, and owner-fenced commits. Recovery must reuse accepted results without redispatch.
- Mystery retains audience-local prefixes and hides pack information. Omniscient can show roles and pack exchanges. Neither exposes private strategy or target reasoning.

## Changed modules and dependencies

| Area | Files and responsibility |
| --- | --- |
| Rules | `packages/engine/src/werewolf/{types,rules,runner}.ts`: rules v5, initiative, sequential scheduling, immediate public acceptance, bounded rounds, pass handling. |
| Agent | `werewolf/{agent,observation,conversation}.ts`: exact tiny speech artifact, original public prefix, short-move guidance and separate final turn focus. |
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

Current rules are v6: see [thread vote checkpoints](2026-09-29-001-feat-werewolf-thread-vote-checkpoints.md). The v5 experiments below are historical; current games add sealed ballots after every thread and require a strict majority of living players. Use fresh v6 games for evaluation.

Focused-reply experiment: keep full public history, then append a separate final user message containing the turn reminder and `conversationTurn`. Reply directly to the opener's latest accepted spoken message or pass; other respondents remain context. Later rounds use the opener's latest answer, retaining the previous spoken message when they pass. The opener still answers the group once. No scheduling/schema change or extra model calls. `werewolf-focused-replies-1.private.json` / `.md` used Luna/low, eight players, seed `role-coaching-3`, one response round and the normal ten-day cap. Village won on day three: 106 discussion turns, one voluntary pass (Rex, day two, Echo's thread), zero unavailable actions. More replies name the opener, but filler such as "I can't speak for them" remains; one stochastic trial does not establish overall improvement. Same seed controls engine randomness, not model outputs. Validation: 2,097 provider-free tests passed, five skipped; 12 focused PostgreSQL API tests passed; type checks, lint and diff whitespace checks passed. Tests cover accepted-prefix quote selection, later answers/passes, thread reset and prompt preservation through provider retries/owner replacement. For another iteration, change the focused instruction in `werewolf/conversation.ts`, preserve accepted words and causal context, and compare direct answers, filler and genuine passes in an explicitly authorized fresh live run.

Explicit passing experiment: daytime prompts now say to pass rather than merely repeat, agree, or announce no evidence, and to return null text rather than a spoken refusal. This is scoped to `discuss`, with no extra calls or changed scheduling. Live trial `werewolf-passing-1.private.json` / `.md` used Luna/low, eight players, seed `role-coaching-3`, one response round and the normal cap. Village won on day three, but all 106 daytime turns were speech: zero voluntary passes and zero unavailable discussion contributions. Rex's final vote used one provider-unavailable target fallback, which does not enter the discussion pass count. Treat the desired behavior as unachieved in this sample. Twenty-five focused provider-free tests plus package type checks and lint passed. Do not report prompt delivery or a village win as proof that passing improved.

Seer timing clarification: shared rules explicitly say one investigation per night and no daytime checks. Every request includes `seerTiming` from completed public night entries: zero before the first resolution, one throughout day-one discussion/voting and unresolved night two, then two after night two resolves. Threads and replies cannot increase this limit. Undisclosed past results within the limit and future plans remain valid questions. This is prompt guidance, with no rules-version change, extra calls, or hidden-ledger disclosure. Six additional prompt fixtures cover the phase boundaries. The user's `hazy-cyan-salt` run was reported as a village win before this clarification; it is not validation of the new prompt.

After the three role-coaching trials, the user approved Villager guidance to provisionally follow specific uncontested Seer results while considering contrary evidence and both endgame hypotheses. It also explicitly reminds Villagers that elimination does not reveal roles. Wolf guidance and conversation mechanics remain unchanged. Those three trials predate this addition; Villager coaching has provider-free prompt-routing coverage but no new live evaluation yet.

Follow-up evaluation: Seer and Doctor now receive private role coaching from `werewolfRoleCoaching` in `strategy.ts`, injected by `agent.ts`. Seer guidance preserves private certainty and accurate reveal ledgers; Doctor guidance favors hidden protection of a plausible claimed Seer, including under uncertainty, within legal-target limits. Villager/Wolf guidance, conversation scheduling and decision schemas are unchanged. See [coaching and evaluation](../werewolf.md#seer-and-doctor-coaching). Use fresh games and the normal safety cap for multi-night evaluation. Coaching routing/isolation tests and the required baselines pass (2,090 provider-free tests, five skipped; 1,774 PostgreSQL tests; type checks and lint). Live seeds are `role-coaching-1` (six seats), `role-coaching-2` and `role-coaching-3` (eight seats), all Luna/low with one response round. Local original transcripts use `werewolf-role-coaching-N.private.md` beside canonical JSON.

Work in the existing Werewolf checkout. Start a fresh v6 API game with `bun run simulate:werewolf:api --preset one_wolf --response-rounds 1 --audience omniscient`; add `--transcript` to inspect production notes and turn positions. Presets are six players/one wolf or eight players/two wolves (`--preset two_wolves`). The API worker's configured provider plays the game. Do not reintroduce House rewriting or a separate should-speak call. Keep player text original, cues opaque, and the next request behind the previous durable commit. Compare repetition, concrete replies, passes, role use, and reading experience before raising the round cap. Provider-free fixtures prove scheduling; dialogue claims require an explicitly opted-in live run. Preserve no-`as any`, direct-House-call discipline, strict schemas, and audience boundaries.


The day scheduler and final vote in this plan are superseded by [ordered recipient threads, rules v7](2026-09-29-002-feat-werewolf-ordered-recipient-threads.md). Earlier validation and live trials remain historical evidence.
