---
title: "feat: Modular format catalog + Majority Elimination"
type: feat
status: active
date: 2026-08-06
origin: docs/brainstorms/2026-08-06-modular-format-catalog-majority-elimination-requirements.md
---

# feat: Modular format catalog + Majority Elimination

## Summary

Make sealed vote formats catalog-registered and share one sealed-ballot resolve path, proven by co-migrating Vote Bomb and shipping **Majority Elimination** (`majority_elimination`) into the default four-card live catalog. Introduce a version-2 `format.resolved` contract whose capability aggregates remove format-specific resolution bags while a new reader preserves version-1 trio replays. Freeze a non-empty format manifest at game creation so local simulations and API games can run any registered subset; a one-format manifest auto-selects, while larger manifests retain two-card soft anti-repeat menus. Extract sealed format decision helpers (W17) before ME integration and leave a lightweight add-sealed-format skill. Defer Split House / Kingdom and multi-elim.

---

## Problem Frame

The format kernel spine is already correct (empower → menu → pick → mingle → resolve). Catalog membership and resolve dispatch are not: adding a format still fans out through open if-ladders, exclusive resolution bags, agent tools, projections, and fixtures. With three formats that cost was paid once; the fourth format is the last cheap moment to replace the version-1 trio shape with a version-2 capability contract before the catalog grows into Kingdom / Split House / multi-elim work.

Origin (see origin: `docs/brainstorms/2026-08-06-modular-format-catalog-majority-elimination-requirements.md`) prioritizes modularity proof first, with Majority Elimination as the live proof vehicle and a sealed-only skill for the next easy format. During plan review, the per-game/simulation allowlist deferral was explicitly reversed: a frozen format manifest is necessary to test one- and two-format games through the same API and runner paths used in production.

---

## Requirements

Traceability to origin R/F/AE IDs.

**Catalog modularity**

- R1. Default live formats are entries in one exhaustive runtime catalog whose capability registration owns legality, resolution policy, decision surface, version-2 aggregate interpretation, and fail-closed dispatch (never silent Safety Bounce for unknown ids). (origin: R1, R5, R6)
- R2. Default catalog after this work: Save-or-Eliminate, Vote Bomb, Safety Bounce, Majority Elimination. (origin: R2)
- R3. Sealed non-polarity single-elim formats share one collect → score → tiebreak → resolution → sealed presentation path. (origin: R3)
- R4. Vote Bomb co-migrates onto that path with unchanged product rules. (origin: R4, R25, AE4)
- R5. Safety Bounce stays on its public-chain path; no generic public-chain framework this slice. (origin: R5)
- R6. Future capability classes may be named in the skill as out-of-scope: public-chain, preselection/split-field, multi-elim. (origin: R6, R22)

**Menu**

- R7. When the frozen manifest has at least two legal formats, House offers exactly two distinct formats after empower. (origin: R7, F1; one-format extension below)
- R8. Soft anti-repeat: when last selected exists and ≥2 other manifest formats remain legal, exclude last and sample two of the remainder via injectable RNG. (origin: R8, R26, AE1)
- R9. Round 1 / anti-repeat impossible: sample any two legal manifest formats. (origin: R9)
- R10. Cast-size fitness is identity within the manifest for this slice: every registered manifest member is legal in standard format-kernel rounds. (planning freeze; origin R7 wording)

**Majority Elimination**

- R11. Public name **Majority Elimination**; stable id `majority_elimination`. (origin: R10)
- R12. Every alive player casts one sealed non-self elim-direction vote. (origin: R11, F2)
- R13. Highest vote total is eliminated; highest-total ties → empowered chooses among that set only (including empowered if tied). (origin: R12–R13, AE2–AE3)
- R14. Empowered is full participant and fully eligible (including sole highest). (origin: R14, AE6)
- R15. Social order mingle → sealed ballot; ballots sealed until resolution reveal under existing lifecycle. (origin: R15–R16, AE5)
- R16. Exactly one elimination after tiebreak. (origin: R17)

**Surfaces**

- R17. Agents get fixed rule sheet + sealed ballot decision surface with deterministic illegal-target repair. (origin: R18)
- R18. Watch/replay/results show offer, selection, sealed lifecycle, plurality tally, elimination without classic Power/Council fields. (origin: R19–R20, AE5)
- R19. Canonical events remain authority; transcript never repairs format facts. (origin: R20)

**Skill and validation**

- R20. Lightweight sealed-format skill documents registration touch points and non-goals. (origin: R21–R22, AE7, F3)
- R21. Tests: ME clear/tie pure math; VB regression; manifest validation and one-/two-format execution; four-format soft anti-repeat; deterministic per-format sealed integration/fixtures; version-1 replay and version-2 persistence round trips. (origin: R23–R26 plus planning extensions)

**Per-game format manifest**

- R22. Game creation freezes a non-empty, duplicate-free manifest of registered format ids. API and local simulation inputs may supply any subset; omission defaults to all four live formats. The canonical game-start contract persists the manifest so recovery and later rounds use the same set. (planning extension approved during review)
- R23. A one-format manifest auto-selects and locks that format without a fake empowered choice while still emitting authoritative selection state. A manifest of two or more uses the normal two-option menu and empowered pick. (planning extension approved during review)

---

## Key Technical Decisions

- **KTD1. Stable id `majority_elimination`.** Matches origin example and public name mapping; single key across metadata, events, tools, fixtures.
- **KTD2. Versioned resolution contract at the existing event-envelope boundary.** Historical `format.resolved` events remain payload version 1 with the trio’s exclusive bags. New resolution events emit payload version 2 and a capability-discriminated aggregate: `sealed_elim` carries totals plus the eligible set, `sealed_polarity` carries nets/save/eliminate totals, and `public_chain` carries starter/classification/vote totals. Readers explicitly accept both versions; there is no invented version 0 and no data rewrite.
- **KTD3. Shared sealed path for non-polarity eliminate-ballots only.** Parameterized pure score/resolve + shared collect/record/tiebreak orchestration. Vote Bomb and Majority Elimination co-consumers. Save-or-Eliminate stays polarity sibling.
- **KTD4. Fail-closed resolve dispatch.** Catalog/capability lookup; unknown or miswired id throws — never fall through to Safety Bounce.
- **KTD5. Frozen per-game manifest + soft anti-repeat.** Validate and persist one or more unique registered ids at game creation; omitted input uses the full live catalog. One id auto-selects. With two or more, exclude last when ≥2 others remain, shuffle the eligible manifest, and take first two. Tests pin manifests and RNG.
- **KTD6. Agent surface: shared sealed-elim ballot path parameterized by locked format.** One legality/fallback runner for target-only sealed elim ballots; distinct prompts/rule sheets so ME cannot read as Vote Bomb fewest-positive. Do not reuse `getVoteBombBallot` name for ME. Prefer thin W17 extract of tool schemas + decision runner without renaming existing Vote Bomb tool ids unless required for parameterization.
- **KTD7. One explicit runtime registry; browser-safe pure surfaces stay leaf modules.** `packages/engine/src/formats/catalog.ts` owns an exhaustive `Record<LaunchFormatId, FormatRegistration>` discriminated by `sealed_elim`, `sealed_polarity`, or `public_chain`. Sealed-elim entries own legality, score/resolve policy, agent decision contract, and version-2 aggregate/presentation adapters; sibling capabilities name their existing dedicated handlers. Presentation metadata remains a browser-safe leaf for names/rules, and web imports pure rule checks only through `@influence/engine/format-rules`.
- **KTD8. Cast-size fitness identity within the manifest.** Every manifest member is legal in standard rounds; no cast-size filter hook is added this slice.
- **KTD9. Skill at `.agents/skills/add-sealed-format/SKILL.md`.** Checklist for sealed non-polarity single-elim only; honest non-goals.
- **KTD10. Characterization-first for Vote Bomb migration.** Capture/extend VB pure + integration assertions before swapping orchestration so R4 cannot silently drift.

---

## High-Level Technical Design

```mermaid
flowchart TB
  create[Game created] --> manifest[Validate and freeze format manifest]
  manifest --> empower[Empower resolved]
  empower --> one{Manifest size = 1?}
  one -->|yes| auto[Auto-select sole format]
  one -->|no| menu[buildFormatMenu from manifest]
  menu --> anti{last selected and 2+ others?}
  anti -->|yes| sample[Exclude last; RNG sample 2]
  anti -->|no| anyTwo[RNG sample 2 of catalog]
  sample --> pick[Empowered pick]
  anyTwo --> pick
  auto --> lock[Lock rule sheet]
  pick --> lock[Lock rule sheet]
  lock --> mingle[Format mingle]
  mingle --> cap{capability class}
  cap -->|sealed_elim| sealed[Shared sealed path]
  cap -->|sealed_polarity| soe[Save-or-Eliminate existing path]
  cap -->|public_chain| bounce[Safety Bounce path]
  cap -->|unknown| fail[Fail closed]
  sealed --> score{tally policy}
  score -->|vote_bomb| fewest[Fewest positive; zero safe]
  score -->|majority_elimination| most[Most votes out]
  fewest --> resolve[Tiebreak if needed; format.resolved]
  most --> resolve
  soe --> resolve
  bounce --> resolve
  resolve --> v2[Emit version-2 capability aggregate]
  v2 --> elim[One elimination]
```

**Directional sealed path (not implementation code):**

```text
for each alive voter:
  call sealed-elim decision(formatId, ruleSheet, legalTargets)
  repair illegal → deterministic non-self target
  record format.ballot_cast { formatId, voterId, targetId, polarity: null }

score = catalog[formatId].score(aliveIds, ballots)   // pure
resolution = catalog[formatId].resolve(...)         // pure
if resolution.kind === tie:
  empowered chooses among tiedSet only
emit format.resolved payloadVersion=2 with capability aggregate
presentation: existing sealed → revealed lifecycle
```

---

## Implementation Units

### U1. Runtime catalog + Majority Elimination pure rules

**Goal:** Define the exhaustive capability registry and add ME presentation metadata plus pure legality/tally/resolve math independent of the runner.

**Requirements:** R1–R2, R11–R13, R21

**Dependencies:** None

**Files:**
- Modify: `packages/engine/src/format-presentation-metadata.ts`
- Create: `packages/engine/src/formats/catalog.ts`
- Create: `packages/engine/src/formats/majority-elimination.ts`
- Modify: `packages/engine/src/formats/types.ts`, `packages/engine/src/formats/index.ts`
- Modify: `packages/engine/src/format-rules.ts` (browser-safe pure re-exports used by web trust path)
- Modify: `packages/engine/src/__tests__/format-presentation-metadata.test.ts`
- Modify: `packages/engine/src/__tests__/format-resolvers.test.ts`

**Approach:**
- Add `majority_elimination` to `FORMAT_PRESENTATION_METADATA` with display name **Majority Elimination** and fixed rule sheets (most votes out; empowered highest-total ties; no self-vote).
- Define an exhaustive runtime `FormatRegistration` union keyed by `LaunchFormatId` and discriminated by `sealed_elim`, `sealed_polarity`, or `public_chain`; keep presentation metadata browser-safe and separate.
- Sealed-elim registrations own legality, pure score/resolve policy, decision contract, and version-2 aggregate/presentation interpretation. SoE and Bounce registrations name their existing dedicated handlers.
- Pure functions mirror Vote Bomb ballot shape: totals over all alive; resolve highest; sole-highest as auto; multi-highest as tie.
- Re-export ME tally/resolve from `format-rules.ts` so web can extend `resolutionOutcomeMatchesRules` without importing engine barrels.
- Extend `LAUNCH_FORMAT_IDS` via metadata; keep browser leaf free of engine barrels.

**Patterns to follow:** `packages/engine/src/formats/vote-bomb.ts`; existing presentation metadata tests.

**Test scenarios:**
- Covers AE2. Tallies A:3 B:2 C:2 D:1 → A eliminated clear/auto.
- Covers AE3. A:3 B:3 C:1 → tie set {A,B} only.
- Illegal self-target and non-alive target rejected by legality helper.
- Presentation metadata includes ME display name and non-empty rule sheet.
- Metadata still lists prior trio with unchanged names.

**Verification:** Pure unit tests pass; `LaunchFormatId` includes `majority_elimination`.

---

### U2. Frozen format manifest + soft anti-repeat menu

**Goal:** API and local simulations freeze a validated format subset at game creation, expose that authoritative configuration in game metadata, and drive selection exclusively from it; one format auto-selects and larger manifests use two-card soft anti-repeat menus.

**Requirements:** R7–R10, R21–R23

**Dependencies:** U1 (catalog size ≥4)

**Files:**
- Modify: `packages/engine/src/formats/menu.ts`
- Modify: `packages/engine/src/game-state.ts`, `packages/engine/src/game-runner.ts`, `packages/engine/src/types.ts`
- Modify: `packages/engine/src/simulate.ts`, `packages/engine/src/api-simulate.ts`
- Modify: `packages/api/src/routes/games.ts`, `packages/api/src/services/game-lifecycle.ts`
- Modify: canonical game-start event, projection, and recovery readers for the frozen manifest
- Modify: game API/read-model metadata types and serializers that return game configuration
- Modify: `packages/engine/src/__tests__/format-resolvers.test.ts`
- Modify: simulation config, games API, lifecycle, metadata/read-model, and recovery tests

**Approach:**
- Add `formatManifest?: LaunchFormatId[]` to the local simulation input and create-game API request. Validate non-empty, duplicate-free, registered ids before the game is admitted; omission copies the default four-id catalog.
- Copy the validated manifest into the canonical game-start event/state. That frozen value—not the mutable global catalog—is authoritative for every later round.
- Project the frozen manifest into game metadata/read-model responses so API clients, operators, and test harnesses can inspect the exact configuration of a running or completed game.
- Hydrate the manifest from the canonical game-start contract during replay/recovery. Historical games without the field retain the launch trio they began with; unknown or corrupt persisted ids fail recovery rather than widening the game.
- Change the selection module contract to require `formatManifest + lastFormatId + random`; no in-game selection path may read the global launch catalog as its legal set.
- A one-format manifest records the authoritative selection without calling the empowered format-pick decision.
- When last is a known manifest id and remaining legal ≥2: exclude last, shuffle remaining, offer first two. Otherwise shuffle the manifest and offer two.
- Fitness identity: legal set = the frozen manifest (document in comment; no cast-size filter).
- Replace trio-era “remaining[0], remaining[1] in fixed array order” so four-format variety is real.

**Patterns to follow:** existing `random?: () => number` injection; menu tests in format-resolvers.

**Test scenarios:**
- Covers AE1. Last = vote_bomb in the default manifest; RNG yields a fixed permutation → offered pair is two of {save_or_eliminate, safety_bounce, majority_elimination}, never vote_bomb.
- Manifest validation rejects empty, duplicate, and unregistered ids at API/simulation admission.
- One-format API and local-simulation games persist and expose the one-id manifest, auto-select and complete that format, and never issue a fake pick call.
- Two-format API and local-simulation games persist and expose the exact two-id manifest, offer only those two, and continue legally when anti-repeat cannot leave two alternatives.
- API round trip proves create request → canonical game-start manifest → game metadata response → selection behavior for both one- and two-format games.
- Changing the process-wide/default catalog after game creation does not change the frozen manifest or legal selection set of that game.
- Round 1 (last null): offered length 2, distinct, subset of the frozen manifest.
- Last unknown/corrupt is rejected during recovery rather than silently widening to the default catalog.
- Deterministic RNG fixtures pin exact pairs.

**Verification:** One-/two-/four-format manifests execute through local simulation and API tests; API metadata returns the persisted configuration; recovery and later rounds preserve the original manifest; selection tests prove no legal-set dependency on the global catalog; menu unit tests cover four-format anti-repeat.

---

### U3. Versioned resolution contract + shared sealed path + Vote Bomb co-migration

**Goal:** Introduce the version-2 capability aggregate end to end, preserve version-1 replay, and extract the shared sealed non-polarity collect/score/tiebreak/record path by porting Vote Bomb without product drift.

**Requirements:** R1, R3–R5, R19, R21

**Dependencies:** U1

**Files:**
- Modify: `packages/engine/src/phases/format-kernel.ts`
- Create: `packages/engine/src/formats/sealed-elim-resolve.ts` (or equivalent pure+orchestration helper under `formats/` / phase helper — planning name only)
- Modify: `packages/engine/src/canonical-events.ts`, `packages/engine/src/canonical-event-log.ts`, `packages/engine/src/game-state.ts`
- Modify: `packages/engine/src/game-projection.ts` and related recovery/projection readers
- Modify: `packages/api/src/services/game-events.ts`, `packages/api/src/services/game-event-read-model.ts`
- Modify: `packages/engine/src/__tests__/format-kernel-integration.test.ts`
- Modify: `packages/engine/src/__tests__/format-resolvers.test.ts` as needed
- Modify: canonical event, projection/replay, and API persistence tests

**Approach:**
- **Execution note:** Characterization-first — ensure Vote Bomb pure + integration assertions lock zero-safe + fewest-positive before moving orchestration.
- Define the versioned `format.resolved` union at the envelope boundary. Existing version-1 events retain the trio bags; version 2 carries one capability-discriminated aggregate. Other event types may continue to emit version 1.
- Update the canonical writer, engine projection, recovery path, and API read model to dispatch by event type plus payload version. Unsupported versions fail clearly; version 1 is not relabeled as version 0 and persisted events are not rewritten.
- Shared path parameters: formatId, pure legality, pure score, pure resolve, capability-aggregate builder, agent decision callback, trace action name.
- `runFormatResolvePhase` dispatches by capability/class registry: `sealed_elim` → shared path; `sealed_polarity` → existing SoE path; `public_chain` → existing Bounce; unknown/unregistered → throw (never silent Bounce).
- Vote Bomb becomes a `sealed_elim` registration, not a bespoke sibling function body.
- New Vote Bomb resolutions emit a version-2 `sealed_elim` aggregate containing totals and the eligible set; consumers interpret it through the catalog registration rather than a Vote Bomb-specific bag.
- SoE remains a registered live format with capability `sealed_polarity` (existing path this slice); Bounce remains `public_chain`.

**Patterns to follow:** existing `resolveVoteBombRound` loop, `withFormatAgentTimeout`, `breakFormatTie`, `applyFormatTiebreak`, provenance helpers in `format-kernel.ts`.

**Test scenarios:**
- Covers AE4. Vote Bomb after migration: zero-vote safe; fewest positive eliminated; dual fewest-positive → empowered set only.
- Incomplete ballots still fail hard (length mismatch).
- Unknown format id at resolve throws / fails closed (never Bounce).
- SoE selection still resolves via polarity path (regression smoke).
- Integration: full Vote Bomb round still eliminates exactly one under sealed path.
- A persisted version-1 trio fixture replays to the same projection/result as before.
- Writer-to-reader round trip persists a version-2 Vote Bomb aggregate through the real API event store and reconstructs the same resolution.
- Unsupported resolution payload versions fail closed with an actionable error.

**Verification:** Existing VB golden cases remain green; version-1 replay and version-2 persistence round trips pass; no behavior change in chatty tally logs’ product meaning.

---

### U4. Agent sealed-elim decisions (W17 slice) + MockAgent

**Goal:** Land the shared sealed-elim decision runner/tools before ME integration, with distinct Vote Bomb and Majority Elimination rule sheets and a deterministic MockAgent surface.

**Requirements:** R17, R12–R14

**Dependencies:** U1, U3

**Files:**
- Create: `packages/engine/src/formats/agent-surface.ts` or `packages/engine/src/agent-format-decisions.ts` (W17 seam)
- Modify: `packages/engine/src/agent.ts`
- Modify: `packages/engine/src/game-runner.types.ts`
- Modify: `packages/engine/src/__tests__/mock-agent.ts`
- Modify: `packages/engine/src/__tests__/agent-structured-output.test.ts` if tool schemas are covered
- Modify: accepted-action correlation registry if new action names are required (`packages/engine/src/canonical-events.ts` / correlation map)

**Approach:**
- Extract the shared validate → tool-call → fallback → provenance pattern for sealed target ballots and, if low-cost, format pick / tiebreak helpers without renaming established Vote Bomb tool ids unless parameterization forces it.
- ME prompts use **Majority Elimination** public name and most-votes rule sheet; explicitly contrast with Vote Bomb fewest-positive and Bounce pool vote.
- MockAgent supplies a deterministic ME ballot (for example, first other alive) and can pick ME from a menu.
- Clean accepts alone stamp `decisionId`; repair/fallback paths do not claim model acceptance correlation.
- U7 documents this landed surface; this unit does not own the skill file.

**Patterns to follow:** `docs/refactor-queue.md` W17; `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md`; existing `getVoteBombBallot` / `buildFormatTargetTool`.

**Test scenarios:**
- MockAgent ME ballot is legal and non-self.
- Illegal model target repairs with typed fallback reason and no false model-accept correlation.
- Tool schema requires target plus thinking/strategic fields consistent with existing format ballots.
- ME prompt/rule sheet contains most-votes language and does not instruct fewest-positive.

**Verification:** Structured-output and mock paths pass before ME is wired into the live resolve integration.

---

### U5. Majority Elimination on the shared path + downstream consumers

**Goal:** Wire ME through the catalog-owned shared path and every authoritative/read-model consumer so facts validate as plurality and downstream learning preserves ME identity.

**Requirements:** R1–R2, R11–R16, R18–R19, R21

**Dependencies:** U1, U2, U3, U4

**Files:**
- Modify: `packages/engine/src/phases/format-kernel.ts`
- Modify: `packages/engine/src/viewer-decision-events.ts`
- Modify: `packages/engine/src/formats/house-resolution-facts.ts`
- Modify: `packages/engine/src/revealed-round-facts.ts`
- Modify: `packages/engine/src/completed-game-results.ts`
- Modify: `packages/engine/src/postgame-analysis.ts` (format-id branches that mention the trio only)
- Modify: `packages/web/src/app/dashboard/agents/[id]/review/owner-learning-model.ts`
- Modify: verified accepted-action policy/correlation consumers that distinguish format actions
- Modify: related unit tests (`house-format-resolution-facts.test.ts`, `revealed-round-facts.test.ts`, `completed-game-results.test.ts`, `format-kernel-integration.test.ts`, owner-learning/action-policy tests)

**Approach:**
- Register ME as `sealed_elim` with most-votes scoring and emit the same generic version-2 `sealed_elim` aggregate shape used by Vote Bomb: totals plus the eligible set.
- Catalog-owned validators recompute outcomes from ballots using the locked format id, so ME applies highest-total rules while Vote Bomb retains fewest-positive/zero-safe rules without format-specific aggregate bags.
- House resolution facts describe highest total and empowered highest-total tiebreak. Completed results use plurality totals and never inherit zero-safe or Vulnerable columns.
- Audit real downstream format-action consumers, not generic `formatId` plumbing. Owner learning, accepted-action policy, and correlation labels must preserve `majority_elimination` identity and must not translate it to Vote Bomb, Safety Bounce, or classic Power/Council terminology.
- Run deterministic end-to-end cases with explicit one-format manifests for each registered format plus focused two-format menu cases. Catalog coverage is a test matrix, not a `maxRounds` or round-count production gate.

**Patterns to follow:** version-1 Vote Bomb fact/result consumers for semantics only; `docs/solutions/architecture-patterns/separate-transport-visibility-from-staged-presentation.md`; owner-learning architecture note.

**Test scenarios:**
- Covers AE2/AE3: one-format ME games resolve a clear winner and a highest-total tie, with empowered choosing from that tie set only.
- Covers AE6. Empowered sole highest is eliminated.
- Covers AE5. Sealed ballots then revealed ledger derive from canonical events; no classic power/council fields appear on format-kernel recap.
- House MC facts rebuild ME elimination from events only; completed results show totals and eliminated without zero-safe/Vulnerable fallthrough.
- Owner-learning/action-policy fixtures label ME ballots and resolution as Majority Elimination; no Vote Bomb, Safety Bounce, Power, or Council aliasing.
- One-format deterministic cases complete each registered format independently; a two-format case proves normal menu/pick behavior without round-count assumptions.

**Verification:** Each registered format completes through its explicit manifest with one matching version-2 resolution and one elimination; validators reject a resolution whose aggregate or outcome conflicts with its catalog policy.

---

### U6. Web presentation + viewer fixtures

**Goal:** Watch/replay/results treat ME as sealed plurality without Vote Bomb zero-safe UI or classic fields.

**Requirements:** R15–R16, R18, R21

**Dependencies:** U5

**Files:**
- Modify: `packages/engine/src/fixtures/format-kernel-viewer.ts`
- Modify: `packages/engine/src/__tests__/format-kernel-viewer-fixture.test.ts`
- Modify: `packages/web/src/app/games/[slug]/components/format-presentation-compiler-helpers.ts` (`resolutionOutcomeMatchesRules` / `aggregatesMatch` catalog adapter; no Bounce fallthrough)
- Modify: `packages/web/src/app/games/[slug]/components/format-resolution-stage.tsx` (plurality totals from the version-2 `sealed_elim` aggregate)
- Modify: `packages/web/src/app/games/[slug]/components/format-presentation*.ts(x)` as needed for id exhaustiveness
- Modify: completed-results model that maps format scoring kinds (ME plurality columns, not Vulnerable/zero-safe fallthrough)
- Modify: `packages/web/src/__tests__/format-presentation*.ts(x)`
- Modify: `packages/web/src/__tests__/format-presentation-model.fixtures.ts`
- Modify: `e2e/format-aware-game-viewer.fixtures.ts` if launch set enumerated
- Avoid: `packages/web/src/app/games/[slug]/components/message-parsing.ts` (frozen classic parser)

**Approach:**
- Reuse sealed ballot reveal and offer stage data-driven cards from presentation metadata.
- Wire ME through pure-trust helpers via `@influence/engine/format-rules` and the capability adapter (most-votes recompute).
- Resolution stage: plurality / most-votes table from the version-2 `sealed_elim` aggregate; do not show “zero safe” or Bounce Vulnerable lanes for ME.
- Completed results model: dedicated ME scoring columns; no fallthrough to Bounce/Vulnerable UI.
- Add fixture scenarios: ME clear, ME highest-total tie; assert aggregate cue is ready (not incomplete).
- Replace open format if-ladders with exhaustive catalog/capability adapters so a non-SoE/non-VB id cannot silently become Safety Bounce.

**Patterns to follow:** `docs/format-kernel-web-contract-drift.md`; Vote Bomb sealed fixtures; offer stage; existing format-rules import path.

**Test scenarios:**
- Covers AE5. Fixture ME sealed → revealed roster order from events; resolution cue ready with highest-total status.
- Offer stage can show Majority Elimination card with concise rules.
- Resolution stage shows highest totals, not zero-safe set or Vulnerable lanes.
- Completed results ME recap uses plurality labels.
- Reduced-motion path still advances semantic cues.

**Verification:** Engine fixture tests + web unit tests green; e2e only if env already runs format viewer suite.

---

### U7. Sealed-format skill + docs sync

**Goal:** Package the add path for the next sealed non-polarity format and keep operator/agent docs honest about four cards.

**Requirements:** R6, R20

**Dependencies:** U1–U6 (skill describes the landed path)

**Files:**
- Create: `.agents/skills/add-sealed-format/SKILL.md`
- Modify: `docs/reasoning-transcript-observability.md` (format-ballot / ME)
- Modify: `docs/local-model-evaluation.md` and/or `DEVELOPMENT.md` launch catalog language
- Modify: `docs/rules-page-content.md` (or web rules content source) for Majority Elimination
- Modify: `packages/web/content/updates/` short release note if product ships public updates for format meta
- `CONCEPTS.md` already documents Majority Elimination / catalog — adjust only if id/order wording drifts

**Approach:**
- Skill checklist: presentation metadata → pure rules → catalog registration/capability → manifest eligibility → shared sealed path wiring → agent surface → version-2 aggregate adapter + projection validators → fixtures/tests → docs. Non-goals: public-chain, SoE polarity redesign, preselection/split-field, multi-elim, format DSL.
- Observability: ME format-ballot action vocabulary and sealed operator text rules match Vote Bomb lane separation.

**Patterns to follow:** existing skills under `.agents/skills/`; origin AE7.

**Test scenarios:**
- Test expectation: none for skill prose — verify by checklist completeness review against U1–U6 files.
- Docs mention four default formats and ME most-votes rule.

**Verification:** Skill readable as a single short path; docs no longer claim “launch trio only” where default catalog is four.

---

## Scope Boundaries

**In scope**

- Format catalog registration + fail-closed dispatch
- Version-2 capability aggregates for new `format.resolved` writes plus version-1 replay support
- Frozen per-game format manifests for API and local simulation, including one-format auto-selection
- Shared sealed non-polarity resolve path
- Vote Bomb behavior-preserving co-migration
- Majority Elimination default live card
- Soft anti-repeat four-format menu
- W17 sealed decision helper extraction (bounded)
- Web/fixture sealed plurality presentation
- Lightweight `.agents/skills/add-sealed-format` skill
- Docs/observability sync for agent decision surfaces

**Deferred to Follow-Up Work**

- Save-or-Eliminate join onto shared sealed path (polarity)
- Generic public-chain framework for Bounce-like formats
- Split House / Dual Houses, Kingdom, Date Night, Room Roulette, BB veto, Ranked Elimination, Even/Double Votes
- Double eliminations / multi-elim rounds
- Classic Power → Council as a format card
- Format-specific Owner Learning coaching beyond correct format identity and action labels
- Mid-ballot crash-safe resume capsules

**Outside this product’s identity** (from origin)

- Random minigame show without social memory
- Live human mid-match vote steering
- Transcript prose as elimination authority

---

## Acceptance Examples

Carried from origin; implementers map to U1–U6 tests and U7 skill/docs review.

- AE1. Soft anti-repeat excludes last among four. (U2)
- AE2. ME clear highest out. (U1, U5)
- AE3. ME highest-total tie → empowered among set. (U1, U5)
- AE4. Vote Bomb product rules unchanged after shared path. (U3)
- AE5. ME sealed lifecycle event-authoritative on watch. (U5, U6)
- AE6. Empowered eligible / sole highest eliminated. (U5)
- AE7. Sealed skill path + non-goals. (U7 checklist review)
- AE8. One-, two-, and four-format manifests execute through both local simulation and API creation/recovery paths. (U2, U5)
- AE9. A persisted version-1 trio fixture replays unchanged and a newly written version-2 resolution survives writer-to-reader round trip. (U3)

---

## System-Wide Impact

- **Events:** historical `format.resolved` version-1 trio bags remain readable; new resolutions use version-2 capability aggregates, while unrelated event types may remain version 1.
- **Recovery:** the canonical game-start state freezes the manifest; selection still reconstructs from authoritative format events; unsupported manifests or resolution versions fail closed; mid-resolve fail-closed behavior is unchanged.
- **MCP / owner learning:** format-tagged ballots and action labels identify ME explicitly; do not fabricate classic expose or alias ME to another format.
- **Web:** presentation metadata leaf remains shared import; no classic parser extension.
- **Agents:** new/parameterized sealed tools increase prompt surface; rule sheets must prevent ME/VB confusion.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Vote Bomb product drift during shared path | KTD10 characterization-first; AE4 regression tests |
| Fail-open resolve (unknown id → Bounce) | KTD4 exhaustive/fail-closed dispatch tests |
| Version-1 replay regresses when version 2 lands | Explicit event-type/version dispatch plus frozen v1 fixture replay |
| Version-2 producer and reader drift | Persist through the real writer-to-reader path and compare the reconstructed capability aggregate |
| Frozen manifest widens or corrupts on recovery | Persist at game start; reject empty, duplicate, or unknown ids; recovery tests pin the original subset |
| ME presented as zero-safe / fewest-positive | Catalog policy adapters + validators + web copy tests |
| Agent confuses ME with Vote Bomb | Distinct prompts; public name Majority Elimination |
| Four-format menu fixed-order starvation | RNG sample of remaining three (U2) |
| New format requires another switch fan-out | Exhaustive capability registry owns behavior; browser-safe leaf adapters are the only intentional boundary |
| W17 scope creep into Bounce | Bound extract to sealed-elim (+ optional pick/tiebreak); leave Bounce |

**Dependencies:** existing format kernel, sealed presentation lifecycle, empowered tiebreak path, format recovery event reconstruction.

---

## Documentation / Operational Notes

- Update operator/sim docs that still say “three launch formats.”
- No data rewrite: historical version-1 trio resolutions remain readable; newly produced resolutions use version 2.
- No partial rollout gate or feature flag: the catalog, manifest support, versioned reader/writer, Majority Elimination, agents, projections, and watch/results surfaces land and verify as one working change.
- API and local simulation docs describe the optional frozen manifest, the default four, and one-format auto-selection.
- After ship, good candidate for `docs/solutions/` compound on modular sealed catalog (not required to land the PR).

---

## Open Questions

**Deferred to implementation**

- Exact helper module filenames under `formats/` vs `agent-format-decisions.ts` once W17 extract lands.
- Whether Vote Bomb tool id string stays literal `vote_bomb` target tool while sharing runner code (prefer yes).
- Depth of postgame turning-point parity for ME (minimum: elimination + tally legibility; dedicated turning-point kinds optional if free).

---

## Sources & Research

- Origin: `docs/brainstorms/2026-08-06-modular-format-catalog-majority-elimination-requirements.md`
- Kernel origin: `docs/brainstorms/2026-07-23-sequester-format-kernel-requirements.md`, `docs/plans/2026-07-23-001-feat-sequester-format-kernel-plan.md`
- W17: `docs/refactor-queue.md`
- Presentation contract: `docs/format-kernel-web-contract-drift.md`
- Learnings: `docs/solutions/architecture-patterns/separate-transport-visibility-from-staged-presentation.md`, `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md`, `docs/solutions/runtime-errors/api-startup-recovery-resumes-interrupted-games.md`, `docs/solutions/architecture-patterns/owner-learning-loop.md`
- Code anchors: `packages/engine/src/formats/`, `packages/engine/src/phases/format-kernel.ts`, `packages/engine/src/format-presentation-metadata.ts`, `packages/engine/src/canonical-events.ts`, `packages/engine/src/canonical-event-log.ts`, `packages/engine/src/game-state.ts`, `packages/engine/src/viewer-decision-events.ts`, `packages/api/src/services/game-event-read-model.ts`
