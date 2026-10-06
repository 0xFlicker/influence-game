---
title: Reuse Werewolf art through the shared Producer repair lifecycle
module: Werewolf production
problem_type: integration_issue
tags: [werewolf, visual-mode, producer, immutable-jobs, audience]
date: 2026-10-05
---

## Problem

Werewolf's historical pack scenes used ordinary character references and generic House locations. A one-off preview could not repair those scenes or exercise a known doctor save repeatedly. A lone wolf also has no pack conversation to trigger night production.

## Solution

The game module derives scene purpose, cast and event boundary from canonical events. Automatic preparation and Producer regeneration call the same planner. Resolved nights with targets produce separate hunt scenes, using the preceding living cast; protected targets are still staged, while null targets produce no hunt.

Wolf forms are derived artifacts keyed by game, player, frozen source, art revision and generation identity. Verify the transformed identity and measure its new head. Preserve original references. Normal scene regeneration reuses verified forms; an explicit form-regeneration request selects another generation.

Keep queued repair plans immutable. Resolve a job's generation intent into concrete references in worker memory, then persist that resolved plan on its output version. Updating the queued plan violates the existing database trigger and undermines retry evidence. Durable provider operations reuse completed bytes, and unresolved charges block new form requests. Review retains candidate reference provenance and rejects mixed form/location sources.

The shared renderer, harmonization, version history, publication and worker lease remain House services. Game-owned staging and media binding enforce the purpose, exact cast, event boundary and audience. A hunt is available only to Omniscient; its original target cannot be inferred from Mystery media URLs. One source night entry expands into hunt and outcome stops through the same index used by arrows and the slider.

## Validation and boundaries

Provider-free tests cover canonical one/two-wolf scenes, doctor saves, no agreement and audience filtering. PostgreSQL fixtures cover form reuse, failed verification, uncertain charges, immutable job intent and explicit regeneration. Browser tests cover Producer desktop/mobile journeys and shared player transport. Real provider image quality needs its own capped trial and operator review; passing mocks does not finish W6 transformation, outcome animation or art acceptance.

Local proof on 2026-10-05: 2,273 provider-free tests, 1,878 PostgreSQL tests, 14 existing browser journeys and the new hunt/outcome journey passed; typecheck and lint passed. Browser seeking must wait for index hydration before dispatching a slider change, otherwise the input can still have its initial range. A teardown timeout also occurred on one rerun; the final isolated run cleaned up successfully. No paid image trial or real-game replacement publication was performed.

### Doctor and seer action beats

A resolved night carries one typed, Omniscient-only action list (protection, investigation, hunt) and the pre-resolution snapshot. This same list determines global scrub counts and client cue expansion, so arrows and slider cannot disagree. Protection identifies its actor from the accepted protection action; investigation uses the recorded seer/target/result. Do not reconstruct any of this from speech. Use the pre-resolution cast even when a role actor dies that night, and do not suppress doctor/seer choices because the pack had no target. Mystery omits the entire list and retains one public outcome stop. Basic role cards use frozen original art and need neither generated images nor independent animation timers.

Doctor/Seer follow-up proof: 2,281 provider-free tests, 1,878 PostgreSQL tests and the 15-assertion browser journey passed. Direct local Hazy playback confirmed both named actions and correct full-body references. Portrait sizing uses the actual remaining flex height, keeping long names and the seer result visible on mobile.

A doctor-save annotation requires a non-null attack matching the protected player and no death. Protection alone is not proof of a save. Keep the named Doctor card outside the generated/fallback image branch so both presentations explain the same canonical outcome; Mystery never receives this callout.

### Published forms and replay motion

Compute the first wolf appearances for each night while scanning canonical history, before filtering the requested window. Reset the appearance set at the canonical night phase so a surviving lone wolf still transforms after appearing with a pack on an earlier night. Otherwise paging or refetching replays the transformation. Bind derived form bytes only from audience-permitted published scene versions at or before the event boundary; retain publication cutoffs and exact per-game byte allowlists. A later hunt without a composite can reuse an earlier published pack's forms, but cannot see future or unpublished variants.

An entrance is a prefix within the existing dialogue/hunt cue, not a new canonical event or scrub stop. Sample fixed image switches and damped springs from the director clock, and shift speech/thinking boundaries by the prefix. The game-owned seek policy lands each night’s first pack/hunt cue at its entrance for both step navigation and the timeline; subsequent dialogue uses readable landing points. No special shared-director seek mode is required. No independent animation timers or session-level transformed flags. Partial/missing/failed forms keep the original picture and name. Outcome accents likewise live inside the canonical death cue, so direct seeks show the settled result and a Doctor save cannot accidentally inherit a slash.

A source cursor alone cannot identify the Doctor, Seer, hunt and dawn substeps of one resolved night. Scene navigation carries `{ cursor, step }` from the same typed action list as playback expansion; Previous/Next must preserve that step when seeking. Test a two-wolf pack becoming a lone survivor, both forward and backward, with a published solo hunt image. Mystery still exposes only its public outcome and no private navigation labels.
