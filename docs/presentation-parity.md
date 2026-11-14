# Changing presentation without breaking Studio or video exports

**Viewer, Studio and exported video parity is a completion requirement.** This
applies to bug fixes and cosmetic changes as well as new beats. Until the paths
are unified, every author and reviewer must check the adapters between them.
An unverified surface is an outstanding requirement, not presumed coverage.

Realtime composed-room casts use staggered floor rows with perspective scaling:
rear figures are smaller and higher on the floor, with spacing receding toward
the room center. The shared composition coordinates drive the viewer, Studio and
fresh exports. Rebuild prepared bundles and re-encode existing movies to adopt
this placement; accepted history and pinned character identities stay unchanged.
Speech and thinking boxes use a two-pixel, higher-contrast outline, including
speech pointers and the thought-circle trail. Keep these treatments consistent
in the shared scene, solo, portrait and reduced-cast renderers.

## Define the comparison

Compare the same accepted source/pinned media, audience, moment, elapsed time,
output dimensions, motion/reading settings, thinking selection and audio choices.
Studio monitor scaling is separate from movie geometry. Compare content bounds,
not the surrounding page controls. Fullscreen controls, editing tools and
intentional omissions in a selected cut need not appear in the video.

Within those bounds, preserve cast identity/order, room/board context, framing,
entrances/exits, reveal order, caption content/pagination, readable duration, voice
placement, music continuity and the final held frame. Document any additional
intentional difference and obtain explicit user agreement before implementing it.
Do not use parity work to change accepted gameplay or contestant visibility.

## Trace the consumers before editing

| Boundary | Owning code to inspect | Common missed integration |
| --- | --- | --- |
| Audience-safe accepted source | `packages/api/src/services/influence-production-source.ts`, `werewolf-production-source.ts`; game-owned projections | New metadata exists on viewer HTTP/WebSocket rows but not frozen production rows |
| Catalog and ordering | `packages/engine/src/production-moments/`, game-owned presentation contracts | New beat has no selectable identity, uses wrong source order, or duplicates speech |
| Viewer composition | `dramatic-replay-viewer.tsx`, `visual-watch-model.ts`, `visual-presentation.tsx`; Werewolf watch model/stage | A wrapper supplies layout/props absent from the export call site |
| Export binding and independent moments | `packages/web/src/lib/replay-export/cues.ts`, `production-presentation.ts`, `presentation.ts`, `room-continuity.ts` | Splitting a thought from speech loses the board, cast, room or prior-speaker context |
| Clock, recordings and score | `replay-export/timing.ts`, `audio.ts`, `generated-audio.ts`, shared watch timing | New duration/reveal or House caption uses a different recording clock |
| Offline preparation | `replay-export/assets.ts`, `manifest.ts`, `render.ts`, `src/scripts/export-house-replay.ts` | New image fields are not frozen, or stale measured pages survive |
| Studio and final rendering | Studio workspace/Player, `src/remotion/house-replay/frame.tsx`, relevant worker composition | Shared renderer called with old defaults; Source works but Selected cut/export fails |

Web paths above are under `packages/web/src/` unless stated otherwise. Follow
actual call sites; this table is a starting point, not an exhaustive registry.
House Cuts/trailer renderers are separate consumers when the feature affects
them: record whether they are in scope instead of assuming replay parity covers
every video product.

Prefer a shared layout, renderer and sampled clock. Verify every caller supplies
the required contract. Do not copy the viewer wrapper into a separate exporter
implementation or add an abstraction without completing its consumers.

Influence's post-pick Mingle and huddle shots show the selected format in the
player picture. The selected format comes from the canonical presentation prefix
at that moment, including when a Studio cut selects only a speech or a thought.
The viewer's format button opens the same concise rules and pauses playback;
the interactive panel is player chrome, while the persistent label and the
longer automatic rules reveal are also rendered into fresh exports. Existing
MP4s must be rendered again, and old export bundles must be rebuilt from the
selection and frozen source to pick up the new framing and timing.
In theater and fullscreen, playback controls fade after three seconds of
inactivity even when paused. Mouse movement, a first tap or keyboard focus
brings them back; that first tap does not advance the picture. Controls remain
visible while hovered or keyboard-focused. This player chrome is not encoded.
Crowded Influence Mingle and huddle rooms keep the speaker in view while the
other attendees appear in timed, shared-clock pages. Their speech and thinking
holds allow time for every cast page; long room names and captions use measured
pagination, and recorded voice retains its original audio duration. Werewolf uses its own room
presentation and is not routed through this Influence-specific treatment.

Influence winner scenes page the other finalists, jury and cast members in pairs on the
sampled presentation clock. The winner cue reserves five seconds per page;
the final page remains held at the end. Rebuild existing bundles from their
frozen selection and source to pick up the revised timing and layout, then
render existing movies again. Do not alter the selected source or media pins.

For a new beat, explicitly decide its catalog identity, source position, duration,
speech/thought ownership, recording identity, selection/default inclusion, allowed
framing context and ending/handoff. Use structured canonical coordinates and
metadata; never infer these from prose. Preserve immutable source and media pins.

## Required regression matrix

### No scrolling inside the player — mandatory

Scrollable containers are banned in the live/replay player, Studio preview and
rendered video. This is a viewer requirement as well as an export requirement.
Do not add horizontal or vertical `overflow: auto`/`scroll` (including Tailwind
variants), hide the scrollbar while retaining scrolling, move overflow into an
outer scene, or scroll programmatically to reveal content.

Fit and reflow cast, labels and names within the picture. Paginate long speech,
thoughts and House copy using the shared presentation clock and enough reading
time. Clipping required content, shrinking it to unreadable text, or asking the
viewer to page manually or to use a separate required paging UI are not acceptable
substitutes. Normal keyboard/click advancement follows the shared director's
measured page schedule: a gesture advances one page before the existing exit
and cue transition. Automatic clock-driven pagination remains complete without
interaction. Cropping decorative
scenery is different from hiding required cast/text content. Studio's editorial
lists, inspectors and timeline outside the rendered picture may scroll.

Narrow solo ballots reserve enough speech-bubble height for the role label,
pagination and a complete readable line while keeping the portrait and vote
ledger in their own space. The same solo layout and typography measurement are
used by the viewer, Studio and freshly prepared exports.

Regression coverage must inspect the actual player/stage at narrow, short and
fullscreen geometries with large casts and long names/copy. Reject scrollable
content containers and assert that required content fits or appears across timed
pages. Checking only that a scrollbar is visually hidden is insufficient.

Test the relevant rows below for each changed treatment. Mark a row not applicable
with a concrete reason; don't silently omit it. Both Studio Source and Selected
cut must use the verified path, including the cut a user actually exports.

| Dimension | Cases to cover |
| --- | --- |
| Sequence and selection | Full sequence, entry mid-sequence, beat alone, neighbor omitted; thinking-only/speech-only/result-only when applicable |
| Timeline | Entrance, readable page, reveal/transition, exit/held ending; next beat handoff; direct seek and reverse/random order |
| Context | Correct cast/board at this point, historical missing art, frozen full body/headshot/scene, no omitted response or future decision in an isolated thought |
| Geometry | Intended output size and short/narrow/fullscreen sizes; large cast and long names/copy; no scrollable player containers; all required content fits or appears on clock-driven pages |
| Audio | With/without an existing recording; complete voice duration, single House caption, page progress, music/effects timing and no duplicated audio |
| Settings/audience | Thinking on/off, affected reduced-motion and timing settings, Mystery/Omniscient or other applicable access scopes |
| Persistence | Fresh preparation, offline bundle rendering, explicit frozen-version behavior and missing-asset errors; same selected IDs/media pins |

Tests must fail when the actual integration is missing. Rendering a component
with hand-supplied correct props does not test whether `ReplayFrame` supplies
them. Catalog equality does not prove layout; a browser screenshot does not prove
encoded video; one sequential playback does not prove random-access sampling.
Use integration/render coverage in addition to focused contract tests.

## Fresh render proof

For every visible/timing/audio change, retain a bounded proof of the changed
moments, using deterministic fixtures or already authorized saved games/media.
Do not make paid calls, generate replacement historical media, or write to
staging/production merely to obtain a parity check.

1. Prepare current cues, assets and measured layouts from the selected source.
2. Capture the viewer and Studio/export content at matched settings and sample
   coordinates. Exercise the real changed adapters, including Player behavior
   when the change involves Studio transport, seeks or buffering.
3. Compare entrance/read/reveal/exit and adjacent handoffs as applicable. Include
   a direct seek and reverse/random sampling to detect history-dependent rendering.
4. Encode a fresh short clip from that prepared composition, decode representative
   frames and compare them to the reference. For audio changes, also verify the
   actual encoded audio placement/duration; frame similarity is not audio proof.
5. Inspect the images and retain paths, source/selection identity, settings,
   sampled frames, measured differences/tolerances, assertions and command results.
   Use a justified compression tolerance for decoded video, not a visual guess.

The current opt-in fixture proof compares actual viewer components with the shared
Studio/export composition, including a layout prepass and H.264 verification:

```sh
cd packages/web
bun run src/scripts/verify-presentation-parity.ts \
  ../../.renders/presentation-parity-<change>
```

**Extend its fixtures for the changed beat.** Its existing Safety Bounce/Werewolf
cases do not prove a new alliance introduction or another unrelated treatment.
It is not an end-to-end test of Studio's editing UI. For an actual Studio
selection-to-MP4 check, see `packages/api/src/e2e/studio-export-parity.ts` and its
browser harness consumers. For reverse/random/fresh-browser verification of a
prepared bundle, use `packages/web/src/scripts/verify-house-replay-export.ts` as
documented in [local export](local-replay-export.md#local-verification).

Run the required repository baselines (`bun run test`, `bun run test:postgres`,
`bun run check`) and affected browser/render checks. Report failures and proof
limits accurately. Do not substitute source inspection or existing green tests
for the new feature's rendered proof.

## Review and handoff gate

Include this information in the PR or handoff before declaring completion:

- Affected viewer, Studio Source, Studio Selected cut and export/worker consumers,
  with the shared implementation or each necessary adapter change identified.
- Regression cases, fresh rendered/encoded evidence, tested source/settings and
  explicit untested cases or agreed intentional differences.
- Test results, including any interrupted or failing baselines. Local evidence is
  not evidence of staging/production deployment.
- Refresh instructions: whether the existing selection JSON can be reused,
  whether the bundle must be rebuilt, and whether a frozen source must be refreshed.

**Missing consumer or missing proof means presentation parity is incomplete.**
Do not defer exporter support to another PR or describe a viewer-only result as
complete unless the user explicitly changes the scope.

An existing selection JSON can usually rebuild the same cut using current local
code; an old bundle can retain stale layouts or omit newly required framing.
An MP4 must be rendered again. Never silently unpin media or regenerate accepted
history. See [refreshing an existing export](local-replay-export.md#refresh-an-existing-export-after-presentation-updates).

## Hunter item proof

Run `HUNTER_PARITY=1 FORMAT_CONTEXT_STUDIO=1 bun run src/scripts/verify-presentation-parity.ts ../../.renders/hunter-parity` from `packages/web`.
The canonical eight-player v12 fixtures cover held and fired private explanations,
independent action selections, snipe-only and two-victim dawns, both audiences,
long frozen names, measured caption pages, reduced motion and recorded/unrecorded
speech. The sequence case includes speech → action → dawn handoffs. The proof
uses the production catalog and binding adapter, the viewer stage, actual Studio
Source/Selected cut Player, and fresh H.264 exports, with reverse-order sampling
and geometry assertions at 1280×720, 640×360, 360×240 and 390×700.

The Hunter room is included by the existing static-art snapshot writer. Reuse the
same selection IDs and pinned source/media to prepare a fresh bundle; render a
new MP4. Reopen/reprepare Studio previews to pick up the new room and corrected
binding. Do not regenerate historical dialogue or alter accepted item decisions.

For generated Werewolf House narration, run the Hunter matrix with saved narration
in the projected source (both audiences, isolated cuts and the full sequence):

```sh
cd packages/web
HUNTER_PARITY=1 HOUSE_NARRATION_PARITY=1 FORMAT_CONTEXT_STUDIO=1 bun run src/scripts/verify-presentation-parity.ts ../../.renders/werewolf-house-narration
```

The provider-free fixture supplies deterministic authored copy; the localhost API
simulation separately proves real House authoring and private journal persistence.
The narration must remain identical through the viewer watch adapter, frozen
Studio source, independent cue selection, caption timing and TTS source. Historical
sources without references keep fixed factual narration; missing referenced copy
must fail integrity checks rather than silently change the movie. Existing movies
need re-encoding, and adopting newer narration requires an explicit source refresh.

## Werewolf v13 pack strategy proof

From `packages/web`, run:

```sh
PACK_STRATEGY_PARITY=1 FORMAT_CONTEXT_STUDIO=1 bun run src/scripts/verify-presentation-parity.ts /absolute/path/to/pack-proof
```

The canonical eight-player v13 fixture agrees at beat two, speaks 320-byte strategy
messages at beats three/four and passes at five/six. It exercises the production
catalog, the full pack → night-actions → dawn sequence and independent
speech/thought/closure binding. Frozen v8 and v12 pack pictures also render. The proof
compares the viewer stage, actual Studio Source/Selected cut Player and fresh
H.264 exports, including long frozen names, reduced motion, recorded/unrecorded
speech, Mystery dawn, direct seeks and reverse-order frames at 1280×720, 640×360,
360×240 and 390×700. `pack-source.json` and `pack-cases.json` retain exact canonical
events, catalog/selection identities, source and settings; comparison/manifest,
frame-audit and page-coverage files retain coordinates and assertions. Pass thinking must not enter the catalog
or movie. The recorded case uses deterministic local fixture audio, not paid TTS.

V7–v12 retain their historical pack sequences; old frozen sources never acquire
v13 speech. Reprepare a bundle from the same selection/source to update rendering
and encode a new movie. Including additional accepted live strategy requires an
explicit source/selection refresh. Never regenerate game history or pinned media.

Shared room names wrap rather than ellipsize. Speech bubbles reserve the measured
speaker-label width before tightening short dialogue; short two-person pictures
reuse the compact room so names and speech fit. Taller rooms retain the circular
staging. Fresh preparation captures the new label-aware layout keys. Rebuild old
bundles from the same frozen selection/source before re-encoding; the selection
does not need new game history or replacement character images.

## Doctor saves and lone-wolf decisions

The v14 Doctor-save fixture in `packages/engine/src/fixtures/werewolf-doctor-save.ts`
backs the permanent alignment and saved-hunt regressions. The implementation was
also verified with the reusable `verify-presentation-parity.ts` harness using
local case JSON and approved local image assets; the one-off case preparation
script is not retained.

The proof covered the saved hunt, surviving wolf's private speech, reduced motion,
recorded speech and Mystery's public dawn with long names. It compared viewer,
Studio Source/Selected cut, reverse/direct samples and fresh encoded clips at
1280×720, 640×360, 360×240 and 390×700. Old source/media pins remain authoritative:
rebuild bundles from the same selection for solo framing; refresh the Studio source
explicitly to adopt a subsequently published saved-hunt image or wolf cutout, then
reselect/rebuild and encode. Existing MP4s never update. No history or media is
regenerated automatically. Older saved hunts without imagery retain portrait
fallbacks; public Mystery exports never receive the private hunt composite.

## Realtime full-body room composition

When every player in the frozen game roster has a full-body reference, portrait
rooms compose the room's audience-safe cast from those transparent images on the
existing static `rooms-v1` backgrounds. Full-body references are treated as
transparent following the artwork migration. A missing reference anywhere in the
game roster retains the circular portraits. Accepted generated scenes keep their
published images and bindings.

`PortraitRoom` selects the shared composition for Influence Lobby/Mingle/huddles
and Werewolf village/pack conversations, including independent Studio/export
thoughts. `VisualSceneView` supplies the existing camera, thinking focus, speech
pagination and sampled clock. Composition coordinates are presentation data;
they never become accepted scene records, contestant observations or model input.
No provider request or generated image is involved. Saved head boxes follow the
source image; older art uses the same presentation head position as solo shots.

Run the provider-free proof from `packages/web`:

```sh
COMPOSED_ROOM_PARITY=1 FORMAT_CONTEXT_STUDIO=1 bun run src/scripts/verify-presentation-parity.ts ../../.renders/composed-room-parity
```

This covers full-body room composition, reduced motion, independent thoughts,
recorded speech and both Werewolf audiences at wide, short, narrow and tall
geometries. It compares viewer, Studio Source/Selected cut and fresh export frames,
reverse samples and fresh encoded clips. No game rules, source order, audience
membership or pinned art changes. House Cuts has no circular conversation-room
consumer and is unaffected.

Reprepare existing Studio selections and rebuild bundles from the same frozen
source/selection to pick up this renderer. A source that predates full-body room
metadata needs an explicit source refresh to adopt available artwork; it remains
playable with portraits until then. Existing MP4s must be encoded again.
