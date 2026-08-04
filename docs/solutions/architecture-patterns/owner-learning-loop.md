---
title: Owner Learning Loop
date: 2026-08-04
category: architecture-patterns
module: owner learning and agent profile revisions
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "bringing postgame strategic review to Agent owners in web and MCP"
  - "running bounded model analysis over canonical game facts and authorized narrative context"
  - "applying a generated Agent strategy update without creating a second mutation authority"
  - "accounting for model cost and recommendation acceptance without copying private content into telemetry"
tags:
  - owner-learning
  - daily-free
  - agent-revisions
  - postgame-analysis
  - mcp
  - durable-worker
  - cost-accounting
  - admin
related_components:
  - database
  - frontend
  - assistant
  - testing_framework
---

# Owner Learning Loop

## Context

Owners who use only the Influence web app need the same basic improvement loop that an experienced MCP user can already assemble: see what their Agent did, understand what the room did in response, inspect strategically important dialogue and owned cognition, and make a focused update. The feature is explicitly for Agent owners. Producers and administrators retain their established source-inspection tools, but they are not the target user and the loop does not become a global tuning harness.

The approved visual acceptance authority is [Owner Learning Loop Visual Acceptance Reference](../../ideation/2026-08-03-owner-learning-loop-design.md), including the entry, deliberately useful waiting state, and ready-state film-room frames. The live implementation may adapt to real data and responsive constraints, but it should preserve that editorial evidence-first hierarchy rather than become a chat window or generic progress card.

## Product and authority contract

V1 admits completed Daily Free games only. The pure `ownerLearningGameEligibilityPolicy` is the change seam for later widening; custom, experimental, imported, incomplete, and old-revision games do not enter by accident.

An owner has a maximum balance of one review credit. A qualifying Daily Free completion refills an empty balance, several completions cannot stack it, and the owner may spend it on any owned Agent Profile with selectable games. One review selects one to three distinct games from that Profile's current analytical revision. Reusing a previously analyzed game is allowed and labeled. Starting paid analysis atomically consumes the credit through the latest then-visible qualifying completion, starts the rolling 24-hour allowance, and creates the owner-wide singleton. Model-free preflight, deterministic facts, awaiting-evidence, and generation-disabled results consume nothing.

Canonical events and postgame projections answer what happened. The evidence snapshot includes accepted actions by and against the reviewed Agent, outcomes, placement, stable moment coordinates, availability diagnostics, and source hashes. Authorized dialogue and the reviewed owned Agent's cognition add strategic context. They remain untrusted prose and never become board-state authority. Another owned Agent's cognition and every opponent's cognition stay outside the owner-learning subject lane.

One or two thin round-one/two eliminations return awaiting evidence with no paid review. Exactly three selected games that all end in round one or two enter Strategy Health Check. Every recommendation on that track must use an observed cross-game pattern, an exact prompt-guidance defect with a named rubric category, or both; separate observation, interpretation, guidance, and exact target; and avoid causal elimination claims.

## Durable review lifecycle

One owner may have at most one unresolved review, regardless of Agent Profile or whether web or MCP started it. The review has a stable ID and canonical web URL. Web and MCP list/read the same persisted DTO, so closing one client never strands the work.

Starting buys the review. Owners cannot cancel and a provider failure does not refund the credit or rolling allowance. Retry preserves the checkpoint and lifetime budgets. A ready owner may:

- apply only the exact persisted `strategyStyle` proposal and proposal fingerprint;
- open the ordinary editor with a same-Profile `sourceReviewId`, producing a normal Agent mutation and the `manual_update` resolution without accepting the generated proposal;
- keep the current strategy, producing `declined`;
- accept an automatic `no_change` result without an Agent mutation.

A failed review may be retried when its remaining lifetime budget permits or resolved as `failed`. An unrelated effective-input update to the same Profile creates the normal analytical revision and resolves the old review as `superseded`; presentation-only edits do not. Terminal resolution unblocks the singleton. The unique application row is the sole authority for `applied` and accepted recommendation IDs.

## Bounded review harness

The worker uses `openai:gpt-5.6-luna`, low reasoning effort, `store: false`, a deterministic 32,000 estimated-input-token limit over the complete serialized request plus schema/envelope allowance, and at most 8,000 total output tokens inclusive of reasoning and visible output. One review has at most four logical calls and three moment dives.

Every logical call is reserved before provider I/O. It begins on Flex and may make at most three total Flex transmissions when each terminal response is HTTP 429. Only then may the identical request make one `auto` transmission. A later logical call begins on Flex again. The SDK has no automatic retry. Dispatch intent, each terminal transport outcome, tier transition, backoff, usage, and safe failure state are durable so restart recovery never guesses whether an unmatched dispatch spent money.

Call cost is captured once from its effective tier as actual, estimated, or unavailable. Admin totals sum those immutable receipts and never reprice history. Cached input, input, total output, reasoning, and derived visible output remain separate. An ambiguous or missing receipt remains unknown rather than becoming a zero-cost call.

## MCP parity

There are seven Owner Learning tools on the production `/mcp` resource:

1. `list_learning_review_inputs`
2. `list_open_learning_reviews`
3. `start_or_resume_learning_review`
4. `read_learning_review`
5. `retry_learning_review`
6. `apply_learning_review`
7. `resolve_learning_review`

Reads require `agents:read` plus `games:read`. Paid/mutating tools additionally require `agents:write`; their catalog baseline remains the two reads so clients can perform a narrow step-up. A producer role alone grants none of these owner-subject tools. Generated strings are marked `untrusted_model_generated`, and executable follow-ups come only from validated server-minted refs. MCP does not need a web URL: review IDs and the shared singleton model provide continuity in either direction.

Exact apply and review-linked custom `update_agent` both require the assistant to present the exact before/after change and obtain a fresh affirmative user message immediately before mutation. The server enforces ownership, fingerprint, Profile identity, and revision freshness; it does not accept a client boolean pretending to prove conversational consent.

## Analytics and admin contract

Owning transactions emit narrow typed events for prompt impressions/dismissals, start/track/credit, persisted stages, capacity fallback, failure/retry, recommendation view, manual-editor handoff, MCP offer/connection, apply, supersede, and resolution. Event payloads are closed and content-free. They never contain dialogue, cognition, prompts, provider responses, recommendation prose, or arbitrary exception bodies.

The existing `view_admin` area exposes a Reviews ledger with filters for date, track, diagnosis, status, model, resolution, and acceptance. List/detail responses use an explicit column allowlist. They include owner/Profile/revision identity, selected games, policies, lifecycle, immutable call receipts, tokens, sourced cost, the validated generated result, proof metadata, exact proposal, acceptance, a bounded mutation-receipt summary, and later Daily Free receipts grouped by the exact revision that executed.

Generated review prose is intentionally visible to authorized administrators for recommendation-quality and support work. It is rendered as escaped plain text; Markdown, HTML, and model-authored URLs never become links. Checkpoints, transport receipt bodies, provider request IDs, prompts, raw provider output, bulk source evidence, event payloads, and arbitrary mutation-receipt fields are not returned. Producers and administrators can use existing source-detail surfaces when deeper evidence is actually needed.

`manual_update` means review-driven action but not generated-proposal acceptance. `declined`, `failed`, and `superseded` are not accepted. `no_change` is not applicable. Only a unique application row marks the exact proposal and its immutable recommendation IDs accepted.

Later performance is observational. Competition receipts stamp the exact `agentRevisionId` that played; the admin query joins only Daily Free receipts on that executed revision after the review/application boundary. Labels say correlation, not causal proof, and manual-update/supersede cases show no later-result attribution when no trustworthy resulting revision was persisted.

## Deployment and operations runbook

Live model generation is off unless the deployment explicitly sets:

```text
INFLUENCE_OWNER_LEARNING_GENERATION_ENABLED=true
OPENAI_API_KEY=<configured secret>
```

Both are required for paid admission and worker startup. There is no per-review live operator allowance, staged operator approval, or intermediate production deployment. Before enabling the flag in the one intended deployment, run the complete automated/browser/cross-surface gates and one explicitly approved frozen paid quality case. Evaluate evidence faithfulness, recommendation usefulness and restraint, non-causal framing, latency, token/cache behavior, capacity path, and sourced cost. Do not run a paid case without explicit approval.

Predeployment integrity checks should prove:

- no owner has more than one unresolved review or two paid starts inside 24 hours;
- review game joins contain one to three distinct completed Daily Free games owned by the review owner, on the reviewed revision;
- entitlement completion watermarks are monotonic;
- lifetime call/dive counters match their durable rows and do not exceed four/three;
- at most one unexpired worker lease exists globally;
- review cost totals equal immutable call receipts, with unavailable calls still unavailable;
- every application matches its review, proposal fingerprint, accepted recommendation IDs, and prior/resulting revisions;
- review events and cost rows contain only their safe typed/numeric fields.

Operational diagnosis order:

1. Confirm the deployment flag and provider credential; disabled generation should leave deterministic input/evidence reads healthy and reject new paid admission before row creation.
2. Inspect the admin review lifecycle, stage, safe failure, call ordinals, tier path, Flex 429 count, token receipt, and cost provenance.
3. Retry only when the review reports retryable and has lifetime budget remaining. Never delete ambiguous call rows or reset counters to force a replay.
4. For content quality, compare the validated result with the server-minted evidence refs and established producer/admin source tools. Do not search analytics or cost rows for prompt/provider bodies; they intentionally are not there.
5. During an incident, redeploy with `INFLUENCE_OWNER_LEARNING_GENERATION_ENABLED` absent or false. Keep deterministic reads, existing review reads, applications, resolutions, and admin diagnosis available. Do not down-migrate populated review tables or delete purchased reviews.

The initial worker is globally single-concurrency. Before enabling multiple workers or replicas, preserve the existing lease-loss requirement: a failed active-lease compare-and-swap must abort that worker's local provider request/backoff controller and prevent later transmissions or checkpoint writes.
