---
title: House replay music — Werewolf first
type: feat
status: implemented
date: 2026-10-05
---

# House replay music — Werewolf first

## Outcome and scope

Add the selected Suno music to Werewolf in the shared House viewer. Music should feel continuous while characters speak and think, respond predictably to the existing playback controls, and remain optional. The House owns sound preferences, transport and controls; the game module chooses the track from the current audience-visible moment. A later game should supply its own mapping and assets rather than another audio player.

This is the next slice after [W5 trailers](2026-10-05-001-feat-werewolf-trailers-release-assets.md), not a reopening of the completed trailer work or a renumbering of W6. User approved this plan with mute and volume always available in the top-level playback bar. Approval covers the implementation direction; implementation is now local; operator listening and physical-device acceptance remain outstanding. Existing trailers keep their selected score and CC-off default.

Deliver live and completed Werewolf viewing, including direct moment links, with the same behavior. Production previews use the same player but retain their separate preference scope. No new Influence score is selected by this work: shared controls and preferences support it, while games without a score remain silent and do not display ineffective music controls.

## Current implementation seams

- `components/watch/use-watch-preferences.ts` already stores thinking/order per device in `house:watch:viewer:v1` and `house:watch:production:v1`, synchronizes tabs, and gates initial player mounting on preference readiness.
- `components/watch/watch-director.ts` owns cue timing; `use-watch-director.ts` pauses it on document visibility loss. Preserve this authority. Music must never advance the replay or delay it for audio loading.
- `components/games/werewolf/use-werewolf-watch.ts` preserves play intent across asynchronous seeks, uses bounded windows, and distinguishes preparing/holding/live tail. Completion pauses at the terminal tail unless the visible music section continues over the final frame. Thinking/image readiness can temporarily hold the director without a user pause.
- `components/watch/watch-transport.tsx` provides one control row, overflow settings and the cursor scrubber. Its slider currently seeks on every change and has no explicit scrub gesture lifecycle.
- `werewolf/watch-contract.ts` supplies audience-filtered moments, day/phase, canonical entries, and scene/chapter IDs. These are the music selector's facts. Do not parse dialogue or use the latest game outcome while the viewer is watching an earlier moment.
- `lib/audio-cues.ts` is an unused-sound/no-op Influence interface, not an existing music engine. Do not activate its transcript-era call sites or adapt their prose-derived state into this feature.
- `lib/episode-media.ts` owns a separate tab-session trailer sound preference. Leave trailer preference behavior intact in this slice; replay music is a distinct preference. Do not invent a global all-media mixer or silently import a trailer choice into replay.

## Approved listening defaults

First visit: visual replay autoplays as today, music starts muted, stored music volume defaults to 30%. A clearly labeled speaker button invites “Turn music on.” A returning viewer who enabled music gets an audible autoplay attempt with their saved volume. A browser may block that attempt despite the saved preference; continue visual playback and show “Enable music” on the speaker control. Do not overwrite their preference with a browser denial.

Persist `musicMuted` and `musicVolume` within the existing viewer/production preferences. Read before starting audio; retain valid thinking/order values when the new fields are absent. Validate each field independently and clamp finite volume to 0–1. No storage migration or parallel settings store. Production begins muted independently. Storage failure leaves controls usable for the current session.

Mute is immediate and does not pause or rewind the musical position. Unmuting joins the current position; volume zero is silence without changing the remembered mute choice. Explicit mute/volume edits synchronize to other open players in the same scope. A synchronized unmute updates preference but does not unlock or start a background tab. Play/pause state, autoplay denial, and musical position are session state, not stored preferences.

Speaker button and volume slider remain visible in the top-level playback bar near settings/fullscreen at every width, including mobile. Neither control moves into settings. Reserve space for them before optional inline speed/thinking controls; those optional controls move into settings when space is tight. Label this “Music,” not generic system sound. Keep keyboard focus, accessible pressed/value states, and at least the existing touch-target size. No extra control row and no always-visible track title. An optional current-track line belongs inside settings.

## Phase-to-track proposal

Use the full selected Suno sources, from 0:00 on each new musical section. The earlier MiniMax cuts and arbitrary 45-second trailer edit are not the sources. Sources and receipts: [music exploration](../brainstorms/2026-10-04-werewolf-music-lantern-village.md), `.renders/werewolf-music/suno-picks-v1/manifest.json`.

| Current visible section | Track | Behavior |
|---|---|---|
| Introductions | Lantern to Fang | Continuous across all individual reveals; repeat if necessary |
| Day discussion and daytime voting | The Circle Closes | One section per day; keep position through conversations, ballots, “Hear more,” and continued discussion |
| Omniscient pack meeting and pack choices | Wolves at the Festival | One section per night; do not restart for each wolf or ballot |
| Public night / dawn outcome | Silence for this first slice | Fade out prior music; do not imply attack success, a save, or a role through a new cue |
| Public terminal village victory | Lanterns Still Burning | Start only when the result is presented; one shot, no loop |
| Public terminal wolf victory | Wolves at the Festival | New outcome section even if it follows the same track in a pack scene; one shot |
| Draw, stopped/suspended ending, empty/preparing player | Silence | No invented victory cue |

The four sources are approximately 194.08s, 163.52s, 193.56s and 177.68s respectively; verify hashes against the saved receipt before packaging. The wolf-meeting use is a proposed first audition, not previously approved night ambience. Night/dawn/draw stay silent until a suitable score/treatment is selected. Vote music does not predict the result: an elimination branch may only occur once that result is visibly presented. No outcome-dependent preloading, URL selection or gain changes before that point.

A musical section key is game + audience + semantic section + day (or terminal outcome). It is independent of speaker, thought/speech page, rendered scene identity and buffered-window boundaries. The adapter consumes the active projected moment and presentation stage; it must not fetch omniscient facts for Mystery. Both audiences may hear a terminal faction cue once their own timeline presents that public result.

## Transport behavior

| Action/state | Required behavior |
|---|---|
| First ready moment | Select its section, begin at 0:00; try sound only after preference hydration and permitted playback |
| New speaker, thought toggle/order, page within speech | No restart, new audio instance, or volume dip |
| Normal new section | Short crossfade, proposed 700ms; incoming track starts at zero |
| User Pause | Silence promptly and freeze current track positions and transition progress; target under 100ms, no long fade tail |
| Resume | Resume positions; gentle ~100ms gain ramp, not a new song intro |
| Mute/unmute or volume change | Keep timing continuous; apply to both sides of a transition |
| Replay speed 0.5×–4× | Music remains 1× at original pitch; only visual/story timing changes |
| Pointer/touch scrub begins | Suspend music and current gains while retaining the pre-scrub playback intent and section |
| Drag updates | Update visuals as today; do not audition every crossed phase or start a download per cursor |
| Scrub ends/cancels | Resolve the actual committed destination once; same section retains position, different section starts at zero; resume only if current user intent is playing |
| Keyboard slider or chapter jump | Same seek policy; only latest resolved seek may start sound. Do not leave audio paused waiting for pointer-up |
| Seek within the same day/section | Preserve musical position, including backward seeks; music is an ambient bed, not a timestamped soundtrack |
| Seek across sections / direct deep link | Destination section starts at zero; there is no full historical music-offset reconstruction |
| Explicit Restart / go to beginning | Reset music to zero even when destination shares the section key |
| Seek across multiple sections rapidly | Cancel pending loads/fades; final destination wins; no old-track flash |
| Waiting for initial data, seek fetch, or missing cue/window | Pause music until a valid moment is ready; visuals never wait for audio |
| Image/thinking readiness while same visible moment remains | Keep the bed continuous; distinguish this from an empty/loading player |
| Live tail waiting for new moments | Fade down and pause after a brief 1s grace period, then resume the same position if the same section continues; no endless waiting-room loop |
| Replay end | Victory music continues over the final frame until its natural end, without looping. Keep play intent so Pause/Play, mute, seek and leaving the player still control it. Unscored endings stop. |
| Hidden tab / device lock | Stop audible playback and follow the director's existing pause behavior; no automatic resume on return |
| Route/game/audience change or unmount | Stop and release old audio immediately; no overlapping old/new sessions |
| Fullscreen or responsive layout change | Retain the same audio owner and position |

No automatic replay of the whole game and no new repeat-game setting. Only long-running background tracks repeat. Manual replay resets the score appropriately. Playback speed and extra thinking time mean a shared moment URL identifies a story moment, not an exact music timestamp; document and test this deliberate simplification.

Victory tracks start with the visible result and may finish the whole song over the final frame. This does not extend or loop the visual result cue. Explicit pause freezes the score; resuming continues from that position. Returning to another section stops the victory track and selects the destination score.

## Looping and transitions

For introductions/day/pack sections that outlast a song, replay the full source from zero with the same short crossfade. No manual loop points, generated extensions, random variations, tempo matching, or beat detection. The supplied songs were not authored as seamless loops: listen to the tail-to-front seam and record limitations instead of claiming gapless music from an `audio.loop` attribute.

Use at most two streaming media elements for transition overlap; one persistent controller owns them for the mounted viewer session. A small Web Audio gain stage provides controlled fades and volume across supported desktop/mobile browsers without decoding entire multi-minute songs into memory. Reuse the idle element for a new section or the same-track repeat; never accumulate players or AudioContexts. Context creation/resume and the first playable attempt must occur in the user gesture path when required by the browser.

Start a loop overlap only with a finite known duration and a ready incoming element. If metadata/readiness is late, finish or briefly fall silent and restart when ready; never stall the replay. Outgoing + incoming gain must not exceed the user's target gain. Stop/seek/dispose cancels scheduled gains and pending play operations. Mute changes the master gain immediately while the underlying transition continues. Pause during overlap freezes both positions; resume the remaining fade. Serialize rapid transitions with a generation token and ignore stale `play()`, loaded/error, and timer completions.

Use media time / the audio clock for position and fade progress, not accumulated React-render intervals. Once browser playback is permitted, keep media time advancing with zero master gain while muted; do not suspend the AudioContext solely for mute. Before permission is available, retain the selected section and begin its track from zero on successful unlock; do not invent a virtual soundtrack clock. Bound preloading to the current and next already-selected track, with no private-information-based speculative requests.

## Autoplay, failures and competing audio

Keep saved sound intent separate from actual audibility: muted, playing, browser-blocked, loading, unavailable. `play()` and AudioContext resume are asynchronous and can fail. Never show “sound on” as proof of playback before success. Retry browser-blocked playback on an explicit player gesture (speaker or Play), not a timer loop or unrelated document click. A later pause/seek/dispose wins even if an earlier play promise resolves afterward.

Audio failure must not fail a game, alter its visual failure policy, or stop replay. A failed file produces a compact “Music unavailable · Retry” control in settings; the speaker conveys unavailable state accessibly. Keep already-playing music only while it still matches the visible section, otherwise fade to silence. Retry reloads only the selected track and respects current pause/mute state. Do not silently substitute an unrelated cue.

At most one audible replay session per document. Prefer normal ownership by the mounted watch shell; if production mounts several previews, the explicitly played preview suspends the previous one. Hidden tabs are already paused. Do not introduce cross-tab leader election or mix two soundtracks. Existing trailer previews must pause/unmount when navigating into replay; verify this handoff, without changing their separate saved sound preference or CC behavior.

Browser constraints are part of acceptance, not assumptions: [MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), [play promise/rejections](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play), [page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API). A stored unmuted preference cannot guarantee audible autoplay. Test with real default browser policy, not only automation flags that disable restrictions.

## Assets and delivery

Package browser-playable derivatives of the four full approved WAVs, with stable versioned/hash-bound URLs and a source receipt. Use existing ffmpeg tooling, explicitly map audio only, and produce one broadly playable compressed format initially. Choose a conservative background listening level by measuring and auditioning the four tracks together; preserve the originals and record any normalization/peak limiting. No provider calls are needed.

Serve from the web's packaged public assets (for example `packages/web/public/music/werewolf/v1/`), not `.renders`, developer absolute paths, or per-worktree upload storage. Verify Next/Docker standalone packaging includes them, content types/range/cache behavior are correct, and deployment artifacts contain the expected hashes. W5's missing portrait incident makes a clean-checkout asset proof mandatory. These reusable music tracks contain no game secrets; their public availability must not depend on match-local role checks.

## Implementation units

1. **RM-01 — music selection and assets.** Pure Werewolf adapter from visible moment to section/track/repeat policy; source receipts and compressed assets. Table-driven boundary and audience tests. Record the proposed pack cue and unresolved night/dawn choices.
2. **RM-02 — shared transport and preferences.** Persistent bounded audio controller, optional shared Music controls, independently validated preference fields, autoplay handling, seek/scrub intent, loop/fade lifecycle and explicit restart. Connect only the Werewolf adapter. Keep Influence quiet unless a score is selected.
3. **RM-03 — real playback acceptance.** Audition actual replay at desktop/mobile sizes with fullbody, generated scenes, thinking on/off and both audiences. Exercise browser blocking, scrubbing, pauses, live waiting and tail-to-front loops. Inspect volume/transitions with the operator before marking the listening defaults complete.
4. **RM-04 — delivery and learnings.** Verify packaged assets in a clean environment, extend the shared-player docs and new-game checklist with the music contract, and record automated versus audible/device versus deployment proof separately.

No new generic plugin framework, server music jobs, per-game soundtrack generation, SFX/stingers, voice narration, trailer remux, automatic musical editing, production redesign, or new game rules. Existing API observation fields should suffice; add a narrow explicit playback-state signal if needed rather than infer loading/transport intent from DOM, text, or clock drift.

## Verification and acceptance

- Unit: each visible phase/result mapping; same phase across speakers/thinking/windows; new day/section with same track; Mystery never selects private pack cues; opening replay cannot select known future winner; draw/protection/no-agreement do not fabricate a win cue.
- Controller with injected media/clock: blocked/delayed play, pause or seek before resolution, rapid A→B→A transitions, stale metadata/error completion, mute mid-fade, zero volume, loop near EOF, loop load failure, pause/resume during overlap, muted logical position, cancellation/unmount and strict-mode remount. Assert no more than two elements/one context and no residual audio/timers.
- Preferences/UI: fresh defaults, old thinking-only record, corrupt fields, blocked storage, viewer/production isolation, same-tab and storage events, speaker keyboard access, slider pointer/touch/keyboard/cancel paths, disabled zero-cue controls, always-visible mute and volume outside settings at mobile and desktop widths, compact footer and fullscreen continuity.
- Browser: default-policy Chromium plus Safari/iOS where available; first-visit silent autoplay, remembered unmute allowed/blocked, successful explicit unlock, pause/scrub while playing and paused, 0.5×/4× without pitch change, direct late-game link, reload, hidden tab/lock, route exit, trailer→replay handoff, live tail/catch-up, victory continuation and natural end, failed audio with intact replay.
- Listen: all four levels, incoming first notes, repeated speaker continuity, at least one tail-to-front loop per looping track, pause clicks, transition loudness, victory song ending. Fake clocks and successful HTTP requests do not establish listening quality. Record unavailable Safari/iOS checks as limitations.
- Delivery: all four served artifacts load in clean checkout/container; correct hashes/MIME; seekable requests where required; no local upload dependency. Existing trailer/CC behavior and Influence playback remain unchanged.
- Run `bun run test` and `bun run check`; use the repository browser harness for deterministic integration. Run the required `bun run test:postgres` baseline against local PostgreSQL, with the repository isolation helper. Document-only planning requires frontmatter/link/diff checks, not provider runs.

Acceptance: a viewer can open a replay, enable music once, then watch/think/pause/seek/change speed without repeated song restarts, overlapping sessions, or losing their sound preference. A missing/blocked soundtrack leaves a fully usable silent replay. Final implementation record must identify the actual tested devices and the operator's listening feedback.


## Implementation checkpoint — 2026-10-05

RM-01/02 are implemented in the Werewolf worktree. The four full Suno songs ship as MP3s with source/output hashes and processing receipts. The shared House controller owns two streaming decks, crossfades, whole-track looping, saved per-scope sound preferences and cancellation. Werewolf supplies only its current audience-visible section. Night/dawn/draw remain silent. Mute and volume remain in the main playback bar, including the 320px layout; the numeric moment counter yields space at the narrowest widths, and optional inline controls stay in settings.

The terminal visual cue remains 4.2 seconds. Per operator feedback, winning music continues at normal volume over the final frame until the song ends naturally. Both victory sections declare `continueAtEnd` in the game adapter; the shared audio hook honors it while the game transport preserves user play intent. No victory loop is added.

Validation:

- Required provider-free baseline: 2,257 passed, 5 skipped; final focused music/preferences/assets checks: 21 passed.
- Required PostgreSQL baseline: 1,872 passed in a fresh isolated database, cleaned up by the repository helper. The initial shared-database attempt failed because its migration history lacked `werewolf_lobby_seats`; no shared database repair was attempted.
- Repository type checking and lint passed.
- Existing isolated browser harness, real Chrome and real MP3 decoding: silent first visit, explicit unlock, saved volume/reload, normal playback speed at 4×, paused same-section seek, cross-section start, full-source loop, mute continuity, scrubbing while playing, restart, fullscreen ownership, 320px controls, hidden-tab pause, real missing-file recovery, and existing thinking/autoplay preferences. No flags disabling browser autoplay policy were used.
- Victory continuation follow-up: real Chrome confirms village and wolf songs continue beyond the 4.2-second visual ending, pause/resume at the same musical position, stop at natural EOF without looping, and switch back to the intro after seeking. Draws still stop silently.
- Asset-copy rehearsal into a clean temporary public directory: all four hashes matched. The running Next server delivered matching bytes and `audio/mpeg`; range requests returned 206. Dockerfile inspection confirms the existing whole-public-directory copy includes the files. This is not a new container build or deployment proof.
- No paid/provider calls, new music generation, database schema changes or publication changes.

RM-03 still needs the operator's listening feedback on levels, loop seams, pack treatment and victory song endings. Physical Safari/iOS, device-lock behavior and native touch scrubbing were not exercised by desktop Chrome emulation. RM-04 integration guidance is recorded in [shared replay music transport](../solutions/architecture-patterns/shared-replay-music-transport.md), including the checklist for adding another game's score.
