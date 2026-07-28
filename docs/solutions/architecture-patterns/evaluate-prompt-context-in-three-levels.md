---
title: Evaluate Prompt Context in Three Levels
date: 2026-07-28
category: architecture-patterns
module: prompt context evaluation
problem_type: architecture_pattern
component: evaluation
severity: high
applies_when:
  - "changing Recall Plan selection, prompt context budgets, or cache layout"
  - "deciding whether a context-builder revision improves a real agent conversation"
  - "using durable game traces without leaking private dialogue or mutating the source game"
  - "approving hosted model spend for controlled context evaluation"
tags: [prompt-context, recall-plan, evaluation, source-fidelity, blind-review, provider-safety]
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

## Failure lessons

- Instrumentation-only “benchmarks” measured prompt shape while leaving relevance untested.
- Arbitrary runtime, policy, or schema hashes did not attest the checkout that actually executed.
- Reporting the approval ceiling as if it were realized cost destroyed economic interpretability.
- Patch-only checks did not prove durable source materialization or same-source fidelity.
- Headline-only reports hid lane budgets, selection reasons, request identity, usage, service tier, cost provenance, and blind decision rationale.

Fail closed on source drift, dirty revisions, protocol mismatch, an ambiguous provider outcome, first-call cache contamination, or invalid continuation. A failed panel produces no partial winner.

## Verification

Provider-free acceptance should include:

- deterministic fixture and protocol tests;
- fake-provider full-panel, recovery, concurrency, blind-review, and report tests;
- revision-isolated worker-process tests through a loopback-only fake broker;
- real DB/trace-storage materialization of the authorized case;
- source-fidelity replay with matched turn count and `sourceMutation: false`.

Hosted curator or panel execution remains a separate operator decision. “The harness is ready” and “the model comparison was run” are different claims, as they should be.
