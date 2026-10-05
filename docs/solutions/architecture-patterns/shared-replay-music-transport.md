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
