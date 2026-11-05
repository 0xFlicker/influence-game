# Isolated readiness and concurrency controls

2026-11-03. No product changes. Two full screenshot-free preparations ran serially
with the original lightweight telemetry, without a competing benchmark. Both
completed all 1,376 measurement frames in 75.083 and 76.497 seconds. Both complete
manifests match the original PNG baseline. The prior frame-942 timeout did not
reproduce; two successes do not explain or eliminate an intermittent failure.

A serial 1/4/1/4 render matrix used the same PNG-prepared full input and first
300 frames of thinking cue 302 (including the previously differing interval).
Times were 42.341, 16.860, 46.448 and 20.664 seconds. Both four-tab outputs matched
the first one-tab output exactly; the repeated one-tab output differed in 159
of 300 decoded frames. All frame counts match. This matrix compared video and
timestamps; it did not repeat audio hashing. Existing nondeterminism therefore
also occurs at concurrency one and cannot be attributed solely to parallel tabs
or screenshot-free preparation.

Pixel diagnostics on earlier differing movies found mean RGB absolute differences
of 0.042895/255 in handoff frame 689 (maximum 66, 33,958 changed pixels), and
0.020224/255 in thinking frame 200 (maximum 10, 47,403 changed pixels). These are
diagnostics, not a relaxed acceptance threshold. Thinking differences ending at
frame 249 suggest possible encoding propagation to a keyframe boundary; this is
an inference requiring raw capture versus encoded-output isolation.

Next: compare lossless browser frame captures across identical repeated runs,
then encode identical retained frames twice. Instrument readiness stage ownership
if isolated preparation fails again. Preserve the existing presentation and
readiness checks; do not implement the optimization based only on these successes.

[Results](readiness-isolation-progress.json). Raw artifacts and scripts remain in
`.renders/readiness-isolation-2026-11-03/`; pixel diagnostics and extracted images
remain in `.renders/empty-layout-trace-2026-11-03/`.
