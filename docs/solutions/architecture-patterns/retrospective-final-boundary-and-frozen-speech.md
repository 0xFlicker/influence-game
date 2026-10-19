---
title: Keep competitive outcome distinct from retrospective completion
date: 2026-10-11
module: Game lifecycle, retrospective, replay, Production Studio
problem_type: architecture_pattern
category: architecture-patterns
tags: [retrospective, canonical-events, werewolf, durable-execution, recovery, replay, export]
---

# Retrospective completion in the existing engine

A game can establish its winner before all required postgame speeches have committed. Closing ownership, settling or ending observation at that outcome loses the recoverable tail. An independent postgame worker would introduce another source of progress and completion authority.

Retain one existing engine execution through canonical initialization, one statement per original contestant and a full-roster completion record. Competitive facts remain immutable at their earlier outcome event. Result reads derive that outcome from validated canonical history and report execution/progress separately. Only the completed epilogue authorizes terminal cursor, owner closure, settlement, final cost/transcript capture and downstream jobs.

That fresh-execution requirement must not become a universal historical read gate. Completed Influence games that never entered a canonical retrospective are valid; only games that entered the phase require its completion proof on results, retrospective-detail and Studio reads. Werewolf v7 completes at its canonical outcome. Absent retrospectives on completed games report no pending statements, and existing results/replay remain readable. Cover both no-retrospective games and truncated retrospective histories in route-level regressions.

Freeze one complete private input at the original outcome and prepare the next actor with exact accepted priors. Both game adapters use the shared speech contract; Werewolf retains its own reducer, deaths and separately seeded survivor order. Provider journal coordinates and owner fences preserve accepted values across restarts. A required failure checkpoints the exact slot and suspends automatic spending; current operator authority, exact head/failure and idempotency fence explicit recovery.

Retrospective speech remains ordinary presentation. Correlate captured Influence dialogue to its canonical actor, ordinal, text and event boundary before adding it to a production source. Werewolf derives its audience-local entry from its own validated history. Stable IDs and frozen source/media/recording hashes carry that provenance through Studio, compiler and offline movie. Selection uses reviewed IDs; the result is independent, and a later label or artwork cannot expand a cut.

Influence playback and full replay exports close on the accepted winner and standings after `retrospective.completed`. Preserve that event in presentation-only frame reads even when a later END frame exists. The endgame cue compiler repeats the existing result at the completion coordinate, preserving chronological seeks and live append without inventing a second game outcome. An unfinished retrospective stays on its accepted speeches; historical games without a retrospective retain their original result ending.

Proof combines reducer/journal/recovery PostgreSQL tests, browser result-to-speech/paused-tail navigation, source substitution rejection and actual Studio-to-encoded-frame comparison. Deterministic local proof does not establish real-model character voice or deployed worker/provider behavior. See [runtime guide](../../game-retrospective-runtime.md) and [implementation evidence](../../plans/2026-10-10-004-feat-game-retrospectives-implementation-plan.md).
