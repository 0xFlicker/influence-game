---
title: Bind retrospective dialogue to committed turns
date: 2026-10-10
module: Influence retrospective runtime
problem_type: architecture_pattern
component: service_object
severity: high
tags: [retrospective, canonical-events, dialogue, durable-turns, formal-speech]
---

# Bind retrospective dialogue to committed turns

The full-run RT-04 fixtures exposed assumptions that isolated source fixtures did not: format phases also carry canonical phase identity in event envelopes, and formal transcript speech may contain a structured display label around the canonical raw utterance.

The API retrospective source reads the original outcome's owning committed turn to obtain its product-dialogue cutoff. Dialogue rows retain their owning-turn canonical boundary. Keep these sequence spaces separate and cap source anchors at the immutable competitive outcome. A current event head, matching text or phase-name guess cannot replace a committed source relationship.

Formal speech writers supply an exact product-dialogue pointer before logging. The compiler validates that identity and compares presentation using the existing structured formal-speech formatter, including target/addressee names derived from canonical seats. It keeps one canonical raw quote rather than treating the formatted display copy as another utterance. Do not strip labels with regexes or extend the classic transcript parser.

Chronological summary sections use accepted event-envelope phase identity as well as explicit phase-entry events. Some format handlers do not publish a separate phase-entry record; requiring one excludes real, accepted format dialogue from an otherwise complete account.

The [durable runtime proof](../../../packages/engine/src/__tests__/durable-game-runner.test.ts) traverses actual gameplay and restarts at initialization, every speech ordinal and completion. The [context compiler proof](../../../packages/engine/src/__tests__/retrospective-context.test.ts) retains exact correlation drift rejection. Use both layers: isolated account fixtures alone do not establish compatibility with the owning runner's accepted artifacts.
