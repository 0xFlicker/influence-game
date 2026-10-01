---
title: Werewolf public visual replay — A2 prerequisite side quest
type: feat
status: implemented-local-validation
date: 2026-09-30
---

# Werewolf public visual replay

## Decision and scope

During [A2 pre-planning](../ideation/2026-09-30-production-studio-brainstorm.md), the user identified a prerequisite: producing a Werewolf game needs to result in a watchable Werewolf game. They selected **Replace the public Werewolf viewer**, rather than a private-only player or video export.

This side quest precedes the Production studio. Replace the transcript-first `/werewolf/[slug]` experience with complete visual playback, retaining Mystery and Omniscient modes. Reuse the existing lobby visual renderer and accepted player dialogue. The resulting player must be embeddable by the future studio without requiring the studio to build its own playback model.

The user finished reviewing this scope on 2026-09-30. Their clarification permits future presentation interpretation of prose, cues and scene labels while preserving canonical game authority. The user authorized v1 implementation after reviewing this scope. It does not authorize paid generation, public publication of draft/private assets, or unrelated admin redesign. Public viewer work is now explicitly in scope, superseding the earlier A1 admin-only boundary for this side quest.

## User-visible result

Open an existing Werewolf game and watch introductions, day conversations, voting, night outcomes and the ending in order. A speaker is framed in the appropriate room and their original line appears in a speech bubble. Pack conversation uses the single private room in Omniscient mode. Missing/unverified scenery falls back to a frozen full-body reference or portrait on a neutral background; missing references still permit readable named dialogue.

The player owns presentation time and controls: play/pause, previous/next moment, seek, speed and keyboard shortcuts that respect inputs/dialogs. A line has enough reading time to finish, including long paginated bubbles; playback must not skip text on a fixed 2.2-second timer. Seeking resets presentation time and pending transitions. Reduced motion suppresses camera motion without changing dialogue or game facts. Mobile controls and speech stay readable without nested page scrolling.

Retain original transcript readback as a secondary view. Preserve the existing route, game links, live/latest behavior, suspended/cancelled explanations and authorized stop control. The game cannot require generated images to be watchable.

## Presentation coverage

| Accepted material | Presentation |
| --- | --- |
| Introduction / day speech | Original line, current speaker, correct lobby scene and cast |
| Pass / unavailable contribution | Brief non-speech moment; retain the distinction and optional original performance cue (preserved for later structured interpretation); no empty speech bubble or invented line |
| Pack proposal | Original line in the one pack room; Omniscient only |
| Pack ballot resolution | Accepted ballots/agreement/retry/no-attack outcome; Omniscient only |
| Day ballot resolution | Accepted tally and target/no-elimination result; deliberate reveal order, compact expandable ledger rather than a full-screen wall |
| Night resolution | Public death/survival outcome; Omniscient can also show accepted protection/investigation details |
| Phase boundary | Brief day/night/vote context that does not invent narration |
| Ending | Canonical faction outcome and winners; role disclosure at the allowed position |

Focus a day elimination presentation on the eliminated character. Preserve named ballot evidence in a secondary ledger. Do not portray the order of sealed ballot collection as public knowledge. Unresolved or failed player calls remain distinguishable from voluntary abstention/pass.

## Existing pieces and gaps

| Module | Reuse / required work |
| --- | --- |
| `packages/web/src/app/werewolf/werewolf-viewer.tsx` | Currently a polling transcript list with a fixed step timer. Replace its primary presentation and controller while retaining supported behavior. |
| `packages/web/src/lib/werewolf-api.ts` | Audience/cursor fetch contract; needs a typed presentation read, cancellation and strict result identity. |
| `packages/engine/src/werewolf/observation.ts` | Existing public allowlist and audience-local cursors. Preserve as game-state authority; presentation interpretation cannot replace those facts. |
| `packages/api/src/services/werewolf-games.ts` | Canonical replay-prefix selection; inspect handling when one event adds several public entries so playback cannot omit a vote/night/result or stall on an unreachable cursor. |
| `packages/api/src/services/werewolf-production.ts` | Frozen references and canonical scene/cast boundaries. Scene reuse differs from dialogue positions; supply exact selected-scene mapping without exposing private event coordinates in Mystery. |
| `packages/api/src/routes/werewolf.ts` | Existing hidden-game/audience/rules-version guards; apply the same guards to every visual/media read. |
| `packages/api/src/services/visual-media-repair.ts` | Version/publication authority. Introduce explicit public Werewolf publication semantics without making existing private approvals public by accident. |
| `packages/web/src/app/games/[slug]/components/visual-scene-view.tsx` | Shared character framing, bubble placement, panel switching, blurred surroundings and portrait fallback. Keep renderer fixes shared, avoid copying it. |
| `scene-speech-timing.ts`, `timed-speech.tsx`, shared playback/director modules | Inventory and reuse timing/playback where its contract is game-independent. Do not import Influence game-rule choreography just to reuse a clock. |
| `packages/web/src/app/admin/werewolf/scene-preview.tsx` | Character-framing proof, not a full player. It currently selects the latest candidate; that is not a public publication policy. Later studio preview should use the same complete player with explicit asset selection. |

## Hard boundaries

### Audience and replay state

Canonical events/projections establish game facts: participant identity and membership, accepted action targets, phase, deaths and outcome. Prose, performance cues and scene labels may be interpreted into a separate validated presentation track—expression, gaze, gesture, tone or composition. For example, “looks at Riven” may resolve to a visual attention target from the known cast; it cannot establish a vote target, add a participant or reveal a hidden role. Labels can suggest staging while structured IDs bind it to the actual scene and cast. Each displayed moment binds to its audience, game, cursor, roster and allowed roles at that point. Do not use the final game's dead/alive or revealed-role state when replaying earlier moments.

The first replay milestone preserves original cues without introducing a model interpreter. This is a scope choice, not a never-parse rule. See [emotional performance cues](../ideation/2026-09-30-emotional-performance-cues.md) for the proposed vocabulary, authorship/interpretation options, rendering tiers and cost model.

Switching audience or seeking backward must remove future/private state synchronously. Abort and fence stale responses; never briefly paint an Omniscient pack frame under Mystery. Mystery must not receive pack imagery, private action counts, raw canonical sequence coordinates or future role disclosures through its presentation payload or asset URLs. Test the complete response, not only visible text.

An audience-local replay position and an image scene boundary are different coordinates. Resolve their mapping server-side from canonical prefixes. Determine safe atomic stepping when one accepted event creates multiple visible entries; do not silently skip those entries or loop on the same cursor.

### Public asset publication

The existing Werewolf publication contract is private production acceptance. Preserve that meaning for existing records. Choose a durable, explicit public publication marker and an explicit operator action. Existing private versions remain private until that action; do not solve this with a silent mass backfill that publishes them.

The public player uses the selected publicly published version, not the newest candidate. Public responses omit prompts, provider evidence, annotations/review data and source metadata that is not needed for playback. Hidden-game restrictions also apply to media delivery. Prefer bounded selected/adjacent media loading; do not embed every large scene image in every cursor response.

Frozen character references already captured for the game are the fallback source. Never substitute the player's edited current profile or generate replacement art automatically. Inspect which captured assets are safe for public display; publishing a replay does not imply publishing all production source material.

### Scene continuity and missing imagery

Select the lobby or pack scene valid at the exact moment. Do not use a future smaller cast after a death. Preserve every good panel; no stitching requirement and no new panel-count limit. The shared renderer may switch among N panels while presenting its existing bounded image layers. An uncovered speaker gets an individual fallback; broken image delivery must leave the words readable.

### Playback ownership

One deterministic presentation clock controls camera, speech and auto-advance. Pause freezes both reading and camera time; manual seek invalidates prior image/transition callbacks. Page backgrounding, image decode delays and variable bubble layout must not consume unseen lines. Spacebar and arrow shortcuts must not hijack text fields, native sliders or dialogs.

Completed replay is the first proof, but the replacement cannot remove existing live/latest viewing. At the committed frontier, show a waiting state and resume only from accepted new material. Browsing, playback, seek and retry reads never invoke models or production mutations.

## Delivery sequence

1. **Contract and projection proof.** Define presentation moment identity, audience-safe prefix state, scene mapping, stepping and public asset selection. Inventory existing shared clock/timing interfaces before choosing extraction. Specify the public publication change and any required migration.
2. **Complete fallback playback.** Play one finished real Werewolf game from introductions through result, with all event kinds and original words, using safe frozen references even without scene renders. This establishes a working product before image-loading complexity.
3. **Published scene imagery.** Attach exact published scenes, preserve panel fallbacks and verify private/public delivery. Add the explicit publish-for-viewers production action.
4. **Public route replacement.** Integrate playback controls, secondary transcript, Mystery/Omniscient switching, live/latest behavior and responsive layout. Retire the old transcript-first primary UI.
5. **Acceptance.** Run deterministic fixtures plus a real local completed game's read-only replay; no paid generation required. Review desktop/mobile browser recordings including the ending.

## Acceptance evidence required

- All accepted original speech appears in order and completes its reading cycle. Passes and unavailable turns do not become invented dialogue.
- A complete six-player and eight-player game can reach the ending; phase/day/checkpoint boundaries and all-pass/no-attack/tied-vote cases remain understandable.
- Mystery payloads and visuals contain no pack/future-role leakage. Omniscient → Mystery and backward seek races cannot show stale private/future content.
- Exactly published imagery is used; a newer candidate remains private. A prior private-only Werewolf publication does not become public without explicit action.
- Correct pre/post-elimination cast, missing scenes, uncovered characters, multiple unstitched panels and failed images have usable playback.
- Pause/resume, long lines, seek, speed, keyboard input focus, mobile and reduced motion work in the actual browser. No duplicate clocks or hidden writes/model calls.
- Existing public game hiding and live/latest/stop behavior survive the replacement. Required repo checks and focused browser/API tests use isolated test databases.

## A2 handoff

Return to the studio brainstorm with a working public player, a proven presentation cursor and an explicit public version contract. The studio can embed that player and later add candidate preview, browsing and timeline tooling around it. Do not rebuild the Production library or job center during this side quest. MP4 export, speech synthesis, House dialogue rewriting and generated emotional/camera tracks are not part of this first player. Future emotional performance is explicitly supported as a direction; preserve its original source cues and moment identity without building that subsystem now.


## Implementation record — 2026-09-30

The public route now uses `WerewolfViewer` for transport and audience selection, `WerewolfPlayer` for one-clock presentation, and `replayMoment` for rendering typed outcomes and original contributions. `projectWerewolfPresentation` binds audience-local positions to canonical pre-event cast/room boundaries. It asserts the current one-visible-entry-per-event contract rather than skipping an unexpected multi-entry event. The shared `VisualSceneView`, speech timing and measured pagination provide image framing and dialogue; silent character focus supports passes and eliminations without manufacturing speech.

Migration 0105 adds explicit publication audiences, preserving historical Werewolf approvals as private. The production panel publishes explicitly for viewers. The presentation API pins a publication cutoff for the viewer session, resolves only a matching public version, and emits guarded image URLs without producer prompts, review evidence or embedded image bytes. Private approvals and newer unpublished candidates cannot replace public imagery. Frozen character references remain the fallback. The migration was applied through the normal migrator to local `influence_dev`; a second pass succeeded without replay.

Validation completed: provider-free suite (2,150 passed, five skipped), isolated PostgreSQL suite (1,811 passed), five deterministic browser journeys, and workspace typecheck/lint. Focused publication tests also prove draft exclusion, historical publication cutoff, hidden-game denial and Mystery denial of guessed pack-image URLs. The browser suite covers explicit public publication, multi-panel image use, character fallback, desktop/mobile, audience changes, backward seek, reduced motion, pause/resume and keyboard focus. The additional silent-focus renderer test passes. No paid generation, publication of the user's private drafts, or deployment was performed.

Real local proof: `young-tan-frost` played all 68 Mystery moments from the beginning through its ending at 2× in the public browser with no page errors. The eight-player `bare-ruby-tower` Omniscient presentation also reached its completed 192-moment state in a read-only API check; this is not a claim of a second full browser autoplay run. Desktop/mobile screenshots and published-panel fixture evidence are saved under `/tmp/werewolf-replay-*.png`; the real-game screenshots are `/tmp/werewolf-real-replay-desktop.png` and `/tmp/werewolf-real-replay-ending.png`. Future split framing and an animated gaze/eyes cue are preserved in the emotional-performance ideation, outside this v1. Remaining A2 work is the production studio, not another game-specific renderer.
