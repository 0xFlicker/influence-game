---
title: Faster replay export through readiness and render concurrency
type: perf
status: planned
date: 2026-10-08
---

# Faster replay export through readiness and render concurrency

Reduce local `bun run replay:export` wall time by removing repeated frame-settling work and allowing bounded parallel frame rendering. Preserve the current picture, typography, timing, audio, arbitrary-frame behavior, and failure guarantees. Implement readiness first at concurrency 1, then measure concurrency independently.

## Scope and current evidence

The review identified two concrete costs:

- `src/remotion/house-replay/frame.tsx`: `PreparedFrame` runs for every output frame, including encoding with frozen layouts. It awaits fonts, decodes every mounted image twice, waits for four animation-frame callbacks, and updates React state before releasing the frame.
- `src/lib/replay-export/render.ts`: both the layout prepass and `renderMedia` use `concurrency: 1`. Encoding cannot distribute frames across browser workers.

All source paths below are relative to `packages/web/` unless specified otherwise. The installed Remotion renderer accepts a `concurrency` option on `renderMedia`; check its installed validation and resolution helpers when implementing the CLI setting.

The existing frame verifier checks forward/reverse samples, three contiguous ranges, and one fresh-browser frame. It does not establish equivalence across concurrent workers or against the old readiness implementation. Existing render durations in `docs/local-replay-export.md` are historical context, not a controlled performance baseline for this change.

Keep web player optimization, download/probe parallelism, bundler caching, new codecs, hardware encoding, distributed workers, and audio redesign outside this change. No provider calls or new game generation are needed.

## Implementation sequence

### 1. Capture a reproducible baseline

Use existing local frozen bundles or deterministic canonical fixtures. Record the renderer revision, bundle hash, selected cue range, resolution, fps, motion/thinking settings, tool versions, and machine CPU/memory. Keep an untouched copy of the fixture: `withPreparedReplay` currently writes measured layouts back into its manifest.

Select short excerpts that collectively include:

- Werewolf opening video and sound effects; scene and portrait thought entrance, reading and return; overview-to-group image changes; transformation; ballots and tally.
- Influence scene/portrait speech, long paginated text, representative format entrances and a final result.
- A recorded speech fixture with a range beginning partway through the soundtrack.

Use 1080p/30fps for the main performance comparison. Keep lower-resolution runs as smoke checks. Capture reference PNGs with the current implementation before changing readiness, plus one encoded audio/video reference excerpt.

Add minimal elapsed-time reporting at the existing orchestration boundaries: bundling, layout prepass, `renderMedia`, and validation/finalization. Treat `renderMedia` time as rendering plus encoding unless the installed API provides reliable separate measurements. Preserve total elapsed time and record resolved render concurrency in the receipt. Do not log cue text or credentials.

Measure peak process-tree memory with host tooling; a parent-process RSS value does not represent Chromium and encoder memory. Run one cold invocation and three comparable warm invocations per benchmark configuration, reporting warm medians separately. Do not run configurations simultaneously.

**Gate:** reference frames and reproducible timings exist before optimization begins.

### 2. Separate measurement readiness from encoding readiness

Keep the layout prepass sequential. It owns font settling, DOM measurement, captured typography/pages, and artifact emission. Preserve its current settling procedure initially so only the encoding path changes.

Replace the encoding use of the full measurement barrier with a small export-only readiness boundary:

1. Await required fonts once per browser document. Each worker has its own document and must initialize independently.
2. Wait for the assets actually required by the sampled frame. Deduplicate successful decode work within that document; newly mounted elements and changed sources still need readiness checks. Do not equate manifest dimensions or a completed network request with decoded image readiness.
3. Identify readiness changes from mounted assets and layout dependencies, not just the cue key. Assets can change within a cue: overview/group cuts, crossfades, transformations and opening transitions must all be covered. Audit CSS backgrounds and other non-`img` media before removing the existing barrier.
4. Retain Remotion's `OffthreadVideo` readiness for sampled opening frames. Do not replace it with HTML video playback timing or a fixed delay.
5. Release a frame only after required React layout/state updates have committed. Audit `VisualSceneView`, `SoloPresentation`, `TimedSpeech`, `useBubbleTypography`, and sampled format entrances for first-mount measurement dependencies. Frozen text does not eliminate container measurement or the need to apply sampled styles.

Use the smallest explicit readiness mechanism that covers those dependencies. If a transition still needs a layout-settling pass, run it when that dependency changes; do not impose four animation frames on every unchanged frame. Avoid a generic readiness registry or global mutable state shared across workers.

Every acquired render handle must be released on success, replacement, unmount, or cancellation. A stale asynchronous decode must not release a newer frame. Failed required fonts/assets and incomplete frozen layout coverage must fail with an understandable cue/asset diagnostic rather than producing a blank frame or silently doing timing-dependent pagination during encoding. If the existing two-samples-per-cue prepass misses a required layout, extend its coverage narrowly before enabling the faster path.

Do not retain a permanent old/new readiness flag. Baseline artifacts provide the comparison; the final implementation has a measurement path and an encoding path with distinct responsibilities.

**Gate:** concurrency-1 output matches baseline reference frames and audio, including fresh-document and transition cases, without the unconditional per-frame settling loop.

### 3. Add bounded render concurrency

Add `--concurrency N` as an execution option for both slug and `--bundle` invocations. Validate a positive integer and enforce the installed renderer's supported host limit before expensive preparation. Update the bundle-option allowlist and help text. Do not persist this execution choice as frozen presentation data or require a manifest migration.

Thread the resolved value through `renderReplay` into `renderMedia`. Keep layout measurement at 1; workers consume the completed, immutable manifest and must never capture layouts or write the bundle themselves. Record requested/default selection and the actual resolved worker count in the receipt.

Benchmark the new readiness path at 1, 2 and 4 workers where supported. Select the lowest count that achieves the best practical throughput without excessive memory growth; cap the automatic default at 4 and at the supported host capacity. Prefer 2 if 4 adds little throughput or causes memory pressure. The final default must follow these measurements, not an assumed linear speedup. Retain explicit `--concurrency 1` for constrained machines and diagnostics.

Do not automatically retry a failed concurrent render at a lower count. Surface the failure, clean up all workers and temporary output, and suggest a lower explicit count when appropriate. Preserve existing overwrite refusal, atomic output promotion, checksum receipt and ffprobe validation.

**Gate:** concurrent output is frame-equivalent to concurrency 1, cancellation cleans up every worker, and the chosen default improves measured total render time.

## Verification

Extend `src/scripts/verify-house-replay-export.ts` rather than building a separate renderer harness. Keep it an opt-in local proof over frozen inputs.

| Check | Required evidence |
|---|---|
| Baseline parity | PNG pixels match the old implementation for representative frames at the same geometry and environment. No tolerance added simply to hide a readiness race. |
| Order independence | Forward, reverse, isolated cold-browser frames and contiguous ranges agree. Include the first frame, cue boundaries and intra-cue asset changes. |
| Worker independence | Render sufficiently long ranges at concurrency 1, 2 and 4 so multiple workers participate; compare each output frame against the concurrency-1 run. |
| Layout | Long speech and thinking retain font size, page boundaries and visible pages; no first-frame zero-size layout, loading state or one-frame flash. |
| Slow and failed assets | Delayed images/fonts block only dependent frames and do not capture early; broken assets fail clearly. Exercise source replacement while a decode is pending. |
| Audio | Decode representative encoded excerpts and compare speech/effect positions, duration and fades with the existing one-frame-plus-codec tolerance. Do not demand identical MP4 bytes. |
| Cleanup | Interrupt measurement and concurrent encoding; confirm no orphan renderer processes or partial final movie, and that the prepared bundle and previous output survive. |
| CLI | Reject invalid concurrency values early; accept the option with a frozen bundle; receipts report the resolved value. |

Add focused tests for lifecycle races, CLI validation and worker-option plumbing. Keep Chromium/ffmpeg proof out of ordinary provider-free unit discovery unless the repository explicitly classifies the harness for that environment. Use existing test infrastructure and Bun only.

Run required merge checks: `bun run test`, `bun run test:postgres`, and `bun run check`. PostgreSQL checks remain required by repository policy even though this change should not alter API behavior. Report local render proof separately from these baselines; neither establishes staging or production behavior.

## Performance acceptance and delivery

Compare three stages using the same fixtures and settings:

1. Original readiness, concurrency 1.
2. Optimized readiness, concurrency 1.
3. Optimized readiness, selected concurrency.

Target at least a 25% reduction in median `renderMedia` wall time on the representative 1080p excerpts versus the original baseline, with no correctness regression. This is an acceptance target, not an observed result. Report total wall time, prepass time, effective frames per second and peak process-tree memory alongside it. If the target is missed, identify the measured bottleneck before expanding scope; do not claim the speed objective is complete.

After the short proofs pass, render a full existing Werewolf and Influence replay at the selected default to check sustained memory use, complete traversal and finalization. Report the resolution used explicitly. Inspect transition-heavy excerpts visually and listen to the recorded-audio proof. No new provider-backed games are necessary.

Update `docs/local-replay-export.md` with the concurrency option, execution-versus-presentation distinction, measured benchmark table, machine/settings, and remaining limitations. Record any non-obvious readiness solution in `docs/solutions/`. Keep performance measurements and private replay artifacts local; commit only suitable summaries and deterministic fixtures.

Deliver in reviewable steps: baseline/verification instrumentation, readiness optimization with concurrency-1 proof, then concurrency/default selection with comparative measurements. Each step leaves the exporter working end to end.

## References

- [Original exporter plan](2026-10-07-001-feat-local-house-replay-export.md)
- [Exporter usage and existing local evidence](../local-replay-export.md)
- `packages/web/src/remotion/house-replay/frame.tsx`
- `packages/web/src/lib/replay-export/render.ts`
- `packages/web/src/scripts/export-house-replay.ts`
- `packages/web/src/scripts/verify-house-replay-export.ts`
