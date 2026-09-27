# Visual and historical playback review

Reviewed on 2026-09-26. These are code and saved-record findings, not deployment proof.

## Entry and asset selection

| Condition | Shared watch behavior |
| --- | --- |
| Waiting game | Pre-show, with authorized Start/Stop/Hide actions. |
| In progress | Live MatchWatchShell and presentation director. |
| Suspended by visual policy | Keep the watch stage and expose repair status. |
| Completed replay with transcript or typed format frames | Shared theater; asset availability does not select a separate runner. |
| Cancelled or otherwise suspended | Existing terminal/status view. |
| Visual endpoint disabled, empty or temporarily unavailable | Present saved dialogue and canonical format facts using portraits. Preserve already fetched media across refresh failures. |
| Full-body image absent or fails | Substantial circular solo portrait; a failed portrait uses the persona default. |
| Mingle room absent, or any participant lacks full-body art | Rotating semicircle of the saved speaker and exact private audience. |
| Usable room with an unlocalized speaker | Headshot and named bubble; a producer can save a separate presentation pointer. |
| Primary room image fails to load | Speech remains readable with its headshot over the backdrop. |

`getMatchWatchRouteDecision` selects the watch surface from status, replay intent and accepted content. `gameKernel` comes from stored kernel authority or trusted canonical format evidence, never images or the creation date. Both kernels use the same director and visual beat renderer.

The visual runtime executes only when the game configuration enables Visual Mode. Best effort allows gameplay to proceed using canonical text context when rendering fails; require visuals pauses for recovery. The viewer fetches saved media for every game, including historical games with Visual Mode off. Missing imagery does not switch engine execution to an old runner.

`fullBodies` comes from immutable prepared cast artifacts or frozen game-start references. Portrait-fallback artifacts cannot masquerade as full-body shots. Confirmed head geometry must match the selected image. Current agent profile edits do not backfill old games. Historical scene production can add canonical room imagery but does not generate a batch of new character references.

An active beat pins its media choice. Initial hydration can fill an empty selection; subsequent refreshes take effect at the next beat. Saved dialogue metadata reserves the speech budget, so image publication cannot change the active reading duration. Mingle reserves room timing regardless of imagery.

## Checked examples

| Saved game | Evidence and consequence |
| --- | --- |
| `odd-gold-ice` | Classic kernel, 616 transcript rows, 149 canonical replay frames; no published scenes or full-body references. 388 attributed rows lack a typed speaker ID and use names in `fromPlayerId`. The old UUID-only lookup returned no visual beat. Unique exact saved names now resolve to the frozen roster; unresolved attribution remains readable. |
| `neon-lemon-surge` | Stored format kernel, 894 transcript rows, 745 canonical frames, two published scenes and no full-body references. Most modern speech has typed speaker IDs; Mingle carries room IDs and exact audiences. Its room presentation now uses the semicircle while canonical format results remain intact. |
| Local `edge-khaki-world` | Stored format game with saved Mingle room IDs and audiences, including the Riven/Jace room. Its former tiny top-aligned portrait was a renderer fallback, not a separate engine. Verified the new larger solo portrait and headshot room in the local browser. |

The production records were read through public game, transcript, visual and replay-frame endpoints. The changes are local; production has not been deployed by this work.

## Endgame and special cases

Canonical elimination and jury events own ballot order, elimination state, jurors and winner revelation. The winner tableau persists after closing narration and hides again when seeking before the reveal. Missing or failed full-body art uses the winner's portrait. All three checked examples have a canonical `jury.winner_determined` frame.

The classic watch HUD still retains its grandfathered presentation parser for historical status; format HUD status uses the active canonical replay frame. No new parser patterns or prose-derived facts were added. Endgame reveal choreography uses typed canonical events in both kernels.

Runs without a canonical winner cue cannot invent one by parsing their transcript or exposing the final server winner during earlier playback. At the completed replay tail, the final portrait or House segment now remains readable instead of fading to an empty stage. Live waiting still preserves its completed clock, and new accepted content advances normally.

| Case | Rule |
| --- | --- |
| Accepted ballot / sealed roll call / deciding vote | Use typed voter and target; preserve reveal order and show only accepted wording. Missing imagery changes presentation, not the ballot. |
| Historical vote text without typed ballot metadata | Render saved speech as speech. Do not infer a target or tally from prose. |
| Accepted Two Names plea | Existing solo speech with full-body or portrait art. |
| Safety Bounce without a suitable saved lobby | Existing canonical board presentation. A failed lobby image also falls back to that board. |
| Anonymous dialogue | No author portrait or inferred identity. |
| Diaries and private thinking | Retain inspector/archive access; do not enter the public story loop. |
| Saved House summary | Render typed `house_summary`; operational system rows do not become narration. |
| Missing old House-summary classification | Phase/title bridges remain available; do not add prose-recognition rules. |
| Room audience missing or ambiguous | Show known seats only; do not fill from the current server cast or guess based on dialogue. |
| Image arrives after a speech beat began | Retain the reserved solo/room timing and active media choice. |

Remaining limits: visual-endpoint failures are retried quietly rather than exposed as an operational error on stage. Historical records without typed ballots or room membership cannot recover those facts from prose. Their saved speech stays watchable, with these evidence boundaries intact.

## Studio asset provenance

One generated character-free background was converted to the bundled `packages/web/public/visual/solo-studio-backdrop.webp` (768 × 1152). It follows the existing full-body reference direction's plain warm-grey photographic background, with the subject omitted. The viewer splits it into left/right halves, blurs and slightly enlarges it, and feathers the full-body edges. No new generation occurs per game or per replay.

Exact generation prompt:

> Use case: photorealistic-natural. Asset type: reusable character-free background for Influence full-body reference presentations. Generate ONE empty portrait studio backdrop, aspect ratio 2:3, matching this existing character-reference prompt's setting: 'photorealistic full-body character reference ... facing toward camera in a natural neutral pose ... plain warm grey background. No text, panels, additional characters or headshot inset.' For this asset OMIT THE CHARACTER ENTIRELY. Only the plain warm grey photographic studio cyclorama, with a very soft warm grey taupe wall gradually blending into a matte warm grey floor, subtle natural studio illumination, quiet diffuse ambient gradients, no visible horizon line, no cast subject shadow. Soft even centered lighting. It will be sliced into left/right halves and blurred to extend the sides of existing portrait full-body shots. Restrained neutral warm-grey colors like the source full-body backgrounds, no dramatic spotlights or black edges. Absolutely no people, animals, creatures, objects, props, logos, text, panels, vignettes or watermark.

Validation: provider-free model/layout/component tests cover identity resolution, exact audiences, reduced motion, failure handling and tail retention. Deterministic browser tests exercise desktop, ultrawide, portrait mobile and landscape mobile layouts, solo paging, room edge fill and overlapping panel transitions. Required check results are reported with the implementation, separately from deployment.
