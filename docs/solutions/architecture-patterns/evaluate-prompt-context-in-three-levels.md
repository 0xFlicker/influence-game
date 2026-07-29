---
title: Evaluate Prompt Context in Three Levels
date: 2026-07-28
last_updated: 2026-07-28
category: architecture-patterns
module: prompt context evaluation
problem_type: architecture_pattern
component: testing_framework
severity: high
applies_when:
  - "changing Recall Plan selection, prompt context budgets, or cache layout"
  - "deciding whether a context-builder revision improves a real agent conversation"
  - "designing a blind panel whose action class must exercise the changed context lane"
  - "interpreting weak or low-confidence human A/B preferences"
  - "using durable game traces without leaking private dialogue or mutating the source game"
  - "approving hosted model spend for controlled context evaluation"
tags: [prompt-context, recall-plan, evaluation, causal-attribution, source-fidelity, blind-review, provider-safety]
related_components: [engine, api, simulation, documentation, testing_framework]
---

# Evaluate Prompt Context in Three Levels

## Problem

Structural instrumentation answers whether prompt construction changed. It does not answer whether the right memory survived or whether an agent used it well. A full-game simulation shows integration and watchability, but it introduces too many changing decisions to attribute a result to one context policy.

Using either as a universal quality verdict is measurement cosplay: lots of artifacts, no clean product decision.

## Pattern

Use three levels in order:

1. **Structural fixtures** compare deterministic Recall Plan budgets, authority lanes, renderer structure, request fingerprints, and replay behavior with a fake provider.
2. **Targeted real-thread evaluation** materializes one authorized durable situation, verifies it against recorded source turns, runs the same ordered continuation through two isolated context policies, captures provider/cache accounting, and ends in blind human review.
3. **Full-game simulation** checks cross-phase integration, long-running strategy, pacing, fallbacks, and watchability.

Each level has a narrower claim than the next. None substitutes for another:

- fixtures do not prove conversation quality;
- one real thread does not prove universal or season-level quality;
- a full game does not isolate the causal effect of one context revision.

Start with the product decision the experiment can reject. Escalate only when the cheaper level leaves that decision unresolved.

## Causal-exercise gate

Before spending money or interpreting a behavioral comparison, prove that the compared calls exercise the lane being changed:

- the action's actual prompt class can receive that lane;
- the lane has a non-zero budget;
- baseline and candidate produce different model-visible inputs at the intended seam;
- the generated output comes from those exact inputs.

For a Recall Plan history change, a panel of `ordinary_speech` calls cannot pass this gate because that prompt class has a zero history budget. The calls may still measure cache behavior, cost, or ordinary-speech quality, but a blind preference between them is not evidence for or against strategic recall.

Derive this scope from completed cell ledgers, not the requested experiment label or a preflight declaration. The current report returns `not_exercised` for cache-quality-only scope, zero scored evidence, or entirely policy-disabled evidence; the strategic probe also detects an all-zero history budget. It does not yet detect model-input equality directly. Until that check exists, the operator must treat zero history budget or no policy-controlled input difference as `not_exercised` and exclude the behavioral winner from recall-promotion arithmetic.

The common prompt must also have enough strategic headroom to reveal the desired behavior. A post-format, pre-vote speech prompt that produces strategically thin outputs in both arms is a weak instrument even if its inputs differ. Preserve that result as low sensitivity or insufficient evidence; do not force sampling noise to adjudicate a context policy.

## Authority boundaries

Canonical events remain authority for accepted board state. Typed transcript, checkpoint, continuity, and complete private-trace artifacts may reconstruct the authorized model-facing situation, but they do not become canonical game facts. Evaluator reports are private analytical artifacts, not game state.

Materialize into a private root outside Git worktrees. Preserve raw prompts, dialogue, reasoning, provider output, blind mappings, and approvals only there. Ordinary status output should expose lifecycle, hashes, aggregate counts, spend, and next actions—not payloads.

Never resume or mutate the source game. Verify a frozen case against source records and record `sourceMutation: false`.

## Revision attestation

The baseline and candidate need the same evaluator harness and action surface, with only the intended compiler policy varying. Each revision-isolated worker must attest:

- protocol, schema, canonicalizer, and capability set;
- shared non-variant harness digest;
- its own Recall Plan compiler-policy digest;
- shared action-schema hash.

Resolve the actual clean checkout SHA and repeat attestation during execution. Bind `runtimeHash` to the shared harness digest. Caller-supplied labels are not proof; accepting arbitrary digests creates a very official-looking placebo.

## Spend and lifecycle controls

Keep curator and panel approvals separate and bind each to the complete canonical manifest hash. The provider broker owns:

- exact model snapshot and Flex-only service tier;
- fixed call order and cache lineage;
- one in-flight request;
- maximum call, token, and spend ceilings;
- no fallback and no automatic retry;
- durable response recording before deterministic apply.

Estimate realized cost from returned usage and effective service tier. Keep conservative approval ceilings visibly separate from realized estimates.

Human ownership is terminal: a curator can propose evidence, but the producer freezes it; the evaluator can anonymize pairs, but the reviewer chooses; unblinding waits until every decision is locked.

## Keep verdict lanes separate

An evaluation can legitimately support one claim while leaving another unresolved:

| Verdict lane | Required evidence | Allowed conclusion |
|---|---|---|
| Selection | Deterministic strategic compilation selects more required evidence without more distractors | Ranking improved for this fixture |
| Model use | Generated strategic calls receive different policy-controlled evidence | The model-use comparison is causally eligible |
| Behavioral preference | A blind reviewer compares the eligible outputs | One output is preferred for this case |
| Integration | A full game exercises the policy across phases | The change survives game-level operation |

Do not let evidence from an unrelated lane veto a demonstrated selection improvement. Conversely, deterministic selection evidence does not prove that a model used the selected evidence well.

The current blind-review schema records categorical choice and optional dimension-specific reasons, but no magnitude. Extend it to preserve:

- `choice`: `A`, `B`, `no_preference`, or `insufficient_evidence`;
- `strength`: `slight`, `moderate`, or `strong` for an arm choice;
- `confidence`: `low`, `medium`, or `high`;
- dimension-specific reasons for strategy, coherence, evidence use, and watchability.

Keep the raw choices. Render strength and confidence beside them instead of silently inventing a weighted score. Two slight preferences and two strong preferences are not the same product signal, even when both produce a `2–0` count.

## Failure lessons

- Instrumentation-only “benchmarks” measured prompt shape while leaving relevance untested.
- Paid ordinary-speech continuations with zero history budget produced valid prose preferences but did not exercise the strategic recall policy under test.
- A strategically weak common prompt made forced A/B choices look more decisive than the reviewers found them.
- Categorical choices without strength or confidence flattened “barely” and “decisively” into the same result.
- Arbitrary runtime, policy, or schema hashes did not attest the checkout that actually executed.
- Reporting the approval ceiling as if it were realized cost destroyed economic interpretability.
- Patch-only checks did not prove durable source materialization or same-source fidelity.
- Headline-only reports hid lane budgets, selection reasons, request identity, usage, service tier, cost provenance, and blind decision rationale.

Fail closed on source drift, dirty revisions, protocol mismatch, an ambiguous provider outcome, first-call cache contamination, or invalid continuation. A failed panel produces no partial winner.

## Verification

Provider-free acceptance should include:

- deterministic fixture and protocol tests;
- a strategic probe that freezes required evidence and distractors, then measures selection coverage without provider calls;
- fake-provider full-panel, recovery, concurrency, blind-review, and report tests;
- revision-isolated worker-process tests through a loopback-only fake broker;
- real DB/trace-storage materialization of the authorized case;
- source-fidelity replay with matched turn count and `sourceMutation: false`.

Before a hosted panel, record a causal-seam table with the action class, changed lane, baseline value, candidate value, and expected observable effect. Refuse the recall-quality experiment when no scored generated call can receive a policy-dependent history selection.

For model-use evidence, the next harness should generate from `strategic_decision` or `strategic_reflection` inputs that pass the gate. Blind the resulting strategic artifacts, ask about plan quality and use of evidence, and retain preference strength and confidence. If the case lacks strategic headroom, choose a better frozen case or improve the common prompt before paying for more samples.

Hosted curator or panel execution remains a separate operator decision. “The harness is ready” and “the model comparison was run” are different claims, as they should be.

## Related

- [Rank Strategic History with Explicit Target and Round Signals](rank-strategic-history-with-explicit-target-and-round-signals.md) covers the retrieval policy and provider-free selection evidence.
- [Build an Agent Strategy Observability Spine](agent-strategy-observability-spine.md) covers typed strategic artifacts and why generic transcript prose is a weak proxy for strategy.
- [Prompt Thread Context Evaluation](../../prompt-thread-context-evaluation.md) is the operator contract for running the harness and interpreting `not_exercised`.
