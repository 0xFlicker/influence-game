---
module: Shared room presentation
problem_type: design_pattern
tags: [full-body, transparent-art, visual-mode, studio, remotion, presentation-parity]
---

# Compose existing character art through the Visual Mode renderer

Portrait-room conversation consumers already share audience-safe room membership,
static open-floor background plates and frozen character references. When every
player in the game has a full-body reference, pass those references and their
saved head rectangles through the room beat instead of introducing a new accepted
scene, generating imagery or consulting today's Agent Profile. Treat full-body
references as transparent following the completed artwork migration.

`PortraitRoom` chooses `ComposedRoom` for the viewer, Studio and exporter. The
composition stages source images in bounded rows with their original aspect
ratios, transforms source head boxes into composition coordinates, then supplies
that geometry to `VisualSceneView`. Background, bodies, speech and thinking share
its sampled camera. Coordinates never become contestant observations, accepted
scene records or gameplay authority. A missing reference anywhere in the full
game roster retains portraits, even when that player is outside the current room.
Accepted generated scene bindings remain authoritative.

Independent thoughts retain only allowed cast/artwork/room framing. They do not
carry omitted speech, future choices or private room members. Pack rooms continue
to contain only living wolves and use their frozen character art. They do not
substitute wolf transformation images.

Cold loads must hold the director until both scenery and cutouts are known.
Deterministic exports use cached dimensions and canonical predecessor identities;
reconstruct the previous composition camera from its head geometry, not React
render history. Match the prior shot's readable-caption fallback as well as its
normal framing. Confirmed missing cutouts fail clearly; transient image errors
retry the same artwork rather than permanently replacing it.

Short, narrow thinking shots need a smaller head beside the thought panel. Stacked
head/text framing can leave less than one readable line. Measure wrapping speaker
labels as part of the thought/speech typography budget. Preserve long-copy pages
on the shared reading clock; do not scroll or clip them.

The reusable proof command and export refresh instructions are in
[the presentation checklist](../../presentation-parity.md#realtime-full-body-room-composition).
The proof selects the final measured text layout after cold image loading: an
earlier transient layout can have a different page count. Retain actual page
coverage, direct/reverse samples, Studio Source/Selected cut comparisons and
fresh encoded clips rather than treating matching component imports as evidence.


## Local verification

- 149 focused regressions passed; the local PostgreSQL baseline passed all 2,665
  tests. `bun run check` passed all workspace typechecks and lint.
- 214 viewer/export frames and 428 actual Studio Source/Selected cut frames
  matched exactly, including reverse/direct sampling at four geometries. Four
  fresh H.264 clips passed the unchanged 4/255 decoded-frame tolerance; recorded
  audio passed its correlation/offset bounds.
- Evidence, exact commands/settings, page coverage, manifests, frames, movies and
  check logs are indexed at `.renders/composed-room-validation/README.md`.
- The full provider-free baseline remains blocked by the Solana dependency's
  missing `bytesEqual` export (3,352 passed; 36 failures including 34 import
  errors). Do not describe that baseline as passing. No deployment was performed.
