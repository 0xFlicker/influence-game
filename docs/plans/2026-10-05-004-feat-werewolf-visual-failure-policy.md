---
title: "W7A — Shared visual failure policy and Werewolf recovery"
date: 2026-10-05
status: implemented
---

# W7A — Shared visual failure policy and Werewolf recovery

## Outcome

Visual Werewolf games offer the same **Best effort** and **Require visuals** choice as Influence. Best effort keeps the game moving with original character art. Require visuals pauses at a durable visual boundary, exposes the failed work in Production, and continues only after an explicit operator resume. Neither mode rewrites accepted gameplay.

The operator approved this direction. This plan does not run paid generation, change existing game policies or deploy code.

## Verified starting point

- `packages/api/src/services/visual-policy.ts` already owns the policy vocabulary, Influence suspension and explicit resume. Its pause guard depends on an Influence durable-turn snapshot; do not pass a fabricated Influence snapshot for Werewolf.
- `werewolf-visual-runtime.ts` uses canonical scene descriptors, owner/event-head guards and the shared renderer. Both scene and lone-wolf form failures currently fall back to original art. The renderer can return no accepted scene without throwing; that must also reach policy handling.
- `werewolf-runtime.ts` prepares conversations before a request and hunts after committing night resolution. Startup recovers a hunt when the last event is `werewolf.night_resolved`. Its general error handler releases the owner; visual suspension must remain distinct from execution failure.
- `visual-replay-production.ts` permits missing-scene rendering only for completed games. Its discovery list also filters to completed Influence games. A suspended Werewolf game therefore needs an explicit repair path before exposing Require visuals.
- W6 supplies reusable wolf forms, canonical night inventory, verified versions and explicit producer publication. Reuse these services and the existing producer controls.

## Decisions and boundaries

1. Keep one policy field and one set of labels: `visualFailurePolicy: best_effort | require_visuals`. Default Best effort for both games. Missing configuration reads as the existing default; do not rewrite historical games. Visual mode off never blocks on this policy.
2. Require the artifacts requested by the actual canonical preparation boundary: a usable verified scene for a scheduled scene, and usable wolf forms for the corresponding wolf preparation. Original portraits are the Best effort presentation. Verified retained panels count as usable scene imagery under the shared renderer’s acceptance rule; failure to produce an optional harmonized composite alone must not block a usable panel set. No new required images for individual introductions, Doctor/Seer cards, no-target hunts or solo pack meetings.
3. Reuse shared policy, diagnostics, worker and producer UI. Keep game-specific event-head/owner fencing and recovery inside each game’s runtime adapter. A third game should supply its boundary authority, not duplicate the policy UI or be made to imitate Influence’s cursor.
4. Pause state stores the exact failed boundary and required work identity, with a clear reason. It must be sufficient to retry after a process restart, including a failure before a scene row exists and standalone wolf-form preparation. Prefer existing durable scene/job identities; add only the missing persistence needed for recovery.
5. Pause atomically under the Werewolf owner and canonical-head guard, release/expire that owner, and prevent ordinary adoption while suspended. Stop, cancellation and owner loss propagate as such; they are never successful visual fallback or new suspension by a stale worker.
6. Changing policy does not resume. Publishing a repair does not resume. Explicit Resume re-enters the unchanged preparation boundary: it reuses matching published repair artifacts, verifies required availability, and then continues. If still unavailable under Require visuals, remain paused with actionable feedback. Switching to Best effort followed by Resume may proceed with original art.
7. Failed/unknown provider outcomes preserve their attempts, costs and reconciliation rules. Resume or repair must not clear uncertainty or create an unbounded paid retry loop.
8. A completed game is not retroactively paused. Repair of completed replay media remains supported independently. Game-ending night preparation must finish or pause before the completion path advances; test this boundary explicitly.

## Implementation slices

### A1 — contract and policy-aware preparation

Trace Werewolf creation/config serialization, worker adoption and visual guards. Persist the shared policy and classify both thrown failures and null renderer results. Add a typed Werewolf visual-block outcome containing real canonical boundary information. Preserve default Best effort behavior and diagnostics. Do not expose a nonfunctional creation option yet.

### A2 — durable pause, repair and explicit resume

Connect the typed block to owner-fenced suspension. Recover both pre-request preparation and post-commit hunts without repeating accepted decisions or night events. Make the failed boundary available in existing Production, including when preparation failed before a scene was recorded. Permit repairs for the exact visual-owned suspended boundary; do not broadly enable rendering against mutable live game state. Reuse version review/publication, frozen references and idempotent requests. Resume must consume the reviewed repair rather than automatically rerender the obsolete failed original version.

Reuse the existing control routes where their permissions and semantics fit; dispatch game-specific runtime authority explicitly. Separate producer repair/publication permission from permission to change game policy or resume execution. Show “Paused for visuals,” the failed work, existing diagnostics, repair/publication state and an explicit Resume control to authorized operators.

### A3 — creation and journey proof

Expose the shared choice in Werewolf Visual Mode after A2 works end to end. Retain ordinary replay access while the game is paused and make the pause distinguishable from a healthy live wait. Add Werewolf suspended work to common Production discovery (coordinate W7B). Refresh user/operator docs in the same change.

## Acceptance and tests

Use deterministic providers and isolated browser databases; ordinary API tests call `setupTestDB()`. No paid image generation is necessary for implementation proof.

- Both policies: missing source art, failed wolf derivative, null renderer result, scene verification failure, usable multi-panel scene with failed optional harmonization, successful scene reuse, and visual mode off.
- One/two wolves; first conversation and reused scene; lone form; doctor save; no attack; committed hunt; game-ending night.
- Atomic pause/reload/resume preserves exact accepted events and provider journal results. Simulate a crash before/after night commit, before/after pause persistence, and after repair publication.
- Stale owners cannot pause/publish/resume; stop/hide/cancel races remain correctly fenced. Policy changes during in-flight generation do not silently resume or advance a blocked game.
- A repaired immutable publication is used on resume. Incomplete repairs remain paused; repeated resume cannot duplicate gameplay or blindly repeat uncertain provider charges.
- Browser: create with policy → deterministic failure → visible pause → discover in Production → repair/review/publish → explicit resume → replay continuity. Include unauthorized control attempts and an Influence regression journey.
- Required proof: `bun run test`, `bun run test:postgres`, `bun run check`, focused browser journey, `git diff --check`. Report real provider/device/deployment proof separately.

## Scope exclusions

No new producer studio, game plugin framework, gameplay timing knobs, music failure policy, automatic resume, new flag, or bulk historical policy conversion. W7B owns card styling, naming and broader journey parity.

## Implementation and local proof — 2026-10-05

A1–A3 are implemented. Creation persists the shared policy; Werewolf owns its exact canonical pause boundary. Production supports a missing pending scene and a standalone verified wolf form, with explicit resume and reuse of published repairs. Common Production lists visual pauses. The live player reports the pause and receives the selected repair on resume. Migration `0112_werewolf_visual_recovery.sql` extends the existing queue for form-only work.

Validation used deterministic providers and isolated databases, with no paid calls:

- `bun run test`: 2,291 passed, 5 skipped, no failures.
- `bun run test:postgres`: 1,887 passed, no failures.
- Final focused policy/renderer checks: 27 passed; cancellation/runtime checks: 16 passed; Production UI checks: 7 passed. These cover the final fixes made after the broad baselines.
- Browser: 3 passed across existing Influence Production and the new Werewolf create → pause → discover → repair → publish → explicit resume journey; mobile layout and an already-open public player included.
- `bun run check` and `git diff --check` passed.

The first browser attempts exposed harness setup issues (audience selection and background-tab polling), corrected before the final pass. A prematurely parallel shared-DB focused run timed out waiting for the baseline's advisory lock; the sequential rerun passed. No development-game mutation, real provider evaluation, deployment or historical policy conversion was performed. Apply migration 0111 with the API rollout.

Integration knowledge: [Werewolf visual recovery at canonical boundaries](../solutions/architecture-patterns/werewolf-visual-recovery-at-canonical-boundaries.md). W7B remains separate: card styling, naming and the broader House journey audit.
