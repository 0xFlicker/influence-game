---
title: Rank Strategic History with Explicit Target and Round Signals
date: 2026-07-28
category: architecture-patterns
module: engine selective context recall
problem_type: retrieval_ranking
component: context-recall-plan
severity: high
applies_when:
  - a bounded strategic history reserve selects relevant but stale dialogue
  - lexical overlap consumes the reserve before current decision evidence
  - a real-thread strategic probe reports required evidence as budget exhausted
tags: [recall-plan, retrieval-ranking, strategic-context, real-thread-evaluation, mingle]
related_components: [prompt-thread-lab, strategy-thread, context-builder]
---

# Rank Strategic History with Explicit Target and Round Signals

## Problem

The `vast-azure-surge` Round 4 Mingle-intent probe proved that a 1,200-character
history reserve was active but not strategically selective. Raw unique-token
overlap ranked a verbose Round 3 commitment first. A short eliminated-player
remark then fit the remaining space, while the approved current Round 4 answer
from the monitored player was reported as `budget_exhausted`.

The failure was not missing budget. It was ranking plus greedy packing.

## Evidence

The human-approved evidence card marked Zara's latest Round 4 statement as
required. The previous candidate instead selected sequences 255 and 310.
Evaluation-only diagnostics made the cause visible:

- lexical overlap treated every seed as equally important;
- recency was only an exact-score tie-break;
- speaker identity was not connected to Strategy Thread `targetPosture`;
- serialized evidence cost, not raw dialogue length, controls what fits.

The two preferred messages cost 1,318 JavaScript string characters with
metadata, so both cannot fit a 1,200-character reserve. The honest regression
target is to select the required latest Zara statement first, not to pretend the
reserve can hold both.

## Pattern

Keep authorization and the zero-overlap gate unchanged. Add two bounded ranking
signals after lexical scoring:

1. the living speaker explicitly named by Strategy Thread `targetPosture`;
2. dialogue from the current round.

If `targetPosture` names no living player, fall back to the next social probe and
reflection suspicion/threat fields. Do not scan coalition prose as a target
source; doing so promotes allies and targets equally.

For multiple current-round messages from the same explicit target, prefer the
latest statement. Continue to use deterministic greedy packing and account for
the full serialized evidence object.

## Verification

- Preserve a compact real-thread fixture with the accepted source text,
  sequences, reserve, and expected required-first selection.
- Observe the failing selection before changing production ranking.
- Assert the preferred pair's serialized cost exceeds the reserve.
- Rerun the provider-free strategic probe against clean pinned revisions and
  require improved evidence coverage with no distractor increase.
- Treat the result as case-specific; separately acquire a real
  `strategic_reflection` case before claiming the 1,600-character reserve works.
