---
title: Fence Noncanonical House Access After Provider Calls
date: 2026-08-19
category: architecture-patterns
module: engine named alliance access orchestration
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "using a model or producer decision to choose which actors receive a gameplay opportunity"
  - "keeping model-authored orchestration separate from canonical game facts"
  - "repairing invalid model selections to an exact deterministic quota"
  - "awaiting provider work while active-game ownership can become stale"
  - "reasoning about crash recovery and provider-call cardinality"
tags: [house, named-alliances, canonical-events, privacy, deterministic-repair, ownership-fence, crash-recovery, provider-calls]
related_components: [assistant, testing_framework, documentation]
---

# Fence Noncanonical House Access After Provider Calls

## Context

The named-alliance window needed fewer proposer calls without giving The House authority over alliance facts. The resulting producer decision chooses only who may receive the existing proposer opportunity. Selected agents still choose `propose`, `amend`, or `pass`, own members and terms, and may decline to form anything. Invitees still respond or counter through the existing versioned consent and activation transaction whether or not they were selected.

This creates a subtle ownership boundary. The House call is awaited and can outlive the process's execution lease. Emitting producer evidence or calling a selected agent after that await without rechecking ownership would let a stale runner continue observable gameplay.

## Guidance

Treat House selection as noncanonical access orchestration:

1. After any rule-owned cleanup, snapshot the living roster and the active-alliance representation counts once.
2. Compute the exact access budget deterministically.
3. Call The House once for candidate IDs and private rationale. Do not ask it for alliance members, terms, consent, status changes, enforcement, or huddle admission.
4. Validate the result against the snapshot. Drop unknown, eliminated, duplicate, and excess IDs. Preserve valid choices, then fill shortages by lowest active-alliance count and stable living-roster order.
5. Recheck the execution lease after the awaited House call and finalization, before emitting the private selection turn or calling any selected agent.
6. Emit one private producer turn with the finalized access set, House/per-player rationale, and repair notes. Do not append a canonical alliance event.
7. Execute the finalized set in stable living-roster order through the unchanged proposer and invitee transaction.

The second ownership fence is deliberately after provider work:

```ts
const housePlan = await house.selectAllianceProposers(context);
const finalizedPlayers = finalizeAndRepair(housePlan, snapshot, budget);

await assertCanAcceptCommit(ctx);
emitPrivateSelectionTurn(finalizedPlayers, housePlan, repairNotes);

for (const player of finalizedPlayers) {
  await collectExistingProposerOpportunity(player);
}
```

If the House implementation rejects, the outer phase boundary still repairs from an empty result to the exact quota and emits one understandable private artifact. A selected agent's pass, unavailable method, timeout, or provider failure consumes that one opportunity; it must not trigger another House selection or silently grant access to a replacement player.

Keep the privacy lanes explicit:

- canonical alliance events and projections remain the only authority for proposal, response, consent, activation, amendment, closure, and huddle facts;
- the House selection turn and private trace are producer/debug evidence;
- player-safe and public transcript surfaces do not receive selection rationale or repair diagnostics.

## Why This Matters

This pattern reduces paid agent cadence without building a second formation system. The House can shape access toward underrepresented players, but cannot manufacture alliance agreement or overwrite the social transaction. Deterministic validation guarantees the engine's exact quota even when structured output is malformed, stale, or adversarial.

The post-provider ownership fence prevents a stale runner from emitting a selection artifact or initiating proposer calls after its lease has been lost. The remote provider call itself is not exactly-once across crash recovery. A process can crash after the provider completes but before local evidence or a resumable boundary is durably established; replay or recovery may issue the House call again. Describe the normal in-memory window as one House call, but describe crash/replay semantics as at-least-once provider execution with deterministic local validation. Do not make billing, uniqueness, or canonical-truth claims from an assumed exactly-once inference call.

## When to Apply

- A model selects access, scheduling, prioritization, or presentation rather than authoritative game state.
- The selected set must meet an exact quota despite invalid model output.
- Provider work occurs inside an active-game runner protected by a lease or owner epoch.
- Recovery can replay from canonical state that intentionally excludes the producer decision.

Do not use this pattern to let a model author canonical membership, consent, outcomes, or status transitions. Those remain rule-owned transactions with canonical events.

## Examples

Representation counts include separate overlapping active memberships, but exclude open proposal lineages and closed or archived alliance records. A player in two active alliances has count two; a player named only in an open proposal still has count zero.

For five living players, the exact proposer budget is two. If The House returns one valid living ID, a duplicate, an unknown ID, and an eliminated ID, retain the valid ID and add the lowest-represented remaining living player. Emit the repaired two-player set privately, then give only those two agents proposer opportunities. An unselected invitee can still accept or counter either proposal.

## Related

- `CONCEPTS.md` defines the House alliance proposer plan and named-alliance authority terms.
- `docs/reasoning-transcript-observability.md` defines the private producer-turn and trace boundary.
- `docs/solutions/architecture-patterns/owner-scoped-alliance-read-models.md` covers downstream alliance read privacy.
- `packages/engine/src/phases/alliances.ts` implements access finalization and the unchanged alliance transaction.
- `packages/engine/src/__tests__/named-alliances-actions.test.ts` covers repair, active-representation counts, privacy, and lease loss.
