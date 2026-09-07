---
title: Complete format round bookkeeping before advancing the phase machine
date: 2026-09-06
module: format kernel
problem_type: logic_error
component: service_object
severity: high
tags: [two-names, format-kernel, endgame, durable-execution, testing]
---

# Complete format round bookkeeping before advancing the phase machine

## Symptom

A five-player Two Names game eliminated one player, then failed to start another
round because no format was eligible. It should have entered the final four.
The failure surfaced in a PostgreSQL test that let an owned game finish while
deployment admission was closed.

## Cause and fix

Two Names accepted the elimination in game state but sent only `PHASE_COMPLETE`.
The phase machine retained five living players. The generic format resolver also
recorded the round result, cleared format pressure and selection, and updated the
actor's eliminated and living rosters before completing the phase.

Both paths now call `completeFormatRound` after accepting their canonical
elimination. Format-specific ballot and elimination semantics remain with each
resolver; standard round completion is shared.

## Verification

`packages/api/src/__tests__/game-durable-run.test.ts` runs a complete five-player
Two Names game with controlled model responses, closes admission while it is
owned, and asserts normal terminal completion under the same owner epoch before
the worker reports zero ownership. This is real PostgreSQL/engine lifecycle
coverage, not live-provider or Linux/systemd proof.

Bounded `maxRounds: 1` tests can verify a round's decisions while hiding a broken
transition out of that round. Keep a full-game regression when introducing a
format-specific resolver.
