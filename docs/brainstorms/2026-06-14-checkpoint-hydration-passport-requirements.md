---
date: 2026-06-14
topic: checkpoint-hydration-passport
---

# Checkpoint Hydration Passport Requirements

## Summary

Influence checkpoint capsules should gain a validator-derived hydration passport that can explain whether a checkpoint is forensic-only, blocked, or a positive `hydration_candidate`. A candidate verdict requires validated event/projection truth, a safe boundary certificate, a snapshot manifest, durable transcript/token cursors, and structured agent/House continuity capsules, while resume execution remains out of scope.

---

## Problem Frame

The durable game-run kernel now writes canonical events, owner epochs, forensic checkpoint capsules, and private evidence metadata. The durable truth read model can inspect those rows, but the checkpoint itself still carries a negative contract: `hydrateable=false`, current transcript entry counts, no token cursor, and an explicit list of missing runtime inputs.

The next risk is false confidence. If checkpoint hydration work only adds a bigger snapshot blob or a writer-controlled readiness flag, the system could claim candidate status while still missing the strategic continuity or boundary safety that a resumed game would need. The passport should make readiness earned, inspectable, and fail-closed before any `GameRunner.fromCheckpoint()` path exists.

---

## Key Decisions

- **Validator-derived readiness.** Checkpoint writers may record evidence, but validators derive the passport verdict.
- **Candidate is not hydrateable.** `hydration_candidate` means the checkpoint has passed v1 readiness checks for future hydration work, not that execution can resume.
- **Continuity is required.** A checkpoint cannot become a candidate if structured agent continuity or House continuity is missing, malformed, or only implied by raw private evidence.
- **Boundary safety is required.** A checkpoint cannot become a candidate if pre-boundary model or effect work can still commit after the checkpoint boundary.
- **Snapshot manifest before snapshot sprawl.** The passport must name the runtime subsystems it is judging instead of treating `snapshot` as an opaque JSON bag.

---

## Actors

- A1. **Operator or maintainer** inspects a durable run and needs to know whether a checkpoint is a candidate for later hydration work.
- A2. **Checkpoint writer** records checkpoint evidence at durable event boundaries.
- A3. **Passport validator** derives stamp-level readiness and the overall passport verdict.
- A4. **Durable truth read model** exposes passport summaries and diagnostics without resuming execution.
- A5. **Future resume planner** consumes the requirements to design `GameRunner.fromCheckpoint()` later.

---

## Requirements

**Passport Verdicts**

- R1. The system must produce a hydration passport for each checkpoint capsule returned by durable-run inspection.
- R2. The passport must derive its overall verdict from validators rather than trusting a writer-provided ready flag.
- R3. The passport must support at least `forensic_only`, `blocked`, and `hydration_candidate` verdicts.
- R4. The passport must keep `hydration_candidate` separate from any claim that a game can resume execution.
- R5. The passport must fail closed when a checkpoint claims readiness while any required stamp is missing, malformed, or failed.

**Required Stamps**

- R6. The passport must include an event/projection stamp that validates event-boundary alignment and projection consistency.
- R7. The passport must include a boundary certificate stamp that proves the checkpoint represents a safe phase boundary.
- R8. The passport must include a snapshot manifest stamp that names every runtime subsystem judged by the passport.
- R9. The passport must include a transcript cursor stamp that distinguishes durable transcript or outbox boundaries from in-memory entry counts.
- R10. The passport must include a token/cost cursor stamp that validates cumulative model-cost state as a durable runtime input.
- R11. The passport must include an agent continuity stamp covering every player agent that must resume strategic behavior.
- R12. The passport must include a House continuity stamp covering the producer-level House state for the game.
- R13. The passport must include a privacy stamp that verifies private continuity and evidence references are not exposed as public transcript or canonical board truth.
- R14. A checkpoint must not receive `hydration_candidate` unless all v1-required stamps pass.

**Boundary Certificate**

- R15. The boundary certificate must prove that all canonical events through the checkpoint boundary have been durably accepted.
- R16. The boundary certificate must prove that no model call, retry, phase collection, or accepted effect from before the boundary can still commit after the checkpoint.
- R17. The boundary certificate must account for phase entry and exit effects that would be unsafe to duplicate or skip.
- R18. A later checkpoint's failed boundary certificate must not retroactively invalidate an earlier checkpoint that already passed its own boundary validation.

**Snapshot Manifest**

- R19. The snapshot manifest must separate canonical projection truth from runtime state that cannot be rebuilt from canonical events alone.
- R20. The snapshot manifest must name actor state, phase accumulators, agent continuity, House continuity, transcript cursor, token/cost cursor, and owner epoch as distinct judged subsystems.
- R21. The snapshot manifest must mark each subsystem as captured, validated, blocked, missing, private-reference-only, or malformed.
- R22. The snapshot manifest must make omitted subsystems visible instead of allowing unknown absence to look like readiness.

**Continuity Capsules**

- R23. Agent continuity capsules must be structured per player rather than inferred from public transcript or raw private evidence.
- R24. Agent continuity capsules must preserve enough private strategic state to keep the agent's future behavior continuous after a later hydrate path exists.
- R25. House continuity must be structured once per game and kept separate from player-scoped agent continuity.
- R26. House continuity must preserve producer-level state needed to keep the game watchable after a later hydrate path exists.
- R27. Raw prompts, raw responses, `thinking`, and `reasoningContext` may support evidence links but must not count as structured continuity by themselves.
- R28. A checkpoint must not receive `hydration_candidate` if any required agent capsule is missing, the House capsule is missing, or a continuity capsule violates privacy boundaries.

**Inspection and Diagnostics**

- R29. Durable-run inspection must expose the passport verdict, stamp statuses, and blocking reasons for each checkpoint.
- R30. Diagnostics must distinguish storage absence, malformed data, failed validator checks, and intentional privacy boundaries.
- R31. The inspection response must not expose raw private evidence, storage keys, hidden reasoning, or player-invisible House reads.
- R32. The inspection response must expose no resume action for a candidate checkpoint.

**Validation**

- R33. Automated tests must cover current forensic checkpoints and show that they remain non-candidate with explicit blockers.
- R34. Automated tests must cover malformed or contradictory passport data and prove the passport fails closed.
- R35. Automated tests must cover a checkpoint with valid event/projection data but missing boundary or continuity state and prove it is not a candidate.
- R36. Automated tests must cover a positive `hydration_candidate` fixture where all v1-required stamps pass.
- R37. A local durable-kernel smoke must inspect a real API-backed checkpoint and verify that the passport output matches the actual durable write path.

---

## Key Flows

- F1. Inspect a current forensic checkpoint
  - **Trigger:** An operator requests durable-run state for a game with current checkpoint capsules.
  - **Actors:** A1, A3, A4
  - **Steps:** The read model loads checkpoints, runs passport validators, and returns stamp-level blockers.
  - **Outcome:** The operator sees that the checkpoint is not a candidate and why.
  - **Covered by:** R1-R5, R29-R33

- F2. Validate a candidate checkpoint
  - **Trigger:** A checkpoint includes all v1-required runtime evidence.
  - **Actors:** A2, A3, A4
  - **Steps:** Validators check event/projection truth, boundary safety, snapshot manifest, cursors, continuity capsules, and privacy boundaries.
  - **Outcome:** The passport returns `hydration_candidate` without exposing resume.
  - **Covered by:** R6-R14, R23-R32, R36

- F3. Reject a continuity-incomplete checkpoint
  - **Trigger:** A checkpoint has valid events and projection but lacks structured agent or House continuity.
  - **Actors:** A1, A3, A4
  - **Steps:** Continuity validators distinguish raw private evidence from structured continuity capsules.
  - **Outcome:** The passport remains blocked and reports continuity as the reason.
  - **Covered by:** R23-R28, R35

- F4. Preserve independent boundary judgments
  - **Trigger:** A later checkpoint fails quiet-boundary validation.
  - **Actors:** A3, A4
  - **Steps:** The validator judges the later checkpoint at its own event boundary without changing earlier passport verdicts.
  - **Outcome:** Earlier valid checkpoint verdicts remain stable.
  - **Covered by:** R15-R18

---

## Acceptance Examples

- AE1. Covers R1-R5, R33.
  - **Given:** A current checkpoint capsule stores `hydrateable=false` and missing runtime inputs.
  - **When:** durable-run inspection returns its passport.
  - **Then:** the verdict is not `hydration_candidate`, and the response lists the missing stamps.

- AE2. Covers R6-R14, R36.
  - **Given:** a checkpoint has valid event/projection data, a passing boundary certificate, a valid snapshot manifest, durable transcript/token cursors, valid agent capsules, a valid House capsule, and passing privacy checks.
  - **When:** the passport validators run.
  - **Then:** the verdict may be `hydration_candidate`, and the response still exposes no resume action.

- AE3. Covers R15-R18.
  - **Given:** a checkpoint has a pending pre-boundary model effect that could still commit.
  - **When:** the boundary certificate validator runs.
  - **Then:** the checkpoint is blocked even if event/projection replay succeeds.

- AE4. Covers R23-R28.
  - **Given:** raw private evidence exists but structured agent or House continuity capsules are missing.
  - **When:** continuity validators run.
  - **Then:** the checkpoint is blocked, because raw evidence alone is not continuity state.

- AE5. Covers R29-R32.
  - **Given:** a checkpoint includes private continuity references.
  - **When:** durable-run inspection returns passport diagnostics.
  - **Then:** the response shows redacted stamp status but excludes raw prompts, raw responses, hidden reasoning, storage keys, and player-invisible House reads.

---

## Success Criteria

- Operators can tell why each checkpoint is forensic-only, blocked, or a candidate without reading raw database rows.
- A positive candidate verdict cannot be produced by a writer flag alone.
- Current forensic checkpoints continue to report honest blockers.
- Structured agent and House continuity are required for candidate status.
- Candidate checkpoints do not expose resume actions or imply crash-safe execution.
- Tests and a real durable-kernel smoke cover both positive and negative passport verdicts.

---

## Scope Boundaries

In scope:

- Hydration passport verdicts and stamp-level diagnostics.
- Validator-derived candidate status.
- Boundary certificate requirements.
- Snapshot manifest requirements.
- Structured agent and House continuity capture and validation.
- Transcript and token cursor readiness as passport stamps.
- Admin/operator inspection of passport status.
- Automated tests and one local durable-kernel smoke.

Out of scope:

- `GameRunner.fromCheckpoint()` or resumed execution.
- Owner takeover or continuing a suspended runner.
- Arbitrary mid-phase recovery.
- Public player-facing checkpoint or passport surfaces.
- Raw private evidence browsing.
- Treating raw prompts, responses, or hidden reasoning as canonical resume truth.

---

## Dependencies and Assumptions

- The durable game-run kernel remains the write-side source for canonical events, owner epochs, checkpoint capsules, and private evidence metadata.
- The durable truth read model remains the admin/operator inspection surface for passport summaries.
- Canonical event replay remains the authority for accepted board facts.
- Structured continuity capture is feasible without exposing private reasoning or House reads to players.
- Planning will decide the exact storage and response shape for passport stamps.

---

## Outstanding Questions

Resolve before planning:

- None.

Deferred to planning:

- Exact status vocabulary for stamp-level results.
- Exact required fields inside agent continuity capsules and House continuity capsules.
- Whether transcript cursor readiness is implemented through transcript rows, an outbox boundary, or another durable delivery cursor.
- Whether token/cost cursor validation is independent or tied to model-effect receipt validation.
- How to store candidate verdict history if validators are re-run after code changes.

---

## Sources

- `AGENTS.md`
- `CONCEPTS.md`
- `docs/statefulness-plan.md`
- `docs/brainstorms/2026-06-14-durable-event-read-model-requirements.md`
- `docs/ideation/2026-06-14-checkpoint-hydration-ideation.html`
- `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md`
- `packages/engine/src/game-runner.types.ts`
- `packages/engine/src/game-runner.ts`
- `packages/engine/src/agent.ts`
- `packages/engine/src/token-tracker.ts`
- `packages/api/src/db/schema.ts`
- `packages/api/src/services/game-checkpoints.ts`
- `packages/api/src/services/game-durable-run.ts`
- `packages/api/src/services/ws-manager.ts`
