---
title: "W6 — Werewolf night production and playback"
date: 2026-10-05
status: in_progress
type: feat
---

# W6 — Werewolf night production and playback

## Outcome

Give Werewolf a complete night sequence inside the House player: the pack meets in wolf form, chooses a target, and the night resolves into death or survival. It must remain legible and engaging using existing character pictures when no generated art is available. Mystery sees only the public night and dawn; Omniscient can follow the pack and resolved private actions.

Deliver the choreography first, then reusable wolf forms and scene production through the existing House services. This is a focused W6 implementation plan, not the A2 production-studio rebuild or a new player. Writing this plan does not authorize paid image calls, replacement of published assets, or deployment.

Related: [pillar W6](../ideation/2026-09-30-house-admin-and-production.md#w6--finish-the-nights-visual-identity), [night brainstorm](../brainstorms/2026-10-01-werewolf-night-production-and-playback.md), [selected Lantern Village direction](../brainstorms/2026-10-04-werewolf-art-lantern-village.md), [replay music](2026-10-05-002-feat-house-replay-music.md), [shared player learnings](../solutions/architecture-patterns/share-watch-clock-with-game-owned-projections.md).

## Implementation checkpoint — repeatable Producer regeneration (2026-10-05)

The operator chose the reusable production path over one-off previews. This slice implements N2/N3 prerequisites and a minimal hunt staging beat, rather than declaring the complete N1 choreography finished.

- Automatic preparation and completed-game repairs share a canonical scene inventory and location/reference planner. Village, pack and hunt use the approved round table, built-in cellar seats and moonlit lane. Introductions remain individual reveals.
- Wolf derivatives retain the frozen original reference, art revision, generation identity and verified head. They are reused across scenes. Producer's **Regenerate wolf forms too** creates a new generation; ordinary regeneration keeps the selected forms. **Wolf forms used** exposes the candidate references. Queued jobs remain immutable; resolved references are stored on candidate versions. The original cast is never rewritten.
- A lone wolf prepares its form before targeting without creating a meeting scene. Resolved attacks add hunt scenes even without a pack conversation. A protected target uses the same distant, nonviolent composition; no target means no hunt. Restart immediately after a committed night resolution recovers scene preparation.
- Omniscient gets five-second doctor, seer and hunt stops (when those choices exist), followed by the canonical outcome. Doctor/seer beats use existing rectangular character art and recorded actions; they need no generated scene. Seer results show only wolf/not-wolf, including when the Seer dies that night. Self-protection and no-agreement nights are covered. Arrows and slider use the same expansion. Mystery receives none of the private action stops or hunt image access. Existing publications remain unchanged by repair until explicit publication.
- Hazy-ruby-sand inventory verified locally: Larry/Marlow pack; day-one hunt with Marnie; day-two Marlow/Marnie hunt; two living-cast village scenes. No paid generation or replacement publication has run in this slice.

**Validation (2026-10-05):** `bun run test`: 2,273 passed, five skipped. `bun run test:postgres`: 1,878 passed against a fresh disposable database. `bun run check` and `git diff --check` passed. The existing Werewolf browser suite passed 14 journeys; the added hunt/outcome journey passed with seven assertions, including mobile and Mystery isolation. A rerun exposed test setup racing replay-index hydration; the seek helper now waits for the loaded index. Another passing journey timed out in browser teardown; a fresh run completed cleanly. Real provider image quality, publication on Hazy and physical-device behavior are not proven by these tests.

**Doctor/Seer follow-up validation:** 2,281 provider-free tests passed (five skipped), all 1,878 PostgreSQL tests passed, and typecheck/lint/diff checks passed. The focused browser journey passed 15 assertions for self-protection, investigation results, mobile fit, arrow/slider equivalence, paused seeking and Mystery response filtering. Hazy was also checked directly: Veyra protects Marnie; Kaiya investigates Veyra and sees “Not a werewolf,” with the correct original full-body art. No paid generation was needed.

**Doctor-save follow-up:** The Omniscient hunt panel explicitly names the saved target and shows a framed Doctor portrait, using the recorded attack, protection and no-death outcome. The card works with generated hunt scenes or original-art fallback. Other protection choices are not called saves. Validation: 2,285 provider-free tests passed (five skipped), typecheck/lint/diff checks passed, and the focused browser journey passed 18 assertions including mobile fit and Mystery exclusion. Direct Hazy playback confirmed Marnie’s save and Veyra’s Doctor portrait. Backend code was unchanged in this follow-up; the preceding 1,878-test PostgreSQL baseline remains the backend proof.

**Still open:** the dramatic deterministic transformation, elimination slash and richer outcome choreography; using published individual wolf forms in no-composite playback; concrete generated wolf/scene acceptance; audio/device checks. The basic fallback currently uses original rectangular character art with pack/target labels. This is not W6 completion.

## Current implementation, verified 2026-10-05

| Seam | Current behavior | W6 change |
|---|---|---|
| Engine events and audience projection | `werewolf.pack_vote_resolved` and `werewolf.night_resolved` record decisions. The night result has attack target, protected target, killed player and investigation. Mystery's night entry omits private fields. | Derive presentation from these facts and the exact preceding cast; do not add gameplay decisions or parse dialogue. |
| Watch projection and player | Pack speeches, ballots and a single dawn summary already play. Phase entries are not independently playable. Day votes demonstrate multiple presentation stops at one source cursor. | Add typed night presentation steps and consistent playback-index counts, while retaining source cursors and the House director. |
| Automatic visuals | `werewolf-visual-runtime.ts` prepares `pack_talk`, `open_thread` and `discuss`; generic `mingle-1`/`lobby` plans use original frozen characters. | Prepare wolf references and explicit pack/hunt purposes, plus a resolved-night boundary that also works for one wolf with no pack talk. |
| Producer inventory | `werewolf-production.ts` discovers dialogue scenes from accepted actions. Shared missing-scene rendering, version comparison, repair and publication already exist. | Inventory wolf forms and night compositions from canonical history, including completed games; keep the legacy panel changes small. |
| Media binding | `werewolf-presentation.ts` binds published versions using boundary, room and exact cast, with cursor/audience-scoped media access. | Include scene purpose and selected variant versions; cast/room alone must not select the wrong night art. |
| Composition | Shared renderer retains verified panels and attempts verified harmonization; scene mounts persist across speakers. | Reuse both behaviors. Failed composites cannot discard usable panels. |
| Music | The shared controller exists. `werewolf-music.ts` currently maps pack entries to Wolves at the Festival; night/dawn are silent. | Preserve transport and existing mapping until listening review selects a change. Do not treat pack mapping as approval of hunt/dawn music. |

The old brainstorm's remount, harmonization and Nano diagnosis describes earlier code. Those are not new W6 prerequisites. Gameplay's baseline remains `gpt-6-luna`; it is not an image-model choice.

## Product decisions

- Keep `/games/[slug]`, the House watch shell, existing controls, device preferences, thinking settings, transcripts and source links. Werewolf supplies facts, scene direction and choreography; House owns transport and rendering primitives.
- Individual introductions remain individual reveals. No generated full-roster intro. Day discussion uses its actual living roster: a doctor save may leave the full cast together, but a night transition is not itself a reason to render another lobby.
- Existing opaque full-body art stays an intact rectangle. No assumed cutouts, background removal or literal walking animation. Use surrounding dark stage art, framed portraits, camera motion and restrained dissolves.
- For generated wolf forms, preserve recognizable clothes, colors, silhouette and accessories. Retain each source character’s rendering style, including anime, illustration and stylized 3D; do not force nonrealistic characters into photorealism. Keep original character art unchanged. Use a drawn-out, bouncy transformation with deterministic discrete switches between the original and wolf images, as specified below. Anatomical morphing and generated video are out of scope.
- Pack meetings use a dark rustic village location, cold stone, rough timber and restrained moonlight. The daytime round table, [v2 masonry-seat pack cellar](../../.renders/werewolf-art/lantern-village-night-v2/pack-cellar.png), and [v1 moonlit hunt alleyway](../../.renders/werewolf-art/lantern-village-night-v1/moonlit-lane.png) are selected. The cellar uses worn stone seats integrated into the walls and a low stone slab, not the rejected freestanding wooden chairs. Concrete wolf forms and populated compositions still need visual review.
- Generated characters must remain identifiable and face the camera sufficiently for localization. Position characters in a hunt to imply direction without requiring rear-only or obscured faces.
- One living wolf skips the meeting. Two living wolves show actual accepted pack dialogue, in order. Do not invent speech, repeat a full transformation for each line, or imply agreement before its canonical ballot.
- Only a confirmed death gets a brief graphic white/red claw accent. No blood, injury imagery, flashing sequence or lethal effect on a doctor save. Reduced motion uses a static accent/dissolve.
- Seer results remain readable in the permitted night details. Doctor/Seer choices now receive simple original-art action beats by operator request. Dedicated transformations or generated action cinematics remain outside W6.

## Transformation treatment

The transformation fights back and forth before settling. Use the two finished images, retaining their complete opaque rectangles. Aim for roughly three seconds per character, with a strong spring-like scale/position bounce and discrete image switches rather than a continuous crossfade. Tune the concrete timing in the visual review packet.

| Portion | Image-switch pattern | Movement |
|---|---|---|
| Early | Mostly human; occasional short wolf interruptions | Small anticipatory compression and elastic rebounds |
| Middle | Wolf appearances lengthen while human reversions shorten | More pronounced bouncy overshoot, contained within the character's reserved frame |
| Late | Mostly wolf; two brief human reversions before the final wolf hold | A pronounced settling bounce, then a stable wolf image |

Use a fixed periodic switch schedule whose wolf duty cycle increases across the beat. Specify the intervals and easing curves explicitly; do not choose random switches during rendering. Keep overall brightness steady and avoid strobe-like rapid alternation. The effect should read as an unstable transformation, not a white-flash transition.

For two wolves, stagger their starts slightly within one shared transformation beat. Begin pack speech only after both settle, so the effect does not compete with reading. Each character transforms once at its first eligible pack appearance in the canonical presentation sequence, not once per line or night. A lone wolf transforms immediately before its first resolved hunt; if no target exists, do not invent a hunt solely to show the effect.

Derive image selection, bounce and stagger from the shared director's elapsed time. Pause freezes the exact pose; speed changes follow the presentation clock; frame sampling is repeatable. Scrubbing directly into dialogue or a hunt shows the settled form without retriggering the effect. Seeking within the transformation samples the exact scheduled state, while rewinding and playing through its original boundary plays it again. Do not use component mount effects, session-level “already transformed” flags or independent timers to decide whether it runs. Keep the whole transformation in one establishing beat; individual glitches are not extra arrow/slider stops.

Reduced motion replaces the switches and bounce with a short dissolve into the settled wolf form. Wait for both images through existing bounded media readiness before beginning; a missing or failed wolf form uses the original-art wolf treatment and skips the transformation. Late asset arrival must not trigger a transformation in the middle of speech. A producer-selected replacement follows the existing publication-cutoff rules.

## Audience sequence and state

| Accepted situation | Omniscient | Mystery |
|---|---|---|
| Night begins, result pending | Brief shared atmospheric transition; existing truthful waiting state when no next entry is available. | Same public transition/wait. No wolf silhouettes, names, counts or identifying music changes. |
| Two living wolves negotiate | Establish the pack once, then accepted dialogue with shared speech/thinking behavior. Retain the scene between speakers and ballot attempts. | No pack entries or assets. |
| One living wolf | No meeting or artificial negotiation. Preserve its accepted target decision for inspection; proceed to the resolved hunt when available. | No private decision. |
| Pack ballot fails, attempts remain | Existing factual no-agreement result, then the next actual dialogue/ballot. No hunt yet. | No private decision. |
| Resolved night kills a target | Wolves and distant target → brief claw accent → dawn outcome. | Atmospheric night → public dawn victim. No identified wolves, attack tableau or private target before dawn. |
| Resolved attack is protected | Wolves and distant target → nonlethal survival treatment → dawn, with recorded protection readable in permitted details. | “Everyone survived the night.” Do not disclose who was protected or why nobody died. |
| No agreed target | Skip hunt and target art; resolve to dawn with the factual reason in permitted details. | Public survival result only. |
| Other recorded no-death result | Render the recorded facts; do not label it a doctor save unless attack target equals protected target and nobody was killed. | Public survival result only. |

For a lone wolf, omit the standalone pack-consensus playback card as well as the meeting; retain its accepted decision in canonical history and permitted inspection. This is a presentation-only skip, and its source position remains accounted for by the shared watch cursor.

Keep public transitions short and presentational, not synthetic House speech. Attach the establishing transition to the first playable night contribution/outcome; do not turn every silent phase entry into another navigable card. At a live frontier, never invent a future target or outcome just to fill time.

Night outcome steps are subcues of the accepted night source position, not new canonical events. Their stable keys include game, audience, source cursor and step. Use one deterministic step descriptor to drive both `playback.steps` and client expansion, as with ballots. Arrows and slider visit the same meaningful stops: hunt where permitted, resolved outcome, dawn. The slash is a short transition inside the outcome step, not an empty stop of its own. Direct seeking lands on a readable state without replaying the slash. Scene/chapter navigation can skip the whole sequence; sharing retains the canonical source cursor.

The preceding canonical snapshot supplies the living pack and target staging. Keep the victim visibly alive in the stage, cast rail and inspector until the outcome is presented; then expose the accepted after-state. This is a presentation boundary, not a game-state mutation. Apply the same rule to rewind, late joins, bounded windows and direct links. Do not let a prefetched post-night snapshot reveal death early. A game-ending night completes its outcome before the faction ending and victory score.

## Implementation boundaries

### N1 — canonical night descriptors and no-generated-image choreography

Extend the Werewolf watch contract/projection with only the typed staging facts needed for the sequence. Construct them server-side from the exact accepted prefix; exclude private values before serializing Mystery responses. Keep browser DTOs free of server/provider imports. Prefer a small Werewolf-owned discriminated descriptor over a universal cinematic scripting system.

Use frozen original rectangular art for wolf and target cards, with a clear wolf treatment only in Omniscient. Arrange one or two wolves apart from the target against a dark stage. Show who is speaking during pack dialogue. Long speech and thoughts must fit without obscuring faces; retain measured bubble fitting and head-directed thought trails. A failed image resolves to a named portrait/card instead of an empty frame.

Reuse `werewolf-watch-stage.tsx`, `werewolf-watch-model.ts`, shared scene/solo composition and director elapsed time. No second timer, HTML video, narration model or independent audio element. Pausing freezes all animation; seeks preserve play intent; changing speed changes presentation time without pitching the music. Resizing, thinking toggles and publication refresh cannot remount/restart a conversation or flash a full-size body between fitted states.

**Acceptance:** deterministic one-wolf, two-wolf, death, save and no-agreement fixtures play and scrub completely without generated scenes. Mystery never receives private staging. Existing Influence vote/dialogue playback still works.

### N2 — match-frozen wolf-form assets

In Visual Mode, prepare one reusable form for every wolf, including a lone wolf, independently of pack-dialogue requests. Only meeting-scene generation requires two living wolves; hunt scenes support one or two.

Represent a wolf form as a versioned derived asset associated with this match/player and its frozen reference. Persist source artifact/hash, purpose, art-direction revision, selected generated version, review outcome and newly measured head rectangle. Human reference coordinates are invalid for a transformed head. Never overwrite `visualGameAssets.cast` originals or an editable/shared profile with a wolf version.

Use existing artifact storage, render-attempt accounting, provider journal and media version/publication services. Inspect their scene assumptions first; add the smallest explicit derived-reference record/operation where required. Do not disguise a character derivative as a dialogue scene or build a parallel job system. If a schema addition is required, make its ownership and deletion relationships explicit in the implementation; do not add historical compatibility parsing or silently backfill games with paid work.

Reuse is keyed by game/player, frozen reference, selected art direction and version. One successful form is reused across speeches and nights. Concurrent/restarted preparation must converge on a persisted identity and avoid duplicate paid calls. Invalid/unverified forms remain failed candidates; they cannot silently become production references. Missing or failed forms retain the complete original-art choreography.

Wolf-form selection changes affect newly prepared/regenerated compositions, not already published pixels. Producer UI identifies compositions made from older variant versions and allows explicit regeneration. No automatic cascade of paid jobs when a form is changed.

**Acceptance:** two distinct characters retain identity in reviewed wolf forms; transformed heads localize correctly; missing reference, failed verification, restart and concurrent preparation retain honest evidence and usable fallback.

### N3 — pack and hunt production through House services

Add explicit Werewolf scene purposes for pack meeting and resolved hunt. Purpose, boundary, participant IDs, reference versions and art-direction revision participate in planning hashes, reuse and publication binding. A generic room alias cannot be the authority for privacy or scene meaning. Keep Werewolf cast/outcome decisions outside the shared renderer; extend shared visual contracts only for the required composition inputs.

- **Pack:** compose the living wolves in selected form versions at a dark meeting location. Reuse the composition while that cast and selected references remain unchanged. Keep dialogue, ballots and thoughts as overlays, not generated pixels.
- **Hunt:** compose one/two wolves and the accepted attack target, separated in a rustic alley. Use the pre-outcome cast, even if the target dies. The same still can support lethal or protected resolution; the canonical overlay determines the outcome. No scene for a null target.
- **Prompt:** describe placement and atmosphere, not an attack: “A moonlit medieval village lane. Two recognizable anthropomorphic wolf characters stand at one edge, facing along the lane. A separate character is farther away, looking ahead or concerned. Wide separation, readable faces, cold stone and restrained lantern light.” Supply the actual participant count and references structurally; do not ask for wounds, physical contact or an assault.
- **Verification:** every required participant must be accounted for by verified shots or explicit portrait fallback. Use the shared multi-panel path where needed, attempt harmonization under existing policy, and preserve verified originals if it fails. Transformed references must not be falsely rejected merely for differing from human portraits; identity checks use approved variant provenance plus scene localization.

Automatic preparation must cover a committed `werewolf.night_resolved` boundary, not just requests for dialogue. Establish that trigger in the Werewolf execution service and use the same deterministic descriptor as completed-game producer inventory. Fence scene writes/publications by the current owner and exact boundary; retry/restart cannot alter events, repeat accepted model decisions or duplicate publication. Rendering failure uses current best-effort behavior with recorded diagnostics and cost. W7's durable require-visuals pause remains separate.

Producer discovery includes missing forms, pack compositions and hunt scenes even for completed games created before W6. Extend existing preview/render/correct/regenerate/version/publish actions; no candidate-swap dashboard or full studio redesign. Automatic generation and explicit producer regeneration use identical direction/reference resolution. Keep all panels and optional composite inspectable. Existing published imagery remains until an explicit repair/publication or new scene preparation selects a version.

**Acceptance:** automatic preparation and producer repair create equivalent scene plans for the same evidence, including a lone-wolf night. Canceled/stale owners cannot publish. A failed form or scene leaves the game watchable and its failure inspectable.

### N4 — audience-safe delivery and publication

Treat wolf forms and hunt art as Omniscient-only assets, regardless of any shared publication row's existing `public` label. That label currently denotes viewer publication, not proof of Mystery safety. Enforce permission using the requested game, audience, source position, scene purpose and frozen publication cutoff at both DTO binding and direct media-byte reads.

Do not put wolf variants into ordinary character URLs, public player identity, Mystery media dictionaries, anonymous previews, card backgrounds or W5 teaser manifests. Changing an asset ID, cursor, audience query or game ID must not bypass binding. Omniscient is an intentionally selectable spectator audience, not an account privilege; preserve current access policy while ensuring a Mystery request never receives private evidence. Completion alone must not replace an earlier Mystery replay frame with later role knowledge.

Use the selected published version as of the watch session's cutoff. A repair becomes visible in a fresh session; it cannot swap a character form under a currently speaking player. Unpublished candidates and annotated/provenance assets remain producer-only.

**Acceptance:** response and byte-level tests prove no pack/target/protection leakage in Mystery, no cross-game assets and no unpublished or future-version delivery. Pack scenes remain available in Omniscient.

### N5 — art, sound and operator acceptance

Build a concrete review packet with no-image desktop/mobile captures, two contrasting wolf forms, the staggered transformation and its reduced-motion alternative, a two-wolf meeting, one- and two-wolf hunt framing, death and protected outcomes, and reduced-motion behavior. Include render count, realized costs and failures. Use synthetic fixtures for coverage when recent games do not contain every result; do not fabricate missing history in a real game.

The daytime round table, rectangular reveal treatment, v2 pack cellar and v1 hunt alleyway have been selected. Use these approved backgrounds as the night direction; do not reopen their selection. Obtain operator selection of concrete wolf-form samples and review populated compositions and transformation playback before making the complete treatment the automatic default. Use the same existing automatic publication policy after that direction is approved; do not introduce mandatory human approval for every night's scene.

Audition night/dawn transitions using the existing shared music transport. Existing pack music is a starting point, not a mandate to reuse a victory theme everywhere. Silence is a valid first-release choice. Record the chosen mapping explicitly; new tracks require a separate music session or operator-supplied Suno source. No new music generation is required to finish N1–N4. Preserve saved mute/volume, autoplay restrictions, speaker continuity, pause/seek, loops and natural victory endings. Public Mystery sound must not encode whether the hidden night was a save or failed agreement before dawn.

Before any paid image trial, present the exact references/purposes, model/quality, maximum render/retry count and a total cost cap for authorization. Earlier Cuts budgets and trailer approval do not authorize new image work. User-approved samples do not authorize replacing existing published games or deploying the feature.

## Delivery order

| Checkpoint | Deliverable | Exit evidence |
|---|---|---|
| W6-01 | N1 plus the necessary audience contract tests from N4 | Complete no-image night journey, consistent scrub stops, no spoilers, desktop/mobile/reduced motion |
| W6-02 | N2 derived assets and small producer controls | Versioned forms, correct localization, honest fallback and restart-safe generation with mocked providers |
| W6-03 | N3 automatic/completed-game scene preparation and full N4 binding | Shared render/repair/publication path, owner fencing, all panels, audience and byte-level proof |
| W6-04 | N5 concrete art/sound review and final integration evidence | Operator-selected night direction; approved bounded image trial if requested; sound mapping and device limits recorded |

Each checkpoint leaves a usable player. Review contracts and persistence before starting image generation; report a pipeline limitation as a concrete operator decision rather than building speculative infrastructure. Keep changes separable from W7 visibility/history/require-visuals work and A2 studio reorganization. No rollout flag is needed; deployment is the gate.

## Verification

- **Provider-free engine/projection:** one and two wolves; pack changes across nights; multiple failed agreement attempts then success; attempt limit; killed/protected/null-target results; seer present/absent; zero private fields in Mystery; no inference from prose; before/after cast and faction ending order. Validate every new structured generation/review contract with malformed, missing, extra-field and exhausted-retry cases.
- **Player:** arrows and slider visit identical night stops; readable direct seek; no standalone slash/blank frame; stable speaker mounts; deterministic transformation samples across early/middle/late switches, stagger and final hold; pause/resume and seek without accidental retrigger; reduced-motion dissolve and missing-form skip; portrait/fullbody/missing-art fallbacks; long names, long thoughts and dialogue; 320px, portrait, wide and fullscreen; paused/playing seeks; delayed media/thinking; reduced motion; live frontier and late join; rewind before death; bounded window eviction/refetch; audience switch; frozen publication session.
- **PostgreSQL services:** use `setupTestDB()` or the existing isolated harness. Verify persisted reuse, transformed-reference provenance, exact-cast/purpose matching, owner loss/cancellation, publication idempotency, failed/uncertain render attempts and costs, stale preview rejection, successful regeneration, no hidden-game access and media allowlists. Completed-game inventory must expose night jobs without replaying gameplay.
- **Browser:** deterministic one-wolf and two-wolf journeys for both audiences, save/no-agreement/death, published scene and no-image modes, producer repair → new-session playback. Inspect network bodies and direct image access as well as screenshots. Preserve Influence camera, vote and music-silent behavior.
- **Listening/device:** night transitions, pack continuity, pause/resume, loop seams and victory handoff with real decoded audio; physical Safari/iOS and touch/lock tests where available. Desktop emulation is not device proof.
- **Required checks:** `bun run test`, `bun run test:postgres`, `bun run check`, classified focused browser journeys and `git diff --check`. Paid providers, external writes and deployment remain separately authorized. Document-only planning needs link/frontmatter/diff checks, not these implementation suites.

Record completion and proof limits in this plan and the pillar. Update `docs/werewolf.md`, production operating guidance and `docs/solutions/` with the reusable lesson: House owns media lifecycle/transport; a game module owns scene facts, audience disclosure and outcome staging. Update `CONCEPTS.md` only for newly introduced shared vocabulary. No claim of W6 completion based solely on mock images or unit tests.

## Explicitly outside W6

Gameplay/balance changes, additional roles, new strategy or review calls, generated dialogue, a universal cutscene engine, anatomical morph/video generation, transparent character extraction, per-scene mandatory human moderation, a new producer application, W7 require-visuals recovery, broad daytime art rollout, new public trailer spoiler policy, and production deployment. Dedicated dawn music and Doctor/Seer cinematics can be recorded as deferred without blocking a complete night experience.
