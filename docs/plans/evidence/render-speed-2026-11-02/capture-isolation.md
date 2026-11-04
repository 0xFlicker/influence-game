# Browser capture and encoder isolation

2026-11-03. Local disposable experiments; no product changes. Same immutable
PNG-prepared Influence manifest, thinking cue 302, first 300 output frames,
1920×1080/30 fps. Existing readiness barriers and presentation were retained.

## Results

- Two one-tab `renderFrames` PNG sequences: all 300 decoded RGB frames match.
- Two one-tab `renderFrames` JPEG sequences: all 300 decoded RGB frames match.
- Encoding the same retained JPEG sequence twice using the installed Remotion
  bundled FFmpeg/libx264, CRF 18, yuv420p, 90 kHz timebase: all 300 decoded video
  frames/timestamps match. This was video-only encoder isolation, not an audio test.
- Four fresh one-tab `renderMedia` calls using the same manifest: each retained
  its actual JPEG input sequence before FFmpeg stitching. All 300 captured RGB
  frames and all 300 decoded movie RGB frames match across all four calls.
  Copying those temporary frames changes overhead; these calls are correctness
  diagnostics, not performance results. No FFmpeg arguments were changed.

No new mismatching trial occurred. The encoder is deterministic for the tested
identical input, but this does not establish the cause of earlier intermittent
movie differences. Both browser capture and encoder inputs must be retained when
that difference next reproduces; unrelated stable trials cannot explain it away.
No pixel tolerance or quality reduction was introduced.

The first direct bundled-FFmpeg invocation failed to load its dylibs. Re-running
with `DYLD_LIBRARY_PATH` set to the binary directory, as the installed renderer
itself does, succeeded. Failure log and successful invocation provenance remain
retained. The installed renderer's tested Chrome version is 149.0.7790.0, matching
the cached browser used here; a mismatched browser version is not established.

## Next investigation

Instrument the individual font/image/rAF readiness stages and frame ownership in
a disposable bundle, with logs that identify unresolved work on timeout. Retain
geometry and actual pre-encode frames for any repeated Safety Bounce mismatch.
The prior readiness timeout remains unexplained, and implementation is still gated
on the full correctness/reliability requirements.

[Machine-readable checks](capture-isolation.json). All scripts, captured images,
movies, FFmpeg logs and decoded hashes remain under
`.renders/capture-isolation-2026-11-03/`. No baseline inputs were overwritten.
