---
name: add-sealed-format
description: Add and prove another sealed non-polarity single-elimination format in Influence. Use when extending the format catalog through the shared Vote Bomb and Majority Elimination capability path.
---

# Add a sealed non-polarity single-elim format

Use this proof-first path for formats that share the sealed ballot capability:
collect one non-self target per living voter, score ballots, resolve a sole
outcome or empowered tiebreak set, and write a version-2 `sealed_elim`
aggregate.

Use Majority Elimination as the structural example. Preserve the new format's
own identity and rules; do not copy its product language or outcome policy.

## Confirm the capability fits

This skill applies only when all of these are true:

- Every living voter submits one sealed ballot against a living non-self target.
- Ballots can be represented as `{ voterId, targetId }`.
- Pure score policy returns `totals` plus the exact `eligibleIds` considered for elimination.
- Pure resolve policy returns either one automatic elimination or a tied set for the empowered player.
- The existing `sealed_elim` aggregate can faithfully represent the public result.

Stop and design a different capability if the format needs polarity, public
sequential votes, ranked ballots, split fields, multiple eliminations, or a
different canonical aggregate.

## Write the contract before code

Fill in this worksheet in the task or plan. Do not start from a name alone.

| Decision | Required answer |
| --- | --- |
| Identity | Stable snake-case id and distinct public name |
| Ballot | Legal target set; normally every living non-self player |
| Score | Meaning of each total and which players belong in `eligibleIds` |
| Clear outcome | Exact condition and reason for automatic elimination |
| Tie | Exact tied set the empowered player may choose from |
| Zero votes | Safe, eligible, or otherwise meaningful |
| Agent behavior | Strategy guidance that distinguishes this format from existing cards |
| Decision identity | Typed agent method, tool name, trace action, label, invalid-target reason, fallback text |
| Presentation | Concise rules, full rule sheet, tally label, clear/tie/result wording |
| Availability | Explicit manifests only while proving it, or ready for the default manifest |

Treat `eligibleIds` as part of the rules, not presentation metadata. The
canonical aggregate, outcome validator, empowered tiebreak, House facts, and
viewer must agree on it.

## Golden path: follow Majority Elimination's shape

### 1. Prove pure policy first

Add failing cases to
`packages/engine/src/__tests__/format-resolvers.test.ts` before production
wiring. Cover:

- exact totals and `eligibleIds`, including zero-vote players;
- a sole automatic outcome;
- a tie whose `tiedSet` contains only the policy-defined tied players;
- illegal self and non-living targets;
- any defensive treatment of malformed or stale ballots.

Implement the smallest pure module at
`packages/engine/src/formats/<format-id>.ts`. Use
`packages/engine/src/formats/majority-elimination.ts` as the reference shape:
one score function, one resolve function, and one legality function. Reuse
`isLegalSealedElimBallot` when the target policy is `alive_non_self`.

If shared sealed-elim code changes, pin Vote Bomb's special rule first: zero is
safe and the fewest positive total is lethal.

### 2. Establish identity and browser-safe rules

Extend the exhaustive id and metadata in
`packages/engine/src/format-presentation-metadata.ts`. Add concise rules and a
complete rule sheet there so browser consumers do not import the runtime
catalog. Re-export browser-safe rules or trust checks through
`packages/engine/src/format-rules.ts` when needed.

Prove metadata completeness in
`packages/engine/src/__tests__/format-presentation-metadata.test.ts`.

### 3. Register one complete catalog entry

Extend the closed `SealedElimFormatId` and decision-identity unions in
`packages/engine/src/formats/catalog.ts`, then register the format with all of:

- `score`, `resolve`, and `isLegalBallot`;
- the full `decision` descriptor;
- the shared `sealed_elim` aggregate adapter;
- truthful `presentation.scoring` and `zeroVoteTreatment`.

The registration is the runtime policy authority. Shared code should ask the
registration how to score, resolve, validate, label, and aggregate. Do not add
another `formatId === ...` branch to the shared ballot or resolution path when
the catalog descriptor can express the difference.

Keep unknown ids and capability mismatches fail-closed. Add catalog descriptor
assertions to `format-resolvers.test.ts` so an incomplete identity cannot ship.

### 4. Wire only the identity-specific agent seam

The shared tool schema, legal-target validation, repair behavior, trace/model
call, and catalog lookup live in
`packages/engine/src/formats/agent-surface.ts`. Usually the format-specific work
is limited to:

- adding the typed method to `IAgent` in `packages/engine/src/game-runner.types.ts`;
- adding its thin delegate in `packages/engine/src/agent.ts`;
- extending the closed catalog decision unions;
- adding deterministic behavior to `packages/engine/src/__tests__/mock-agent.ts`.

Prove the exact tool name, prompt/rule sheet, legal target, fallback reason, and
repair behavior in
`packages/engine/src/__tests__/agent-structured-output.test.ts`. A repaired
decision must not retain the rejected model call's `decisionId`.

### 5. Prove shared runtime dispatch

Add a one-format case to
`packages/engine/src/__tests__/format-kernel-integration.test.ts`. A complete
`sealed_elim` registration should flow through
`resolveSealedElimFormatRound` in
`packages/engine/src/phases/format-kernel.ts`; it should not require a new
format-specific resolver branch.

Assert that the game:

- auto-selects the sole manifest entry;
- emits no fake `format.menu_offered` and makes no empowered pick call;
- records one matching version-2 `format.resolved` event;
- writes `aggregate.capability: "sealed_elim"`, exact totals, and exact eligible ids;
- records exactly one matching elimination;
- restricts an empowered tiebreak to the returned tied set.

Then add a focused two-format case proving both cards are offered and the
empowered selection routes to the selected registration. Only add the format
to `DEFAULT_FORMAT_MANIFEST` after the rest of this document is green. Prove
the full default still obeys menu ordering and soft anti-repeat.

### 6. Carry exact identity through canonical readers

Update closed identity or action vocabularies where the compiler requires it.
Inspect these boundaries; do not assume a successful runtime test covers them:

- `packages/engine/src/canonical-events.ts`
- `packages/engine/src/formats/resolution-access.ts`
- `packages/engine/src/format-recovery.ts`
- `packages/engine/src/formats/house-resolution-facts.ts`
- `packages/engine/src/revealed-round-facts.ts`
- `packages/engine/src/completed-game-results.ts`
- owner-learning labels and accepted-action correlation
- `packages/api/src/services/game-events.ts`
- `packages/api/src/services/game-event-read-model.ts`

Read sealed aggregates through `formats/resolution-access.ts`. Recompute and
validate the outcome with the selected catalog registration; do not trust totals
alone, infer facts from transcript prose, or fall through to another format's
identity.

Prove writer/read/replay/recovery, rejection of conflicting aggregate/outcome
pairs, completed results, and owner-learning naming. Keep the historical v1
trio replay fixture green; never relabel old events.

### 7. Add explicit viewer presentation

Extend the trusted compiler and presentation where this format's labels or
scoring differ:

- `packages/engine/src/fixtures/format-kernel-viewer.ts`
- `packages/web/src/app/games/[slug]/components/format-presentation-compiler-helpers.ts`
- `packages/web/src/app/games/[slug]/components/format-resolution-stage.tsx`
- `packages/web/src/app/games/[slug]/components/completed-results-model.ts`

Add deterministic clear and tie fixtures. Prove offer cards, one-format locked
rules, tally labels, eligible/tied players, resolved outcome, and completed
results in:

- `packages/engine/src/__tests__/format-kernel-viewer-fixture.test.ts`
- `packages/web/src/__tests__/format-presentation-model.test.ts`
- `packages/web/src/__tests__/format-presentation.test.tsx`

Never extend the frozen classic presentation parser or derive authoritative
facts from rendered prose.

### 8. Update docs and availability surfaces

Update the live rules page, `CONCEPTS.md`, observability docs, simulator/local
model examples, and `packages/engine/src/simulate.ts` JSDoc when their current
lists, action vocabulary, or examples change. Add a short public update when
the new card ships.

The API and simulators validate manifests through the catalog. Prove their
create/parse surfaces accept the new id and persist the frozen manifest; do not
add a second independent allowlist.

## File and proof map

| Concern | Primary production files | Minimum focused proof |
| --- | --- | --- |
| Pure rules | `formats/<format-id>.ts`, `format-rules.ts` | `format-resolvers.test.ts` |
| Identity and catalog | `format-presentation-metadata.ts`, `formats/catalog.ts` | metadata + catalog assertions |
| Agent ballot | `game-runner.types.ts`, `formats/agent-surface.ts`, `agent.ts` | `agent-structured-output.test.ts` |
| Runtime and menu | `formats/menu.ts`, `phases/format-kernel.ts` | one-format and two-format integration |
| Canonical and recovery | `canonical-events.ts`, `resolution-access.ts`, `format-recovery.ts` | canonical replay, recovery, invalid outcome |
| House and results | `house-resolution-facts.ts`, `revealed-round-facts.ts`, `completed-game-results.ts` | facts, recap, owner-learning identity |
| API manifest/events | `routes/games.ts`, `services/game-events.ts`, `services/game-event-read-model.ts` | create/detail/list persistence and v2 round trip |
| Viewer | engine viewer fixture, compiler helpers, resolution stage, completed results model | clear/tie compiler and component tests |
| Documentation | rules, concepts, observability, local-model/simulator docs | rules/docs assertions and stale-id search |

The table is a routing map, not a mandate to edit every file. Inspect each
boundary and change it only when the new closed union, identity, or presentation
requires it.

## Required proof before shipping

- Pure score/resolve: exact totals, eligible set, sole outcome, and empowered tied-set path.
- Regression: Vote Bomb still treats zero as safe and eliminates the fewest positive total.
- Integration: explicit one-format and two-format manifests exercise the catalog-owned path.
- Canonical: v2 writer/read/replay round trip succeeds; unsupported event/version pairs fail closed; historical v1 trio replay remains green.
- Downstream: canonical validators reject conflicting aggregates/outcomes; House facts, completed results, and owner learning retain the new identity.
- Web: clear/tie fixtures render without classic-parser or format-alias fallback.
- Admission: API and simulator accept and freeze the id without a duplicate allowlist.

Start with focused checks while iterating:

```bash
bun test packages/engine/src/__tests__/format-resolvers.test.ts packages/engine/src/__tests__/agent-structured-output.test.ts packages/engine/src/__tests__/format-kernel-integration.test.ts
bun test packages/engine/src/__tests__/canonical-event-replay.test.ts packages/engine/src/__tests__/format-recovery.test.ts packages/engine/src/__tests__/format-kernel-viewer-fixture.test.ts
bun test packages/web/src/__tests__/format-presentation-model.test.ts packages/web/src/__tests__/format-presentation.test.tsx
bun run --cwd packages/engine typecheck
bun run --cwd packages/api typecheck
bun run --cwd packages/web typecheck
git diff --check
```

Finish with the repository's required broader validation. Do not run a paid
model simulation without explicit approval.

## Version contract

- Historical `format.resolved` v1 carries only the original trio's exclusive bags.
- New `format.resolved` writes use v2 capability aggregates.
- Every other canonical event remains payload version 1.
- Reject unsupported event/version pairs; never rewrite or relabel historical events.

## Non-negotiable boundaries

- Do not add backward-compatibility aliases or fallbacks for a new format.
- Do not add production round-count or player-count gates to force catalog coverage.
- Do not use `as any`.
- Do not make direct House/model calls outside the established agent surface.
- Do not introduce a format DSL merely to add one catalog entry.
