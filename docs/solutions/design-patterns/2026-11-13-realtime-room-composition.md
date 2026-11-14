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
composition stages source images in bounded, horizontally staggered rows with
their original aspect ratios. Rear rows use smaller figures, a higher floor line
and spacing that recedes toward the room center, rather than placing one figure
directly behind another at nearly the same size. It transforms source head boxes
into composition coordinates, then supplies
that geometry to `VisualSceneView`. Background, bodies, speech and thinking share
its sampled camera. Coordinates never become contestant observations, accepted
scene records or gameplay authority. A missing reference anywhere in the full
game roster retains portraits, even when that player is outside the current room.
Accepted generated scene bindings remain authoritative.

Independent thoughts retain only allowed cast/artwork/room framing. They do not
carry omitted speech, future choices or private room members. Pack rooms continue
to contain only living wolves and use their frozen character art. They do not
substitute wolf transformation images.
Carry the audience-filtered held-item metadata into the composition as well as
the body/head geometry. Shared item badges stay beside their owner's visible
head through camera movement; Mystery must never gain an omniscient Hunter's
held Snipe. Item information comes only from the projected roster.

Cold loads must hold the director until both scenery and cutouts are known.
Deterministic exports use cached dimensions and canonical predecessor identities;
reconstruct the previous composition camera from its head geometry, not React
render history. Match the prior shot's readable-caption fallback as well as its
normal framing. Confirmed missing cutouts fail clearly; transient image errors
retry the same artwork rather than permanently replacing it.

The Influence viewer derives `previousSpeakerId` from adjacent canonical room
pictures, resetting at room/cast boundaries, and passes it through the frame
adapter. Export cues freeze that minimal identity as `previousRoomSpeakerId`
before editorial selection; isolated speech and thought cuts retain the camera
path without retaining omitted dialogue. Sample the first 450 ms, including cold
loads and paused seeks. A multi-cue proof must prepare two layout frames per cue,
matching production, rather than measuring only the first contribution.

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

- Final provider-free baseline: 3,583 passed, five skipped, zero failures. The
  PostgreSQL baseline passed 2,667 tests. Workspace typechecks/lint passed.
- 46 focused presentation regressions include eight-player staggering/depth,
  source image aspect ratios and paused/direct-seek camera behavior.
- Perspective proof: 128 viewer/export and 256 Studio Source/Selected cut
  comparisons passed, with three fresh encoded clips. Eight distinct characters,
  larger Influence casts, Werewolf, reduced motion and isolated thoughts were
  sampled in direct/reverse order at four geometries.
- Final brighter-outline proof: 54 viewer/export and 108 Studio comparisons,
  plus two fresh encoded clips, passed for speech and thinking. Both the speech
  pointer and thought-circle trail use the thicker, higher-contrast border.
- Commands, settings, frames, encoded clips, thresholds and bundle refresh
  instructions are indexed at `.renders/composed-room-depth/README.md` and
  `.renders/composed-room-outlines/README.md`. Original broader composition
  evidence remains in `.renders/composed-room-validation/README.md`.
- Historical reader conversion evidence is separate in
  `.renders/local-cutouts-2026-11-13/README.md`. No deployment was performed.
