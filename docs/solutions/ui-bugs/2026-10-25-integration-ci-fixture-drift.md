---
title: Install audio test tools and keep browser fixtures on current contracts
date: 2026-10-25
module: CI and browser coverage
tags: [testing, ci, audio, werewolf, studio]
problem_type: integration_issue
---

PR #221 exposed missing runner dependencies and stale browser fixtures after the
integration branch changed the underlying contracts.

The Studio PostgreSQL tests synthesize no paid audio, but they do probe a saved
MP3 through the real publication path. The worker correctly retains a failed
track when `ffprobe` is unavailable; the subsequent manifest is null. Reproducing
the test with FFmpeg absent from `PATH` produces the same failure. Install the
`ffmpeg` package explicitly in PostgreSQL CI jobs and API browser jobs, which also
use it to create synthetic audio. Assert the track's ready status and include its
saved error before checking publication, so dependency failures remain legible.
Do not bypass probing with an invented duration in these integration tests.

The public library fixture must mock Werewolf's current
`PATCH /api/admin/werewolf/:id/visibility` endpoint and assert `{hidden:true}`;
Influence still uses its own hide action. W7A's fake decision provider must return
the exact `solo_target` response with its private explanation and handle the
current speaking-priority contract. Do not weaken production validation to accept
obsolete fixtures.

Studio verifies authenticated recording bytes and plays a local blob URL. The
MCP cut browser journey must identify that playing audio element rather than
waiting for its `currentSrc` to contain the former public `/api/games/` path.
Keep the elapsed-time and rewind assertions on that element: changing the URL
expectation must not weaken the playback continuity test.

The original Werewolf portrait-room fix reserved rear-row labels above the
speaker. The October 29 layout revision deliberately allows speech to cover
those listeners so ordinary turns can use the available space before paginating.
Keep the ring independent of fitted message size and preserve the front portrait
and name inside short stages. Browser checks now verify that speech clears the
active head and its caret points close to that speaker; a blanket prohibition on
rear-label overlap contradicts the intended layout. The shared component supplies
the same layout to Influence, Werewolf and sampled exports without changing
canonical history or media identities.
Restore mocked Happy DOM dimension descriptors in `finally`: its HTMLElement
prototype is shared across windows, so a short-stage unit fixture can otherwise
activate typography measurement in unrelated later tests.

Music browser instrumentation must count media elements attached through
`AudioContext.createMediaElementSource`, rather than every `new Audio()` call.
The voice controller primes a separate unlock element during a user gesture.
Keep the exact two-deck music ownership assertion through fullscreen transitions
and the transport/loop checks scoped to the music graph.

Format-viewer fixtures must answer the audio metadata endpoint with JSON `null`
when there are no recordings. Their generic 404 caused the real voice controller
to pause playback, cascading into missing bubbles, music and navigation. An
Empower v2 story also needs its frozen revote version explicitly set; omission
correctly selects historical v1 behavior.
Introduction shots use the Lobby room backdrop. Their fullscreen tests should
decode that declared image and retain geometry checks, rather than requiring the
former two-image stage backdrop implementation.
After fullscreen or viewport changes, poll the bubble and speaker geometry in
one browser evaluation. The DOM can have its new width before ResizeObserver
updates the portrait layout; sampling that transient state produced an 18px
centering error in CI. Keep the original 2px alignment tolerance.

Werewolf phase entries are playable House cues. Browser journeys should select
canonical speech or room-navigation entries instead of assuming cursor 1 is a
contestant's speech, or that one arrow always bypasses House narration. Public
fixtures must carry valid frozen provider manifests, since one malformed game
can make the library request fail for later tests. Scope library actions to the
intended game card when several fixtures are present.
The wolf-transformation timing story needs its own browser context. Earlier
stories deliberately persist Show thinking; those saved thoughts add time to the
viewer timeline, while this story's seeks use speech-only timings. In CI a
5250ms thought shifted the requested frame into the preceding House cue. Isolate
the story's preferences rather than adjusting otherwise-correct seek arithmetic.

A subsequent PostgreSQL run exposed a cutout publication race: PostgreSQL saves
`ready_at` with microseconds, while an immediate JavaScript `new Date()` cutoff
can still be at the start of that millisecond. An accepted ready cutout was
therefore occasionally missing from a live read. Use the database clock when no
cutoff is supplied. Explicit frozen Date cutoffs retain their exact comparison;
this adds no compatibility path and changes no saved assets or snapshots. A
deterministic test reproduces the sub-millisecond boundary before checking both
live visibility and the unchanged frozen cutoff.
