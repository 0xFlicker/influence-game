---
title: Separate Transport Visibility From Staged Presentation
date: 2026-07-27
category: architecture-patterns
module: format viewer ballot disclosure
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "staging a dramatic reveal from facts already readable by operators"
  - "separating participating-agent knowledge from public viewer transports"
  - "building live and replay presentation from the same canonical event stream"
tags: [canonical-events, disclosure, ballots, replay, presentation, privacy]
related_components: [public-watch, production-game-mcp, presentation-director, testing_framework]
---

# Separate Transport Visibility From Staged Presentation

## Context

Format ballots needed television pacing: aggregate first, then named roll call.
The accepted ballots were already intentionally readable by operator web, API,
and MCP transports, while participating agents had a narrower sealed-knowledge
contract. Treating the reveal as a new privacy boundary would have required a
duplicate payload and would have made transports disagree.

## Guidance

Keep four lanes explicit:

1. canonical accepted facts;
2. participating-agent knowledge;
3. operator transport visibility;
4. staged presentation.

Persist one accepted voter-to-target fact. Let operator transports sanitize and
deliver it immediately. Redact peer mappings only in participating-agent
context. At the canonical resolution boundary, project the same facts into
stable roster order and change presentation lifecycle from `sealed` to
`revealed`. The browser may buffer or delay drawing identities, but it must not
claim they were transport-secret.

Use an explicit lifecycle instead of interpreting an empty array:

```ts
type BallotPresentation =
  | { status: "sealed"; rollCall: [] }
  | { status: "revealed"; rollCall: BallotReceipt[] }
  | { status: "not_applicable"; rollCall: [] }
  | { status: "unavailable"; rollCall: [] };
```

Compile live and replay from the same ordered viewer decisions. The presentation
director may control dwell, pause, speed, motion, and manual advance, but
animation callbacks never commit game truth.

## What Did Not Work

- A second `ballotReveal` artifact duplicated authority and could disagree with
  accepted ballots.
- Making accepted ballots producer-only created privacy theater and broke public
  API/MCP readability.
- Using array emptiness conflated unresolved, automatic, malformed, and missing
  ballot states.
- Parsing House transcript prose to reconstruct a reveal made copy an accidental
  game protocol.

## Verification

Use one fixture across lanes. Before resolution, assert public/operator/MCP
sanitized mappings are readable, producer raw mode retains provenance, and each
participating agent sees only its own receipt. After resolution, assert the
projection reveals the same mappings in roster order and the UI draws aggregate
before ledger. Add malformed-prefix tests that retain the last trusted snapshot
without transcript repair.

## Related

- `docs/format-kernel-web-contract-drift.md`
- `docs/solutions/architecture-patterns/owner-scoped-alliance-read-models.md`
- `docs/solutions/architecture-patterns/production-mcp-role-resource-split.md`
- `packages/engine/src/viewer-decision-events.ts`
- `packages/engine/src/revealed-round-facts.ts`
- `packages/web/src/app/games/[slug]/components/format-presentation-director.ts`
