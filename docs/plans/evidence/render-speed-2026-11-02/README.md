# Render-speed review and implementation evidence

Current results for [the revised plan](../../2026-11-02-render-speed-100x.md):

- [Implementation audit](implementation-audit.md) and [validation ledger](implementation-validation.json).
- [Full-input preparation](actual-preparation-benchmark.json), [render concurrency](actual-render-benchmark.json) and [combined benchmark](combined-render-benchmark.json).
- [Linux correctness proof, including retained failure and recovery](linux-worker-proof.json).

## Initial planning experiment — 2026-11-02

The historical experiment below preceded implementation. No product renderer,
dependency, infrastructure or deployment changes were made during that experiment.
Subsequent authorized implementation and its qualification are linked above.

The [full Influence follow-up](influence-followup.md) extends this initial
Werewolf test with complete-input preparation, discarded-screenshot experiments,
conversation/thinking/opening renders, sampled resources and decoded comparisons.
Its machine-readable results are in [influence-followup.json](influence-followup.json).
Keep those results distinct from the earlier fixture below.

## Inputs and provenance

- Reviewed and benchmarked code: `codex/shared-batch-rendering`,
  `99819e431701a180dedefcde73d7803c0f75e858`; source checkout was clean before and
  after the experiment. The plan branch is based on this commit.
- Native Apple M5 Max, 18 logical CPUs, 36 GiB RAM; other desktop/Docker/Bun
  processes were running. This was not a reserved benchmark machine.
- Bun 1.3.14; installed Remotion renderer/bundler/core 4.0.486; existing cached
  Chrome Headless Shell 149.0.7790.0, mac-arm64.
- Read saved `grim-amber-coal`, `hard-smoke-rune`, `neat-black-orb` manifests and
  the first two export receipts. [manifest-census.json](manifest-census.json)
  retains file hashes, sizes, timing categories, counts and receipt provenance.
  File hashes cover saved bytes; receipt manifest hashes cover serialization and
  preparation state and are not assumed to equal the saved file-byte hash.
- Benchmark used a copied `grim-amber-coal.bundle`, with `range` set in memory to
  `[3600,3900)`. Full cue and audio context remained present. Historical source
  and measured layouts were retained; there was no fresh layout or source rebuild.

## Concurrency experiment

The disposable harness imported `withPreparedReplay` from the clean target
checkout and the installed renderer. It copied the saved bundle into this worktree's
ignored evidence directory. It prepared one serve URL, selected `HouseReplay`,
then called `renderMedia` serially for concurrency `1,2,4,8,1`. Each render used
a fresh browser, H.264/AAC and the current exporter defaults. A five-minute abort
bounded the rendering phase. `onStart`, unmodified `ffmpegOverride` arguments and
slowest-frame results were retained. No dependency download was necessary for
the successful native run.

The first sandbox attempt reached bundling but could not download a default
browser (`ECONNREFUSED`); a cache write was also denied. It produced no benchmark
result. The successful run explicitly selected the existing cached browser and
ran outside the sandbox. Build caches may therefore have been warm. Original
source and saved input bundles were unchanged.

| Concurrency | Seconds | Effective output fps |
| --- | --- | --- |
| 1 | 23.351 | 12.85 |
| 2 | 12.307 | 24.38 |
| 4 | 7.530 | 39.84 |
| 8 | 6.015 | 49.87 |
| 1, repeated | 23.238 | 12.91 |

Shared preparation was 3.405 seconds, excluded from all rows. Input-copy time,
select-composition time, cloud queue/startup, upload and verification are not in
these render-call measurements. The observed 3.88× is a **10-second sample** gain.
No per-configuration RAM/CPU/scratch profile or distribution of full-match timings
was collected. Do not treat the fastest row as a safe fleet default.

All `onStart` events reported `parallelEncoding: false`. The installed source
requires enough estimated free memory in addition to the API's default allowance.
No verbose free-memory reading was captured, so retain that distinction from a
complete resource profile. The actual stitch command used JPEG images, libx264,
CRF 18, yuv420p, video timescale 90000, faststart and copied preprocessed AAC.

[concurrency.json](concurrency.json) retains results, resolved start settings,
redacted FFmpeg arguments, slowest frames and output checks. Temporary absolute
paths were replaced with local-path placeholders; no source dialogue or assets
are committed as evidence.

## Output verification

For each of five videos:

```sh
ffprobe -v error -count_frames -show_streams -of json <video.mp4>
ffmpeg -v error -i <video.mp4> -map 0:v:0 -f framemd5 -
ffmpeg -v error -i <video.mp4> -map 0:a:0 -f md5 -
```

All outputs had 300 decoded H.264 frames, 1920×1080, 30/1 fps, video duration
10.000 seconds, and stereo AAC at 48 kHz. Every decoded video frame hash matched
the first run, and decoded audio hashes matched. AAC stream duration was 10.048
seconds in all runs; container/audio padding is not the video duration.

This proves equivalence between the five concurrency settings for that sampled
output. It does **not** prove source-to-viewer/Studio parity, output against
lossless browser reference, mixed-audio alignment, static-span reuse, newer
Remotion performance, native Linux performance, or cloud performance.

## Focused tests

Run against the clean target checkout's exact reviewed code and existing locked
dependencies:

```sh
bun test ./packages/web/src/lib/replay-export/timing.test.ts \
  ./packages/web/src/lib/replay-export/audio.test.ts \
  ./packages/web/src/lib/replay-export/room-continuity.test.ts --max-concurrency 1
```

Result: **17 passed, 0 failed, 74 assertions**. No PostgreSQL, providers, remote
object writes or deployment was used. Broad repository baselines were not run
for the documentation-only change. These tests do not prove a new renderer.

## Retained local artifacts and reproduction

All generated/private evidence is under
`.renders/render-speed-review-2026-11-02/` in the plan worktree:

- `benchmark.ts`: disposable exact harness, with local source/dependency paths.
- `benchmark.log`: unsuccessful sandbox attempt.
- `benchmark-native.log`: successful serial sweep.
- `benchmark.bundle/`: copied saved bundle; original remains untouched.
- `concurrency.json`, `concurrency-*-run-*.mp4`: complete local results/output.
- `analyze.py`, `analysis.log`, `*.framemd5`: decoding and comparison evidence.
- `focused-tests.log`: focused test result.

To repeat, use a new output directory, the recorded code and installed versions,
the same hashed saved source, and the harness's explicit cached browser. Preserve
`[3600,3900)`, all full-context arrays and measured layouts; execute the sweep
serially. Do not reuse these numbers if the source, browser, preparation, motion,
audio, geometry or resource conditions change. The follow-up supplies bounded
Influence conversation/thinking/opening coverage. Aligned-recording, other
motion/page transitions, native-worker and full-duration qualification remain.

Latest: [both-game video qualification](video-preparation-proof.md) passes sampled movie checks but exposes an Influence preparation mismatch.

Latest investigation: [empty-layout tracing and repeated controls](empty-layout-trace.md).

[Isolated readiness and concurrency controls](readiness-isolation.md) reproduce picture variability at one tab; two isolated preparations pass.

[Browser capture and encoder isolation](capture-isolation.md): repeated captures and identical-input encodes match; intermittent earlier failures remain unexplained.

[Confirmed avatar reload loop and initial fix](../../../solutions/ui-bugs/2026-11-03-avatar-image-load-feedback-loop.md), [diagnostic traces](avatar-feedback-trace.json), and [actual-worktree output checks](avatar-fixed-render.json).

The subsequent [hidden lazy-image diagnosis](../../../solutions/ui-bugs/2026-11-03-hidden-lazy-image-export-readiness.md)
reproduces the preparation stall at [both exact format-menu coordinates](cold-format-readiness.json).
[Full-input eager-readiness trials](eager-readiness-qualification.json),
[Influence encoded comparisons](eager-influence-output.json), and
[Werewolf manifest/movie comparisons](eager-werewolf-output.json) pass. The owning
changes are implemented; final actual-code benchmarks and repository/Studio parity
validation remain outstanding. These newer results qualify screenshot-free
preparation without discarding the failed historical trials above.
