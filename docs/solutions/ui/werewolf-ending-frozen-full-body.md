---
module: Werewolf presentation
tags: [werewolf, artwork, replay, studio, presentation-parity]
problem_type: ui_bug
---

# Full-body artwork in the Werewolf final cast

The replay ending explicitly rendered 24px headshot avatars even when its frozen
snapshot supplied full-body artwork. The reported ordinary production replay had
eight available body URLs (all returned HTTP 200); this was not missing storage.

The compact ending now uses each snapshot's full-body reference, with its frozen
portrait as the fallback. A verified missing image uses the established character
image error handling; transient failures do not substitute a different identity.
Names wrap in full, and canonical roles, outcomes and elimination details remain
unchanged. No editable agent profile is fetched. This changes the shared movie
ending, not the separate standalone results-page roster.

## Consumers and verification

WerewolfWatchStage and ReplayFrame both reach WerewolfContentFrame's compact
WerewolfEnding. Studio Source, Selected cut and encoded replay use ReplayFrame.
The proof includes an isolated final-result selection with no preceding speech,
the actual eight-player local championship snapshot, and a twelve-player fixture
with long names and mixed body/portrait artwork. At 1280×720, 640×360 and 390×700,
24 direct/reverse frame comparisons were pixel-identical. Two fresh H.264 clips
provided eight decoded-frame checks (maximum mean channel difference 3.221/255).
Audio, timing, audience projection and gameplay are unchanged by this image fix.

The actual local championship replay was also checked in the browser: all eight
bodies loaded, with no overflowing cast cards at narrow width. Focused narration
and viewer/export tests passed: 11 tests, 322 assertions. Typecheck and changed-file
lint passed. The provider-free baseline before this final UI change passed 3348
tests with five skips; the interrupted PostgreSQL baseline is tracked separately.

Local proof artifacts are retained in the task workspace beside the repository:
`werewolf-ending-render-proof/comparison.json`, PNG comparisons and two MP4 clips.
Reproduce with `bun packages/web/src/scripts/verify-presentation-parity.ts
<output-directory> <authorized-cases.json>` from the repository root.

Existing MP4s remain unchanged. Prepare a fresh bundle and render from the same
selection to adopt this treatment; do not regenerate game history or artwork.
An older championship selection whose descriptor predates the frozen-artwork
source fix must be refreshed using the current source, as documented in
`championship-frozen-replay-artwork.md`.

## Centered results follow-up

The figure and details now form one vertically centered flex group inside each
card, rather than a growing image row pushing details to the bottom. The figure
shrinks first at short geometries; details remain fully visible. Actual browser
measurements found equal top/bottom group gaps (188.403px at the checked desktop
geometry) and no card overflow on desktop or narrow mobile. Refreshed proof is
in `werewolf-centered-render-proof`: 24 viewer/export comparisons and eight
encoded-frame checks across the same eight/twelve-player and geometry matrix.
