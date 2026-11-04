# Render speed: make the existing renderer faster without sacrificing quality

Status: **implemented and locally qualified; benchmarks and bounded Linux output proof complete**.
The user authorized implementation after the relevant experimental gates pass.
Both-game qualification now supports eager export image loading and screenshot-free
preparation. Required local baselines and final viewer/Studio/export proofs now pass;
combined local benchmarks are complete. Platform proof and remaining measurement limitations are tracked below.

## Offline Linux worker correctness — 2026-11-03

The existing x86_64 worker image, matched dependency lock, installed Chromium and
current source produced 18 diagnostic clips across both games: 1,080 decoded
frames, timestamps and audio match exactly between PNG and screenshot-free
preparation. Both prepared manifests also match exactly. The cuts include opening,
gameplay, Safety Bounce, thinking, format menus and Werewolf ending content, using
the existing presentation/audio compiler and the same `renderReplay` entry point
as Batch. Original source art and voice bytes remain unchanged.

The first multi-render diagnostic container completed 17 clips, then hit its
512-task limit with 344 unreaped Chromium children under Bun PID 1. Its failure
is retained. A fresh otherwise matched container with Docker `--init` completed
the last clip and exact comparison. This is a harness lifecycle finding, not a
claim that the initial 18-clip run passed. No production container configuration
was changed. The image also emitted nonfatal webpack cache-permission warnings.

This offline, emulated Linux proof establishes bounded output correctness only;
it does not qualify native worker performance or a concurrency default.
[Environment, counts, failure and recovery](evidence/render-speed-2026-11-02/linux-worker-proof.json).

## Additional geometry and startup evidence — 2026-11-03

The final implementation passes 54 additional exact viewer/export captures at
1920×1080, 1024×280 and 375×667, in normal and reduced motion, including reverse
sampling and six fresh encoded clips. Cases cover format menus, Safety Chain and
Werewolf vote/result scenes. Raw evidence is retained under
`.renders/extended-geometry-proof-2026-11-03/output/`.

A separate instrumented API preparation probe could not load the original saved
selection: authorization returned `Pinned Influence accepted source changed;
reload the source explicitly`. The server compares the pinned accepted-source
hash before allowing preparation. The original selection and bundle were preserved;
no source was silently refreshed. Thus the recalled >12-minute whole startup is
still unattributed. The complete-input offline measurements below establish layout
preparation savings, not remote binding/download savings. A future whole-startup
benchmark requires an explicitly refreshed source fixture or a server that can
honor the original pin.

## Actual implementation preparation benchmark — 2026-11-03

Eight serial full-input trials now complete with the final product code. Controls
restore only the unused PNG captures; both modes use the same readiness and
Safety Bounce fixes. Each game ran PNG / none / none / PNG with fresh layout
preparation, immutable saved inputs and the same installed browser.

| Game | Cues | PNG median | Screenshot-free median | Speedup | Time saved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Werewolf | 130 | 33.514 s | 15.533 s | 2.16× | 17.982 s |
| Influence | 688 | 239.761 s | 75.180 s | 3.19× | 164.581 s |

All Werewolf manifests match exactly. The first Influence screenshot-free manifest
matches exactly; the second substitutes the previously traced empty-speech key
with identical cached values. All non-layout fields and all common layout values
match, including the closing PNG control. This is the known no-speech measurement
variation, covered by the prior affected-output and poisoned-layout experiments.

[Trial timings, source hashes and exact differences](evidence/render-speed-2026-11-02/actual-preparation-benchmark.json).
These are offline preparation results on the local M5 Max, two observations per
mode. They exclude API binding/downloads and movie encoding. Two-minute movie
concurrency trials are complete; no full-match throughput claim follows from this
table, and preparation and encoding speedup ratios must not be multiplied.

## Combined preparation and rendering benchmark — 2026-11-03

The paired workflow measurement now passes for both games. Each trial freshly
prepares the complete saved input, then selects and encodes the same two-minute
1920×1080/30fps range through the existing renderer. Total time includes browser
bundling/layout preparation, composition selection, encoding and scratch cleanup;
asset copy is timed separately. The controls restore unused PNG preparation
capture and use one rendering worker. Candidates skip that capture and use four.

| Game | PNG + one worker | Screenshot-free + four workers | Measured combined speedup |
| --- | ---: | ---: | ---: |
| Werewolf | 301.230 s | 99.194 s | 3.04× |
| Influence | 783.856 s | 244.330 s | 3.21× |

All four movies match their game-specific controls in every decoded frame,
timestamp and full decoded audio stream: 14,400 frames total. This is one matched
combined pair per game, supported by the separate repeated preparation and
concurrency trials. It is not the product of their speedup ratios, and does not
include API binding/downloads or establish a full-match encode time.
[Raw component times and output comparison](evidence/render-speed-2026-11-02/combined-render-benchmark.json).

## Longer movie benchmark — 2026-11-03

Two-minute 1920×1080/30fps gameplay ranges now have exact decoded movie comparisons.
The Influence matrix completes all four serial trials: 545.373 / 168.782 /
173.221 / 540.160 seconds at one / four / four / one workers. Median time falls
from **542.766 to 171.001 seconds (3.17×)**. Every decoded frame, timestamp and
full decoded audio stream matches across all four movies, 14,400 frames total.

Frame rendering dominates: Remotion reports 530.858 s rendering and 14.268 s
encoding in the first one-worker run, versus 152.425–156.746 s rendering and
16.086–16.199 s encoding in the four-worker runs. Recorded resolved concurrency
is exactly one/four as requested; encoding settings and audio scheduling are unchanged.

Werewolf's first one-worker render took 265.721 s; four-worker repeats took
84.138 and 85.577 s (3.13× against that completed control). All three movies match
every decoded frame, timestamp and decoded audio, 10,800 frames total. The closing
one-worker control failed on a localhost 404 for a speech recording. Its original
bundle asset is intact. A fresh instrumented control completed in 264.679 s and
also matches all 3,600 frames/timestamps/audio, with original and temporary asset
hashes intact. The 404's cause remains unestablished; it is retained as a failed
trial, not silently replaced with the recovery timing.

[Timing, phase, concurrency, memory and decoded-output evidence](evidence/render-speed-2026-11-02/actual-render-benchmark.json).
[Retained failure and diagnostic recovery](evidence/render-speed-2026-11-02/actual-render-partial.json).
These are local desktop results for bounded ranges, not full-match or Linux worker
qualification. The paired fresh preparation-plus-render benchmark also passes, as reported above.

## Final-validation findings — 2026-11-03

The final product provider-free baseline passes 3,305 tests (5 skipped), and repository-wide
typecheck/lint passes, including the later diagnostic comparator. The earlier maintained presentation proof passes 42 pixel-identical
viewer/export captures, reverse sampling and three encoded clips. Removing eager
loading in a disposable build makes its new format-menu fixture time out, proving
the regression check exercises the readiness fix.

Actual Studio Source/Selected-cut checks and four encoded scenarios pass, but the
Influence ballot export fails strict still-versus-sequential capture equality.
The retained failure changes seven pixels on a rounded card edge (maximum channel
difference 6/255). Three loader-based original-renderer controls pass and three
current controls fail. Split experiments initially implicated the shared avatar
callback change; eager loading alone passed. However, an actual-code rerun after
restoring original avatar behavior still differs at the same seven pixels during
random seek. The split controls therefore do not establish the complete cause.
A direct unmodified-checkout comparison without loaders subsequently reproduced
the mismatch in all three reference runs. The unchanged reference and final code
produce exactly the same two raw-pixel variants. Their difference is seven pixels
in one 2×4 rounded-edge region, maximum RGB channel difference 6, total RGB
difference 74; alpha is unchanged. [Raw variants and pairwise measurement](evidence/render-speed-2026-11-02/clean-ballot-raster.json).
This establishes pre-existing capture variation, rather than attributing it to
the performance changes from the earlier loader-based controls.

The diagnostic replay verifier now compares decoded RGBA after an unequal PNG
hash, admitting only that measured absolute budget (7 pixels / 6 levels / 74 total),
with exact alpha and geometry. It records every non-exact comparison in its proof.
Negative tests reject brighter single-pixel changes, extra changed pixels, excess
total difference, alpha changes, missing text and shifts. This changes no movie
capture/encoding setting and is not frame reuse. Before/after encoded movie
comparisons remain exact. Four fresh actual-code ballot movies, alternating the unchanged reference and final
implementation, match all 126 decoded frames per movie, timestamps and decoded
audio exactly. [Movie comparison](evidence/render-speed-2026-11-02/ballot-movie-comparison.json).
The final Studio rerun passes all six selected tests (69 assertions), including
Source/Selected-cut behavior, five encoded scenarios and the ballot check; its
owned database cleanup completed. The final maintained presentation proof also
passes 42 exact viewer/export captures, reverse sampling and three fresh clips.
The replacement Safety Bounce observer guard ignores repeated notifications
for the same image source, dimensions and event type while retaining original
avatar behavior. Three full-input preparations completed, and two candidate movie
sets match all 6,770 decoded frames, timestamps and audio against the reference.
It is now applied in place of the shared-avatar callback change. Its mounted
regression passes and fails against the original observer; final actual-code
Studio checks and local benchmarks now pass.

An earlier Studio run reported a teardown-hook timeout; its owned database cleanup
was checked separately. The initial PostgreSQL baseline used an existing shared
test schema missing this branch's `source_render_version` column. That task-owned
run was stopped, its log retained, and the full suite restarted against a new
disposable database. The previously failing render-order tests pass there; the
fresh-database suite now passes all 2,342 tests with 32,065 assertions and no
failures. Clean full-input preparation benchmarks now pass; longer movie benchmarks are complete with the retained Werewolf 404 described above.

An intermediate provider-free rerun found a missing `document.fonts.ready` stub
in the new observer test. After supplying it, the full privileged baseline passes
3,305 tests (5 skipped), and repository-wide typecheck/lint passes. The subsequent
capture comparator's focused tests, repository-wide checks and final browser
integration checks also pass. Failed intermediate runs are retained.
[Current validation ledger](evidence/render-speed-2026-11-02/implementation-validation.json)
distinguishes final completed checks from retained intermediate failures.
Reviewed 2026-11-02 against `codex/shared-batch-rendering` at
`99819e431701a180dedefcde73d7803c0f75e858`. This revision lives on
`codex/render-speed-plan`, based on that commit. The original draft was an
uncommitted file in the main development checkout, not a file in the target
branch; that checkout and draft remain untouched.

## Confirmed avatar feedback loop — 2026-11-03

Readiness/geometry instrumentation exposed runaway Safety Bounce rerenders after
a frame's readiness release. The shared avatar's inline error callback changes
on each parent render; installed Next Image resets the image source when that
callback changes. The parent's load observer updates state, completing the loop.
A browser reproduction with the real components reached a cap of 100 loads and
100 renders; a stable callback produced one load and two renders. Three full-input
experimental preparations with the stable callback completed, with no changed
values on common layout keys; any key-set differences concern empty text.

The first callback candidate was applied to the shared component. Its regression
failed against the original callback and passed with the candidate, including
current-source error/fallback coverage. Four actual-worktree renders matched prior
captured frames, decoded movie frames and audio exactly. Broader Studio parity
later exposed the ballot capture regression described above, so this candidate
was replaced by the scene-specific observer guard. These earlier checks remain
historical evidence, not validation of the final implementation.
See [the diagnosed reload loop](../solutions/ui-bugs/2026-11-03-avatar-image-load-feedback-loop.md).

### Post-fix qualification: another PNG readiness timeout

Fresh full-input preparation using this worktree's actual avatar fix completed
for Werewolf in both PNG and screenshot-free modes (35.958 and 17.169 seconds),
with identical entire prepared manifests. These are individual local observations,
not repeated benchmark estimates. Both modes also produced complete opening and
gameplay comparison movies: all 999 opening frames and 300 gameplay frames have
exactly equal decoded pixels, timestamps and decoded audio. See the
[post-fix Werewolf results](evidence/render-speed-2026-11-02/post-fix-werewolf-qualification.json).

The next full Influence PNG control failed at measurement frame 796 after its
unchanged 58-second readiness deadline. Thus the avatar fix does **not** establish
that preparation stalls are resolved, and the failure is not specific to removing
screenshots. Preserve this failed trial under
`.renders/fixed-preparation-qualification-2026-11-03/influence-png-prepare/`.
Serial PNG/none repeats with readiness tracing are underway under
`.renders/fixed-readiness-followup-2026-11-03/`; these diagnostic runs are not clean
performance benchmarks. Screenshot-free production implementation remains gated.

The traced second PNG control reproduced frame 796's timeout: exactly one image
decode (first pass, image index 3) never completed. Both frame 796 and the original
frame 942 select `format_menu`, which renders a lazy Next Image portrait inside
a CSS-hidden fallback when full-body art is shown. A separate Chromium fixture
using the actual avatar confirms the mechanism: a hidden lazy image remains
incomplete with its decode pending; setting its loading mode to eager completes
that same decode while the image remains hidden. See the
[trace and reproduction](evidence/render-speed-2026-11-02/hidden-image-readiness.json).
This directly diagnoses the reproduced PNG stall; the original frame-942 trial
had no equivalent image-level trace, so attribution there remains an inference.
Test eager loading within export readiness before implementation. Keep all image
decodes, font readiness and layout-settling passes; skipping hidden images is not
the proposed fix.

Three full-input eager-loading experiments (PNG, none, none) all completed their
1,376 measurements, 13,558 image decodes and every readiness release. The PNG
manifest exactly matches the fresh original PNG control. The first none manifest
also matches exactly; the second differs only in the known empty-text key, with
no changed shared values. [Detailed counts](evidence/render-speed-2026-11-02/eager-readiness-qualification.json)
are retained. Encoded comparisons and cold-start checks at frames 796/942 follow;
these results alone are not implementation or benchmark completion.

Cold-start tests now reproduce the same pending lazy portrait decode at **both
796 and 942** with the original readiness path. Eager loading completes both
exact-frame tests with no pending decode. These bounded diagnostic tests use a
10-second renderer timeout (8-second delay-render deadline), not a proposed
production timeout change; partial one-frame preparation manifests are not used
as full-input bundles. [Cold-frame results](evidence/render-speed-2026-11-02/cold-format-readiness.json).
The initial image snapshot can precede container-query settling (one client rect);
the scene's responsive fallback becomes hidden at movie geometry. The independent
already-hidden avatar fixture also reproduces and resolves the pending decode.

The subsequent Influence encoded comparison passes exactly: four sets of the
complete opening (1,530 frames), gameplay (300) and continuous Safety Bounce
handoff/speech/thinking sequence (1,555), totaling 12 movies / 13,540 decoded
frames. Eager PNG and both independently prepared eager-none candidates match
the fresh original PNG baseline in decoded pixels, frame timestamps and decoded
audio. This also tests the known empty-text key variation in actual output.
[Encoded results](evidence/render-speed-2026-11-02/eager-influence-output.json).
The equivalent eager-loading Werewolf qualification also passes: both complete
prepared manifests equal the original PNG reference, and all opening/gameplay
frames, timestamps and decoded audio match. [Werewolf results](evidence/render-speed-2026-11-02/eager-werewolf-output.json).

The owning implementation now starts image loading eagerly before awaiting each
decode and uses `imageFormat: "none"` only in the serial layout prepass. It retains
all measurement frames, both image/font/layout-settling passes, layout artifacts,
timeouts and ordinary full-frame movie encoding/audio. The parity proof now
starts with a format-menu fixture and encodes it, covering the lazy hidden portrait
that caused the reproduced stalls. Final actual-code checks now pass; clean benchmarks are reported above and continue
with longer movie comparisons.

## Retained intermediate investigations

The [intermediate qualification history](evidence/render-speed-2026-11-02/intermediate-qualification-history.md)
retains the raw-capture/encoder controls, intermittent failures and early both-game
video qualification. Those initial unresolved findings led to the hidden-image
and observer diagnoses above. They remain evidence, rather than current blockers.

## Recommendation

**Render every output frame with the existing shared presentation. Keep the
existing audio path. Improve preparation, concurrency, capture and redundant work.**

The user clarified that “100×” is aspirational: any measured speed improvement is
valuable. There is no minimum multiplier or deadline that justifies added quality
risk. They also recall **more than 12 minutes of preparation for a two-hour
Influence game**. Treat that as a priority to investigate, with the duration and
phase attribution still to be confirmed from a timed run.

Frame deduplication, similarity-based decisions, static-span substitution, sparse
rendering and interpolated/skipped animation frames are excluded from this plan,
including proposals described as exact or conservative. Do not add those decisions
to a live player or export renderer. No reductions in resolution, fps, readability,
animation or encoding quality. Prepared asset/layout caching is distinct from
reusing rendered movie frames and must retain exact input identity and correctness.

Distributed sharding and a replacement audio mixer are deferred. They are not
prerequisites to making the current renderer faster. Reconsider distribution only
as a separate, evidence-backed proposal after simpler improvements have delivered
their gains. No new distributed state machine is part of the initial work.

Preserve 1920×1080 at 30 fps, readable duration, every native animation frame,
frozen media, picture, sound and audience boundaries. There is no approval here
to shorten the movie, lower quality, change presentation, deploy, or spend on a
cloud experiment. GPU encoders and a replacement stage renderer are not required.
Continue using the existing Batch service; adopting Remotion Lambda or another
cloud rendering control plane is outside this plan.

## Objective and measurement boundary

Use **order accepted → verified output available** as the primary user latency.
Also report queue/startup, worker-only time, warm render-only time, total compute,
and cost separately. A fast encode receipt does not measure the whole service.

The reported starting point is about six minutes of work per minute of video,
with some 20-minute cuts taking 100 minutes or more. Keep each actual run's
denominator and report seconds/minutes saved as well as relative speedup.

Retire the earlier ≤2-minute / ≤15-minute targets and literal 100× calculations as
acceptance criteria. **Success is a repeatable reduction in elapsed time with
unchanged output quality and no reliability regression.** Improvements can ship
independently; they do not have to add up to a dramatic headline multiplier.

Establish cold/warm latency on representative full inputs and the intended native
Linux worker shape. Report sample count, median/range and failures; a small local
sample is not a p95 estimate. Track memory, CPU, scratch and transfer costs so a
faster setting does not turn into an unreliable or unexpectedly expensive default.
Changes in paid capacity still need a concrete resource/spend proposal.

## What the code actually does

| Boundary | Current behavior / implication | Owning source |
| --- | --- | --- |
| Studio order | Freezes permitted source, selection, recordings and settings; worker may still need to prepare the bundle | `packages/api/src/services/production-render-order.ts`, `packages/web/src/lib/replay-export/prepare-selection.ts` |
| Preparation | Freezes assets, probes media, compiles timeline/audio; copies static/assets into scratch, compiles Tailwind and webpack, then copies public files again | `replay-export/assets.ts`, `prepare-selection.ts`, `render.ts` |
| Layout | When either layouts or pages are absent, renders two measurement frames **per cue**, sequentially, and writes measured manifest | `render.ts`, `remotion/house-replay/index.tsx` |
| Frame rendering | Shared `ReplayFrame`; current frame maps through absolute range and `sampleTiming`; neighboring pictures affect framing | `remotion/house-replay/frame.tsx`, `replay-export/timing.ts`, `room-continuity.ts` |
| Readiness | Every export frame decodes current document images twice, with a double-rAF after each pass: **four rAF callbacks**, plus font readiness and React commit | `PreparedFrame` in `frame.tsx` |
| Replay defaults | Concurrency 1, accepted range 1–8; `renderMedia` does not disable parallel encoding. Installed Remotion 4.0.486 defaults video capture to JPEG and x264 to `medium` | `render.ts`; installed renderer `image-format.js`, `render-media.js`, `options/x264-preset.js` |
| Trailer defaults | Separately forces `disallowParallelEncoding: true` and reads a different concurrency setting | `lib/house-highlights-trailer-media-bundle.ts:remotionMediaOptions` |
| Audio | Every frame maps the clip schedule into Remotion `Sequence`/`Audio`; non-speech gain includes fades and speech ducking | `frame.tsx`, `replay-export/audio.ts` |
| Upload/finalize | Worker hashes and uploads movie; API asynchronously reads object bytes to verify hash/length before publishing success | `scripts/render-batch-job.ts`, API `render-object-storage.ts`, `render-jobs.ts` |
| Execution | One active worker/lease per render job today; staging documentation specifies separate trailer and Studio lanes, one task each, 4 vCPU / 8 GiB total per task, 50 GiB scratch | API `render-jobs.ts`, [Batch staging](../deployment/batch-render-staging.md) |

Web paths in the table are under `packages/web/src/` unless fully qualified.
Repository configuration is evidence of intended limits, not a live AWS quota
audit. Do not attribute the reported 6× runtime to Batch without its actual job,
image digest, architecture, effective resource limits and timings. Replay and
trailer environment variables are not interchangeable; the Batch replay worker
currently takes browser settings from the trailer helper but uses replay concurrency.

The two lanes are **workload isolation**, not two export shard slots. Never borrow
the trailer allowance for an export. The worker container uses system Chromium,
including a tailnet wrapper; a package update alone does not change that browser.

## Evidence ledger

### Verified historical evidence

Read-only receipt and manifest census is retained in
[manifest-census.json](evidence/render-speed-2026-11-02/manifest-census.json).
These are older renderer/source revisions, not a baseline of the reviewed head.
Receipts do not record concurrency, browser, effective CPU limit, or complete
phase durations. The machine is currently an Apple M5 Max, 18 logical CPUs,
36 GiB RAM; that does not establish historical execution conditions.

| Saved export | Frames / duration | Receipt elapsed | Effective fps / slowdown |
| --- | --- | --- | --- |
| Werewolf `grim-amber-coal` | 45,599 / 25.33 min | 3,877.068 s | 11.76 / 2.55× |
| Werewolf `hard-smoke-rune` | 51,778 / 28.77 min | 4,535.219 s | 11.42 / 2.63× |

The initial census's saved `neat-black-orb.bundle` is useful for scale: **688 cues, 678 audio clips,
22.56 MB manifest, 464.75 MB cached assets and 35.59 MB static assets**. It contains
no frozen layout/page entries, so the current prepass would need 1,376 frames.
The user's recollection of >12 minutes before rendering starts makes a real
full-input preparation trace a priority. The follow-up below uses a separately
retained bundle from the completed overnight render, with its own manifest hash;
do not treat the two saved copies as identical. Do not estimate preparation duration
from steady-state frame throughput: binding, downloads, probing, copying,
compilation and layout all contribute, and measurement frames may cost differently.

That bundle's range contains 234,728 frames (130.40 minutes), but its last cue ends
at 127.85 minutes. The **~153-second ending score tail** still needs the final held
picture and complete audio. Planning only cue intervals loses valid output.
This bundle is not asserted to be the user's latest selected cut.

Reading segments occupy ~70.0% / 63.6% of the two Werewolf timelines and ~71.8% of
the Influence timeline. Thinking occupies ~17.2% / 24.6% / 9.8%. These are clock
categories, not an optimization policy; every output frame remains rendered.
None of these three manifests has aligned speech cues, so they cannot qualify
recording-aligned page transitions.

### Claims from the original draft that remain hypotheses

- A finished-video re-encode at ~3.3 seconds per minute does not isolate the
  renderer's actual encode time or establish an unavoidable floor. It uses already
  compressed input; input complexity, FFmpeg build, threads, audio and overlap vary.
- The original `freezedetect`/`mpdecimate` observations have no role in the planned
  renderer. Frame deduplication and sparse rendering were rejected by the user.
- End-to-end receipt fps does not isolate screenshot cost. ~85 ms per frame is
  an aggregate, not a measured React/readiness/capture breakdown.
- Preparation is fixed per job only in part. Asset bytes, cue count, layouts and
  audio schedule scale with the selection. Their impact on a 20-minute movie
  cannot be inferred from “short cuts have startup overhead.”
- A 4-CPU Docker limit on this ARM Mac is not a native x86 cloud performance
  result; emulation is a correctness smoke only.

Local experiments and exact reproduction notes are recorded in the companion
[review evidence](evidence/render-speed-2026-11-02/README.md). Keep generated media,
private bundles and full logs under the recorded `.renders/` experiment directories.
No cloud run or fresh full parity proof is claimed by this planning revision.

### New bounded measurement on the reviewed code

Rendered the same 300-frame Werewolf range (120–130 seconds of `grim-amber-coal`)
at 1080p30, serially, using existing frozen layouts and assets. Shared preparation
took 3.405 seconds and is excluded from each row. The browser opened afresh per
render. This is a small native Mac diagnostic, not a full-match benchmark.

| Concurrency | Render + encode/audio wall time | Effective fps | Relative to first run |
| --- | --- | --- | --- |
| 1 | 23.351 s | 12.85 | 1.00× |
| 2 | 12.307 s | 24.38 | 1.90× |
| 4 | 7.530 s | 39.84 | 3.10× |
| 8 | 6.015 s | 49.87 | 3.88× |
| 1, repeated control | 23.238 s | 12.91 | 1.00× |

All five outputs decoded to exactly 300 frames; decoded frame hashes and decoded
audio hashes matched across runs. This verifies concurrency equivalence for this
sample only. It does not verify the old bundle against today's viewer or Studio.
Seventeen focused timing/audio/room-context tests also passed.

**Actual parallel encoding was false in every run**, despite the API allowing it.
Installed 4.0.486 additionally gates it on estimated available memory. The start
events and FFmpeg arguments were retained, demonstrating why resolved settings
must be measured rather than inferred from defaults. JPEG, x264 CRF 18, yuv420p
and 90 kHz video timebase were observed. No per-run memory profile was collected,
so this is not a recommendation to set fleet concurrency to eight.

### Full Influence follow-up

The [follow-up evidence](evidence/render-speed-2026-11-02/influence-followup.md)
uses the completed overnight Influence input: 688 cues, 705 assets, 234,728 output
frames. All 796 referenced media/static files passed their recorded hashes.
Preparation was forced on a copy by clearing only its measured layouts/pages.
All successful prepasses visited all 1,376 measurement frames.

Sequential preparation took **283.965 seconds**, of which **277.395 seconds** was
layout measurement with PNG screenshots. CSS and webpack together took 4.420
seconds. Removing unused prepass screenshots in a disposable experiment reduced
preparation to **79.948 seconds**, with an identical complete prepared manifest:
583 layout entries, 381 page entries, and unchanged assets, cues, audio and timing.
A repeated screenshot-free run took **74.769 seconds** and again matched the
entire reference manifest. This is a 204–209-second saving on this input,
not a full service-latency measurement.
Original remote downloads and source binding are excluded. The >12-minute startup
recollection is still not fully explained.

The installed API's `imageFormat: "none"` also disables video during the measurement
pass; it is not merely a file-write switch. This requires video-dependent layout
coverage before adoption. The normal movie renderer remains unchanged. No output
movie frame is skipped or reused, and no picture/encoding quality is reduced.
JPEG prepass capture took 193.925 seconds but replaced one layout key. Its cause
is unresolved, so that result is not accepted as equivalent either.

Parallel preparation is **not accepted**: two tabs finished in 184.680 seconds but
changed the layout/page key sets; four tabs failed with a readiness timeout.
Cause is unproven. More tabs cannot be recommended for this phase on throughput
alone, and weakening readiness or increasing timeouts is not an established fix.

| Full-context Influence sample | One tab | Four tabs | Eight tabs |
| --- | --- | --- | --- |
| Conversation, 20 seconds | 101.571 s; repeated 106.226 s | 33.149 s | 24.649 s |
| Thinking, 10 seconds | 116.328 s | 33.260 s | Not tested |
| Opening video/title, 10 seconds | 22.726 s | 9.249 s | Not tested |

These render-call times exclude shared preparation and composition selection.
Conversation encoding took about three seconds in every run; frame rendering
dominated. Sampled process-tree RSS reached 6.04 GiB at eight tabs. The desktop
has 36 GiB and 18 logical CPUs; these results are not worker-capacity qualification.
Scene throughput varies greatly, so do not extrapolate one range to a two-hour match
or multiply its rendering gain by the preparation gain.

All 12 rendered movies (nine concurrency trials plus three using the faster-prepared
bundle) passed exact decoded frame/audio comparisons and frame-timing checks:
5,400 frames total. These are bounded export comparisons, not fresh viewer/Studio
parity or full-match qualification. Local probing of all 705 cached assets took
15.595 seconds serially versus 3.887 seconds with four calls, with identical
metadata. That 11.709-second saving excludes downloads and has a warm-cache/order
confound; it is a smaller candidate than the measured layout cost.

## Work we were missing, ordered by investigation value

### 1. Measure the full preparation phase first

Record phase boundaries from API acceptance through verification: queue,
capacity/image pull/tailnet startup, input download/hash, source binding and media
probe, assets, CSS/webpack, browser startup, layout, capture, encode, audio,
mux, upload and verification. Record overlapping spans, not just durations
whose sum double-counts parallel encoding. Log resolved Remotion settings, actual
encoder arguments/build, slow frames, capture mode, CPU/memory, swap, scratch and
network bytes. Existing receipts describe the system `ffmpeg`; Remotion may use
its bundled binary. Both identities matter.

Use the complete saved Influence input for preparation, even when the final test
movie covers only a bounded range. An already measured Werewolf bundle with a
3.4-second bundling step does not explain a 12-minute full-game startup. Record
each phase's start/end, item count, bytes, cache state and slow items; attribute the
delay before selecting an optimization.

Benchmark on immutable inputs and pinned renderer/browser/font versions. Keep
the unchanged renderer as the comparison baseline. Use a cold run,
warm run and repeated serial trials with a rerun of concurrency 1 to expose host
load drift. Never benchmark competing configurations simultaneously on one host.

### 2. Remove unused preparation capture before considering larger changes

The full-input trace identifies an immediate candidate: the prepass produces
screenshots that are discarded after collecting layout artifacts. Test avoiding
that capture while retaining every measurement frame, readiness barrier and
artifact. This is preparation work, not movie-frame selection. Compare complete
prepared manifests and encoded output with the sequential PNG baseline.

The installed no-image mode delivered a substantial local gain, but its video
side effect needs explicit coverage. The JPEG diagnostic retained video rendering
but changed one layout key; that result requires diagnosis. These temporary pictures
never become movie frames. A result is acceptable only if measurement output stays equivalent.
Do not introduce a custom capture bypass or another renderer merely to avoid a
supported API's semantics. Keep the first change small and independently useful.

Revisit parallel layout measurement only after explaining the observed differing
key sets and timeout. No parallel-prepass default is supported by these results.

### 3. Test supported library improvements

The installed renderer is **4.0.486**. Current official documentation describes
[shared-memory capture from 4.0.534](https://www.remotion.dev/docs/shared-memory-capture):
supported video renders can pass bitmaps directly from a patched default Chromium
to FFmpeg, avoiding JPEG encode/decode overhead. This is a candidate experiment,
not an achieved gain. It requires the supported OS/glibc and Remotion browser;
the current `/usr/bin/chromium` and `chromium-tailnet` path will not automatically
provide it. Preserve proxy bypass, TLS/SNI and network isolation when evaluating
the browser packaging. Verify the container's browser/IPC/shared-memory support
and effective cgroup CPU/memory limits. Require logs proving the capture mode
actually activated.

Benchmark a coordinated, exactly pinned upgrade of renderer, bundler, core and
Player in an isolated experiment; re-run Studio buffering/seeking and opening video
proof. New capture changes the compression path and potentially text rasterization.
Do not infer output parity from a version number or upgrade one package alone.

The upgrade experiment keeps ordinary full-frame `renderMedia` and existing
audio scheduling. Its purpose is to reduce transport/capture overhead, without
introducing frame selection or an alternate assembly pipeline. Check installed
types and actual execution logs rather than assuming current documentation applies
to the pinned version.

### 4. Remove redundant readiness work only with an explicit readiness contract

At a nominal 60 Hz, four callbacks represent roughly 67 ms of scheduling intervals;
real headless behavior must be profiled. This is a strong candidate explanation
for the old ~11 fps, not causal proof. Test unchanged frames, then image changes,
page changes, fresh browser starts and random/reverse seeks separately.

Replace repeated settling only after proving that the requested frame committed,
its fonts and current images decoded, relevant ResizeObservers/layout updates
settled, and opening video reached its sample. `img.complete`, a prior URL decode,
or “fonts loaded once” is insufficient for a new element/font/geometry. Old async
completion must never release a newer frame. Missing assets must remain errors.
Keep measurement readiness and playback buffering intact; the readiness owner is
per browser page/current content, not a process-global boolean. Do not blindly
delete rAF waits or leave the layout prepass as the only place with correctness.

### 5. Treat preparation, large props and audio enumeration as separate costs

Measure the 22.6 MB manifest's serialization/localization and per-page memory;
eight browser pages can multiply that footprint. `ReplayFrame` maps all audio
clips every frame, while `audioGain` scans speech clips for ducking. Profile large
and small cuts before deciding whether indexing/memoization is warranted. Keep
Remotion as the audio owner and preserve exact rounding and gain envelopes.

Evaluate prebuilding immutable CSS/webpack code into the worker image and reusing
verified preparation for the exact same input/settings. Keep content assets out of the reusable
application bundle. Compilation was only 4.420 seconds in the full-input local
trace, so it ranks below layout capture for that environment. Cache keys must include renderer digest, source/selection,
media hashes, geometry, fps, motion/timing settings, fonts, layout schema and
relevant browser/platform identity. Text alone cannot key layout.
Cache hits still require authorization and integrity; no cross-audience leakage.
Do not substitute stale layouts after a renderer/font/geometry change.

Download/copy/probe only dependencies actually needed for the selected output
where safe; measure bounded I/O parallelism and disk usage. Investigate bounded
parallel layout measurement only if frozen results match the sequential prepass;
completion order must not choose conflicting layout values. Avoid duplicate
asset copies/probes when their verified identity is already known. Resolve expiring download
URLs close to use through existing authorized boundaries; persisted signed URLs
are not durable asset identities. Current render URLs expire after 15 minutes.

Do not parallelize `ReplayAssets.cache()` by merely wrapping callers in
`Promise.all`. Its source map currently records completed results, not in-flight
work. Repeated URLs could be fetched twice, and distinct URLs with identical
content converge on the same hash-named file. A bounded-I/O experiment must prove
single-owner writes/probes for each resulting file, stable cue ordering, correct
failure/cancellation cleanup and unchanged pinned identities before adopting it.
This is a follow-up candidate; the current implementation keeps asset fetching
and publication semantics unchanged.

### 6. Keep audio and job ownership intact

Initial improvements retain the existing audio schedule, Remotion audio rendering,
single-job lease and durable verification handoff. Concurrency inside one render
does not require shard leases, a new mixer or independent AAC segments. Preserve
source trim, frame rounding, overlapping score loops, fades, ducking and the final
score. Inspect audio cost if profiling shows it matters; do not rewrite it merely
because video performance is being investigated.

The existing verifier leaves mixed speech/music waveform alignment unverified.
Extend relevant audio proof when a dependency, scheduling or encoding change could
affect it. A preparation-only improvement should not grow into an audio project.
The full existing output remains the baseline.

### 7. Defer distributed sharding as a separate proposal

Sharding adds real work: independent child leases, retries/cancellation, durable
assembly, previous/next-cue context, frame-exact joins and seamless audio.
The current job row grants one lease and cannot simply be claimed by several
workers. Those are reasons to defer it, not tasks the first performance change
must solve.

If single-worker improvements later leave an unacceptable bottleneck, prepare a
separate proposal using supported full-frame chunking APIs and the existing Batch
service. Show measured additional benefit, cost and failure behavior before
expanding scope. Preserve the current
[durable finalization handoff](../solutions/infrastructure/2026-11-02-native-render-finalization-recovery.md)
through any future execution changes.

## Evaluate gains independently

Track preparation, full-frame rendering, encoding/audio, upload and verification
separately, then measure the end-to-end result. Account for overlapped capture and
encoding rather than summing the same time twice. Measure each change alone and
in combination; concurrency, readiness and capture improvements can compete for
the same CPU or memory.

Use repeated runs to distinguish a small improvement from noise. Record absolute
time saved, output equivalence and resource costs. A modest reliable gain is a
valid result. There is no need to reach a particular total before accepting it,
and no performance target permits a quality trade.

## Experiments and decision gates

Run experiments on existing saved media; no generation of game content or provider
calls. Keep benchmark code disposable and outside product source. Local native
tests are authorized now. Paid/staging runs and capacity changes need a concrete
fixture, job count, resource limit and spend ceiling before execution.

| Priority | Experiment | Evidence needed |
| --- | --- | --- |
| 1 | Avoid unused prepass screenshots | Extend the full-input 284 → 75–80 s candidate with video-dependent layouts, both games and cross-platform trials; require identical preparation and encoded output |
| 2 | Existing renderer concurrency | Extend the measured Werewolf/Influence gains to page changes, native Linux and long outputs; collect CPU/RAM/scratch and compare complete output |
| 3 | Complete preparation attribution | Add cold/warm binding, download/hash/probe and worker startup timings to the offline full-input trace; qualify bounded I/O and exact preparation reuse independently |
| 4 | Coordinated library/browser upgrade | Verify actual capture backend; compare full-frame output and existing audio, Studio buffering/seeking and resource use |
| 5 | Readiness profiling | Attribute time to actual image/font/layout settling versus redundant waiting; optimize only with fresh/changed/repeated-state and reverse/random-seek proof |
| 6 | Profile remaining large-input work | Manifest serialization/localization, per-frame React/audio enumeration and encoder time; optimize only demonstrated bottlenecks |

Use a bounded rendered corpus covering both games, portrait/visual rooms,
openings, long pages, thinking/results, omitted neighbors, aligned recordings and
the ending tail. Time preparation on complete inputs, even where the encoded
comparison is short. After a promising change, validate a realistic long output.
Do not require every investigation to finish before accepting one proven gain.

## Implementation sequence after planning approval

1. **Measure:** establish the full preparation breakdown and representative
   concurrency/resource baseline. Confirm where the time is going.
2. **Improve one bottleneck:** choose the smallest output-preserving change
   supported by measurements. Preparation and concurrency are the first candidates.
   Keep a complete working export throughout.
3. **Verify and report:** compare the actual output, run checks appropriate to the
   change, and report time saved and resource effects. Deliver that improvement
   without waiting for a larger multiplier.
4. **Repeat:** evaluate the supported capture upgrade, redundant readiness work
   and other measured costs. Keep audio and job ownership intact.

Implementation was subsequently authorized through the active goal, after experimental
qualification of each change. No new feature flag or
user-facing fallback switch is proposed; deployment remains the gate. Rollback
uses an admitted prior release without silently changing a frozen order's renderer.
Unsupported pinned jobs need a clear re-prepare instruction. Preserve existing
artifacts and accepted history/media.

## Validation and completion requirements

Follow [presentation parity](../presentation-parity.md) for viewer, Studio Source,
Studio Selected cut, local export and Batch composition. House Cuts/trailer smoke
coverage is required when shared library/browser packaging changes; a replay-only
speed optimization does not imply trailer optimization. No player scrolling.

- Unchanged-renderer versus candidate frame comparisons, including every
  transition frame in bounded fixtures. Negative fixtures must catch a dropped
  page, one-frame shift, missing label, stalled camera and wrong final hold.
- Fresh matched viewer/Studio/export images and encoded clips, both games,
  ordinary/reduced motion, recorded/unrecorded/aligned speech, isolated thinking,
  speech and result cuts, omitted neighbors, narrow/short/fullscreen geometry,
  long copy/names and supported large casts (Werewolf at most eight).
- Direct seek, reverse/random sampling and independent browser starts during
  video, camera, narration, page flips, thought focus and music.
- Decoded video checks include exact frame count, fps, dimensions, timestamps,
  final picture and moment handoffs. Use justified per-region/text and temporal
  checks as well as a global pixel metric. A low average can hide a missing word.
  The current standalone verifier permits mean difference up to 12/255; the draft's
  2–3/255 was not that universal gate. Calibrate codec tolerance from the unchanged
  reference and deliberately broken outputs; do not adopt either value blindly.
- For changes that can affect audio: mixed-audio waveform/envelope, long-form
  alignment/drift and final-score proof. Non-silent output or H.264/AAC stream
  presence is insufficient. Keep unchanged-audio checks scoped to the change.
- Preserve current retry, cancellation and verification semantics. Exercise
  corrupt/missing assets, expired URLs, disk pressure and bounded cleanup where
  preparation or resource changes affect them. Never publish a partial movie.
- For implementation: `bun run test`, `bun run test:postgres` (one process per
  database with `setupTestDB()`), `bun run check`, affected browser tests and fresh
  rendered proof. These implementation baselines passed; see the validation ledger
  for exact counts, retained failures and final successful reruns.

Existing MP4s never change. Any fresh bundle/cache must be prepared from the same
permitted frozen source, selection and pinned media with current required layout
metadata. Reuse selection JSON where its frozen source is still sufficient;
otherwise explicitly refresh the selection. Never silently unpin or regenerate
history/media. Retain previous artifacts and report preparation/renderer hashes.

## Follow-up work beyond this implementation

- Measure API source binding/downloads against an explicitly selected usable source
  fixture. The saved selection currently fails its accepted-source pin check; do
  not bypass this check to obtain a benchmark.
- Qualify concurrency against native worker resource limits before changing the
  default of one. Four workers improved these local samples; this does not establish
  fleet capacity or full-match throughput.
- Keep parallel preparation deferred: retained experiments found inconsistent
  measurements. Library/browser upgrades, bounded asset I/O and remaining per-frame
  costs require separate measurements and output proof.
- Before any paid benchmark or capacity change, specify resources, run count and
  spending limit. Sharding and replacement audio mixing remain deferred.

The delivered changes are the smallest qualified preparation/readiness improvements.
There is no target multiplier, frame omission, similarity reuse or quality tradeoff.

## References

- [Remotion performance guidance](https://www.remotion.dev/docs/performance)
  supports measurement and concurrency sweeps; it does not predict this pipeline's gain.
- [renderMedia](https://www.remotion.dev/docs/renderer/render-media) and
  [renderFrames](https://www.remotion.dev/docs/renderer/render-frames)
  describe current APIs; installed types/version remain decisive for experiments.
- [Local export](../local-replay-export.md),
  [Batch release preparation](../deployment/batch-render-release-preparation.md),
  [Studio Player and frozen recordings](../solutions/ui-bugs/2026-10-09-production-studio-player-and-frozen-recordings.md)
  document existing source pins, verification and media ownership constraints.

### Native staging qualification in progress (2026-11-03)

Staging Fargate qualification uses identical pinned Influence and Werewolf cuts
at 1920×1080/30 fps, with unchanged motion, music, reading and ending settings.
Test frame concurrency at 1, 2 and 4 on the existing allocation: the renderer
container receives 2 vCPU/4 GiB; the separate tailnet container receives another
2 vCPU/4 GiB. The task total is not the renderer's allocation. Keep concurrency
at 1 until repeat timings, failures and exact decoded video/timestamps/audio
justify a winner. These selected staging sources have no saved voice recordings;
the first matrix's audio proof covers music, not recorded dialogue.

The initial controls use the existing deployed digest
`sha256:bdb6970aec837bc0a5bbf5b7d19f0201e798998ab06358306dddce18d2c45f19`.
They do not include this PR's preparation/readiness fixes. Do not attribute their
performance to the optimized renderer or claim the final cloud default yet.

A user-reported staging failure (`eeb0b48e-be94-47b5-b0c0-d2e4cb009862`)
exited with renderer code 1: `Replay layout 9479` did not clear its readiness
handle within 58 seconds. This identifies a frame-readiness timeout, not an
OOM kill. The readiness fixes still require native verification before claiming
this particular failure resolved.

Cloud qualification also reproduced three existing browser assertions after the
shared House backdrop change: two incorrectly searched inside the caption for
the stage-owned backdrop, and one required a 74 px outer caption despite a valid
70 px panel at 480×480. The tests now check the single stage backdrop and actual
readable typography, text fit, pagination space and separation from the scene.
All four focused browser tests passed, including the existing standalone-stage
regression. No presentation code changed for these assertion corrections.
