---
title: Render Safety Bounce on saved lobby images without changing game authority
date: 2026-09-23
category: design-patterns
module: web game viewer
problem_type: design_pattern
component: frontend
symptoms:
  - Safety Bounce replaced the generated lobby with a separate classification board
  - A current board alone could not show who made earlier picks
root_cause: presentation_state_did_not_retain_pointer_receipts
resolution_type: code_fix
severity: medium
tags: [safety-bounce, visual-mode, canonical-events, replay, head-anchors]
---

The presentation compiler now retains the accepted pointer list in each Safety Bounce snapshot. Each list is an immutable prefix: later classification and resolution cues cannot change an earlier cue's arrows or statuses. The generated image supplies geometry only.

Select a lobby through the current round's prior canonical dialogue, honoring its saved image binding and requiring the exact chain participant set. Keep the existing per-cue media freeze. Never pick the globally newest lobby, infer a chain from prose, or place a guest at an uncertain head coordinate.

Render the loaded image at its measured aspect ratio. Badges and directed arrows share that exact image rectangle, including letterboxing, rotation and narrow screens. Clear head anchors receive image overlays; uncertain guests remain in the numbered named strip. Green checks and amber warning triangles distinguish classifications without relying solely on color. Elimination remains in its separate result presentation.

An unavailable or failed image uses the existing picker. Canonical tally and tie cues can retain the room; ballot speech keeps its existing presentation clock. Browser fixtures verify image-relative coordinates, backward seeks, reconnects, reduced motion and failure fallback. See [Visual Mode](../../visual-mode.md#safety-bounce-on-the-lobby-image) for the interaction contract.
