---
name: add-sealed-format
description: Add and prove another sealed non-polarity single-elimination format in Influence. Use when extending the format catalog through the shared Vote Bomb and Majority Elimination capability path.
---

# Add a sealed non-polarity single-elim format

Use this proof-first checklist for formats that share the sealed ballot path:
collect → pure score → pure resolve → optional empowered tiebreak → version-2 `sealed_elim` aggregate.

## In scope

- One sealed non-self target ballot per alive voter
- Pure tally math that differs only in score/resolve policy
- Catalog registration as `sealed_elim`
- Manifest eligibility (default live catalog or subset)
- Agent decision surface with a **distinct** public name and rule sheet
- Viewer/results plurality-style presentation (not Vote Bomb zero-safe UI unless the rules are zero-safe)

## Non-goals

- Do not parse transcript prose or extend the frozen classic presentation parser.
- Do not alias the new format to Vote Bomb, Majority Elimination, Safety Bounce, or classic action identity.
- Do not add a production round-count gate to force catalog coverage.
- Do not use `as any`.
- Do not make direct House/model calls outside the established agent surface.
- Do not force public-chain, polarity, preselection/split-field, multi-elim, or a format DSL onto this path.

## Checklist

1. **Characterize first** — add failing pure clear/tie cases and one explicit one-format integration case before wiring runtime dispatch. If changing shared code, pin Vote Bomb zero-safe/fewest-positive behavior first.

2. **Presentation + pure rules** — update `format-presentation-metadata.ts`, then add `formats/<name>.ts`. Keep metadata browser-safe. Implement legality, score, and resolve; re-export browser-safe trust checks through `format-rules.ts`.

3. **Catalog capability** — register the id in `formats/catalog.ts` as `sealed_elim`, including decision, aggregate, and presentation descriptors. Extend the exhaustive id/types; unknown ids and capability mismatches must fail closed.

4. **Frozen manifest** — make the format eligible through the catalog/default manifest only when it is fully wired. Prove an explicit one-format manifest auto-selects without `format.menu_offered` or an empowered pick call, a two-format manifest offers both cards, and the four-plus default keeps soft anti-repeat. Do not add cast-size or round-count gates.

5. **Shared resolve path** — route catalog dispatch through `resolveSealedElimFormatRound`; use the registration's score/resolve and aggregate adapter. New writes emit `format.resolved` payload version 2 with `aggregate.capability: "sealed_elim"`, totals, and the policy-defined eligible set.

6. **Shared agent surface** — add the catalog-owned public name, rule emphasis, tool/action names, and fallback reason; expose the typed agent method and MockAgent decision through `formats/agent-surface.ts` and `agent.ts`. Keep format-specific strategy distinct and use the established trace/model-call path.

7. **Canonical readers and validators** — update accepted-action vocabulary, projections, recovery, House/revealed facts, completed results, owner-learning labels, and outcome validators. Read aggregates through `formats/resolution-access.ts`; preserve exact format identity.

8. **Web compiler + viewer fixtures** — add the offer/rule card, trusted resolution compiler checks, resolution stage, results presentation, and deterministic clear/tie fixtures. Recompute the outcome with catalog policy; never infer it from prose or fall through to another format.

9. **Docs** — update rules, observability, simulator/local-model examples, concepts when vocabulary changes, and the short public update if this ships as a new card.

## Required proof

- Pure score/resolve: sole outcome and empowered tied-set path.
- Regression: Vote Bomb still treats zero as safe and eliminates the fewest positive total.
- Integration: explicit one-format manifest completes with one matching version-2 resolution and one elimination, without a fake menu or pick call.
- Canonical: writer/read/replay round trip accepts `format.resolved` v2; unsupported versions fail closed; a historical v1 trio fixture still replays.
- Downstream: canonical validators reject a conflicting aggregate/outcome; completed results and owner-learning keep the new identity.
- Web: compiler and viewer fixtures render clear/tie outcomes without classic-parser or format-alias fallback.
- Quality: run targeted Bun tests, relevant type/doc checks, and `git diff --check` before broader repository validation.

## Version contract

- Historical `format.resolved` v1 carries only the original trio's exclusive bags.
- New `format.resolved` writes use v2 capability aggregates.
- Every other canonical event remains payload version 1.
- Reject unsupported event/version pairs; never rewrite or relabel historical events.
