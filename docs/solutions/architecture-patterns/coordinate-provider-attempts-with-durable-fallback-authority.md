---
title: Coordinate Provider Attempts with Durable Fallback Authority
date: 2026-08-23
category: architecture-patterns
module: provider execution and game recovery
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - routing gameplay calls through an ordered provider fallback manifest
  - preserving provider-failure evidence without blocking game completion
  - enforcing fallback budgets across concurrent or recovered workers
  - recovering an indeterminate provider call without a duplicate canonical effect
  - exposing private provider evidence to operators and producer MCP
tags: [provider-resilience, provider-attempt-journal, provider-manifest, fallback-budget, acceptance-fence, circuit-breaker, private-evidence]
related_components: [background_job, database, authentication, testing_framework, documentation]
---

# Coordinate Provider Attempts with Durable Fallback Authority

## Context

Provider fallback is not just a loop around an SDK call. Influence has long-running, resumable games in which a remote response can affect canonical competitive state. Retries, fallback order, spend, crash recovery, private diagnostics, and systemic provider health must therefore agree about what was dispatched and what was accepted.

The unsafe shape is to add independent retry or fallback logic to each player and House call. SDK retries then happen outside application accounting, provider exceptions disappear before a successful trace exists, concurrent workers can overspend the last fallback unit, and a crash can let two responses compete to affect gameplay. Provider exhaustion must also never become fake agent-authored dialogue.

## Guidance

### Centralize attempts below gameplay policy

Route player and House calls through one coordinator. Give every logical call stable game/owner/actor/action coordinates, allocate each attempt ordinal durably, reserve before dispatch, disable hidden transport retries, classify the outcome, and journal the terminal result.

When one phase legitimately schedules the same action more than once, give the call a closed, versioned semantic coordinate. A phase call carries its canonical event boundary and call slot; a diary exchange carries its session event boundary, player ID, and exchange ordinal; a House huddle carries its durable schedule ID; a turn-scoped call carries its durable turn ID and subcall slot. Do not let repeated calls fall back to a shared default coordinate: accepted-result replay would then let a later call consume an earlier call's value.

Canonically serialize and hash that coordinate before deriving the logical-call ID. The journal persists the structured coordinate and its hash as immutable identity. A historical numeric column may remain nullable during an expand-contract rollout, but it is inert: no active writer, reader, or replay path may use it as an authority. Do not pack semantic dimensions into a number.

The coordinator owns attempt mechanics and manifest traversal. It does not decide legal game actions. Optional speech may return typed absence; required actions still delegate to the phase that owns the current legal target set.

```ts
const call = coordinator.startCall(coordinate);

const result = await call.executeManifest({
  entries: sealedRuntimes.map((runtime) => ({
    catalogId: runtime.catalogId,
    preparedRequest: () => prepareRequest(runtime),
    maxAttempts: retryPolicy(runtime),
    dispatch: ({ requestOptions }) => send(runtime, requestOptions),
    validate: validateCandidate,
  })),
  cancellationSignal,
});
```

Each dispatch consumes its reserved fallback unit and is never refunded. Reservation and the provider-health check belong in the same database transaction so a breaker cannot open between observation and dispatch. An exhausted or entry-scoped-open manifest entry may advance to the next permitted entry; a provider-wide open circuit may halt automatic cross-provider spending.

### Preserve useful failure evidence without making storage gameplay authority

Capture the exact prepared request and provider response at the transport boundary before parsing discards detail. Sanitize credentials before persistence, including reflected values and credential-bearing URL parameters. For non-429 failures, retain the exact sanitized envelope and correlation metadata.

Recovered rate limits are different: aggregate their count and recovered status instead of writing one raw object per retry. Terminal rate-limit exhaustion retains the count and terminal reason.

Write a deterministic private-evidence outbox next to the terminal attempt journal. Object-storage workers may claim and reconcile that outbox with bounded deadlines, backoff, and idempotent identities. If evidence storage fails, mark diagnostics degraded and continue gameplay; a diagnostic failure must not repeat or invalidate an accepted action.

### Separate optional absence from required legal continuation

Optional speech or narration exhaustion creates no transcript message, model thinking, strategy update, or synthetic `[No response]` prose.

Required decisions use phase-owned deterministic fallback over the current legal choices. The fallback commits through the normal canonical path, so it affects tallies, later eligibility, and game history, while provenance records that the engine—not a model—selected it. Do not fabricate a model decision ID, rationale, or strategy delta.

### Seal one manifest per game

The game configuration seals the ordered provider/model entries, compatible reasoning policies, and per-fallback call caps. Catalog changes and later Daily defaults cannot rewrite a running or recoverable game. Manual and test creation may continue to use the supported OpenAI and Katana catalog; qualification limits unattended Daily defaults, not the inventory available to authorized testers.

Budget enforcement must be atomic. Counting already-reserved attempt rows while holding the game-owner lock is sufficient: two workers racing the last unit cannot both dispatch, and no mutable in-memory counter can drift after a restart.

### Accept one gameplay effect, not one remote execution

A remote inference cannot be made exactly once without provider idempotency. If the process crashes after dispatch but before durable acceptance, recovery retries with a new attempt ordinal and may duplicate billing.

The local guarantee is different and enforceable:

1. Persist a stable logical-call identity and monotonic attempts.
2. Persist a bounded validated value behind an accepted-result fence.
3. Derive decision correlation from that accepted attempt.
4. Link the accepted attempt to the canonical event in the canonical transaction.
5. Reject stale-owner, conflicting, and late results.
6. Replay an already accepted value instead of redispatching it.

This permits one canonical gameplay effect without claiming exactly-once remote inference or billing.

Validate provider payloads and accepted domain values as separate representations when normalization changes shape. For example, a provider schema may require a nullable `thinking` field while the canonical accepted value omits it after a `null` result. Provider validation must still require the field; replay validation must accept only the canonical omission or a retained non-empty string, then round-trip the value through the domain decoder before reuse. Do not weaken the provider schema or reinterpret noncanonical accepted values to make replay pass.

### Treat systemic provider health as separate durable authority

Request-specific refusal and rate limiting remain call-scoped. Authentication failures open provider health immediately; unsupported configuration can open only the affected entry; repeated service or transport failures open after a bounded threshold. Ambiguous 4xx responses stay call-scoped without corroboration.

Persist revisioned health state and use one expiring probe lease. Closing requires a successful probe against the current revision. A failed probe leaves the circuit open and stores its sanitized evidence; there is no blind force-close. An open Daily primary pauses new Daily claims, while running games continue through their permitted manifest or engine behavior.

### Preserve the existing private authority split

Admin history uses one batched summary query and lazy-loads chronological details and bounded raw content. Current `admin` or `sysop` database role is revalidated on every read. Producer MCP requires both the `producer` OAuth scope and current producer role; `games:read`, game ownership, or a stale token claim is insufficient.

Render raw provider data as escaped plain text. Mark MCP payloads as untrusted evidence, audit raw reads, and return private responses with `no-store`. Loading, truly empty, unavailable, degraded, recovered, terminal, partial, and complete states must remain distinguishable.

## Why This Matters

The authority split keeps four different truths from collapsing into one another:

- canonical events say what happened in the game;
- accepted decision traces explain successful model choices;
- provider-attempt evidence explains unusable remote attempts;
- spend and provider-health records control whether another dispatch is allowed.

Without that split, fallback can overspend, diagnostics can leak private strategy, storage outages can fail games, or crash recovery can apply two conflicting actions. With it, diagnostics may degrade independently while gameplay continues under deterministic rules.

## When to Apply

- Adding retries or provider fallback to paid remote inference.
- Running long-lived or resumable work across multiple workers.
- Converting provider exhaustion into legal domain actions.
- Preserving rejected requests for privileged diagnosis.
- Enforcing per-run provider budgets or systemic circuit breakers.
- Exposing private provider evidence through admin or MCP tools.

## Examples

```text
non-429 failure
  -> terminal attempt journal
  -> deterministic private-evidence outbox
  -> bounded private object + manifest
  -> admin/sysop or producer-scope/current-role read

recovered 429 activity
  -> logical-call aggregate count
  -> recovered outcome
  -> no raw object per retry

indeterminate dispatch after crash
  -> retry with next durable attempt ordinal
  -> possible duplicate provider billing
  -> one accepted-result fence
  -> one canonical gameplay effect
```

Regression coverage should pin transport retry suppression, refusal traversal, reset-to-primary on the next logical call, atomic final-budget consumption, accepted replay without redispatch, canonical serialization/hash stability, distinct deterministic semantic coordinates for repeated same-action calls, malformed/unknown-coordinate rejection, provider-to-domain normalization and replay validation, canonical linkage, stale-owner rejection, evidence degradation/reconciliation, exact non-429 evidence, aggregate 429s, optional absence, legal required fallbacks, breaker classification/concurrency, probe fencing, authorization, inert rendering, bounded byte continuation, no-store behavior, and no-N+1 summaries.

## Related

- [Keep One Game Provider Manifest Authority](./keep-one-game-model-selection-authority.md)
- [Fence Noncanonical House Access After Provider Calls](./fence-noncanonical-house-access-after-provider-calls.md)
- [Agent Strategy Observability Spine](./agent-strategy-observability-spine.md)
- [Production MCP Role and Resource Split](./production-mcp-role-resource-split.md)
- [Bound Phase-Cadence Narration with Selective Fact Frontiers](./bound-phase-cadence-narration-with-selective-fact-frontiers.md)
- [Production Game MCP Raw Trace Read Limit](../runtime-errors/production-game-mcp-raw-trace-read-limit.md)
- [API Startup Recovery Resumes Interrupted Games](../runtime-errors/api-startup-recovery-resumes-interrupted-games.md)
