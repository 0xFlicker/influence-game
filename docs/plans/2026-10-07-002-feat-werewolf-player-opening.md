---
title: Werewolf opening in the House player and full replay export
type: feat
status: implemented
date: 2026-10-07
---

# Werewolf opening in the House player

## Product decision

Build the opening as webpage presentation using the approved video clips, music, existing character art and House logo. The full-game exporter samples that same presentation. Do not ship a standalone intro MP4 generator, generate a video per game, or replace the existing spoken introductions or their score.

The local `sequence-v1` movies are an art-direction study, not an implementation. The operator corrected the example episode title to **Silence Beneath the Lanterns**. Read actual episode metadata for each game; never turn a slug into a creative title. Before naming is available, show the game name **Werewolf**, then freeze the selected title for that viewing session/export.

## Revised direction

| Shot | Initial duration | Treatment |
| --- | --- | --- |
| The House presents | 5 seconds | Approved lantern-wakes clip, fading up from black over roughly 0.7 seconds. Use the actual `public/logo.png` emblem with a custom typographic lockup: small tracked **THE**, bold condensed-looking uppercase **HOUSE**, and restrained **PRESENTS** below. Warm ivory type and muted gold emblem. No Times/Georgia House wordmark. Keep the lockup in the dark left portion of the shot, clear of the lantern. |
| Episode title | 3 seconds | The final 0.9 seconds of the House shot dissolve smoothly into the separately approved moonlit alley still while the House lockup fades away. The alley starts at 110% scale as the dissolve begins, moves continuously through the fade and title to 125% with a slight left/up pan, then slowly pulls back to 100% across the entire cast sequence. Cast count determines the pullback duration, with no camera reset between players. The typography and portraits stay fixed. Reduced motion leaves the background still. This is a distinct composition, not another frame of the lantern clip. Large readable episode title and a small Werewolf label. Hold this still under the transition into the first cast portrait. The dissolve uses existing shot time, preserving total duration and audio offsets. No new generated footage is needed for this version. |
| Player reveals | 2.5 seconds per player | Existing rectangular fullbody artwork, framed rather than treated as a transparent cutout. Name beside the portrait on landscape screens, below on portrait screens. Preserve frozen roster order. Omniscient alone adds the role; leave that area empty in Mystery. |
| The door closes | 5 seconds | Approved closing-door clip. Begin the picture fade during the final two seconds while the door is still closing, reach black at its end, and allow approximately 0.3 seconds of black before spoken introductions. Fade the score over the same final two seconds; retain the audible door beneath it. |

Remove the generic tagline and the separate gathering hold. Six players produce an opening of about **28.3 seconds**, eight about **33.3 seconds**. Durations are presentation data, not gameplay timers. Tune against the actual clip during implementation; do not freeze the previous study's 31-second duration.

Use the existing logo asset without redesigning its mark. Build the wordmark as accessible HTML/CSS alongside it; choose and bundle a licensed typeface only if existing fonts cannot achieve the intended lockup. The title can have a more literary treatment, but the House identity should feel like a production credit, not default serif text.

## Shared implementation boundary

1. A small opening compiler accepts frozen episode title, audience-safe initial cast and versioned asset references. It returns ordered opening cues with stable keys, durations and media placements. It has no networking, role inference, wall-clock timers or gameplay effects.
2. A shared `WerewolfOpeningFrame` accepts a cue and sampled elapsed time. It owns layout, opacity and camera movement. The browser and full-game Remotion composition use this component; their media adapters supply HTML video versus frame-sampled video respectively.
3. The Werewolf viewer prepends these presentation cues before canonical introduction cues. Opening cues have their own identity, not invented event IDs or cursor zero. Existing canonical replay URLs still point directly to their intended moments.
4. The full-game exporter includes the same opening cues and selected assets in its frozen manifest. A whole-game export includes the opening; a range starting at a later canonical cue does not. Keep the one full replay export command and its audience validation.

Browser integration points are `werewolf-viewer.tsx`, `use-werewolf-watch.ts`, the shared director and `WatchTransport`. With operator authorization, the separate exporter work was committed as `e6d99900` and merged into this branch before editing `lib/replay-export/cues.ts`, `manifest.ts`, `audio.ts` and `remotion/house-replay/frame.tsx`. Its original checkout remains clean.

Do not introduce a universal game plugin system or replace all event navigation to add this opening. The shared boundary is sampled presentation plus media placement; the Werewolf module supplies its own opening content. Influence gets no opening change in this slice.

## Playback and sound

- Normal replay entry starts at the opening and follows the existing autoplay policy. A moment/deep link, Go live, or an explicit later starting position bypasses it. Returning to Start replays it.
- Every shot and cast reveal is reachable with Previous/Next and the scrubber. They must refer to the same opening cue list. Skipping the opening enters the first canonical introduction without skipping dialogue.
- Reuse the player's top-level volume, mute, speed, pause and fullscreen controls. No separate intro controls or persisted preference category. Full export contains only the content frame.
- During the opening, elapsed presentation time owns video position and the **Lantern Shadows** offset. Pause stops both; seeking sets both; returning to the opening restarts at the selected time. Do not let an independently running video advance the replay.
- Treat embedded clip sound as explicit effects placements and keep picture videos muted. This prevents double audio and permits the same mix in export. Extend the export audio-purpose union with `effects` for this actual consumer; do not create a speculative effects framework.
- Use one audio owner at a time. Opening music/effects take ownership during the opening; the existing ambient music controller resumes when canonical introductions begin. Preserve **Lantern to Fang** and every later gameplay music mapping.
- Autoplay rejection leaves the opening playing silently with the existing sound-unlock control. A later unlock starts sound at the current opening time, not at the beginning. Browser preferences never change an explicit export's sound settings.
- Reduced motion keeps the same timing and audience disclosures, using still frames and simple opacity changes in place of camera movement. Scrubbing always displays a deterministic frame.
- Runtime media failure must not trap the player: use the approved still for failed video, continue silently if audio fails, and retain Skip/Next. A full export fails preflight on missing selected media rather than quietly changing the output.

## Data and asset boundaries

Mystery and Omniscient use identical neutral cast order, durations, framing, music and effects. Only permitted role labels differ. Build from the audience-authorized initial roster; never use final status or send an omniscient cast object to Mystery and hide it with CSS. Do not copy the study's `cast.json` into public assets.

Publish reusable, versioned lantern/door clips, their extracted effects, the approved alley still and a delivery encode of Lantern Shadows. Keep source WAV and provider receipts as production sources; `.renders` is not the runtime asset store. Use the repo's existing asset delivery mechanism and freeze hashes/references for exports. No new provider generation or paid calls are required.

Approved local sources:

- `.renders/werewolf-intro/lantern-v1/lantern-wakes.mp4`
- `.renders/werewolf-intro/door-v1/door-closes.mp4`
- `.renders/werewolf-intro/sequence-v1/sources/lantern-shadows.wav`
- Approved moonlit alley study: `.renders/werewolf-art/lantern-village-night-v1/moonlit-lane.png` in the Werewolf worktree; verify/copy this source deliberately during asset preparation.
- `packages/web/public/logo.png`

## Delivery and proof

1. Implement the shared opening compiler/frame and assets in a webpage preview using actual episode metadata. Review the House lockup, alley title cut, rectangular cast art and longer door fade there.
2. Wire into the real Werewolf viewer: opening navigation, sound ownership, explicit deep-link bypass and handoff to existing spoken introductions.
3. Connect the full replay exporter to the same compiler/frame/audio placements. Remove the study-only generator; retain approved source assets and previous study outputs for reference.

Verify variable roster sizes and long names/titles at landscape and portrait dimensions. Test cue boundaries, backward seeking, Start, Skip, pause, drag-scrubbing, speed changes, muted autoplay, sound unlock, audience switching, reduced motion and missing media. Prove Mystery payloads/assets contain no roles or private material. Sample browser/export frames at matching times and check audio offsets across a seek and an export range. Run required repository checks for the code implementation; no provider-backed tests are needed.

Acceptance is the opening playing in the **real game**, followed by unchanged introductions, and a full replay export containing that same sequence. A standalone study video does not satisfy acceptance.

## Implementation evidence — 2026-10-07

- Shared compiler, sampled frame, clock-bound browser audio/video, and full-game export integration are implemented. Runtime assets and hashes are under `packages/web/public/visual/werewolf/opening-v1/`; source WAV and prior studies remain local. There is no standalone intro generator in the shipped code.
- Normal entry, explicit moment bypass, pause, speed, opening navigation, backward traversal, distant-window restart, audience-safe role labels, failed autoplay and late media promises have focused coverage. The original gameplay music mapping is unchanged.
- The actual `hazy-ruby-sand` Mystery page passed browser navigation through House/title/cast/Skip with no page errors. Its entire replay was prepared through the full-game exporter; the opening-through-first-speech range was encoded and inspected at 1280×720/24fps. This verifies export integration without claiming another full-length game encode.
- Required provider-free baseline: 2,342 passed, 5 skipped. Required API baseline: 1,917 passed against a disposable isolated database, removed afterward. The ordinary shared test database lacked `werewolf_lobby_seats`; it was not altered to obtain this result.
- Final focused opening/export checks: 31 passed; types and lint passed. Five frozen-replay samples (House, title, cast, door, first speech) matched reverse-order rendering, three contiguous-frame ranges and a fresh browser. Portrait samples at 720×1280 cover the title, cast, moving door fade and final black frame.
- The local API stopped before a later mobile/audio browser rerun. The earlier live-page proof stands; frozen-bundle frame checks can run without that service. Live sound listening and final art acceptance remain operator review.
