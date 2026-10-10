---
title: Werewolf night production and playback continuity
date: 2026-10-01
status: brainstorm
---

# Intent

Pause feature implementation to design Werewolf's night production and resolve the perception that discussion is being skipped. Reuse the House player and production pipeline. Give the pack distinctive transformed character art, a private meeting, and a non-graphic stalking/outcome sequence. Both generated scenes and portrait-based playback should feel complete.

## Verified local evidence: wild-lemon-sun

Read the local omniscient presentation and provider-attempt records without modifying the game or making model calls.

- Six players; Marlow Reed is the sole wolf. The rules already skip pack talk for a lone wolf. This game cannot demonstrate two-wolf negotiation.
- 63 presentation entries: three introduction speeches, 22 discussion contributions, nine day vote receipts, three pack ballots, three night outcomes, 22 phase entries, and the result.
- Only six discussion contributions contain speech; 16 are unavailable, not deliberate passes. Spoken cursors: 21, 29, 33, 34, 41, 42. A browser check of cursor 21 showed Veyra's opening and then the vote, because cursors 22–25 contain unavailable replies.
- The model is gpt-5-nano. Provider attempts include 174 undecodable structured outputs with `max_output_tokens`, 18 usable outcomes, six Flex rate-limit outcomes, and seven records with no outcome kind. These are attempt counts, not distinct turns. Do not infer what the seven records mean without inspecting their lifecycle.
- Required evaluation baseline: **gpt-6-luna**, per user direction. The current shared creation form, omitted-model API path, and simulation CLI already resolve to `openai:gpt-6-luna`; this completed game retains its prior Nano configuration. Do not optimize the new experience around Nano or rewrite historical model records.
- The current Werewolf agent invocation sets `outputTokenLimit: 2000`. Investigate budget adequacy for reasoning plus strict structured output and actual reasoning configuration before selecting a revised policy. This evidence does not prove that raising the cap alone fixes every failure.
- Daytime speech and pack speech are already supported by replay. Pack talk maps to the existing private `mingle-1` scene; special transformed art and night staging are missing.
- The blank introduction image is a within-contribution timing state, not another canonical event. Shared scene speech waits 650ms before its fade; paused seek positions at the speech start, which still has zero opacity. With thinking enabled there is an additional timing/fetch dependency. Manual advancement also deliberately includes a clear-image state. This explains why seeking can land on a bare character until another action.

## Verified follow-up: hazy-ruby-sand

Read-only local inspection on 2026-10-02, game `d181930b-b365-4d56-a8a8-20400e6cfa4e`:

- The opening lobby has **two panels in both v0 and regenerated v1**. Both versions use `shots.mode = groups` and `overview = null`. This is not a missing second render.
- The shared `visual-scene-renderer.ts` deliberately preserves independently verified panel pixels. Its multi-panel branch assembles a contact sheet, but makes no generative harmonization/stitch call and publishes the playable group shots. Regenerating repeats this workflow. Influence and Werewolf use this same renderer.
- The shared repair comparison renders only each version's lead `imageArtifactId`; it must expose all panels to make multi-panel review understandable.
- Werewolf keys `SceneContent` by every cue, remounting `VisualSceneView` on speaker changes. That discards the shared camera's previous position/layers and prevents its pan/slide/dissolve continuity. Repair the component lifecycle with explicit readiness, timeout and navigation handling; do not merely remove the key and retain stale readiness.
- The omniscient presentation contains both Larry and Marlow's pack speeches at cursors 9 and 10. A private `mingle-1` scene exists with both wolves verified. Wolf-form art is still the unimplemented design below; missing transformation does not establish missing dialogue.

Next playback work should preserve camera continuity and verify both pack lines visibly play. Separate-panel playback must remain complete with smooth movement and blurred edges. If optional harmonization is added later, retain the verified original panels and accept a composite only after identity/localization verification; do not make successful composition a prerequisite for watching the scene. No additional image jobs were requested during this diagnosis.

## Playback repair before visual evaluation

1. Verify a fresh configuration uses gpt-6-luna. Audit output budgeting for that model with deterministic truncated-output coverage; fix it if needed. Preserve exact schemas and typed failures. Do not convert failures into intentional passes or generate replacement history for this completed game.
2. Surface systemic execution failures to producers so a run with almost no discussion does not look like a successful quiet game. Define the threshold/recovery behavior in implementation planning; avoid inventing new gameplay rules here.
3. Seek should land on the first readable state of the contribution: thinking when enabled and available, otherwise speech. It should preserve play/pause intent and handle delayed thinking/image readiness without an empty extra click. Auto-play may retain a brief establishing transition, but not a separately navigable blank intro step.
4. Confirm every accepted line survives playback with thinking on/off, both orders, sequential play and seek, including windows around cursors 32/33. Use a deterministic two-wolf fixture for pack coverage. Run a fresh paid game only when explicitly requested.

## Night sequence

### Transformed character assets

Create a match-specific wolf-form variant from each wolf's frozen character image. Retain recognizable clothing, silhouette, colors, and distinctive accessories; transform the character into an anthropomorphic werewolf. Keep the original character asset unchanged. One reusable asset per wolf, not per speech or night.

Store original-reference provenance, actor identity, generated asset/version, and localization for the transformed head. Existing human head coordinates cannot be reused. The producer can inspect/regenerate/select the variant through the existing version/publication model. Generate the variant before composing pack scenes; cache by match reference, visual direction and selected version.

A short crossfade or silhouette transition can suggest transformation. A convincing anatomical morph would require a separate animation/video effort and is outside the first slice.

### Two living wolves: private meeting

Night falls → reveal transformed wolves in a dark meeting place → play their accepted proposal lines with the existing speaker focus and speech/thought bubbles → present the canonical ballot result.

Preserve each proposal/ballot attempt and the original speech order. Failed agreement returns to another proposal when the rules say so. After the final failed attempt, show no hunt tonight. Reuse meeting art while the living pack and chosen assets remain the same. Production can make alternate atmosphere later without requiring it now.

### One living wolf

Skip the meeting and negotiation presentation. The resolved choice goes directly to the stalking/outcome scene. The pack ballot remains available as evidence without requiring a separate full-screen agreement card.

### Stalking and outcome

Stage the selected target at the far side/depth of a dark alley, walking away; one or two wolves occupy the near edge, oriented in the same direction. The target may be unaware or concerned. No contact, weapons, injury, blood, or attack pose. Use identity references for all participants; canonical events supply participant IDs and target, never generated prose.

Suggested composition prompt:

> A cinematic moonlit alley with three separated figures. The referenced traveler is in the far distance, walking toward a pool of lamplight. The two referenced anthropomorphic werewolves stand at the near left edge, beginning to walk down the same alley. Preserve their clothing and recognizable character details. Spacious staging, clear silhouettes, atmospheric shadows. No physical contact, injury, blood, or weapons.

The one-wolf version requests two figures. Specify the actual participant count structurally rather than expecting the renderer to infer it from this example.

Use camera framing, layered positioning and a restrained push-in to imply movement. A still image alone cannot independently animate the wolves walking; literal movement needs isolated character layers or a separate video asset. The first slice does not require generated video.

Only after the canonical night result confirms a death, overlay a brief white/red claw-mark wipe (graphic accent, not a wound), then reveal the dawn outcome. Prefer claws for the first version; a teeth silhouette can remain an alternate art direction. Avoid repeated flashes. Reduced motion uses a static mark and dissolve.

- Protected target: suspense resolves into survival; no lethal slash or elimination animation.
- No agreed target: no target/stalking tableau; return to dawn.
- Other no-death outcomes: render the accepted result, not an assumed attack success.
- Display neither an unresolved intended kill as a death nor the selected target before the audience is entitled to know it.

## Audience and non-generated presentation

Omniscient may see the identifiable wolf variants, meeting, target, and resolved private actions. Mystery receives no identifiable pack art, pack dialogue, or unrevealed target/Doctor/Seer information. Recommended Mystery sequence: atmospheric night transition, then the publicly announced dawn victim/survival result. Decide later whether anonymous silhouettes add anything; recognizable clothes or body shapes can still disclose identity.

Without generated scenes, use the same sequence and timing with character cards/cutouts, a dark backdrop, speaker focus, target composition and the claw overlay. If wolf-form art is unavailable, use the original frozen character with an explicit wolf presentation treatment in Omniscient. The viewer should remain complete without a render and without blocking gameplay. Failed assets remain inspectable in Production.

Mystery must not receive private asset URLs/metadata merely because a UI layer hides them. Preserve the existing audience-filtered presentation/media boundaries.

## Production integration and cost

Extend existing scene planning, render attempts, costs, inspection, repair, and publication rather than creating a second production system. Introduce explicit Werewolf-owned production scene purposes for pack meeting and night stalking/outcome; room membership alone cannot distinguish these from generic lobby/mingle art.

Expected render units: one wolf variant per wolf; reusable meeting art per living-pack composition; one stalking composition per distinct night/target as needed. Cache identity variants and meeting scenes. Presentation accents, camera moves, bubbles and slash effects incur no model calls. Do not promise a dollar estimate until the selected image model, quality and retry policy are known.

The existing visual runtime only prepares introduce/pack_talk/open_thread/discuss scenes. Night outcome preparation, transformed-reference resolution, audience-safe delivery, render triggers, and published versions need explicit implementation work. A finished game should support producing these assets from its canonical history; live automatic production should use the same jobs and record their costs.

## Relevant implementation map

- `packages/engine/src/werewolf/rules.ts`: lone-wolf skip, proposal/vote order, canonical night outcomes.
- `packages/engine/src/werewolf/agent.ts`: strict speech/decision contract and current 2,000-token cap.
- `packages/engine/src/werewolf/watch-contract.ts`: playable entries and audience-safe replay windows.
- `packages/api/src/services/werewolf-visual-runtime.ts`: automatic production boundary and publication.
- `packages/api/src/services/werewolf-production.ts`: frozen references, producer scene inventory and preview.
- `packages/api/src/services/werewolf-presentation.ts`: audience-filtered scene binding and publication cutoff.
- `packages/engine/src/visual-scene-plan.ts`: shared composition contracts; keep game rules out of it.
- `packages/web/src/app/werewolf/werewolf-watch-model.ts`, `replay-moment.ts`, `werewolf-watch-stage.tsx`: Werewolf choreography and presentation.
- `packages/web/src/components/watch/watch-director.ts`, `watch-thinking.tsx`: shared seek/readiness/thinking timing.
- `packages/web/src/app/games/[slug]/components/scene-speech-timing.ts`, `solo-presentation.tsx`, `visual-scene-view.tsx`: shared visual reveal mechanics.
- `docs/plans/2026-09-30-004-feat-werewolf-public-visual-replay.md`, `docs/plans/2026-10-01-001-refactor-shared-house-watch-player.md`: prior production/publication and shared-player boundaries.

## Suggested implementation order after design

1. Playback entry continuity and model-budget diagnosis/fix; verify a healthy deterministic game.
2. Complete no-generated-scene night choreography for one/two wolves, protection, no agreement, Mystery and reduced motion.
3. Add versioned wolf-form assets with head localization and producer review.
4. Add meeting and stalking scene production through existing jobs/costs/publication; reuse the same player choreography.
5. Review the visual result and tune pacing before optional movement/video or more elaborate transformation effects.

No gameplay, production jobs, media assets or playback code changed during this brainstorm.


## Implementation follow-up (2026-10-02)

The user approved restoring harmonization and fixing speaker remounts. The shared renderer now attempts and strictly verifies a harmonized scene after all original panels verify, retaining those panels in the saved version. New games and Producer regeneration use this stage. The legacy comparison exposes all panels plus the composite; no separate repair action or migration was added. Werewolf retains the scene component across speaker turns with cue-scoped readiness and explicit navigation revisions. The verified diagnosis above describes the pre-fix behavior. Wolf transformation/night artwork remains design work.

Validation: provider-free baseline 2,183 pass / 5 skip; isolated PostgreSQL baseline 1,829 pass; focused renderer/repair coverage 39 pass; producer UI coverage 7 pass; typecheck/lint and diff whitespace checks pass. Browser coverage proves retained room DOM across speakers, a real animated cross-panel transition, paused navigation, all three producer panels, and pack audience separation. The full browser run passed five checks and had a pack timing timeout; the focused pack plus production rerun passed both. Image/vision providers were mocked; no paid harmonization or publication was performed on the user's episode.
