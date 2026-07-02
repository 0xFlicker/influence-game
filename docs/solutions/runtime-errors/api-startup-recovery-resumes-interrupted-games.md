---
title: API Startup Recovery Resumes Interrupted Games
date: 2026-06-30
category: runtime-errors
module: api game lifecycle and durable event recovery
problem_type: runtime_error
component: service_object
symptoms:
  - "API restart left pre-existing in_progress games without an in-memory GameRunner"
  - "Interrupted games stayed suspended or uncompleted even when durable events and checkpoints existed"
  - "Recovery readiness could overclaim resume support unless tied to an implemented startup recovery path"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags: [startup-recovery, durable-events, game-resume, owner-epochs, phase-boundary, canonical-events, suspended-games, api-lifecycle]
related_components: [game-lifecycle, game-recovery, game-ownership, game-runner, durable-run-inspection]
---

# API Startup Recovery Resumes Interrupted Games

## Problem

Influence had durable evidence for interrupted API-backed games, but evidence did not equal recovery. If the API process died while a game was running, the live `GameRunner` disappeared; the best the system could do was preserve a suspended game with diagnostic checkpoints and canonical events.

The product bug was the gap between "this checkpoint looks hydrateable" and "startup can resume this same game, append post-restart canonical events, and finish through the normal completion path." The current support is intentionally bounded: it resumes from implemented completed phase-boundary coordinates only, not arbitrary mid-phase failures, in-flight model calls, or every endgame boundary.

## Symptoms

- API process restart lost the in-memory runner held in `activeGames`, while the database could still show a game as `in_progress`.
- Startup had to treat pre-existing `in_progress` rows as orphaned because the replacement process had no local runner for them.
- Durable-run inspection could report a checkpoint as a `hydration_candidate`, but that was readiness evidence, not executable recovery.
- A user-visible game could remain incomplete even though canonical events, checkpoints, and private evidence were present.
- Unsupported coordinates and unsafe accumulators were tempting to revive, but best-effort resume there would risk duplicate events, skipped phase effects, or corrupted results.

## What Didn't Work

- Proof-only artifacts were not enough. Hydration passports, runtime snapshots, and boundary receipts made checkpoints inspectable, but they did not create a fresh owner or run the game forward.
- An admin-gated recovery button was the wrong primary acceptance path. In the current deployment shape, the API process is also the worker, so the useful behavior is "recover when able" during startup.
- Jumping straight to arbitrary `GameRunner.fromCheckpoint()` recovery was too broad. Mid-phase model calls and partial accumulators still require more durable state than this slice persists.
- A grace window for recent `in_progress` games was fake safety. On startup, the new API process has no live runner regardless of age, so old `in_progress` rows are suspended first.
- Treating transcript prose or private evidence as game truth would have made recovery easier to fake and harder to trust. Accepted canonical events remain the authority.

## Solution

Add a startup recovery path that turns a safe suspended checkpoint into a real resumed run:

1. Startup classifies all pre-existing `in_progress` rows as orphaned and suspends them.
2. Recovery scans suspended games.
3. The recovery selector loads the latest phase-boundary checkpoint, persisted canonical events, transcript replay, Runtime Snapshot payload, token cursor, and actor coordinate.
4. Only implemented boundaries pass; unsupported states return a diagnostic skip reason and remain suspended.
5. A fresh recovery owner claims the game at the checkpoint event head.
6. `startGame` constructs a normal API-backed runner with `resumeFrom`.
7. The runner hydrates game state, transcript replay, token cursor, Mingle inbox replay when needed, House continuity, and the phase actor coordinate.
8. The same game appends contiguous events under the new owner and completes through the existing result/watch-state path.

The startup wiring runs orphan classification before recovery:

```ts
const startupOrphans = await suspendOrphanedInProgressGamesOnStartup(db);

const startupRecoveryDisabled =
  process.env.INFLUENCE_API_STARTUP_RECOVERY?.toLowerCase() === "false";
if (!startupRecoveryDisabled) {
  const recovery = await recoverGamesOnStartup(db);
}
```

The recovery selector stays strict. A checkpoint must be attached to a suspended game, be a `phase_boundary`, carry Runtime Snapshot v1 evidence, target a supported actor coordinate, and sit exactly at the durable event head:

```ts
if (params.gameStatus !== "suspended") return { ok: false, reason: ... };
if (params.checkpoint.checkpointKind !== "phase_boundary") return { ok: false, reason: ... };
if (!isRuntimeSnapshotV1(runtimeSnapshot)) return { ok: false, reason: "missing_runtime_snapshot" };
if (!isSupportedActorCoordinate(actorCoordinate)) return { ok: false, reason: ... };
if (params.persistedEvents.lastTrustedSequence !== params.checkpoint.lastEventSequence) {
  return { ok: false, reason: "checkpoint_not_at_event_head" };
}
```

It also requires transcript replay, token cursor, safe accumulator state, and actor-specific prerequisites. Supported coordinates currently include the original pre-round lobby boundary, normal-round `vote`, `mingle`, `power`, and `reveal`, plus the first supported endgame-entry coordinate, `reckoning_lobby`.

Recovery ownership uses a separate claim path instead of overloading normal game start. `acquireRecoveryGameRunOwner` requires a suspended source game, rejects an already active owner, moves the game back to `in_progress`, clears `endedAt`, and seeds `lastPersistedEventSequence` to the checkpoint boundary.

`recoverGame` then calls the normal lifecycle start path with the validated resume input:

```ts
const candidate = await getSupportedRecovery(db, gameId);
const owner = await acquireRecoveryGameRunOwner(
  db,
  gameId,
  candidate.resumeFrom.lastEventSequence,
);
const result = await startGame(db, gameId, owner.claim.ownerEpoch, {
  resumeFrom: candidate.resumeFrom,
});
```

The engine constructor handles resume setup by rebuilding `GameState` from canonical events, setting the flushed canonical sequence to the checkpoint head, seeding checkpoint keys so old boundaries are not rewritten, loading the token cursor, seeding `TranscriptLogger`, hydrating Mingle inbox replay if present, and restoring supported House continuity.

Phase actor hydration is explicit rather than magical. The runner advances the phase machine through only the prerequisite transitions needed for the target coordinate and asserts the final actor state. For example, `vote` requires a started round, `mingle` requires resolved empowered state, `power` requires room allocation, `reveal` requires candidate resolution, and `reckoning_lobby` requires the first supported endgame-entry shape.

Durable inspection now derives `resumeAvailable` from the same implemented support predicate used by startup recovery. A passport can still be useful readiness evidence without becoming marketing copy for unsupported resume.

## Why This Works

The fix treats recovery as a new owner-backed continuation, not a replay artifact. Canonical events remain the source of accepted game truth; checkpoint payloads supply only the runtime inputs needed to continue from a completed boundary.

The system preserves single-writer durability. Recovery owner rows start at the checkpoint event sequence, and existing owner checks still guard accepted commits. A recovered run can append sequence `checkpoint + 1`, while stale owners cannot keep writing through the normal owner path.

Fail-closed gating is the other half of the design. A checkpoint must be latest-at-head, phase-boundary, Runtime Snapshot v1-backed, transcript-replay-backed, token-cursor-backed, accumulator-safe, and targeted at an implemented actor coordinate. If any of those are missing, startup recovery reports a skip reason and leaves the game suspended instead of manufacturing a corrupted completion.

The acceptance proof exercises the product seam. It is DB-backed and API-lifecycle-backed, not a pure engine unit test: interrupt after a durable phase-boundary checkpoint, run startup recovery, assert the same game completes, assert event sequences stay contiguous, assert post-interruption rows use exactly one fresh owner, and assert completed results are written once.

## Prevention

- Keep `resumeAvailable` tied to the implemented recovery selector, not to `hydration_candidate`. A passport verdict is evidence readiness; implemented resume support is a runtime contract.
- Add a DB-backed recovery matrix test before enabling any new actor coordinate. The test must interrupt at that boundary, run startup recovery, assert contiguous post-restart events under a new owner, and reach normal completed results.
- Include actor coordinate in phase-boundary checkpoint identity. Several endgame phases are transcript-only, so multiple distinct actor boundaries can share one canonical event head.
- Keep unsupported boundaries suspended with diagnostic evidence. Do not repair by replaying transcript text, skipping phase effects, or synthesizing terminal results.
- Accusation Capsule V1 is now the pattern for accumulator-heavy phase-boundary resume: persist structured runtime state, seal it to the checkpoint boundary, validate IDs/names/content, and hydrate runner-local maps from that payload. Do not reconstruct accumulator truth from transcript prose or private trace text.
- When a durability TODO lands, update `docs/statefulness-plan.md`, `docs/refactor-queue.md`, and any touched plan or solution note in the same branch so the queue points at the next real risk.
- Preserve startup orphaning semantics in the single-API-process deployment. On a fresh process, old `in_progress` means no local runner exists here.
- Keep recovery owner claim separate from normal waiting-game start. Recovery has different invariants: suspended source state, checkpoint event head, no active owner, and `lastPersistedEventSequence` seeded to the boundary.
- Treat current support as phase-boundary startup resume only. Mid-phase interruption, in-flight model call recovery, arbitrary historical repair, and multi-worker or spot-fleet coordination are still unsupported.

## Related Issues

- `docs/statefulness-plan.md` is the current operating map for durable game state, supported recovery, known gaps, and next slices.
- `docs/plans/2026-06-29-002-feat-generic-phase-boundary-recovery-plan.md` is the generic phase-boundary recovery plan that expanded the supported boundary set.
- `docs/plans/2026-06-30-002-feat-endgame-phase-boundary-recovery-plan.md` is the historical implementation-ready plan for staged endgame boundary expansion; Accusation Capsule V1 later retired its follow-up TODO.
- `docs/plans/2026-06-29-001-feat-one-boundary-resume-to-completion-plan.md` is the predecessor plan that set the right acceptance bar: same-game resume to completed results, not another proof artifact.
- `docs/refactor-queue.md` tracks the remaining refactor backlog and future multi-worker orchestration work.
- `CONCEPTS.md` defines the recovery vocabulary: canonical game event, durable game-run kernel, checkpoint capsule, hydration passport, phase-boundary startup resume, and owner epoch.
- `packages/api/src/__tests__/game-recovery.test.ts` is the focused DB-backed same-game recovery suite.
- `packages/api/src/__tests__/startup-orphaned-games.test.ts` protects startup orphan classification semantics.
