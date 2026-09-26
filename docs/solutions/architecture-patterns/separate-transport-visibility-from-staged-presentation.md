---
title: Separate Transport Visibility From Staged Presentation
date: 2026-07-27
category: architecture-patterns
module: format viewer ballot disclosure
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "staging a dramatic reveal from facts already readable by operators"
  - "separating participating-agent knowledge from public viewer transports"
  - "building live and replay presentation from the same canonical event stream"
tags: [canonical-events, disclosure, ballots, replay, presentation, privacy]
related_components: [public-watch, production-game-mcp, presentation-director, testing_framework]
---

# Separate Transport Visibility From Staged Presentation

## Context

Format ballots needed television pacing: aggregate first, then named roll call.
The accepted ballots were already intentionally readable by operator web, API,
and MCP transports, while participating agents had a narrower sealed-knowledge
contract. Treating the reveal as a new privacy boundary would have required a
duplicate payload and would have made transports disagree.

## Guidance

Keep four lanes explicit:

1. canonical accepted facts;
2. participating-agent knowledge;
3. operator transport visibility;
4. staged presentation.

Persist one accepted voter-to-target fact. Let operator transports sanitize and
deliver it immediately. Redact peer mappings only in participating-agent
context. At the canonical resolution boundary, project the same facts into
stable roster order and change presentation lifecycle from `sealed` to
`revealed`. The browser may buffer or delay drawing identities, but it must not
claim they were transport-secret.

Use an explicit lifecycle instead of interpreting an empty array:

```ts
type BallotPresentation =
  | { status: "sealed"; rollCall: [] }
  | { status: "revealed"; rollCall: BallotReceipt[] }
  | { status: "not_applicable"; rollCall: [] }
  | { status: "unavailable"; rollCall: [] };
```

Compile live and replay from the same ordered viewer decisions. The presentation
director may control dwell, pause, speed, motion, and manual advance, but
animation callbacks never commit game truth.

## What Did Not Work

- A second `ballotReveal` artifact duplicated authority and could disagree with
  accepted ballots.
- Making accepted ballots producer-only created privacy theater and broke public
  API/MCP readability.
- Using array emptiness conflated unresolved, automatic, malformed, and missing
  ballot states.
- Parsing House transcript prose to reconstruct a reveal made copy an accidental
  game protocol.

## Verification

Use one fixture across lanes. Before resolution, assert public/operator/MCP
sanitized mappings are readable, producer raw mode retains provenance, and each
participating agent sees only its own receipt. After resolution, assert the
projection reveals the same mappings in roster order and the UI draws aggregate
before ledger. Add malformed-prefix tests that retain the last trusted snapshot
without transcript repair.

Keep reconnect coverage focused on pause intent: wait for the refreshed replay
frames, check that the paused presentation stays in place, then verify Play
resumes playback. Ballot-text assertions belong in the paused roll-call journeys,
where manual navigation and the presentation clock are controlled together.

## Related

- `docs/format-kernel-web-contract-drift.md`
- `docs/solutions/architecture-patterns/owner-scoped-alliance-read-models.md`
- `docs/solutions/architecture-patterns/production-mcp-role-resource-split.md`
- `packages/engine/src/viewer-decision-events.ts`
- `packages/engine/src/revealed-round-facts.ts`
- `packages/web/src/app/games/[slug]/components/format-presentation-director.ts`

## Fullscreen presentation (September 2026)

Fullscreen is an element-level concern owned by `DramaticReplayViewer`, with the
same mounted director and content in normal and immersive viewing. The camera
and speech pagination sample base presentation time. Explicit director navigation
increments a navigation revision to cut camera motion, while automatic advancement
may pan between clear anchors on the same immutable image. Resize recalculates
geometry and text pages without modifying canonical cues, speech duration or the
publication snapshot. There is no independent camera or page timer.

### Full-body solo performances

`solo-presentation-timing.ts` defines the staged image entrance, settling hold, speech envelope, shorter exit hold and fade through black. Its duration is budgeted into transcript solo cues and canonical ballot/plea cues. `SoloPresentation` samples that same base clock and offsets `TimedSpeech` into the reading interval; no CSS transition or extra timer can continue while playback is paused.

`SoloPresentation` owns the bounded character/bubble layout. It consumes frozen full-body media from `visualWatchPresentation`, falls back to a static portrait on absence/load failure, and delegates text pagination to `TimedSpeech`. `layoutSoloPresentation` uses the measured frame and loaded image dimensions to fill the stage vertically, letterbox wide screens and trim only the sides on narrow screens. The bubble overlays the image below the upper head region; controls reserve bubble space, not image space. Until source-bound confirmed geometry is available, only upright single-person references use the conservative upper-22% head-region fallback. Room images never use this fallback. No video clips, generated speech reasons, extra cues or independent speech timers are introduced. Canonical ballot targets supply the entire spoken ballot text; purpose and polarity remain separate captions. House segments divide the available stage into equal upper/logo and lower/copy regions. The fullscreen toggle uses the standard corner glyph with accessible labels.

### Frozen solo head geometry

The visual read model supplies `fullBodies` and `fullBodyHeads` together, selected from game-start profiles or prepared cast artifacts. The head rectangle is confirmed against the exact stored source hash at profile submission, frozen with the game, and carried to a prepared reference only when its bytes match. No current-profile lookup supplies historical placement. Solo layout transforms this rectangle with the image, clamps narrow framing around edge heads and places speech below (or above when a low head leaves more room there). These are layout calculations: media readiness, geometry, resize and recropping do not create cues or change the director clock.
