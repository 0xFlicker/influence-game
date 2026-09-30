---
title: Werewolf thread vote checkpoints
type: feat
status: implemented
date: 2026-09-29
---

# Werewolf thread vote checkpoints

## Decision

After each opening thread concludes (including an opening pass), ask every living player for one sealed target-or-abstain ballot. The user confirmed the denominator is all living players that day, including abstainers. More than 50 percent must select the same target: `floor(living / 2) + 1`. That checkpoint immediately eliminates the target and ends the day without a second confirmation vote or remaining threads. Otherwise continue the seeded opening order. After the final thread, no majority ends the day without elimination. Check faction victory before starting another night; apply the day cap only when the day has ended.

Each checkpoint replaces the previous ballot. Record null target as abstention / hear more. The checkpoint still collects every living player's decision before a single reveal; partial commitments are never public. Provider exhaustion also abstains, with an explicit unavailable marker. Self-voting remains illegal. Speaking-pass and ballot-abstention are distinct structured actions.

## Implementation and dependencies

- `werewolf/types.ts`, `rules.ts`: rules v6, checkpoint cursor, preserved discussion across day/vote transitions, strict majority and canonical `werewolf.day_vote_resolved`. Its payload owns thread, full nullable ballot ledger, totals, required votes, eliminated ID and day-ended status. Reject earlier versions; no new migration or compatibility layer.
- `werewolf/agent.ts`, `runner.ts`: native vote contract permits nullable `targetId` with required private `thinking`; only vote allows null. Prompt supplies living count, threshold and checkpoint. Exhausted votes abstain. Existing provider retry, owner fencing and frozen-observation journal remain the authority.
- `werewolf/observation.ts`: public checkpoint identity and resolved ledgers; pending choices and rationale stay private. Day resumption retains initiative and the next opener rather than resetting the day.
- `werewolf/report.ts`, `api-simulate.ts`, Werewolf viewer/lobby: display abstentions, unavailable markers, threshold, continuation versus day end, and majority rules. Keep original dialogue and opaque production notes.
- Engine fixtures cover odd/even thresholds, exactly 50 percent, plurality without majority, no carry-forward, opening passes, final no-elimination, faction victory, sealed observations, malformed outputs, fallback and replay. API recovery covers accepted abstention reuse through owner replacement. Browser fixture covers both spectator modes and the mobile ledger.
- Update current rules, vocabulary, developer/local-evaluation/observability docs, README, simulation JSDoc and the compact agent guideline. No new dependencies, paid inference or feature flag is required.

## Call cost and evaluation

With N living players and R response rounds, a full day has at most `N * (1 + N * R + N)` calls before retries. With six living players and one response round, that is 78 calls; a first-thread majority uses 13. A skipped opening still costs its opening call plus N ballots. Early majorities shorten the chat, but repeated undecided ballots can increase total inference cost. Saved v5 model trials do not prove willingness to vote early under v6. Deterministic games prove mechanics only.

## Repeat / continuation hint

Reuse the Werewolf worktree and start a fresh v6 game with `bun run simulate:werewolf:api --preset two_wolves --response-rounds 1 --audience omniscient --transcript`. Inspect canonical `werewolf.day_vote_resolved` events and rendered ledgers, not spoken voting promises. Compare thread count before elimination, ballot abstentions (separate from unavailable ballots), total calls and strategy quality. Preserve sealed observations, living-roster denominator, exact schemas, no `as any`, and direct House-call discipline. Never accumulate past checkpoints or make a second vote after a majority.

## Validation

Provider-free baseline: 2,105 passed, five skipped. Full PostgreSQL baseline: 1,775 passed. Three API browser journeys passed, including a first checkpoint with eight abstentions followed by a second-checkpoint majority elimination. The mobile ledger was visually inspected. All package type checks and lint passed; final viewer changes also passed web type checks and lint. Diff whitespace check passed. API coverage proves malformed ballot retries and accepted abstention reuse after owner replacement without a second dispatch or partial reveal. No live-model game was run for this rule change; early-voting strategy and cost improvement remain unevaluated.

## Follow-up: ballot latency and reporter progress

Day ballots now use the existing concurrent sealed-batch execution lane. Preserve all reserved slots and frozen observations, drain dispatched attempts, and reuse accepted provider values after restart. `readWerewolfLiveView` returns spectator-only `voteProgress` beside the canonical view; count current-checkpoint accepted results without reading target/rationale payloads or revealing names. Cursor reads and stopped games omit live progress. CLI changes announce the majority and sealed reveal once, then report readiness changes and 30-second heartbeats without duplicating public entries. Test a held final voter, partial commits, owner replacement, next-checkpoint reset, secrecy and unchanged inference count. This is a rules-v6 execution/reporting update, not another game version or migration. No live-provider speed claim follows from deterministic fixtures.

Follow-up validation: 2,107 provider-free tests passed (five skipped), 1,776 PostgreSQL tests passed, and all three API/browser journeys passed. Package type checks, lint and diff whitespace checks passed. A delayed final voter demonstrates intermediate accepted-decision readiness without a public cursor change; partial-commit recovery preserves all accepted values, avoids redispatch and never double-counts. Terminal fixtures cover count changes, waiting heartbeats, invalid counts and a single canonical reveal. No paid model run was launched.


The day scheduler and final vote in this plan are superseded by [ordered recipient threads, rules v7](2026-09-29-002-feat-werewolf-ordered-recipient-threads.md). Earlier validation and live trials remain historical evidence.
