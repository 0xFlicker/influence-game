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

The Werewolf portrait-room browser check also caught a real layout regression:
floor-perspective speech was anchored above the front speaker while the rear
cast's name labels occupied that same area. Reserve the rear row when positioning
the bubble and move the ring down only as far as the fitted speech requires.
Bound that movement by the remaining portrait and name space: a narrow 300px
embedded stage must not push the front speaker outside its clipped container.
Keep the existing mobile label-overlap and portrait-containment assertions; the
shared component supplies the same layout to Influence, Werewolf and sampled
exports without changing canonical history or media identities.

Format-viewer fixtures must answer the audio metadata endpoint with JSON `null`
when there are no recordings. Their generic 404 caused the real voice controller
to pause playback, cascading into missing bubbles, music and navigation. An
Empower v2 story also needs its frozen revote version explicitly set; omission
correctly selects historical v1 behavior.
Introduction shots use the Lobby room backdrop. Their fullscreen tests should
decode that declared image and retain geometry checks, rather than requiring the
former two-image stage backdrop implementation.

Werewolf phase entries are playable House cues. Browser journeys should select
canonical speech or room-navigation entries instead of assuming cursor 1 is a
contestant's speech, or that one arrow always bypasses House narration. Public
fixtures must carry valid frozen provider manifests, since one malformed game
can make the library request fail for later tests. Scope library actions to the
intended game card when several fixtures are present.

A subsequent PostgreSQL run exposed a cutout publication race: PostgreSQL saves
`ready_at` with microseconds, while an immediate JavaScript `new Date()` cutoff
can still be at the start of that millisecond. An accepted ready cutout was
therefore occasionally missing from a live read. Use the database clock when no
cutoff is supplied. Explicit frozen Date cutoffs retain their exact comparison;
this adds no compatibility path and changes no saved assets or snapshots. A
deterministic test reproduces the sub-millisecond boundary before checking both
live visibility and the unchanged frozen cutoff.
