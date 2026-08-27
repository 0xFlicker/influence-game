---
title: Restore House-Authored Narrative Behind an Information Firewall
date: 2026-08-27
category: architecture-patterns
module: House narrative cadence
problem_type: architecture_pattern
component: game_engine
severity: high
applies_when:
  - "letting an omniscient showrunner narrate a canonical event-driven game"
  - "carrying private narrative threads without exposing them to contestants"
  - "keeping prose creative while preventing prose-derived game state"
tags: [house, narration, canonical-events, privacy, structured-output, continuity]
related_components: [engine, simulation, checkpoint-recovery, documentation]
---

# Restore House-Authored Narrative Behind an Information Firewall

## Problem

The selective-fact frontier made House summary prose mechanically provable by asking the model to select claim kinds and source aliases, validating those selections, and rendering copy in the engine. That protected canonical authority, but it also prevented the House from writing summaries, weakened connective narrative, and added prompt/schema/tool overhead for attestations no game-state consumer needed.

The actual invariant is narrower: game facts must never be derived from prose. It does not require preventing the omniscient House from describing facts in prose.

## Pattern

At a material actor-coordinate boundary, compile one bounded omniscient narration context from typed engine data:

- canonical events since the last examined head;
- the canonical projection when relevant;
- accepted public dialogue;
- milestone-only private dialogue, sealed decisions, and diary Q&A;
- recent public House beats; and
- one private House narrative notebook.

Make one provider call with an exact schema containing required nullable `publicSummary` and `privateNarrativeNotebook` fields. The schema routes public and private creative output and preserves typed failure; it does not assert that the prose is true.

Publish a non-null summary exactly as authored after only shape, non-empty, control-character, and existing beat-length validation. A non-null notebook replaces the entire bounded opaque snapshot; null preserves the previous snapshot. Non-JSON, embedded/fenced JSON, `{}`, missing or extra fields, refusal, and exhaustion publish nothing and preserve the notebook. Do not synthesize a fallback summary.

## Authority boundary

House prose may contain names, counts, strategy, private information, interpretation, and dramatic connective copy. Human viewers may see that omniscient narration. No reducer, projection, tally, eligibility check, decision, result classifier, replay path, Recall Plan, or AI contestant context may parse or inspect it for facts.

Canonical events and projections remain the authority for what happened. Accepted speech records remain participant history. Exact output schemas remain the authority for whether a structured provider turn succeeded. These are independent of the truth or quality of House prose.

## Information firewall

The House and contestant interviewers have different context compilers:

- The House is an omniscient showrunner and may receive private conversations, sealed decisions, diary answers, and its notebook.
- A diary interviewer receives the subject player's public knowledge, conversations they participated in, their own decisions, and their own prior diary Q&A.
- Judgment question and answer prompts use the same actor-scoped `PhaseContext` boundary plus canonical speaker/addressee history.

House summaries, the notebook, operator traces, other players' diary answers, peer-only private conversations, and peer-owned sealed decisions never enter contestant-facing prompts.

## Continuity and durability

`HouseNarrativeContinuityV2` stores recent public beats, the one private notebook, cadence heads, and pending-delta state. The runner checkpoints an accepted public beat and matching notebook together before releasing the buffered viewer event. Recovery accepts only the exact V2 capsule; deploy only after incompatible active games have drained.

A provider failure remains nonfatal. The existing bounded pending-delta policy may carry an unseen delta once, then clear it after success, explicit skip, or a second failure.

## Long-form and cost

Rich producer mode adds private House-authored long-form copy using the same narration context, recent public beats, and notebook. It adds no Strategy Bible, producer brief, evidence catalog, claim selection, fact read, or separate memory call. Provider exhaustion produces typed absence.

Keep engine-generated phase telemetry for status, call count, usage, cost, and pending-delta disposition. Name it telemetry, not a factual receipt. Recall Plan and prompt-reuse telemetry remain separate structural accounting.

## Validation

Deterministic tests should prove:

1. accepted public summary bytes are unchanged;
2. notebook-only milestones update private continuity without viewer copy;
3. malformed/refused/exhausted turns preserve the previous notebook;
4. checkpoint durability precedes viewer delivery;
5. changing House prose cannot change canonical state, projection, result, or replay classification;
6. notebook and private-context canaries never reach contestant prompts or viewer payload fields; and
7. House creative schemas contain no aliases, claims, receipts, or fact-read action.

Provider evaluation should record visible output, calls, tokens, cost, latency, and failure status, then use human qualitative review for legibility, arc continuity, diary specificity, and player-knowledge compliance. It should not generate semantic hashes, source attestations, or automatic factual grades.

## Superseded lesson

The earlier selective-frontier implementation is useful evidence that over-constraining creative narration can degrade the product even when its proof machinery is internally consistent. Preserve the consumer-side no-prose-facts rule; do not rebuild model-authored evidence systems around presentation text.
