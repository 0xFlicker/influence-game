---
module: Shared presentation
problem_type: performance_issue
tags: [avatar, next-image, remotion, readiness, safety-bounce, react]
---

# Repeated avatar loads can feed Safety Bounce's measurement loop

Safety Bounce observes character image load events to update head geometry.
`AgentAvatar` passed a new inline error callback to Next Image on each render.
Installed Next 16.1.7 includes that callback in its image-ref dependencies and
reassigns `img.src` when attaching the ref. A parent load observer therefore
formed a feedback loop: load → state update → new error callback → ref attachment
and source reassignment → another load.

This was confirmed independently of Remotion with the real components in a local
browser. The original callback reached the fixture's cap of 100 image loads and
100 parent renders. A callback stable for the current requested source produced
one load and two renders. In an instrumented full-input preparation, a runaway
Safety Bounce frame produced more than a million repeated component records
after its readiness barrier had already released. The diagnostic process was
stopped and its logs retained.

An initial candidate memoized `AgentAvatar`'s error callback. Although its initial
movie comparisons passed, broader Studio ballot proof exposed a tiny rounded-edge
pixel difference between still and sequential captures. Split controls initially
implicated the callback change. That candidate was removed; the shared avatar
component retains its original behavior. A later direct comparison without loaders
reproduced the same two seven-pixel rounded-edge variants in the unchanged
reference checkout. The split controls were not sufficient causal attribution;
this small capture variation also predates the changes. The verifier's measured
noise budget and negative controls are documented in the render-speed plan.

The selected fix lives in `SafetyChain`'s media observer. It remembers each image's
last source, intrinsic dimensions and load/error event type in a WeakMap. An
identical repeated notification does not increment the measurement revision.
Changed sources, dimensions and event types still request measurement, and the
existing resize/actor/position dependencies remain intact. No decode barrier,
picture, timing, fallback or animation is removed.

The mounted-component regression measures actual React commits: duplicate loads
must not cause new commits, while new image sources and dimensions must. It fails
against the old observer (six commits instead of four) and passes with the guard.

Three full-input experimental preparations with the stable callback completed.
The final traced trial recorded 135 Safety Bounce renders and 37 face updates,
versus thousands in successful original runs and runaway counts in the failed
run. These are diagnostic counts, not a fleet performance prediction.

Four renders from the earlier callback candidate (one/four/one/four tabs, 300 frames each)
matched the prior reference in actual captured JPEG pixels, decoded movie pixels
and decoded audio. The focused avatar suite passed 16 tests / 53 assertions;
web typecheck and lint passed. Broader repository and presentation-parity checks
remained required and subsequently exposed the broader ballot regression above.

The replacement observer guard completed three full-input preparations. Two
independent prepared candidates also matched all 6,770 opening/gameplay/Safety
Bounce movie frames, timestamps and decoded audio against the retained reference.
Only the previously investigated empty-text layout key varied. The guard's
focused tests pass; final actual-code parity and clean benchmarks remain tracked
in the plan.

This diagnoses a real reload loop, but does not prove it explains every earlier
timeout or pixel difference. In particular the original measurement-frame-942
timeout occurred at a different cue. Continue the qualification described in
[the render-speed plan](../../plans/2026-11-02-render-speed-100x.md).

Private artifacts remain under `.renders/readiness-trace-2026-11-03/`,
`.renders/avatar-feedback-proof-2026-11-03/` and
`.renders/avatar-fixed-render-2026-11-03/`. Subsequent qualification supports
[eager export readiness and screenshot-free preparation](2026-11-03-hidden-lazy-image-export-readiness.md).
No movie-frame reuse, timing reduction or quality reduction is part of these
changes. Existing movies remain unchanged.
