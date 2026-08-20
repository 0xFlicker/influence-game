---
title: Bound Phase-Cadence Narration With Selective Fact Frontiers
date: 2026-08-20
category: architecture-patterns
module: House summary cadence
problem_type: architecture_pattern
component: game_engine
severity: high
applies_when:
  - "increasing model-authored narration cadence without replaying full game history"
  - "letting a narrator select salient facts while canonical events remain authoritative"
  - "requiring exact per-call and per-game provider cost evidence"
tags: [house, narration, canonical-events, selective-context, tool-loop, privacy, cost-accounting]
related_components: [engine, simulation, token-tracker, documentation]
---

# Bound Phase-Cadence Narration With Selective Fact Frontiers

## Problem

A once-per-round narrator can tolerate a large prompt containing the accumulated transcript, public messages, diary entries, room allocations, producer strategy, and round facts. Reusing that call shape after most phases multiplies spend and gives non-authoritative prose too much opportunity to compete with canonical truth.

Making each call merely shorter is not enough. The scheduler, authorization boundary, source lineage, failure semantics, and accounting all have to remain bounded when call count increases.

## Pattern

At each meaningful actor-coordinate boundary, compile a server-owned frontier from changes after the last examined canonical and eligible-dialogue heads. The seed contains only:

- boundary identity and beat class;
- a compact salience catalog;
- compact non-authoritative narrative continuity; and
- remaining tool/byte/prose budgets.

Keep fact bodies in an in-process read-only store. Allow one sequential request for a small typed category set, then require the model to emit cited prose or select no material change. Source aliases are request-local and map to exact producer-private coordinates. The public transcript receives only validated prose; it never receives aliases, coordinates, tool payloads, or diagnostics.

The current categories deliberately do not overlap:

- `canonical_phase_facts` for accepted decisions and outcomes;
- `player_projection_facts` for audience-safe roster, room, alliance, and eligibility state; and
- `audience_dialogue_quotes` for explicitly public player statements labeled non-authoritative.

Prior House/system prose, diary, thinking, private/huddle speech, producer evidence, and sealed or unrevealed facts do not enter the catalog or omission counts. Anonymous dialogue is relabeled `Anonymous` before provider serialization.

## Scheduler and continuity

Schedule by actor coordinate, not coarse phase enum. This distinguishes normal format work from legacy Council and from Reckoning, Tribunal, and Judgment. Treat accepted elimination, round resolution, and endgame results as milestone beats; keep ordinary speeches, lobby movement, menus, and picks in the smaller envelope. `checkGameOver` and terminal cleanup are not narration boundaries.

Preflight skips happen before provider I/O when no allowlisted material changed. Model-selected skips and provider failures emit no fallback prose and remain nonfatal to gameplay. The first failure may carry its unseen delta to the next boundary once. Success, skip, or a second failure clears the carry, so a provider outage cannot create an unbounded retry loop.

Narrative continuity helps the voice connect adjacent beats, but it is never authority or checkpoint state. Keep only the last emitted summary, bounded milestone thread state, supporting-source lineage, and examined/emitted heads. Never rebuild continuity by parsing transcript prose.

## Bounds and accounting

Use separate hard envelopes for ordinary and milestone beats. Both permit at most two explicit provider responses. The runner permits only one fact read for the whole game and offers it only at a milestone. The current ordinary envelope permits two categories, 4,096 returned bytes, 256 completion tokens per response, 180 public characters, and 45 seconds. The milestone envelope permits three categories, 8,192 returned bytes, 512 completion tokens per response, 360 public characters, and 75 seconds.

Disable automatic retry/fallback for this call family. Allocate a call identity before each request and retain provider-reported usage, response identity, and effective service tier. A content-free phase receipt records status, call/category/byte/source counts, and usage availability. Simulation instrumentation reconciles receipt call identities and known token subtotals with `TokenTracker`.

Price every response using its realized tier and the repository's frozen rate card. If any charged attempt lacks usage, response identity, tier, or pricing, return `inconclusive`; never fill missing cost with zero or a token estimate.

## Validation sequence

Prove the cheapest claims first:

1. Pure frontier tests establish canonical authority, visibility, anonymous identity handling, source coordinates, and byte bounds.
2. Deterministic fake-provider tests establish finite tool behavior, citation validation, continuity, and nonfatal skip/failure outcomes.
3. Runner tests establish the full meaningful actor-coordinate matrix and zero-call preflight skips.
4. Instrumentation tests establish per-phase/per-game reconciliation and exact versus inconclusive accounting.
5. A minimal current-model proving slice checks specific narration at `FORMAT_PICK` and round resolution.
6. A full-game current-model comparison decides queue completion; the proving slice alone cannot.

For R21, the reviewed meaning of “near the round-only budget” is at most `1.25x` the same game's complete round-only realized USD cost. The cache-isolated 2026-08-19 `gpt-5.6-luna` Flex fixture did not meet that bar: 16/23 eligible beats emitted, 14/23 were selected-fact-specific, and candidate cost was `$0.0023335` versus `$0.0017157` for two independent round-only calls (`1.360086x`). It did preserve 21/21 continuity coverage, identical canonical authority, exact accounting, one total fact read, and zero provider calls for the preflight skip. R21 remains open until a later implementation passes both automatic and offline quality review; the earlier reported `1.137215x` result was invalidated by evaluator and review defects.

## Failure lessons

- A compact prompt can still be expensive when schema and reasoning overhead dominate; measure the complete game, not characters per call.
- Tool schemas accepted by one model may be rejected by another. Keep strict schemas minimal and exercise the exact current model after deterministic validation.
- A catalog alias shown in the seed must be a valid current-loop citation; otherwise the model receives evidence it cannot legally cite.
- Hidden SDK retry or service-tier fallback breaks finite-loop and cost accounting. Suppress it for this call family and make every request explicit.
- A successful two-boundary slice proves the architecture, not the cadence outcome. Keep the queue open until the reviewed full scheduler and whole-game economic gate pass.
