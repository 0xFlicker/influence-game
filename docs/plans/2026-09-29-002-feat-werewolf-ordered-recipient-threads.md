---
title: Werewolf ordered recipient threads and final plurality ballot
type: feat
status: completed
date: 2026-09-29
---

# Werewolf ordered recipient threads

## Accepted design

Shuffle the opening ring once from the game seed. Persist the cursor across nights and advance after completed or skipped openings, skipping eliminated players. Each living player gets at most one opening per day. An opener chooses zero to three distinct living recipients, in order. They respond first; the rest of the living room follows in a seeded random order frozen for this thread. Each respondent gets one Speak/Pass. Every spoken reply offers the opener one Speak/Pass answer. Passes skip answers in both stages. The opener knows the next possible respondent, including the invited/open-floor boundary; after the last respondent there is no next speaker in this thread.

No repeated response rounds, recursive branches, House rewrite or pacing delays. Every next call receives the committed causal prefix. Replies quote the opener's latest speech; opener answers quote the prior respondent. Addressing someone does not change the queue.

Earlier threads end in concurrent sealed target-or-hear-more ballots; a strict majority of all living players ends the day. The final thread instead ends in a mandatory-target plurality ballot. A unique highest total eliminates its target; ties spare everyone. Normal night actions follow. Unavailable provider decisions remain explicitly marked abstentions, never fabricated votes.

## Modules and contracts

- `engine/src/werewolf/types.ts`, `rules.ts`: rules v7; persistent ring/cursor, respondent queue, explicit `open_thread` request and `opening` decision; canonical vote mode and nullable majority threshold.
- `agent.ts`, `conversation.ts`, `runner.ts`: exact provider-native opening payload, recipient legality checks inside attempts, stage-specific causal prompts, legal failure handling; sequential dispatch after commit and concurrent sealed ballots remain.
- `observation.ts`: public recipient/turn metadata and vote mode, protected private roles/reasoning, audience-local cursor.
- API `werewolf-games.ts`, routes, runtime: removed response-round input, frozen journal plans for new opening contract, live vote readiness distinguishes plurality from majority.
- `report.ts`, both simulation CLIs, web Werewolf viewer/lobby: invited order, individual opener replies and explicit final plurality rule. Remove `--response-rounds` rather than preserving an obsolete option.
- Agent guide, concepts, Werewolf operations, model evaluation, transcript observability and CLI JSDoc updated together. No new dependency or database migration.

Rules v1–v6 logs fail clearly and remain unmodified. Restart gateway/worker and launch a fresh v7 game. No paid model run is implied by implementation or deterministic checks.

## Verification

Exercise recipient order/limits/duplicates/self/dead IDs, opener and respondent passes, accepted-prefix visibility, queue boundaries, persistent cursor after early day ending and night deaths, opening-result recovery before commit, sealed ballot recovery, early majority vs final plurality, final ties and unavailable ballots, transcript/readiness labels and both browser audiences. Run focused tests, provider-free baseline, PostgreSQL baseline, all package checks and deterministic browser journeys.

## Compact continuation hint

Change Werewolf scheduling through canonical requests/events and strict provider schemas together: types → reducer → observation/prompt → durable recovery → CLI/API/viewer → docs/tests. Preserve the persistent opening cursor, causal prefix and private ballot boundary. No scheduling from prose, no `as any`, no House rewrite, and no response-round compatibility. Provider failure is not a voluntary Pass or abstention. Keep any future House production calls direct and separate from rules authority.

## Validation evidence

- Provider-free baseline: 2,108 passed, 5 skipped, no failures across 198 files.
- Focused PostgreSQL integration: 16 passed, including accepted opening recovery and concurrent final-ballot recovery.
- API/browser journeys: 3 passed, covering CLI output, character/create/watch, both audiences, mobile layout and a final plurality elimination below majority.
- `bun run check`: all package typechecks and lint passed. `git diff --check` passed.
- Provider-free CLI smoke: two-wolf preset, seed `ordered-threads-smoke`, two-day cap, completed with final tied ballots and a day-limit draw. Private canonical log: `packages/engine/docs/simulations/werewolf-ordered-threads-smoke.private.json`; terminal output: `/tmp/werewolf-ordered-smoke.log`.
- Full PostgreSQL baseline: 1,778 passed, no failures across 149 files (360.57 seconds). No live-model evaluation was run.
