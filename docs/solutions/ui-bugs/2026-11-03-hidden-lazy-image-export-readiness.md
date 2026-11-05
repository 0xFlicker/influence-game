---
module: Replay export
problem_type: performance_issue
tags: [remotion, image, readiness, lazy-loading, format-menu]
---

# Hidden lazy portraits can block export preparation

The format-menu scene retains a portrait fallback while showing full-body art.
At movie geometry its container query hides that portrait. Next Image defaults
to lazy loading, but the export readiness pass awaits decoding every document
image. A hidden lazy image may never start loading, so its decode never resolves.

Full-input tracing reproduced a PNG preparation timeout at measurement frame 796
with exactly one unfinished image decode. Cold-start tests reproduced the same
failure at both frame 796 and the previously failing frame 942. Both are
format-menu scenes. A separate actual-avatar browser fixture confirmed that a
hidden lazy image stayed incomplete until its loading mode changed to eager;
the same pending decode then completed without making the image visible.

`PreparedFrame` now sets image loading to eager before awaiting decoding. It keeps
font readiness, both image-decode/layout-settling passes, error propagation and
the existing timeout. Do not bypass decoding or add a longer timeout to hide this
failure. The viewer comparison harness uses the same loading prerequisite; the
interactive viewer's loading behavior is unchanged.

Three full-input Influence trials completed all 1,376 measurements and 13,558
image decodes each. PNG and screenshot-free prepared output were compared across
complete video openings, gameplay and the continuous Safety Bounce sequence.
All 12 Influence movies (13,540 decoded frames) matched in pixels, timestamps and
audio. Werewolf's PNG and screenshot-free manifests matched the prior reference,
and its full opening/gameplay comparisons also matched exactly. A known empty-text
layout-key variation in Influence did not change output.

The production prepass now emits layout artifacts without writing unused PNGs;
ordinary movie-frame capture and audio remain unchanged. The maintained
`verify-presentation-parity.ts` proof starts with the format-menu fixture and
includes an encoded clip. Final implementation validation, broad checks and clean
benchmarks are tracked in [the render-speed plan](../../plans/2026-11-02-render-speed-100x.md).

Private reproductions are under `.renders/hidden-image-readiness-2026-11-03/`,
`.renders/cold-format-readiness-2026-11-03/`, and the eager qualification directories.
Existing movies and frozen source media are unchanged; prepare a fresh bundle
from the same accepted selection/source to exercise the updated prepass.
