---
title: Keep replay music continuous without creating another game clock
module: House watch player
problem_type: integration_issue
date: 2026-10-05
tags: [audio, replay, werewolf, autoplay, preferences, transport]
---

# Shared replay music transport

The House owns the two-deck streaming controller, device sound preferences and volume controls. A game adapter returns a music section from the currently presented, audience-filtered moment. Section identity is game + audience + semantic phase + day/outcome; never key audio by speaker, thought page, scene image or buffer window. Werewolf's selector ignores the snapshot's latest outcome and roles, and only selects a victory track when presenting the result entry. Mystery cannot select pack music.

`WatchMusic` uses a Web Audio gain graph over two HTML media elements, retaining one controller for the mounted viewing session. Crossfades and whole-song repeats use the media/audio clock; React renders do not advance the song. Media always plays at 1×. The existing director remains the only authority for story timing, while a section with `continueAtEnd` may finish over the final frame. The game transport must preserve play intent for that section, so Pause still stops audio. Incoming or blocked audio cannot delay the game.

A pointer scrub suspends sound immediately and freezes track selection until the final seek resolves. Same-section seeks preserve musical position; cross-section seeks and explicit restart start from zero. Keyboard/scene seeks have no pointer lifecycle, so the navigation revision also resynchronizes transport. Preserve the user's play/pause intent across all seeks. Pause freezes both decks during overlap. Initial mute allocates no media; after unlock, mute uses master gain zero and retains media position.

Saved mute intent is separate from browser playback permission. Call unlock directly in a player gesture, create/resume the AudioContext there, and handle both media `play()` rejection and a context resume that remains pending. A denial shows Enable music without overwriting the saved preference. Do not retry on every render or new section. Fence async completion after pause, seek, replacement and disposal. Hidden tabs pause through the existing director and stay paused on return.

Sound preferences extend the existing per-device viewer/production record and validate fields independently. Thinking-only records preserve their values. Trailer sound remains separate. Mute and volume are always outside settings, even on narrow screens; optional speed/thinking controls yield room, and Go live remains available in settings when its inline button cannot fit.

Package reusable tracks in `packages/web/public/music/`, with source/output hashes and processing receipts. The Docker web image already copies the entire public directory. Never rely on `.renders` or per-worktree upload files at runtime. The four selected Suno WAVs remain unchanged; MP3 derivatives use restrained background loudness and full-source durations. Exact Suno prompts were not supplied and are not inferred from prior local-model prompts.

## Adding a game's score

1. Select and package approved tracks with receipts; keep unsupported phases silent.
2. Write a pure adapter from current visible canonical facts to section/source/title/repeat policy and optional `continueAtEnd` for victory songs. Include audience and future-result noninterference tests.
3. Connect `useWatchMusic` to the shared player's play intent, preparing, holding, seek revision and live-tail state. Pass its controls into `WatchTransport`. No score means no ineffective audio controls.
4. Test async cancellation, default-policy autoplay, mobile volume, pause/seek/loop, asset delivery, and actual listening. Browser decoding and fake-clock tests do not establish artistic quality or physical Safari/iOS acceptance.

Implementation and proof: [replay music plan](../../plans/2026-10-05-002-feat-house-replay-music.md).

## Influence opening and cast reveal

Influence's shared presentation composer prepends editorial `opening` cues to its playable
history: a continuous House entrance (20 seconds), each contestant
(2.8 seconds), and a welcome card (3 seconds). House branding appears early
in the entrance, followed by an uninterrupted architectural approach, the
Influence title at 12.2–17.5 seconds, and a quiet arrival before the cast.
The first cast cue starts at exactly 20 seconds. The existing presentation
director owns their timing, pause, speed, seek and automatic handoff. The opening
is one chapter for Previous/Next; Skip intro preserves play/pause intent.
Returning to the beginning includes it. Canonical event deep links and initial
live joins bypass it, as does live catch-up after reconnect.

Opening cues have a null canonical coordinate and copy only cast IDs, names and
avatar URLs. Existing full-body character art can be displayed independently of
the game's scene-visuals setting. When full-body art is absent, cast reveals use
square headshots. Failed full-body images fall through to the published
portrait, cast avatar and the same bundled persona portrait used elsewhere in
the player; only failure of all candidates shows a monogram. Neither latest standings, shields, strategy,
episode summaries nor outcomes enter the opening. The player hides the gameplay
HUD and resets the surrounding cast projection during these shots. Reduced motion
removes camera/portrait movement while retaining timing and readable fades.

Local upload URLs resolve against the running API's `INFLUENCE_LOCAL_UPLOAD_DIR`
(default: `packages/api/.local-uploads` when launched from that package). Git
worktrees do not copy these ignored files. A shared database can therefore return
valid character references whose files are absent in a new worktree. Recover the
referenced originals from the owning checkout, retaining content-type/hash
metadata and verifying byte hashes; do not regenerate characters to repair a
missing local asset.

The entrance uses packaged IMGN H3 footage, slowed from 15 to 20 seconds, with its
final frame continuing behind the cast. The shared `OpeningBrowserVideo` adapter
follows the presentation clock; reduced motion uses a still. Media failure shows
the poster. Original footage, request/response evidence and preview renders are
retained locally under `.renders/influence-opening/entrance-v2/` and
`.renders/influence-opening/video-v2-final/`.
The generated asset provenance is recorded beside the packaged media.
The six user-selected Suno tracks are packaged in
`packages/web/public/music/influence/v1/`. Its manifest records the intended
phases, full durations, source/output hashes and loudness measurements.
Playback MP3s use the existing -20 LUFS / -2 dBTP background target, 160 kbps
stereo at 48 kHz, with no trims or loop edits. The intro retains its full
20-second lead-in. Original WAV masters and the supplied MP3/M4A exports are
preserved byte-for-byte in the user's permanent
`Music/The House/Influence/score-v1/` archive, outside disposable worktrees.
The Influence player uses all six tracks:

| Visible presentation | Track |
| --- | --- |
| Entrance and cast reveal | An Invitation to Power |
| Introductions, lobby, Mingle, whispers and rumors | Good Company |
| Strategy huddles, format choices and power actions | Terms and Conditions |
| Pleas, ballots, tallies, tiebreaks and jury proceedings | Names on the Table |
| Eliminations, farewells, diaries and retrospective reflection | The Empty Chair |
| Revealed winner and completed retrospective's closing results | The Last Word |

`influenceMusic` selects from the presented cue and structured speech metadata,
including explicit farewell purpose. It never reads prose or the game's latest
status to infer a result. The canonical winner projection used by the visible
tableau also keeps its song continuous through subsequent House summaries.
Ordinary beds loop and crossfade; speakers share a section within the same round.
The winner song plays once and may continue over the last frame; Pause still
stops it. Retrospective reflection interrupts the first result song, and the
canonical completion cue starts the closing song afresh.

Both games share `useOpeningAudio` for position-locked opening sound.
Influence samples the song at opening start + local cue time, preserving the
20-second cast entrance during seeks and speed changes. It fades in over 0.7
seconds and out over the final two seconds. Gameplay music uses the shared
two-deck transport at 1×. Mute and volume use the existing device preferences;
first visits start muted. The music gesture also prepares the ambient context
for the automatic handoff. Scrubbing, pausing and hiding the tab suspend sound.

The review preview with music is retained under
`.renders/influence-opening/video-v3-with-music/`: the existing 39.8-second
1080p visual render with the packaged intro track starting at zero and matching
opening fades.
The player, Studio and exports use the same opening composition, cast-art
selection, frame component and phase-music selector. The production catalog owns
one `opening` moment with an editorial source reference, containing all authored
shots. Cuts may include or omit it atomically; no canonical event reference is
invented. Opening timing is fixed under editing profiles so the first cast
entrance remains at 20 seconds. Its score is one continuous clip with the same
gain envelope as browser playback. Packaged video, stills, logo, portraits and
music URLs travel in presentation data and are frozen into export bundles.

Music-enabled exports and Studio compile phase beds, loops, crossfades and the
closing score through the shared audio scheduler. The final hold finishes the
song from the beginning of its contiguous section, including subsequent House
summaries; it does not add another full song duration at each summary. Browser
transport displays continuing playback only while the unmuted closing score is
loading or playing, and releases that state when the score ends or fails.

Coverage: `packages/web/src/__tests__/influence-opening.test.ts` verifies identity
isolation, clock behavior, handoff, exact seeks, chapter navigation and live/deep-link
behavior.
`influence-music.test.ts` covers phase selection, result boundaries, packaged
sources and intro alignment. Browser checks exercise real audio decoding,
desktop/mobile controls, pause/seek/handoff and music continuing over results.
`production-source-parity.test.ts` compares player composition against Studio and
export pictures, cast order, music and timing across the format fixtures, including
opening-only and opening-free cuts and exact opening audio envelopes.
