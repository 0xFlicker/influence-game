---
title: Stable Player input props prevent repeated voice rewinds
module: Production Studio
problem_type: ui_bug
date: 2026-10-25
tags: [remotion, player, audio, clock, playback]
---

# Studio voice repeatedly replayed part of a line

## Evidence and cause

In the actual `hard-smoke-rune` Studio cut, 8.098 seconds of elapsed time advanced the composition by only 4.6 seconds. Voice and music repeatedly jumped backward by roughly 0.65 seconds. No recording regeneration was needed.

`ProductionPreview` updates its playhead state on every Player frame event. Its inline `inputProps={{manifest, preview: true}}` created a new object on every update. In the installed Remotion 4.0.486 Player, that object participates in the composition-manager/video-config memo. Changing the config restarts the playback effect and resets its elapsed-time accumulator. Repeated resets lose fractional-frame time; native audio continues normally until Remotion seeks it backward to the slower composition clock.

## Fix

Memoize the complete Player input-props object by the already memoized manifest. Preserve the existing Player, buffering, mute, seeking and media owners. Do not increase allowed audio drift, disable synchronization, add a second playback clock, patch Remotion, or rewrite recorded media.

The actual game then advanced 11.033 seconds over 11.021 elapsed seconds, with no voice/music rewinds and no buffering in that sample.

## Regression proof

Extend the isolated Studio browser proof with a deterministic 12-second MP3, enable sound, and sample six seconds while the voice is active. Require zero backward jumps greater than 100 ms and composition progress within 10% of elapsed wall time. The test reproduced the defect before the fix: 6.021 elapsed seconds, 4.0 timeline seconds and three rewinds. It also retains exact cut membership, music settings, frozen recording bindings and changed-tag review protection.

Short tests that merely see a frame advance miss this failure: the old clock advanced, just too slowly, and sub-second recordings ended before repeated resynchronization became observable.
