---
date: 2026-06-14
topic: phase-boundary-runtime-snapshot
---

# Phase-Boundary Runtime Snapshot Requirements

## Summary

Influence checkpoints should gain a Phase-Boundary Runtime Snapshot v1 that can produce a positive `hydration_candidate` verdict for a real durable checkpoint when all v1 validators pass. The snapshot must prove checkpoint hydration readiness without implementing resumed execution.

---

## Problem Frame

The checkpoint hydration passport can already describe why current checkpoint capsules are forensic-only or blocked. The next risk is that the checkpoint can only become greener by hand-editing manifest statuses, while the durable payload remains too thin to deserve a positive verdict.

Runtime Snapshot v1 should make hydration validation real. It should attach minimal but meaningful runtime evidence to a sealed phase boundary: actor position, accumulator closure, continuity capsules, token usage, transcript boundary progress, and owner/event proof. That lets the system test checkpoint hydration before it attempts `GameRunner.fromCheckpoint()`.

---

## Key Decisions

- **Positive candidate bar.** A real checkpoint written through the durable API path should be able to reach `hydration_candidate` when all v1 validators pass.
- **Validation is not resume.** A positive passport means the checkpoint is safe to hydrate in a future resume harness, not that production resume exists.
- **Minimal honest runtime evidence.** Actor and accumulator evidence may be compact, but present evidence must be semantically checked rather than trusted by shape alone.
- **Transcript watermark over transcript storage project.** V1 needs a durable transcript boundary marker, not full mid-game transcript persistence.
- **Passport verdict is the truth source.** No separate `hydrateable` boolean should compete with the derived passport verdict; development-only carry-forward fields may be removed when low-cost.
- **Postgres remains runtime truth.** S3-compatible storage is not a prerequisite for hydration candidacy and remains reserved for bulky private/debug evidence.

---

## Actors

- A1. **Operator or maintainer** inspects durable-run state and needs to know whether a checkpoint passed hydration validation.
- A2. **Checkpoint writer** records boundary evidence after durable canonical event flush.
- A3. **Passport validator** derives stamp results and the final checkpoint verdict.
- A4. **Durable read model** exposes passport-first checkpoint readiness without exposing resume controls.
- A5. **Future resume harness** consumes candidate checkpoints after this work but is not built in this slice.

---

## Captured Data Inventory

| Snapshot artifact | Data captured | Validation obligation |
|---|---|---|
| Boundary identity | Owner epoch, event boundary sequence, event head hash, projection hash, checkpoint kind, phase, and round. | Every Runtime Snapshot v1 artifact must bind to the same boundary identity or the checkpoint fails validation. |
| Boundary receipt | API-sealed owner/event receipt plus quiet-barrier evidence for durable event flush completion and drained or absent pre-boundary work. | Receipt, projection, and quiet-barrier evidence must agree with the checkpoint row and cannot be a bare writer assertion. |
| Actor witness | Phase-machine coordinate at the boundary, machine/version metadata, and enough actor snapshot data to form a typed future-hydration input. | Actor evidence must match projection phase, round, and boundary sequence. |
| Accumulator registry | Registry version, phase-boundary class, every required accumulator id, each status, and each status proof or captured payload. | Unknown versions, omitted required ids, malformed entries, or unproven `not_v1_hydratable` statuses block candidacy. |
| Token cursor | Versioned cumulative model usage through the boundary. | Cursor shape must validate and belong to the same boundary. |
| Transcript watermark | Content-free durable boundary metadata such as sequence, digest, offset, or outbox marker. | Watermark must prove transcript boundary progress without carrying transcript text, prompts, responses, reasoning, or private storage references. |
| Continuity capsules | Declared expected player set, structured per-player capsules or explicit non-required reasons, and one House continuity capsule. | Missing expected capsules, malformed capsules, raw private evidence as substitute, or privacy violations block candidacy. |
| Passport diagnostics | Sanitized verdict, stamp names, statuses, and redacted blocking reasons. | Admin/read-model responses and normal logs must not expose raw continuity, accumulator payloads, prompts, responses, hidden reasoning, private storage references, or full cursor payloads. |

---

## Requirements

**Verdict and Source of Truth**

- R1. Runtime Snapshot v1 must allow a real phase-boundary checkpoint to receive `hydration_candidate` when every required v1 validator passes.
- R2. Runtime Snapshot v1 must keep `hydration_candidate` separate from any claim that live-game resume is implemented.
- R3. The passport verdict must be derived from validators rather than copied from a writer-provided readiness flag.
- R4. The system must remove or demote any development-only `hydrateable` boolean that would create a second readiness truth source.
- R5. A checkpoint with present but inconsistent evidence must fail the relevant passport stamp and must not receive `hydration_candidate`.
- R6. A candidate checkpoint must be sufficient to construct a typed future-hydration input from persisted snapshot evidence, while execution of that input remains out of scope.

**Boundary Receipt**

- R7. Every Runtime Snapshot v1 evidence artifact must bind to the same boundary identity: owner epoch, event boundary sequence, event head hash, projection hash, checkpoint kind, phase, and round.
- R8. The checkpoint must carry an API-sealed boundary receipt that proves owner epoch, event boundary sequence, event head hash, projection hash, and verifiable quiet-barrier evidence agree.
- R9. Quiet-barrier evidence must cover durable event flush completion and the absence or drainage of pre-boundary model calls, retries, phase collections, and accepted effects.
- R10. Boundary receipt validation must fail when the receipt sequence, owner epoch, event head, projection evidence, quiet-barrier evidence, or no-pending boundary assertion mismatches the checkpoint row.
- R11. A failed later checkpoint must not invalidate an earlier checkpoint that passed its own boundary receipt validation.

**Actor and Accumulator Evidence**

- R12. The checkpoint must include a boundary actor witness that records the phase-machine position, machine/version metadata, and actor snapshot data needed for the typed future-hydration input.
- R13. Actor witness validation must cross-check the actor coordinate against projection facts such as phase, round, and boundary sequence.
- R14. The checkpoint must include a closed, versioned accumulator registry for each phase-boundary class.
- R15. The accumulator registry must name every v1-judged runner accumulator required for that phase-boundary class.
- R16. Unknown registry versions, missing required entries, and omitted v1 accumulator ids must block `hydration_candidate`.
- R17. Each accumulator registry entry must be judged as captured, empty or drained, blocked, malformed, or not v1 hydratable.
- R18. `empty`, `drained`, and `not_v1_hydratable` statuses must carry proof, not just labels.
- R19. `not_v1_hydratable` may pass only when the accumulator is proven irrelevant or empty at that phase boundary.
- R20. Captured accumulator payloads must be used only where needed for boundary validation; v1 must not require full runner reconstruction data.

**Cursors and Continuity**

- R21. The checkpoint must include a token cursor derived from cumulative model usage through the boundary.
- R22. The checkpoint must include a durable transcript boundary watermark tied to the checkpoint boundary.
- R23. The transcript boundary watermark must be content-free metadata and must not contain transcript text, raw prompts, raw responses, hidden reasoning, `thinking`, `reasoningContext`, or private storage references.
- R24. Transcript entry counts may remain diagnostic evidence but must not satisfy the transcript cursor stamp by themselves.
- R25. Player continuity capsules must remain required evidence for the declared expected player set at the boundary.
- R26. Any player omitted from the expected continuity set must have an explicit non-required reason in checkpoint evidence.
- R27. Player continuity capsules must contain structured strategy and memory facts sufficient for future hydration to preserve commitments, pending intentions, and role-relevant memory.
- R28. House continuity must remain required evidence for game-level producer continuity.
- R29. House continuity must contain structured producer state sufficient for future hydration to preserve House-level context.
- R30. Raw prompts, raw responses, hidden reasoning, and private storage references must not count as continuity state by themselves.

**Passport and Read Model**

- R31. Runtime Snapshot v1 must persist only structured minimal hydration evidence in the checkpoint payload and validator inputs.
- R32. Runtime Snapshot v1 must not persist raw prompts, raw responses, hidden reasoning, `thinking`, `reasoningContext`, or private object-storage references in checkpoint payloads or validator inputs.
- R33. Bulky private/debug evidence outside the checkpoint payload must remain optional, access-controlled, and non-authoritative for `hydration_candidate`.
- R34. The passport must derive manifest component statuses from persisted evidence rather than preserving stale engine-side missing claims.
- R35. The durable read model must present checkpoint readiness as a passport-first summary: verdict, stamp statuses, and blocking reasons.
- R36. The durable read model must explicitly state that resume is not implemented for candidate checkpoints.
- R37. The durable read model must not expose a separate readiness boolean that can diverge from the passport verdict.
- R38. Passport diagnostics must distinguish missing evidence, malformed evidence, semantic mismatch, and intentionally deferred resume work.
- R39. Passport diagnostics, durable-run read-model responses, and normal logs must expose only sanitized status codes, stamp names, and redacted blocking reasons.
- R40. Passport diagnostics, durable-run read-model responses, and normal logs must not expose raw continuity capsules, captured accumulator payloads, raw prompts, raw responses, hidden reasoning, private storage references, or full token/transcript cursor payloads.
- R41. Runtime Snapshot and passport details must be authenticated and authorized for operator or maintainer roles only.
- R42. Runtime Snapshot and passport details must not be exposed through public player or public game read endpoints.

**Validation Proof**

- R43. Automated passport tests must cover a positive fixture where all Runtime Snapshot v1 stamps pass.
- R44. Automated passport tests must cover corrupt or semantically mismatched actor, accumulator, boundary, cursor, and continuity evidence.
- R45. A live DB checkpoint proof must show a checkpoint written through the durable API checkpoint path returning `hydration_candidate` through durable-run inspection.
- R46. The live DB proof must verify the admin/read-model surface, not just a standalone validator fixture.
- R47. Validation must not require S3-compatible object storage or raw private evidence blobs.

---

## Key Flows

- F1. Candidate checkpoint validation
  - **Trigger:** A durable API checkpoint is written at a phase boundary with all Runtime Snapshot v1 evidence present.
  - **Actors:** A2, A3, A4
  - **Steps:** The checkpoint writer records boundary evidence, the passport validator derives each stamp, and the durable read model returns the passport summary.
  - **Outcome:** The checkpoint returns `hydration_candidate` while still exposing no resume action.
  - **Covered by:** R1-R42, R45-R47

- F2. Thin evidence rejection
  - **Trigger:** A checkpoint contains nominal actor or accumulator fields that do not match projection or boundary evidence.
  - **Actors:** A1, A3, A4
  - **Steps:** The validator checks semantic parity instead of accepting presence alone.
  - **Outcome:** The relevant stamp fails and the read model reports the blocking reason.
  - **Covered by:** R5, R7-R20, R38-R40, R44

- F3. Transcript watermark validation
  - **Trigger:** A checkpoint includes transcript evidence.
  - **Actors:** A2, A3, A4
  - **Steps:** The validator distinguishes a durable boundary watermark from in-memory transcript entry counts.
  - **Outcome:** A durable watermark may pass; entry count alone remains blocked or failed.
  - **Covered by:** R21-R24, R38-R40, R44

- F4. Readiness without resume
  - **Trigger:** An operator inspects a candidate checkpoint.
  - **Actors:** A1, A4
  - **Steps:** The durable read model shows the passport verdict, stamp results, and resume-not-implemented state.
  - **Outcome:** The operator can trust hydration validation without mistaking it for production resume.
  - **Covered by:** R2, R35-R42, R45-R46

---

## Acceptance Examples

- AE1. Covers R1-R6, R35-R42.
  - **Given:** a phase-boundary checkpoint has every required v1 stamp passing.
  - **When:** durable-run inspection reads the checkpoint.
  - **Then:** the passport verdict is `hydration_candidate`, and the response does not expose a competing readiness boolean or resume action.

- AE2. Covers R12-R20, R44.
  - **Given:** an actor witness exists but disagrees with projection phase or boundary sequence.
  - **When:** actor witness validation runs.
  - **Then:** the actor stamp fails and the checkpoint is not a candidate.

- AE3. Covers R14-R20, R44.
  - **Given:** an accumulator entry is marked `not_v1_hydratable` without proof that it is irrelevant or empty at the boundary.
  - **When:** accumulator validation runs.
  - **Then:** the accumulator stamp fails and the checkpoint is not a candidate.

- AE4. Covers R21-R24, R44.
  - **Given:** a checkpoint includes a token cursor and only an in-memory transcript entry count.
  - **When:** cursor validation runs.
  - **Then:** token validation may pass, but transcript validation fails or blocks until a durable boundary watermark is present.

- AE5. Covers R25-R30, R38-R40, R44.
  - **Given:** raw private evidence exists but structured player or House continuity is missing.
  - **When:** continuity validation runs.
  - **Then:** the checkpoint is blocked because raw evidence alone is not continuity state.

- AE6. Covers R7-R11, R44.
  - **Given:** an actor witness or cursor is bound to a different boundary identity than the checkpoint receipt.
  - **When:** passport validation runs.
  - **Then:** the boundary stamp fails and the checkpoint is not a candidate.

- AE7. Covers R45-R47.
  - **Given:** a checkpoint is written through the durable API checkpoint path with all v1 evidence present.
  - **When:** the admin durable-run read model inspects that checkpoint from the database.
  - **Then:** the read model reports `hydration_candidate` without requiring S3 or production resume.

---

## Success Criteria

- A real durable checkpoint can reach `hydration_candidate` through the normal durable API checkpoint and read-model path.
- Positive validation depends on semantic stamp checks, not field presence alone.
- Current or malformed checkpoints continue to fail closed with actionable blocking reasons.
- Operators see passport verdicts and stamp statuses without seeing resume controls.
- Runtime Snapshot v1 remains DB-local for hydration-critical state.
- The captured-data inventory lets a planner identify every DB-local artifact required for candidacy without inferring required facts from prose.
- Tests cover both fixture-level validator behavior and at least one live DB checkpoint proof.

---

## Scope Boundaries

In scope:

- API-sealed boundary receipt evidence for checkpoint validation.
- Shared boundary identity binding across every Runtime Snapshot v1 artifact.
- Actor witness evidence and actor/projection parity validation.
- A closed, versioned accumulator registry with captured, empty/drained, blocked, malformed, and constrained `not_v1_hydratable` statuses.
- Token cursor wiring and transcript boundary watermark validation.
- Required player and House continuity validation for the declared expected player set and House producer state.
- Passport-first durable-run inspection with sanitized diagnostics.
- Operator or maintainer-only access to Runtime Snapshot and passport details.
- Removal or demotion of development-only readiness booleans when they compete with the passport.
- Focused validator tests and one live DB checkpoint proof.

Out of scope:

- Production resume, `GameRunner.fromCheckpoint()`, owner reclaim, and live-game restart controls.
- S3-compatible storage as a prerequisite for hydration candidacy.
- Full mid-game transcript persistence.
- Mid-phase recovery or arbitrary in-flight model/effect recovery.
- Full runner reconstruction or uninterrupted-run versus resumed-run comparison.
- Raw prompt, response, `thinking`, or `reasoningContext` storage as canonical hydration state.

---

## Dependencies and Assumptions

- The durable event log and projection replay remain the source of accepted board truth.
- The durable API checkpoint path remains the proof path for live DB validation.
- The passport validator remains the source of checkpoint readiness truth.
- Structured continuity capsules remain private runtime evidence and are not public transcript or canonical board state.
- This requirements document fixes the captured facts and pass/fail obligations; planning will decide the exact persisted encoding of actor witness, accumulator registry, and transcript boundary watermark.
- Existing intra-development database fields may be removed when no external carry-forward requirement exists.

---

## Outstanding Questions

Resolve before planning:

- None.

Deferred to planning:

- Exact actor witness serialization for the required boundary facts.
- Exact phase-specific accumulator inventory and encoding, constrained by the closed registry and proof requirements above.
- Exact content-free transcript boundary watermark encoding.
- Whether removing the existing readiness boolean is lower risk than demoting it to an ignored/deprecated field.

---

## Sources and Research

- `docs/statefulness-plan.md` — statefulness posture, candidate-not-resume boundary, and phase-boundary checkpoint material.
- `docs/brainstorms/2026-06-14-checkpoint-hydration-passport-requirements.md` — prior passport requirements and required stamps.
- `docs/plans/2026-06-14-002-feat-checkpoint-hydration-passport-plan.md` — prior implementation plan and explicit resume exclusions.
- `docs/ideation/2026-06-14-phase-boundary-runtime-snapshot-ideation.html` — ranked ideation source for this requirements slice.
- `CONCEPTS.md` — checkpoint capsule, hydration passport, boundary certificate, snapshot manifest, continuity capsule, and owner epoch vocabulary.
- `packages/engine/src/game-runner.ts` — current checkpoint manifest, continuity capsule collection, transcript cursor, and token cursor behavior.
- `packages/engine/src/game-runner.types.ts` — checkpoint capsule, manifest, boundary certificate, and cursor type surfaces.
- `packages/engine/src/token-tracker.ts` — existing serializable token cursor.
- `packages/api/src/services/game-checkpoints.ts` — checkpoint persistence, API boundary sealing, and snapshot payload packing.
- `packages/api/src/services/checkpoint-hydration-passport.ts` — current stamp validation and `hydration_candidate` derivation.
- `packages/api/src/db/schema.ts` — `game_checkpoints` storage surface.
