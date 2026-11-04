# Full Influence preparation and rendering experiments

Follow-up to the [planning review](../../2026-11-02-render-speed-100x.md).
Product code, dependencies, infrastructure and deployment remain unchanged.
All experiments ran serially on the same nonisolated M5 Max desktop using saved
media. No provider calls or remote writes were made.

The dependency-equipped source checkout advanced during the work to
`1e45754cf491021f4721ba83bc6b14560bbd9a97`. Final git comparison confirmed that
renderer/application code and dependency manifests remained identical to reviewed
commit `99819e431701a180dedefcde73d7803c0f75e858`; changes were documentation and
deployment configuration outside these local harnesses. That checkout remains
clean. No changes belonging to other work were reverted.

## Input and method

The completed overnight `neat-black-orb` export provides a real full-match input:
688 cues, 705 media assets, 234,728 output frames at 1920×1080/30 fps. Its retained
receipt reports 35,858.724 seconds for a 7,824.267-second movie. That historical
receipt uses renderer `42773948bb364ed9be7a1ce7f937bae91772c4ca`, whereas these
experiments use reviewed head `99819e431701a180dedefcde73d7803c0f75e858`.
Do not compare them as a controlled before/after optimization.

Saved source manifest file SHA-256:
`ec36584d9b35d058d781bd35e01a3f506fe28a8be5ec2057a4839fd0e1c95c87`.
All **796 referenced media/static files** passed their recorded content hashes.
Original files remain untouched. A new copy was used for every preparation run,
with only its existing `layouts` and `pages` removed to force a complete prepass.

The disposable harness copied `withPreparedReplay` into the ignored experiment
directory, anchored imports to the unchanged reviewed checkout, and added phase,
frame and artifact timing. Experimental parameters varied only prepass concurrency
or prepass screenshot output. The actual `ReplayFrame` implementation was unchanged.
The baseline kept PNG capture and concurrency one. All runs retained the same
60-second per-frame timeout and readiness checks. All completed prepasses processed
1,376 measurement frames.

Native runtime: Bun 1.3.14, Remotion 4.0.486, Chrome Headless Shell 149.0.7790.0
mac-arm64, Apple M5 Max with 18 logical CPUs and 36 GiB RAM. Other desktop processes
were active. Resource samples sum process-tree RSS, which can count shared pages
more than once; they are not isolated-container peaks. The host already had
substantial swap allocated. Treat these as local diagnostic measurements.

## Preparation results

| Experiment | Time to prepared | Outcome |
| --- | --- | --- |
| Original PNG prepass, concurrency 1 | 283.965 s | Completed; reference manifest |
| PNG prepass, concurrency 2 | 184.680 s | Completed, but measurement maps differ; not accepted as equivalent |
| PNG prepass, concurrency 4 | Failed at 128.390 s | Readiness timeout at measurement frame 587; no speedup claim |
| No prepass screenshot capture, concurrency 1 | 79.948 s | Completed; entire prepared manifest matches the reference |
| JPEG prepass, concurrency 1 | 193.925 s | Completed, but one layout key differs; not accepted as equivalent |
| No prepass screenshot capture, concurrency 1, repeated | 74.769 s | Completed; entire prepared manifest again matches the reference |

Baseline phase timing: CSS compilation 0.740 s, webpack 3.680 s, composition
selection 1.992 s, **layout prepass 277.395 s**. Local copies were fast on this
filesystem. This does **not** include remote asset fetching or original source
binding, and must not be presented as the complete explanation of the user's
recalled >12-minute preparation period.

The screenshot-free experiment saved **204.017 seconds** in this run (3.55× faster
preparation). The ordinary prepass writes PNG screenshots solely while collecting
layout artifacts; the production function then deletes those temporary files.
The candidate still visits every measurement frame and retains its artifacts,
without creating these unused screenshots. All 583 layout entries and 381 page
entries match, with no missing/extra keys or changed values. Canonical comparison
of the **entire prepared manifest** also matches, including cues, assets, audio,
timing and settings. Repeated artifact keys had zero conflicting values.
The repeated screenshot-free run took 74.769 seconds and again produced an
identical complete manifest. The two trials saved 204.017–209.196 seconds versus
the single PNG baseline. This improves confidence in the candidate but does not
replace cold-cache, cross-platform or broader fixture qualification.

This uses the installed `renderFrames` API's `imageFormat: "none"` option.
[Remotion documents it for audio-only rendering](https://www.remotion.dev/docs/renderer/render-frames#imageformat).
Installed source confirms that it still visits frames and collects artifacts,
but also sets `videoEnabled: false` during that prepass. It is therefore a
candidate requiring explicit video-dependent-layout coverage, not a general
promise that disabling capture can never affect preparation. The normal movie
render continues using its unchanged image/video/audio settings. No movie frame
is omitted, reused, interpolated or rendered at reduced quality.

The concurrency-two maps contain four additional layout keys; page maps have
17 missing and five additional keys, although values on common keys match.
That may involve frame-history/measurement behavior, but its cause is unproven.
It is not enough to call the result visually wrong or safe. Concurrency four
stalled at a format-result measurement that took 93 ms in the sequential run;
other pages continued before the timeout failed the attempt. No timeout was
increased and no readiness check was removed. Preserve both results as blockers
to adopting parallel preparation without further diagnosis and rendered proof.

JPEG capture retained video during preparation and saved about 90 seconds versus
PNG. It produced the same number of layouts/pages, but replaced one layout key
(one missing, one extra); values on common keys and the full page map match.
Only the `layouts` top-level field differs. This is diagnostic evidence, not an
accepted optimization. The single trials do not establish whether capture timing,
existing measurement nondeterminism or another factor caused that difference.
Changing discarded screenshot compression does not itself change movie encoding;
the unresolved issue is deterministic preparation metadata.

## Rendering and output verification

The rendering matrix uses the successfully prepared sequential reference and
ordinary full-frame `renderMedia`, retaining the complete input context and audio
schedule. Cases are a 20-second visual conversation, a 10-second thinking shot,
and a 10-second opening range containing moving video/title presentation.
Conversation concurrency levels are 1/2/4/8/1, with the repeated one-tab run as a
load-drift control. Thinking and opening compare one and four tabs.

| Sample | Tabs | Render + encode/audio | Effective fps | Sampled peak process-tree RSS |
| --- | --- | --- | --- | --- |
| Conversation, 20 s | 1 | 101.571 s | 5.91 | 2,420 MiB |
| Conversation, 20 s | 2 | 55.481 s | 10.81 | 2,644 MiB |
| Conversation, 20 s | 4 | 33.149 s | 18.10 | 3,678 MiB |
| Conversation, 20 s | 8 | 24.649 s | 24.34 | 6,190 MiB |
| Conversation, 20 s, repeated control | 1 | 106.226 s | 5.65 | 2,058 MiB |
| Thinking, 10 s | 1 | 116.328 s | 2.58 | 1,855 MiB |
| Thinking, 10 s | 4 | 33.260 s | 9.02 | 3,964 MiB |
| Opening, 10 s | 1 | 22.726 s | 13.20 | 2,691 MiB |
| Opening, 10 s | 4 | 9.249 s | 32.43 | 4,341 MiB |

The conversation sweep improved 4.12× at eight tabs versus its first baseline;
the repeated one-tab control was 4.6% slower than the first. Four tabs improved
the thinking sample 3.50× and opening sample 2.46×. Absolute throughput varies
substantially by scene; one short sample cannot predict a full match.

Actual parallel encoding was false throughout. Conversation encoding occupied
2.86–3.12 seconds per run; thinking about 1.46 seconds, opening 0.88–0.97 seconds.
The observed bottleneck is primarily in rendering frames for these cases. These
figures do not yet separate React/audio enumeration, readiness waits and capture.
Opening at four tabs sampled 4.24 GiB process RSS, and conversation at eight tabs
6.04 GiB. Neither establishes an appropriate concurrency for a 4-vCPU/8-GiB worker;
all processes, caches, scratch and other worker duties need headroom there.

Final measurements and decoded output checks are retained in
[influence-followup.json](influence-followup.json). Measurements exclude shared
preparation and per-case composition selection. They are not full-match latency,
cloud results or an end-to-end Studio/viewer parity qualification.

All **12 movies / 5,400 decoded frames** passed the output checks. Nine movies
cover the baseline concurrency matrix; three more use the screenshot-free
prepared bundle at concurrency four. Every decoded frame hash, frame timestamp
and decoded audio hash matches its corresponding one-tab reference. Frame counts,
1920×1080 geometry and 30 fps match. The conversation range crosses a cue handoff;
the opening range crosses the opening-video/title boundary. The thinking sample
has 293 distinct decoded frames out of 300, providing substantial motion coverage.
No similarity threshold was used to accept differences; all compared hashes match.
These counts describe validation only, with every movie frame still rendered.

The candidate-bundle clips took 30.832 s for conversation, 32.693 s for thinking
and 9.173 s for opening. Their purpose is output verification; treat differences
from the baseline's concurrency-four times as run variation, not an additional
rendering speedup from preparation. The complete prepared manifests are equivalent.

## Local media probes

Re-ran the existing `probe()` function against all 705 cached media files, first
serially and then with four concurrent calls. The serial pass took **15.595 s**;
four-way probing took **3.887 s**, saving **11.709 s**. Both returned all 705
results with identical complete FFprobe format/stream metadata. The second pass
can benefit from warm filesystem caches; the order
was not reversed and this is not a cold-cache or remote-transfer benchmark.

This demonstrates a modest local preparation opportunity. It does not explain
minutes of network/source-binding time, measure live URL fetching, or justify
parallelizing other preparation operations with different ownership constraints.

## Retained artifacts and reproduction

The ignored directory `.renders/render-speed-followup-2026-11-02/` contains:

- `instrument.ts`, `instrumented-render*.ts`, `instrumentation*.json`,
  `telemetry.ts`, `prepare.ts`: disposable instrumentation, provenance and runner.
- `preparation-c1/`, `preparation-c2/`, `preparation-c4/`,
  `preparation-none-c1/`, `preparation-none-c1-repeat/`, `preparation-jpeg-c1/`:
  separate copied inputs, phase logs, frame timings,
  resource samples, artifact summaries and successful prepared manifests.
- `render-matrix.ts`, `render-matrix/`, `render-candidate/`: serial render harness,
  baseline/candidate output movies and decoded comparisons.
- `asset-probes/`: local FFprobe timing and private complete metadata.
- `probe-assets.ts`, `verify.py`, `summarize.py`: bounded local analysis helpers.
- `memory-pressure-before-matrix.txt`: read-only host context.

Use new output directories when repeating. Run one performance experiment at a
time. Explicitly select the same cached browser and locked dependencies; retain
all full-context cue/audio arrays. The experiment parameters are disposable
harness inputs, not proposed product flags. Do not reuse performance figures
across changed browser, resource, source, layout or encoding conditions.
