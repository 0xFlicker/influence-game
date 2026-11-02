# Changing presentation without breaking Studio or video exports

**Viewer, Studio and exported video parity is a completion requirement.** This
applies to bug fixes and cosmetic changes as well as new beats. Until the paths
are unified, every author and reviewer must check the adapters between them.
An unverified surface is an outstanding requirement, not presumed coverage.

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
viewer to use a separate required paging UI are not acceptable substitutes. Normal
keyboard/click advancement following the established player transport rules remains
allowed. Cropping decorative
scenery is different from hiding required cast/text content. Studio's editorial
lists, inspectors and timeline outside the rendered picture may scroll.

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
