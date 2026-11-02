---
module: Studio replay export
problem_type: ui_bug
tags: [werewolf, influence, safety-bounce, remotion, replay, presentation]
---

# Preserve viewer staging in Studio and exported movies

Two recent viewer treatments bypassed the shared export path:

- Werewolf's browser wrapper reserved House-caption space and enabled compact
  result/cast rendering. Remotion called the content renderer directly with its
  old defaults, so Studio and MP4s retained the old overlay/results.
- Independent Safety Bounce thoughts retained only the actor and backdrop.
  Converting them into solo shots discarded the pre-choice chain board, pools,
  cast placement and chooser camera.

`WerewolfHouseLayout` now owns the shared caption geometry. Browser and export
both use it; export explicitly enables compact results and suppresses the old
caption overlay. Recorded narration progress still follows the recording clock.
The silent completed-retrospective reprise stays silent.

Independent chain thoughts carry a dedicated pre-choice framing value consumed by
the same `SafetyChain` renderer. It contains the canonical before-board, round,
actor and explicit character display fields. It excludes the owning decision cue,
new target/classification, after-state and omitted speech. Thinking cannot advance
the chain even when sampled beyond its normal duration. Full speech/reveal shots
continue using their existing canonical cue.

## Verification

- Provider-free baseline: 3,275 passed, 5 skipped, zero failures.
- Regression tests cover thought-only privacy, every pointer's before-board,
  Werewolf compact results/one caption, and silent final casts for both audiences,
  including actual eliminations/winners and current-rule draws.
- `bun run check`: typecheck and lint passed. Final focused checks are recorded in
  the task handoff.
- Fresh render proof: 40 lossless viewer/export comparisons matched pixel-for-pixel,
  including reverse-order sampling. Four decoded frames from two new MP4s had
  maximum average channel difference 2.557/255. Evidence is retained at
  `.renders/presentation-parity-2026-11-02-verified/`.
- The shared PostgreSQL baseline encountered account/RBAC setup timeouts followed
  by duplicate seed-row failures. It was stopped after those failures; all 57
  account/RBAC and Studio/export API tests passed in a separate disposable database,
  which was dropped after the run.
  Do not describe the interrupted full database baseline as passing.

Run the provider-free browser comparison from `packages/web`:

```sh
bun run src/scripts/verify-presentation-parity.ts \
  ../../.renders/presentation-parity-verification
```

The proof renders actual viewer components against the shared Studio/Remotion
composition at 1280×720 and 640×360, including thinking entrance/read/return,
night deaths, public vote outcomes, game results and final casts. It freezes
export typography with a layout prepass, checks reverse-order sampling, encodes
two fresh H.264 clips, and compares decoded frames against the viewer. Lossless
frames must have average channel difference ≤1/255; H.264 frames ≤4/255.
`comparison.json`, PNG pairs, manifests and MP4s remain in the output directory.
This is deterministic component/encoding evidence, not a production deployment
check or a test of live provider/audio generation.

## Updating an existing export

Re-run the existing selection JSON with the updated local exporter and a new
output filename. It retains the exact cut/settings/media while rebuilding its
bundle and movie. Use a fresh Studio selection to change the cut or move off an
older frozen source projection. A saved MP4 cannot be restyled, and an old bundle
cannot supply chain context it never saved. See
[the export refresh instructions](../../local-replay-export.md#refresh-an-existing-export-after-presentation-updates).
