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
