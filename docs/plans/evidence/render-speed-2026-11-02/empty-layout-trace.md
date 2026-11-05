# Empty-text layout trace and repeated controls

2026-11-03. Experiments only; no product code or dependencies changed.

## Findings

The repeated full PNG preparation completed in 261.634 seconds and its entire
manifest matched the original PNG baseline exactly. Artifact tracing located the
contested key in measurement frame 598, cue 299: a Safety Bounce cue without speech.
Its artifact contains both the temporary empty-speech box height 970.442 and the
settled height 467.882. Both values fit to exactly the same typography: width 240,
height 131, font 46, one empty page. The alternate earlier key height 484.22 also
has that fitted value. Source tracing identifies `SafetyChain`'s container/face
measurement effects and `chainSpeechBox` as the producers of these available-box
sizes; ordering of those geometry updates is the likely source of intermediate
keys, not a proven change in final layout.

`useBubbleTypography` includes full text and geometry in each lookup key. It
measures `speech?.text ?? ""` even when speech is absent. `SafetyChain` uses that
result only for the speech bubble, whose render requires speech and no thought.
It does not feed those dimensions back into the character or thinking camera.
A later nonempty speech cannot look up an empty-text key.

To test output dependence, a disposable copy replaced all ten cached empty-speech
layouts with width 1800, height 900, font size 200 and visible control text. No
production renderer or accepted input was changed. Both movies from this deliberately
altered copy matched the PNG reference exactly. Coverage spans cues 298–300
(including the affected no-speech cue and neighboring speech), plus complete
thinking cue 302. This supports that the mismatching empty key is inert in these
outputs; the differing key was not removed from the comparison.

## Render variability exposed

Ten movies, 6,350 decoded frames, all with exact expected frame counts and identical
decoded audio. Each mode rendered 735 handoff frames and 535 thinking frames at
1080p30 with four tabs. Differences below are against the first PNG movie:

| Bundle/run | Handoff differing frames | Thinking differing frames |
| --- | --- | --- |
| Screenshot-free, first | 1 | 111 |
| Deliberately altered empty layouts | 0 | 0 |
| Unchanged PNG, repeated | 39 | 279 |
| Same screenshot-free bundle, repeated | 0 | 0 |

The screenshot-free bundle used here is the previously completed manifest with
the differing key. Both repeats use their same immutable prepared manifests.
This establishes existing render-to-render variability in these scenes, rather
than attributing every difference to screenshot-free preparation. No tolerance
was introduced to accept the differing pictures. Pixel magnitude/visual impact
and the exact asynchronous cause remain unclassified.

## Preparation failure and limitations

The newly traced screenshot-free full prepass failed at 111.653 seconds: the
`Replay layout 942` readiness handle was not released within the existing timeout.
Its earlier frame-598 artifact matched the traced PNG artifact. The timeout was
preserved, not increased. Failed inputs/logs remain retained; movie comparisons
used the prior completed candidate instead. A render runner was launched near
this failed attempt's termination; these correctness runs must not be treated as
a clean performance comparison or isolated resource diagnosis. The failed input
manifest was retained as `failed-prepass-input.json` before supplying the prior
completed manifest to the diagnostic bundle.

The empty-key mismatch is no longer evidence of a visible regression in these
samples. Overall readiness and deterministic output are still unqualified.
Next investigations should repeat the frame-942 failure in isolation and compare
one-tab versus four-tab Safety Bounce sampling, tracing face geometry, image
readiness and frame ownership. Do not weaken waits or hide differing output.

Artifacts: `.renders/empty-layout-trace-2026-11-03/` contains instrumented preparation,
artifact/frame logs, copied inputs, all ten movies, hashes and comparison scripts.
[Machine-readable output checks](empty-layout-output-checks.json).
