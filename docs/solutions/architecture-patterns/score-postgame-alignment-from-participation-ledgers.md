---
title: Score Postgame Alignment from Participation Ledgers
date: 2026-08-19
category: architecture-patterns
module: engine postgame analysis and production MCP read models
problem_type: architecture_pattern
component: projection
severity: high
applies_when:
  - "deriving a player's majority alignment from a round-level vote cohort"
  - "calculating alignment rates or producer strategic grades"
  - "serializing nullable postgame evidence through API or MCP"
tags: [postgame, canonical-events, vote-ledgers, majority-alignment, mcp, strategic-grades]
related_components: [completed-results, revealed-round-facts, testing-framework]
---

# Score Postgame Alignment from Participation Ledgers

## Context

A round can expose a supported majority cohort without proving that every player
participated in the scored decision. Treating every player outside that cohort as
misaligned gives eliminated players false losses in later rounds and lowers their
producer strategic grades after they have left the game.

The cohort answers which participating decisions formed the visible majority. It
does not answer who participated. Participation must come from the canonical
ledger for the same scored decision.

## Guidance

Keep majority alignment tri-state:

- `true` when the relevant canonical ledger contains the player and the supported
  majority cohort contains that player;
- `false` when the ledger contains the player but the cohort does not, proving a
  genuine participating minority decision;
- `null` when the ledger does not contain the player or the round does not expose
  a supported majority cohort.

Use the ledger that matches the cohort basis. Standard empower alignment reads the
canonical standard-vote ledger; Council alignment reads the canonical Council
ledger. A cohort alone is never evidence that an omitted player abstained, voted
against it, or was still eligible. Do not repair missing participation from
transcript prose.

Compute alignment rates and producer strategic grades over non-null rows only:

```text
alignment rate = aligned participating rounds / scored participating rounds
```

Preserve `null` explicitly through API and MCP serialization. Do not omit the row,
coerce it to `false`, or replace it with a default value; consumers need to
distinguish non-participation from minority participation.

## Verification

Use deterministic canonical fixtures that cover:

- elimination before later rounds, with later supported cohorts producing `null`;
- an active minority vote producing `false`;
- ballot or cohort formats without a supported alignment cohort producing `null`;
- finalists receiving scored alignment through the last relevant standard round
  and `null` for unsupported endgame decisions;
- API and MCP JSON round trips preserving explicit `null` values;
- producer grade counts and rates using only scored, non-null rounds.

These contract tests prove the projection and serialization behavior. They do not
prove that the change has been deployed or observed in a production game.

## Related

- [Agent strategy observability spine](agent-strategy-observability-spine.md) defines canonical events as game-fact authority and keeps transcript cognition separate.
- [Owner-scoped alliance read models](owner-scoped-alliance-read-models.md) describes compact postgame and MCP read-model boundaries.
- `CONCEPTS.md` defines the compact postgame round summary and tri-state player majority alignment.
- `packages/engine/src/postgame-analysis.ts` owns deterministic alignment derivation.
- `packages/api/src/game-mcp/read-model.ts` owns producer strategic-grade assembly.
