---
title: Freeze Werewolf discussion and ballot semantics by rules version
date: 2026-10-18
module: Werewolf
problem_type: architecture_pattern
component: rules, projections, replay
severity: high
tags: [werewolf, versioning, public-discussion, ballots, replay]
---

# Freeze Werewolf discussion and ballot semantics by rules version

## Symptom

Changing daytime rules can make an accepted game's replay disagree with what
players saw. A new public-discussion format also risks leaking private pack
coordination or exposing ballot choices before their public turn.

## Cause and fix

Treat the rules version in the frozen game configuration as the authority for
both execution and presentation. Keep historical reducers for existing v7/v8
games; fresh v9 games use a separate reducer and structured conversation,
ballot, and pack-proposal entries. Commit and publish each public contribution
before dispatching the next actor. The projection assigns ordinals, recipients,
reply references, and byte accounting from typed state, never from dialogue.

V9 uses one shared UTF-8 byte allowance, then one seeded public ballot in which
later voters see earlier accepted choices. Pack proposals remain visible only
to wolves and Omniscient viewers. The final result references the ballot
resolution without replaying the already-public choices. Live telemetry may
report accepted progress, but never future choices or private rationale.

Regenerate the closed House MCP output schemas from the owning DTOs whenever
these unions change. An explicit v7 HTTP test found that the saved schema still
required `rulesVersion: 8`, despite the reducer correctly accepting v7. That
same stale contract would reject v9 conversation snapshots and public ballots.
Use the pinned `scripts/generate-house-mcp-schemas.cjs` workflow; do not weaken
the schemas or hand-maintain another interpretation of the game state. General
rules lookup and character coaching must also use the current rules constant,
while historical model execution references the explicit legacy constant.

## Verification

Add focused tests for v9 scheduling and byte accounting, public-prefix
visibility, proposal privacy, and the absence of a duplicate ballot reveal.
Keep fixture-pinned v7/v8 replay tests to prove that current rules do not alter
historical timing or visibility. Paid model evaluation is separate from these
deterministic checks and must stay within its explicitly authorized aggregate
budget.

Exercise actual MCP HTTP serialization for each released version, including
paginated replay, completed results and Omniscient-only proposals. A passing
engine projector test alone cannot catch a stale external JSON schema.

## Daily priority batches (v11)

A Seer with a wolf read could reach the floor too late under the seeded v9/v10
order. V11 adds a private integer-only priority survey before discussion, using
parallel provider calls and fixed-order durable commitments. Keep the start-of-day
observation unchanged as individual priorities commit; otherwise recovery rejects
remaining prepared calls due to changed observation hashes. Apply the descending
priority order only once all living actors have committed, keeping the original
seeded order for ties. No survey entry belongs in playback or future agent context.
Reuse the sealed-batch recovery path and test an interruption after the first
commit, owner replacement and no provider redispatch. Public votes remain serial.

V11 verification (2026-10-24): the provider-free baseline passed 2,957 tests
with five skips, and the final priority-specific suite passed eight tests,
including malformed-output exhaustion. The full PostgreSQL run passed 2,183
of 2,187 tests, including priority-batch owner recovery with no redispatch.
Three visual tests needed their scripted agent to return priorities, and one
MCP test had loaded the pre-generation schema; after the fixture update, a
fresh run of both affected files passed all 45 tests, including v11 MCP replay.
Typechecking/linting passed. No paid game or provider qualification was run.
