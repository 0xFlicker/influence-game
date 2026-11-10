---
title: Replay audience switching, watch entry points, and page advancement
type: feat
status: in-progress
date: 2026-11-09
---

# Replay audience switching, watch entry points, and page advancement

## Objective and authority

Make Werewolf Omniscient playback easy to enter and switch to without losing the current position. Make the existing click/tap advance gesture move through every page of a thought or spoken message before leaving that content. Page advancement applies to both Werewolf and Influence.

The user authorized implementation on 2026-11-09. This does not authorize merging, deployment, paid games, or regeneration of accepted history or media.

The user has specified:

- Use a compact viewing-mode control. Do not put explanations of roles, pack conversations, and night decisions in the viewer control.
- Give Mystery and Omniscient equal visual priority. Entry actions adapt from `Watch Mystery` / `Watch Omniscient` to `Mystery` / `Omniscient`, then to a dropdown as space requires. Do not make Mystery the primary action.
- Switching modes is silent: no success toast, nearest-moment message, confirmation dialog, or tutorial.
- Preserve the current cue and position where both audiences have the corresponding content.
- If an Omniscient-only moment has no Mystery equivalent, use the nearest preceding playable Mystery moment. Do not explain the move with a message.
- A click/tap on multipage thinking or speech advances one page, rather than discarding the remaining pages and moving to the next player.
- Keep the chosen mode when switching between games on the same season page.

The entry-point layouts and detailed edge-case policies below guide the implementation. The user resolved the season-page mode preference in section 10.

## 1. Evidence and current ownership

| Finding | Current owner | Consequence |
| --- | --- | --- |
| Grid Watch links explicitly select Mystery | `packages/web/src/app/games/episode-preview.tsx`, `EpisodeCard` | Omniscient is absent from the immediate watch action, including the mobile card dialog. |
| Entry and Results offer Watch Mystery as primary and Watch Omniscient as secondary | `packages/web/src/components/games/werewolf/werewolf-entry.tsx`, `werewolf-results.tsx` | Omniscient is reachable, but requires discovering the detail page. |
| Running viewer has a mode label, not a mode switch | `packages/web/src/components/games/werewolf/werewolf-viewer.tsx` | A Mystery viewer cannot change audience within takeover/theater/fullscreen. Embedded viewers omit these standalone settings entirely. |
| Season and championship mount keys include audience | `packages/web/src/app/seasons/season-watch.tsx`, `packages/web/src/app/events/championship-view.tsx` | Changing the outside dropdown creates a new player and starts over. |
| Viewer and nested session also use audience-dependent mount keys | `werewolf-entry.tsx`, `werewolf-viewer.tsx` | Removing only the season/championship key will not solve the reset. |
| Watch hook assumes one mounted game/audience | `packages/web/src/components/games/werewolf/use-werewolf-watch.ts` | Changing the argument alone re-runs initial seek while leaving refs that were designed for a fixed audience. A deliberate transition is required. |
| Cursors count audience-visible entries; cue keys include audience | `packages/engine/src/werewolf/watch.ts`, `packages/web/src/components/games/werewolf/werewolf-watch-model.ts` | Equal cursor numbers, step indexes, or slider percentages cannot identify the same source moment across modes. |
| Canonical provenance is available internally | `walkWerewolfHistory` and `projectWerewolfProductionProvenance` in engine `werewolf/watch.ts` | The server can map through accepted event identity without putting canonical sequences or hidden gaps in public watch DTOs. |
| Watch reads filter the accepted event prefix by audio readiness and bind media at a publication cutoff | `packages/api/src/services/werewolf-presentation.ts`, `readWerewolfWatch` | The switch resolver must use the same authority and readiness boundary, rather than an unrestricted event read. The publication cutoff pins media; it is not an event-history cutoff. |
| `manualAdvance()` knows thought/speech entrance, reading, and exit boundaries but not text pages | `packages/web/src/components/watch/watch-director.ts` | Once reading starts, a click can jump directly to the content exit and skip unread pages. |
| Measured text pages are selected from playback progress | `packages/web/src/app/games/[slug]/components/timed-speech.tsx`, `speech-pages.ts`; shared `SpeechBubble`, `ThoughtBubble`, `HouseMessage` | The rendered page depends on text, actual geometry, and its content clock. Transport needs those page boundaries, not a guessed page count. |
| Voice follows the director, with separate speech/thinking offsets | `packages/web/src/components/watch/use-watch-voice.ts` | A page advance must move the shared clock so sound and text follow the same seek. |
| Published generated audio exposes duration, not word alignment | `packages/engine/src/audio-track.ts` | Do not promise word-exact page seeks or invent alignment for those recordings. Imported aligned speech has a separate existing alignment path. |
| Studio uses Remotion Player and frame/moment controls | `packages/web/src/app/admin/production/production-preview.tsx` | Viewer interaction and Studio editorial commands are different chrome. Their pictures must still agree at the same source position and settings. |

Planning research included a visual inspection of the deployed championship page, where the Mystery/Omniscient dropdown was below the player, separate from transport. The table records the pre-implementation behavior. Implementation and validation are tracked below; production was not changed by that research.

## 2. Player mode control

### Visible treatment

- In the running Werewolf transport, show equal-weight `Mystery` and `Omniscient` choices when both fit; mark only the currently active mode as selected. These are mode switches, so their running-player labels do not need the `Watch` prefix.
- When both choices no longer fit, collapse to a dropdown labeled with the current mode: `Mystery ▾` or `Omniscient ▾`. Use only `Mystery` and `Omniscient` inside the menu, with the active choice marked.
- No descriptions, tooltip tutorial, extra confirmation, or success/movement notification.
- Keep the mode control accessible in standalone, contained season/championship, embed, theater, and native fullscreen players.
- Give the mode label priority over inline speed options and Show thinking when width is tight. Move those secondary controls into existing settings as needed. At supported narrow sizes, keep the mode name readable and the control tappable; do not truncate it or create a scrolling control strip.
- Preserve Show thinking as an independent Omniscient preference. Mystery hides that control and never requests thinking. Entering Mystery must not overwrite the saved thinking preference.
- Use the existing styling, accessible control patterns, and Floating UI support. The mode menu must mount inside the active fullscreen/theater root, retain keyboard focus, dismiss on Escape/outside interaction, and not advance playback when selected.
- Opening the menu does not itself change playback state or position. Selecting a different audience freezes at the current position for the transition. Selecting the current audience is a no-op.
- Use the existing Preparing/error treatment if loading takes time or fails. No new success or explanatory overlay is introduced.

## 3. Games and season entry points

### Games grid and its mobile dialog

Replace the Werewolf card's single Mystery-only Watch link with two equal-priority watch actions that adapt to their actual available width:

| Available space | Entry control |
| --- | --- |
| Both full labels fit | `Watch Mystery` and `Watch Omniscient` |
| Only the short labels fit | `Mystery` and `Omniscient` |
| Both short labels no longer fit | Neutral `Watch ▾` dropdown with `Mystery` and `Omniscient` |

- Match treatment, text size, touch target, and emphasis between the two actions. Neither is primary/secondary, preselected, or styled as recommended. Do not use a Mystery-primary split button.
- Both destinations are actual typed links, including dropdown menu rows. Modified click, copy link, and open in new tab must retain the chosen audience.
- Keep the existing Live/Replay status visible so the watch action need not carry another long label.
- Use the same action in the touch/mobile card dialog. Do not require Details or the trailer to finish before choosing Omniscient.
- Keep Details available independently. Preserve card artwork/title navigation and existing trailer interactions; do not make a menu click trigger the surrounding card link.
- Apply through the shared `EpisodeCard` consumers, including the season-filtered games grid. Influence cards retain their game-specific watch action.
- Choose the layout from the action area's available width, accounting for Details and other real neighboring actions. Prefer existing responsive/container facilities; use shared thresholds only where they prove both labels fit. Do not shorten early based only on global viewport width, wrap the labels awkwardly, truncate a mode name, or retain a hidden primary/default action behind the dropdown.

The user prefers Omniscient and explicitly rejected elevating Mystery. Equal-priority access, rather than replacing one privileged mode with another, is the entry-point contract.

### Season and championship watch rooms

- Before playback, use the same responsive equal-priority watch actions on the poster. Choosing either action starts that audience directly. At the narrowest size, `Watch ▾` opens the two-choice menu; opening it alone does not start playback.
- If a large central Play affordance remains on a Werewolf poster before a mode is chosen, it opens the same neutral watch-choice menu rather than silently starting Mystery. An explicit audience link or retained choice for the same game can start its known audience directly.
- After playback starts, the mounted viewer's transport owns the control. Remove the duplicate dropdown below the picture. Keep the existing close-player and surrounding caption functions where applicable.
- The poster hands the chosen audience to the viewer as its initial audience. If the host needs to remember it when closing and reopening the same game, use a controlled callback from the viewer. Do not leave two independent active audience states or two switches.
- Keep a player mounted by game identity, not game plus audience. Opening another game remains a distinct session.
- Preserve lazy player loading: opening the watch-choice dropdown must not fetch watch windows, private thinking, or media. Selecting a named watch action is the explicit play action.
- Episode/match selection must not quietly launch Mystery as the privileged default. An explicit watch action starts its named audience; otherwise show the neutral watch choices. Retain the chosen mode across games as specified in section 10.

### Existing game entry and other links

- Give the explicit Mystery/Omniscient entry and Results watch links the same equal treatment and responsive labels. Remove the current Mystery-primary/Omniscient-secondary hierarchy there as well; preserve Results and other unrelated actions independently.
- Remove the player entry copy claiming that the viewing mode stays fixed.
- Replay URLs without an audience can keep the existing choice page; a running replay switch does not require going through it.
- Do not broaden this work into House Cuts audience navigation, global watch-history synchronization, a default-mode account setting, or homepage redesign.

## 4. Position-preserving audience transition

### Position model

Capture a semantic playback anchor, not a total movie timestamp:

1. Game identity, current audience, and pinned publication cutoff.
2. Opening shot identity, or validated audience-local source cursor and semantic cue part.
3. Current content phase: entrance, thinking, speech/outcome/ballot subpart, or exit.
4. Position within that phase, distinguishing text-reading time and recording offset from optional thinking duration and audience-specific lead-in animation.
5. Play/pause intent, follow-live/tail state, speed, audio controls, and expanded-player state.

Semantic cue parts include public speech, the dawn outcome, a particular historical ballot reveal, tally, private night decision/action, and presentation-only final-result reprise. Do not use an integer step as a cross-audience identity: adding private night steps shifts the public outcome's step index. Do not recover any identity from spoken prose.

For corresponding content, restore the same local content/recording position. A thought inserted before speech or a wolf transformation lead-in must not make the speech restart. The total timeline time and slider percentage may change when the audience's timeline changes.

### Resolver

Add one small read-only audience-position resolver beside the existing Werewolf watch service, with its contract in the game-owned watch types. A route such as `GET /api/werewolf/:id/watch-position` is sufficient; finalize its name with the implementation's route conventions.

- Accept the source and destination audiences, the source audience-local cursor and validated semantic part (or opening shot identity), and the existing publication cutoff. Keep local visual/audio phase restoration in the player where the measured layout and recording timing are available.
- Validate that the source cursor/part really exists for that game and audience. Reject invalid identities and malformed inputs clearly; do not clamp an invalid private part onto arbitrary content.
- Reuse the same visibility/access checks, audio-ready accepted prefix, version-specific reducers, retrospective presentation, and publication/media binding authority as `readWerewolfWatch`.
- Join source and destination through accepted event identity internally. Return only the destination audience-local coordinate and permitted cue part. Do not serialize reducer state, canonical sequence numbers, private action counts, or a map of hidden events.
- A read can map to an earlier valid public point without reading or returning the later unrestricted game head. No durable game or playback record needs to be mutated.
- Reuse the existing bounded watch-window reads to load the destination. Avoid a new full-history client download or a persistent cross-audience navigation table.
- Apply existing private/no-store handling and normal access-revocation behavior.

### Mapping rules

| Source position | Destination |
| --- | --- |
| Shared opening/title/cast/door shot | Same opening shot/player and its local time; regenerate the opening's audience-projected role display from permitted source data. |
| Shared public speech, introduction, ballot, tally, result, or retrospective | Same accepted source event and semantic cue part, then restore corresponding content/recording time. |
| Mystery dawn outcome to Omniscient | The same dawn outcome, not the first private night-action substep that precedes it. Earlier private steps become available to rewind to, but do not play automatically on the switch. |
| Omniscient-only pack proposal, conversation, or private night decision/action to Mystery | Nearest preceding Mystery-playable source moment, landed at its normal readable/content point. No message. A private substep expanded from a night-resolution event must not jump forward to the public dawn outcome merely because they share an event. |
| Omniscient thinking over otherwise public speech to Mystery | The corresponding public speech at its readable beginning. Do not transfer private thought timing into Mystery. |
| Omniscient thinking over private-only content to Mystery | Use the private-only preceding-moment rule. |
| No preceding playable Mystery moment | Opening at its normal initial position. This is a valid beginning-of-game case, not a reason to choose a later revealing event. |
| Final-result reprise after completed retrospective | Preserve the presentation-only reprise; do not confuse it with the last retrospective speaker or an unfinished retrospective. |
| Silent hold/live tail | Preserve the same accepted visible boundary and whether the player is following or paused. Newly visible permitted content can then follow under the normal live scheduler. Never use the other audience's latest cursor or Latest/Go live implicitly. |

Returning to Omniscient after moving to an earlier Mystery point maps from the current Mystery position. It does not resurrect a hidden private bookmark from the earlier switch.

### Transition lifecycle and cancellation

1. Snapshot the active anchor and user intent; freeze the shared clock at that position. Suspend outgoing voice/music and abort old audience requests.
2. Increment a game/audience operation generation. Fence watch windows, prefetch, thinking, decisions/transcript, image-readiness callbacks, recording metadata, and follow-position publication against it.
3. Keep the fullscreen/theater container and control state mounted. Clear or mask outgoing audience-sensitive content before the destination label/frame is committed. In particular, never display an old pack image, role tag, transcript, inspector choice, or thinking overlay under Mystery controls.
4. Resolve the destination and prepare its audience-safe windows, opening data, active scene, timing, and recordings using the same media cutoff. Preserve the existing bounded-window cache discipline; do not append old and new audience windows together.
5. Commit audience, active snapshot, cue, inspector data, and mapped time together. Rebind audio before resuming. Keep selected player identity only if still valid, with role/decision data derived anew from the destination prefix.
6. Resume only if the saved user intent was playing/following. Paused stays paused. Preserve master mute, voice mute/volume, music settings, speed, reduced motion, expanded view, and the saved Omniscient thinking choice.
7. On transient failure, retain/restore the original consistent audience and frozen position and expose the existing retry treatment. Never resume automatically after an actual access denial; clear inaccessible data using the existing authorization failure path.
8. A newer mode choice, seek, game change, or teardown supersedes the older operation. A slow response must not overwrite newer user intent or jump the player back after a successful later seek.

Refactor the existing viewer/session/hook ownership to support this deliberate transition. Removing mount keys alone, or changing the `audience` prop without resetting its audience-specific refs, is insufficient. Keep the existing director and clock; do not add a second playback-controller framework.

### URL, sharing, and analytics

- For standalone replay routes, replace the address with the destination audience and destination cursor/cue/local time without remounting the player or triggering its initial shared-link seek again.
- Treat initial replay-share hydration separately from subsequent in-session navigation. `useReplayShare` currently reads URL state for boot; the transition must not turn that boot state into a repeated initializer.
- Opening and reprise anchors retain their proper link shape. A private Omniscient cue must never remain paired with a Mystery audience query.
- Season/championship viewing stays on the season/event route, preserving its existing query and selected season. Share this moment still emits the standalone game link in the active audience and current position.
- Preserve unrelated query/attribution fields. Replace only the owned replay parameters.
- Keep current watch analytics coherent: a mode switch is one continuing game-viewing session, not a second game start or completion. Use existing instrumentation; no new analytics program is required for this work.

## 5. One-page click/tap advancement

### Behavior contract

| State when advance is requested | Result |
| --- | --- |
| Visible thought on page 1/6 through 5/6 | Show exactly the next thought page; same player, thought, and cue. |
| Visible speech/caption on page 1/6 through 5/6 | Show exactly the next speech page; same player/message/cue. |
| Final thought page | Use the existing thought-exit/return-to-speech progression. Do not discard the same player's speech. |
| Final speech page | Use existing hide/exit and next-content progression, including its established fades and holds. |
| Single-page content | Existing progression. |
| Content entering or exiting | Preserve existing reveal/fade handling; do not jump through unread pages or require a second page-specific control. |
| Player paused on a readable multipage message | Advance one page and remain paused at its readable start. |
| Player playing on a readable multipage message | Advance one page and continue automatically from that page's clock position. |
| Controls hidden where the existing first-tap rule applies | First tap reveals controls; the next advance tap follows the one-page rule. |
| Menu/button/slider interaction | Handle that control only; no page or cue advance. |

The same advance command serves click, tap, Enter, and ArrowRight in the viewer, retaining current keyboard exclusions for inputs, dialogs, focused sliders, and buttons. Space continues to control play/pause. Previous/Next scene buttons and bracket scene shortcuts keep their scene-navigation meaning. Left-arrow/backward paging is outside the requested change.

Automatic clock-driven pagination remains sufficient to watch the complete message without interaction. The user may accelerate it one page at a time. Add no pager buttons, click hints, success messages, mandatory manual paging, or scrolling.

### Shared page schedule

This is proposed behavior, not a description of the current director. Today the renderer measures and displays pages, while the director knows only the whole thought/speech timing. Close that information gap: supply the director with the actual measured page schedule so it can own page advancement on its existing clock.

- Use the actual `TimedSpeech` pages after typography/layout measurement or frozen layout/page preparation. The page list must be identical to the one rendering the text at that geometry.
- Share the forward page sampler and the inverse next-page-boundary calculation. For ordinary text, derive boundaries from the existing word-weighted `speechPageIndex` policy rather than equal time per page.
- Respect all three current inputs: normal text reading time, explicit progress used by House captions, and supplied recorded alignment used by supported imported speech. Make the page owner identify which mapping it uses.
- Convert content-local page starts through the actual thought/speech timing, recording duration, reading profile, and cue-specific offsets such as transformation lead-ins. Do not add a raw percentage directly to the whole cue duration.
- Supply the active cue/part's measured page boundaries to the director through a typed input. Layout owns measurement; the director owns advancement and playback position. Reuse existing sampled-stage/director plumbing where appropriate; no global pagination service or second clock.
- Scope registration to game, audience, cue, content part, and layout/timing revision. Only the actually active thought or speech owns advance. Hidden measurement probes, omitted selected-cut parts, background captions, and previous mounted actors cannot claim it.
- With those measured boundaries available, the director resolves its current page from its current playback time and seeks to the next page boundary. This uses the same page schedule as rendering; it does not estimate page boundaries from elapsed time or inspect the DOM. Do not maintain a separate React page counter for advancement.
- Recompute/invalidate on geometry, fonts, text, thinking timing, audio metadata, or frozen-layout changes. During incomplete measurement, do not fall through to skipping the whole message.
- At boundary timestamps, choose the first representable time/frame that actually samples the next page. A click must never remain on the old page due to rounding or jump across two pages due to inconsistent weighting.
- Keep page transitions seek-based and deterministic. Do not store a manual-only page index that diverges from the slider, audio, direct seek, or a freshly mounted renderer.

### Director and audio integration

- In `manualAdvance()`, check for an eligible next page after the existing entrance handling but before the current thought/speech hide/exit shortcut.
- Seek within the same cue to the next readable page. Preserve its identity, player/cast, scene and play/pause intent; do not replay entrance animation, transformation, opening, or speech already passed.
- Leave the existing end-of-content transition code as the owner after the last page. Keep its protections against interrupting a fade; do not impose a long debounce on ordinary page clicks.
- Handle one browser gesture once. Avoid duplicate touch/pointer/click handlers or bubbling from nested stage content. Test successive distinct taps, including while paused.
- Move the shared clock, then let voice/music follow the normal seek/alignment path. Reuse scrub/media alignment behavior to prevent the old speech continuing beneath the new page or duplicate audio players.
- Where imported word/span alignment exists, choose the next page's aligned start and validate page coverage with the existing alignment rules.
- For duration-only generated audio, retain the existing deterministic recorded-progress mapping. It synchronizes the visual page seek with the corresponding playback offset; it is not proof that the recording reaches the page's first word at that instant. Do not fabricate timestamps, regenerate audio, or add provider calls for this feature.
- Preserve mute, volume, buffering, audio-unlock, and paused-seek behavior. Muted playback still uses recording duration where the current contract does.
- Update the existing shortcut description to a concise accurate label, such as `Next page, then advance`.

### Interaction with audience switching

After advancing several pages, switching audience captures the resulting content position. For shared text, the destination restores that content/recording position and derives its page at the destination geometry. Do not rely on an obsolete source page number if layout differs because of role labels or viewport geometry. A resize may change page numbering while retaining the corresponding source position. Private thought/pack content follows section 4's silent mapping rules.

## 6. Viewer, Studio, and video parity

Follow `docs/presentation-parity.md` throughout implementation.

- Mode menus and page-click commands are player chrome. They are not encoded into movies or embedded in accepted game history.
- Studio Source and Selected cut keep their existing editorial frame/moment transport and audience-scope/draft safety. This plan does not turn an audience change into permission to retain private editor selections or silently translate a cut into another audience.
- The page schedule and rendering must agree across viewer, Studio Source, Studio Selected cut, offline prepared bundles, local exports, and the render worker at matching source moment, audience, geometry, profile, recording, and time.
- A viewer click changes the sampled time. Seek the actual Studio Player to the corresponding frame and prove the same page, context, and recording offset. A video still plays its complete automatic timeline; viewer clicks do not become editorial cuts in an MP4.
- Exercise independent thought-only and speech-only selections, omitted neighbors, public night outcome without preceding private steps, results/reprise, and historical missing art/publications. Do not leak omitted speech, private choices, or future cast state into retained context.
- Preserve automatic timing/readability and every required page. No scrollable player content, unreadable shrinkage, clipped required copy, or separate required manual paging UI.
- Include existing House Cuts/trailer compositions only where they consume the changed shared pagination/timing code. Record which were checked and why other compositions are unaffected; do not redesign their audience controls here.

Expected artifact behavior: existing MP4s remain playable and unchanged. New viewer interactions do not require rewriting them. If implementation changes prepared page metadata or rendering, rebuild affected bundles from their existing selections and frozen sources and render new movies to obtain those changes. Verify whether old selection JSON remains reusable; require a refreshed selection only where its actual frozen contract lacks necessary inputs. Never change source/media pins or regenerate history to make proof pass.

## 7. Implementation sequence and ownership

These are sequential work units, not instructions to dispatch parallel agents. Each unit must leave a working product. Deployment is the gate; add no feature flags or disabled visible controls.

### A. Establish fixtures and playback anchor semantics

Inspect current tests and collect small deterministic current and historical fixtures. Include v7/v8 sealed ballots, v9/v10 public ballots, v10 private solo explanations, public/pack speech, long thoughts/speech, outcomes, finished/unfinished retrospectives, and zero-playable-content/audio-wait cases. Use eight players at most for Werewolf. Define semantic cue parts and phase-local anchors without changing stored canonical events.

**Done when:** tests distinguish the same public source moment from coincident audience-local cursors and from private substeps sharing its canonical event.

### B. Implement and prove server-side audience mapping

**Owns:** engine Werewolf watch contract/traversal helpers; API Werewolf route and presentation service; typed web `werewolf-api` caller; focused engine and PostgreSQL tests.

Implement the read-only resolver with shared access/readiness authority, bounded response, historical reducers, and explicit semantic mapping. Remove duplicated ad hoc joins if any are introduced while wiring it.

**Done when:** mapping/privacy tests pass for both directions and private-only fallback, including no future dawn reveal, no canonical gaps in Mystery responses, invalid source handling, and revoked access.

### C. Make the mounted Werewolf player transition audiences

**Owns:** `werewolf-entry.tsx`, `werewolf-viewer.tsx`, `use-werewolf-watch.ts`, opening/watch models where needed, `embedded-replay.tsx`, voice/music and replay-share integration only where required.

Replace the fixed-audience-session lifecycle with the explicit frozen-clock transition. Keep the game/fullscreen host stable, remove audience mount keys at every active host, isolate audience buffers, preserve session controls, restore content time, and keep initial shared-link boot separate from in-session URL changes.

**Done when:** a real mounted standalone/embedded player can switch twice on a shared public page without restarting or losing mute, speed, pause, or expanded view; delayed old responses cannot paint or play in the new mode.

### D. Add the compact player control and entry actions

**Owns:** `watch-transport.tsx`; Werewolf card actions in `episode-preview.tsx`; season/championship poster and host wiring/styles; relevant entry copy and integration tests.

Use the responsive equal-priority watch actions, compact two-choice transport control, proper fullscreen portal/focus behavior, real audience links on cards, lazy poster choices, and one active in-player mode control. Remove obsolete external mode controls, Mystery-primary treatment, and fixed-session copy when the working switch takes over their responsibilities.

**Done when:** Omniscient is reachable from grid and season before play and from a running Mystery replay, including touch/mobile and fullscreen, with no explanatory or success message.

### E. Expose measured page boundaries to the shared advance command

**Owns:** `speech-pages.ts`, `timed-speech.tsx`, shared speech/thought/House page owners, sampled-stage/page registration, timing and alignment helpers as required, `watch-director.ts`, and both game viewer advance handlers.

Add the shared forward/inverse page schedule, active-content registration, and same-cue clock seek. Integrate all paginated speech/thought paths actually reached by both players, rather than fixing only Werewolf portrait speech. Preserve automatic pagination and existing final-page progression.

**Done when:** a paused six-page thought and six-page speech can each be advanced one page per gesture through page six, with the same cue until content ends; recorded and unrecorded variants pass.

### F. Complete integration, render proof, and docs

**Owns:** affected viewer/Studio/export adapters, parity fixture additions, browser harnesses, documentation, and the final verification report.

Prove combined page-advance → audience-switch → share/reload behavior, historical and current acceptance, and matched viewer/Studio/export frames with encoded clips. Run required repository checks once the implementation is complete; address failures before calling the change ready.

**Done when:** section 8 passes, fresh evidence is retained, and section 9's docs describe actual behavior rather than the old fixed-audience contract.

## 8. Acceptance and validation

### Mode-switch acceptance

- Public speech at page 5/6 stays on corresponding speech/content position in both directions; inserted thoughts do not reset speech.
- Mystery dawn → Omniscient remains on dawn, rather than beginning Doctor/Seer/Hunt substeps.
- Pack speech/private solo explanation → Mystery goes to the preceding public playable point silently, without flashing private roles, text, scene images, decisions, recordings, or results.
- Opening cast shot, historical ballot reveal/tally, retrospective speech, completed reprise, and unfinished retrospective retain their proper distinct semantics.
- Paused stays paused; playing resumes; live-follow and silent holds retain the intended accepted boundary; no-content/audio-not-ready states remain valid.
- Slow/stale responses, rapid mode changes, seek during switch, game change, teardown, permission revocation, and retry cannot cross-contaminate data or override newer intent.
- Fullscreen/theater remains open; mute/volume/speed and saved thinking choice survive. Same-mode selection performs no reload.
- Shared URLs and reloaded direct links open the destination audience, cue, time, and playback settings. Season/event URLs retain their current page context.
- Historical accepted replay sources work without rewriting events, generating replacement media, or demanding a field/publication that did not exist at creation.

### Entry-point acceptance

- Omniscient entry requires no Details visit from a desktop card or mobile card dialog.
- At roomy, intermediate, and narrow action widths, verify full paired labels, short paired labels, and the neutral dropdown respectively. Both modes have equal emphasis; neither mode name is truncated, and a dropdown trigger does not implicitly choose Mystery.
- Main and menu actions work with keyboard, touch, new tab, and copied links; menu interaction does not activate the card.
- Regular season and championship posters allow pre-play audience selection; the mounted player has one mode control and switching does not remount it.
- Opening poster watch choices does not load replay/Omniscient evidence; selecting a watch action starts the named mode. No-player, waiting, live, completed, unavailable/error, and mixed Influence/Werewolf selections keep working.
- Inline and expanded controls fit supported narrow/short geometries without scroll-dependent content. Use existing 320/390/800/1440-width coverage and short/fullscreen cases as appropriate.

### Page-advance acceptance

- For thoughts, character speech, and paginated House captions: page 1 → 2 → 3 → 4 → 5 → 6 uses six-page fixtures and never skips to another actor while another page remains.
- Uneven page lengths use measured word-weighted boundaries; do not test only equally sized pages. Include long unbroken text, tags crossing historical frozen pages, missing/late fonts, resize and role-label geometry changes.
- Final thought page returns to its own speech before the next player. Final speech page preserves current fade/exit and handoff semantics. Single-page content and non-text scenes retain their current behavior.
- Pause, autoplay, playback speeds, reduced motion, direct/reverse/random seek, late thinking, and delayed recording metadata work. A fresh mount at a clicked destination shows the same page.
- Touch generates one advance command; repeated distinct taps advance one page each. Existing first-tap-reveals-controls behavior and control-event exclusions pass.
- Recorded/unrecorded thoughts and speech, muted/unmuted audio, multiple recording segments, buffering, and imported alignment follow the same shared-clock seek. No doubled or stale audio.
- After page advancement, audience switch and Share this moment preserve the corresponding position under section 4's mapping rules.

### Test ownership and commands

Reuse/extend the existing suites where they exercise the actual consumer:

- Provider-free: engine Werewolf watch tests; web `werewolf-watch-model`, `werewolf-watch-cache`, `watch-director`, `format-presentation-director`, `watch-timeline`, `watch-voice`, `replay-share`, `season-watch`, `championship-view`, `game-library-card`, page/typography/alignment tests, and replay-export integration tests.
- PostgreSQL: Werewolf watch/visibility/readiness/position API tests. Call `setupTestDB()` before mutations and keep them sequential; never run independent suites concurrently against the same DB.
- Browser: the existing isolated Werewolf and season surface harnesses plus shared-watch/Studio export helpers. Assert actual rendered page copy, mode, cue, playback state, audio position, and host continuity; mocked player props alone do not prove behavior.
- Render/encoded proof: extend the parity verifier with six-page thinking/speech, a mapped public dawn, historical ballot, and isolated thought/speech cases. Compare viewer, actual Studio Source/Selected cut, fresh export frames, and decoded frames/audio from a newly encoded clip. Retain source/selection identity, geometry, settings, target timestamps, assertions, tolerances, commands, logs, and images.

Required implementation baselines from the repository root:

```sh
bun run test
bun run test:postgres
bun run check
```

Affected API browser suite, run sequentially using its owned isolated databases/cleanup:

```sh
bun run --cwd packages/api test:browser
```

Render proof from `packages/web`, after extending fixtures:

```sh
bun run src/scripts/verify-presentation-parity.ts ../../.renders/replay-mode-page-advancement
```

Use the documented `packages/api/src/e2e/studio-export-parity.ts` harness and `packages/web/src/scripts/verify-house-replay-export.ts` for actual selection-to-MP4 and reverse/random/fresh-renderer proof. Select their exact fixture commands at implementation time. No paid/provider calls are necessary. If a sandboxed local PostgreSQL connection is refused, retry with the documented elevated access before declaring PostgreSQL unavailable.

Missing rendered consumers or encoded proof must be reported as **presentation parity is incomplete**, even if focused tests pass. This plan does not claim that any implementation checks have already passed.

## 9. Documentation and handoff

Update these in the implementation branch after behavior is implemented:

- `docs/werewolf.md`: remove current statements that mode switching starts over or is unavailable; explain audience-local cursors and position-preserving switching accurately.
- `docs/werewolf-rules-page-content.md`: remove fixed-session wording without adding lengthy viewer-control instructions.
- `docs/watch-timeline.md`: document semantic audience anchors, silent private-only landing, and page-aware manual seeks using the shared clock.
- `docs/visual-mode.md` and `docs/presentation-parity.md`: update manual advancement descriptions while retaining automatic pagination, first-tap control reveal, no-scroll rules, and viewer/Studio/export requirements.
- `DEVELOPMENT.md` and the affected playback paragraph in `docs/reasoning-transcript-observability.md`: replace fixed-mode guidance and preserve the distinction between saved thinking and provider-native/private evidence. This is a presentation update, not an agent-decision or simulation-format change.
- Add a focused `docs/solutions/` entry for the audience-local cursor mapping and measured-page advance integration, with the repo's YAML metadata.
- Mark superseded fixed-audience design claims in the relevant old planning/review documents with a pointer to the new implementation documentation where needed; do not rewrite historical test results as though they tested this feature.

Handoff must list every affected surface, concrete check outcomes, retained parity artifacts, known limits, and selection/bundle/movie refresh instructions. Distinguish local proof from staging and production verification. Existing player behavior ships together with working entry points and required parity; do not label a viewer-only partial change complete.

## 10. Mode choice across games

The user chose to retain the selected replay mode when switching between games on the same season page. Keep it for that page visit; fresh visits present equal watch choices, and explicit audience links win. Do not add an account-wide or saved browser default.

## 11. Local implementation evidence

- The provider-free baseline passed with 3,448 tests and five skips before the final narrow-layout adjustment; the focused layout, director and rendered-page suites pass after it. The PostgreSQL baseline passed 2,610 tests against a dedicated local database; the older shared test database was left untouched after its pre-existing migration conflict.
- Local browser tests cover a real season player switching audience and retaining the choice in a second game; public and private-night switching; fullscreen; one-page ballot clicks; audience switch and reload; and responsive grid/dialog actions. The first complete browser run found three failures in the new season/entry checks; their targeted reruns pass. A complete rerun is in progress.
- Fresh deterministic viewer, Studio Source, Studio Selected cut and export comparisons cover the long ballot, six-page thought, recorded speech and thinking, and a historical vote. The verifier retains images, manifests, decoded frames, audio checks and fresh MP4s under the local replay parity artifact directory. Actual Studio frozen thinking and both games' retrospective selections also prepared and encoded successfully, with fresh-browser and reverse/random frame checks. After adjusting the narrow solo layout, the 320×480 ballot renders all six pages with a complete readable line above its vote ledger and matches all three presentation consumers.
- Existing selections can rebuild fresh bundles from their frozen sources; old bundles and MP4s remain unchanged. Rebuild a bundle to pick up the narrow solo layout and render a new movie. No historical game events, source/media pins, recordings, staging or production were changed.
