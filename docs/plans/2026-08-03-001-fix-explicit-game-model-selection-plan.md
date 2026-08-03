---
title: Explicit Game Model Selection - Plan
type: fix
date: 2026-08-03
topic: explicit-game-model-selection
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Explicit Game Model Selection - Plan

## Goal Capsule

- **Objective:** Make `games.config.modelSelection` the only source for a game's provider, model, reasoning policy, and display label.
- **Default:** New public games and Daily Free games use `openai:gpt-5.6-luna` unless an operator chooses another game-ready model.
- **Execution profile:** One SQL data migration plus direct engine, API, and web cleanup in one deploy.
- **Stop condition:** Do not add compatibility layers, historical reconstruction, background backfills, audit services, or new model-selection abstractions.
- **Completion signal:** Every game config has an explicit selection, new games cannot be created without one, and active code never maps `budget`, `standard`, or `premium` to a model.

## Product Contract

### Summary

Influence will persist one explicit `modelSelection` for each game. Its catalog ID identifies the provider and model, and its reasoning policy identifies the reasoning behavior. Relative labels such as `budget` have no model meaning and will disappear from game persistence, runtime selection, API contracts, and UI labels.

A one-time migration will assign fixed explicit selections to tier-only games. This is a practical normalization, not an attempt to reconstruct which model handled each historical call.

### Problem Frame

Legacy configs store `modelTier`. Current code resolves that tier through today's defaults, so changing the budget default caused old nano games to report Luna. The same mutable fallback exists in game start, recovery, fill, join, completion, and labels.

The model catalog already provides explicit provider/model selection. The remaining fix is to migrate old configs and remove tier fallback everywhere that reads or creates a game.

### Requirements

#### Creation and defaults

- R1. Every newly created game must persist a normalized `modelSelection` with `catalogId` and `reasoningPolicy`; no creation path may persist `modelTier`.
- R2. The public-game form must default to `openai:gpt-5.6-luna` with its current `medium` reasoning depth, while Daily Free must explicitly use Luna with `action-policy`.
- R3. `POST /api/games` must require nested `modelSelection` and reject missing, malformed, unknown, disabled, or unsupported selections instead of accepting tier or flat-field aliases.
- R4. Admin import and other current game-config producers must require the same explicit shape so a tier-only game cannot be added after migration.

#### One-time migration

- R5. The migration must update every tier-only game, regardless of status, with this fixed mapping: `budget` to `openai:gpt-5-nano`, `standard` to `openai:gpt-5-mini`, and `premium` to `openai:gpt-5.4-mini`; each repaired selection uses `action-policy`.
- R6. The migration must preserve every existing explicit `modelSelection`, remove `modelTier` from every game config, and fail transactionally on malformed JSON, an unknown tier-only value, or a row that would remain without a selection.

#### Runtime and presentation

- R7. Game start, recovery, fill, join, completion, owned-seat projection, queue enrollment, and model labeling must resolve only the stored `modelSelection` and fail visibly when it is absent or invalid.
- R8. Current API and web contracts must remove game `modelTier` fields and tier fallbacks; model-bearing reads must return a server-computed `modelLabel`, while admin reads may also return the normalized selection.
- R9. The tier-based create-form cost estimate must be removed. Provider/model-based runtime accounting and OpenAI request `serviceTier` remain unchanged.
- R10. Focused tests and current API/product documentation must describe and prove the explicit-only contract.

### Key Flows

- F1. **Create public game:** The form opens with Luna selected, submits `modelSelection`, and the API stores it without `modelTier`.
- F2. **Create Daily Free game:** The scheduler writes Luna/action-policy directly, and fill/start paths reuse that stored selection.
- F3. **Migrate old games:** One SQL migration preserves explicit selections, applies the three fixed mappings to tier-only rows, removes `modelTier`, and commits before API startup.
- F4. **Run or resume a game:** Runtime code resolves the stored selection through the catalog. Missing or invalid selection is an understandable error, not a default.
- F5. **Read a game:** API serializers derive the model label from the stored selection, and web surfaces render that label without local inference.

### Acceptance Examples

- AE1. Covers R1-R3. Submitting the untouched public-game form stores `openai:gpt-5.6-luna` with `medium` reasoning and no `modelTier`.
- AE2. Covers R3. Submitting only `modelTier: "budget"` to `POST /api/games` returns a client error and creates no game.
- AE3. Covers R5-R6. Budget, standard, and premium tier-only fixtures receive the fixed selections, an existing explicit selection is preserved, every migrated config loses `modelTier`, and applying the repair logic again makes no semantic change.
- AE4. Covers R6. Malformed JSON or an unknown tier-only value aborts the migration without partially updating other games.
- AE5. Covers R7-R8. Start/recovery and owned-seat projection use the stored selection, while public, admin, player-history, and queue reads show its catalog label without a tier field.
- AE6. Covers R2, R4, R9. Daily Free writes Luna/action-policy, a tier-only admin import is rejected, and the create form has no tier-derived estimate.

### Scope Boundaries

**In scope:** one migration over `games.config`; current game creation and import paths; Daily Free; start/recovery/fill/join/completion; owned-seat and queue projection; public/admin/player-history labels; web types and displays; current docs and tests.

**Out of scope:** reconciling `game_players.agent_config`; reconstructing completion settlements or historical calls; mixed-model detection; re-validating existing explicit selections in SQL; historical-label accuracy beyond the fixed migration; database schema redesign; new constraints or audit tooling; changing OpenAI `serviceTier`; adding providers or models; rewriting historical plans or simulation artifacts.

## Planning Contract

### Key Technical Decisions

- KTD1. **`modelSelection` is the only game model authority.** (session-settled: user-directed — chosen over tier fallback: `budget` has no stable model meaning.) Governs R1, R3, R7-R8. The catalog ID already encodes provider and model, so no parallel provider field or compatibility resolver is needed.
- KTD2. **Use a fixed migration, not historical reconstruction.** (session-settled: user-directed — chosen over player-record and settlement reconstruction: historical execution accuracy is not required.) Governs R5-R6.
- KTD3. **Repair all three legacy tiers in the same migration.** (session-settled: user-approved — chosen over a budget-only repair: removing fallback requires every tier-only row to receive an explicit selection.) Governs R5-R6.
- KTD4. **Deploy the migration and explicit-only code together.** Governs R5-R8. Stop the old API, start the new release, and let its existing migration runner commit before startup recovery and request handling. If the new release fails after migration, keep writes stopped and roll forward; do not add dual-read or staged-backfill machinery.
- KTD5. **Keep labels server-owned.** Governs R8. API serializers use the engine catalog formatter; web clients render `modelLabel` and do not invent fallback text.
- KTD6. **Remove the fake tier estimate.** Governs R9. Do not rename the old three-price approximation as model pricing. Leave actual provider/model accounting intact.

### System-Wide Impact

- `games.config` remains text JSON. Only its model fields change.
- Existing player model snapshots and completion records remain untouched.
- Startup migration failure leaves the transaction uncommitted and prevents the new API from starting.
- OpenAI `serviceTier` and provider `service_tier` are unrelated and remain intact.

### Risks and Mitigations

- **Invalid legacy config:** Validate within the migration and fail the deploy transaction instead of guessing.
- **Missed producer:** Cover normal creation, Daily Free, and admin import, then search active code and fixtures for remaining game-tier writes.
- **Hidden fallback:** Replace all calls to the tier-aware resolver and remove fallback label formatting.
- **Fixture churn:** Update current fixtures to explicit selections; retain tier-only fixtures only for migration and rejection tests.
- **Over-broad cleanup:** Keep provider `serviceTier` code and tests unchanged.

### Sources and Research

- `packages/engine/src/model-catalog.ts` — current tier mapping and catalog resolver.
- `packages/api/src/routes/games.ts` — creation, join/fill, and public read contracts.
- `packages/api/src/services/game-lifecycle.ts` — start, recovery, and completion resolution.
- `packages/api/src/services/owned-seat-projection.ts` and `packages/api/src/services/queue-enrollment.ts` — owned-seat and queue/MCP paths.
- `packages/api/drizzle/0038_repair_agent_name_uniqueness.sql` and `packages/api/src/__tests__/agent-name-uniqueness-migration.test.ts` — existing transactional data-repair test pattern.
- `docs/solutions/architecture-patterns/shared-postgres-tests-use-a-process-advisory-lock.md` — DB-backed tests call `setupTestDB()` and remain sequential.
- `docs/solutions/runtime-errors/api-startup-recovery-resumes-interrupted-games.md` — migrations complete before startup recovery.
- `docs/solutions/architecture-patterns/openai-flex-simulation-retries.md` — provider `service_tier` is not a game model tier.
- [PostgreSQL JSON functions and operators](https://www.postgresql.org/docs/current/functions-json.html) — `jsonb` supports the needed object update and key removal.

## Implementation Units

### U1. Add the one-time game-config migration

- **Goal:** Convert all persisted game configs to explicit selection before the new runtime starts.
- **Requirements:** R5-R6.
- **Dependencies:** None.
- **Files:** `packages/api/drizzle/0049_explicit_game_model_selection.sql`; `packages/api/drizzle/meta/_journal.json`; `packages/api/src/__tests__/game-model-selection-migration.test.ts`.
- **Approach:** Follow the existing migration-test pattern. Parse configs safely, preserve explicit selections, map the three tier-only values, remove `modelTier`, and assert that no row remains without a selection. Keep the SQL idempotent even though the journal applies it once.
- **Test scenarios:** Cover all three mappings, multiple game statuses, explicit-selection preservation, tier removal, malformed/unknown rejection, transactional rollback, and semantic idempotence.
- **Verification:** The focused DB test calls `setupTestDB()`, runs sequentially, and observes either the complete repaired set or the complete unchanged set after failure.

### U2. Remove tier resolution from engine and API

- **Goal:** Make all current game producers and consumers explicit-only.
- **Requirements:** R1-R4, R7-R8.
- **Dependencies:** U1.
- **Files:** `packages/engine/src/model-catalog.ts`; `packages/engine/src/llm-client.ts`; `packages/engine/src/simulate.ts`; `packages/api/src/lib/model-label.ts`; `packages/api/src/routes/games.ts`; `packages/api/src/routes/free-queue.ts`; `packages/api/src/routes/admin.ts`; `packages/api/src/services/game-lifecycle.ts`; `packages/api/src/services/agent-revisions.ts`; `packages/api/src/services/owned-seat-projection.ts`; `packages/api/src/services/queue-enrollment.ts`; affected engine/API tests and fixtures.
- **Approach:** Delete game `ModelTier`, `DEFAULT_TIER_MODELS`, `legacyTier`, `tierToCatalogId`, and `resolveModelForTier`. Require the explicit resolver input. Callers without a persisted game must use a named catalog/default constant rather than a tier. Make game creation/import validate and persist only `modelSelection`. Keep Daily Free's named Luna selection. Remove API `modelTier` fields and derive labels only from explicit selection.
- **Test scenarios:** Resolve valid catalog/provider selections; reject missing or invalid selection; create Luna by default through the client; create an alternate model; persist Daily Free Luna; reject tier-only import; and verify lifecycle, recovery, owned-seat, queue, public, player-history, and admin paths without tier fallback.
- **Verification:** Focused engine and API tests pass, and active engine/API source has no game tier-to-model mapping.

### U3. Remove model tiers from the web

- **Goal:** Submit and display explicit model identity without client inference.
- **Requirements:** R2-R3, R8-R9.
- **Dependencies:** U2.
- **Files:** `packages/web/src/lib/api.ts`; `packages/web/src/app/admin/games/new/create-game-form.tsx`; model displays in game browser/viewer, admin, dashboard, history, and join modal; affected web tests.
- **Approach:** Remove `ModelTier` from current types and form state. Make `CreateGameParams.modelSelection` required. Keep Luna and medium reasoning as the form defaults. Render server `modelLabel` directly and delete the tier-based estimate.
- **Test scenarios:** The untouched form submits Luna/medium; alternate model selection submits correctly; tier-only response fixtures are removed; all affected views render the server label; and no create-form tier estimate remains.
- **Verification:** Focused web tests pass, and active web source has no game-tier formatter or tier-priced estimate.

### U4. Update current docs and close verification

- **Goal:** Remove obsolete current guidance and prove one model authority remains.
- **Requirements:** R10.
- **Dependencies:** U1-U3.
- **Files:** `docs/mvp-ux-design.md`; remaining current-code fixtures found by search.
- **Approach:** Replace current `modelTier` API examples with required `modelSelection`. Do not rewrite historical plans or artifacts. Update fixtures that represent current configs; keep legacy tiers only in migration/rejection coverage.
- **Test scenarios:** Current docs show explicit nested selection and Luna default, while searches distinguish intentional migration fixtures from unrelated provider `service_tier`.
- **Verification:** `bun run test`, `bun run check`, and the final active-code search pass.

## Verification Contract

- Run the focused migration test, engine model-catalog tests, games/lifecycle/recovery/free-queue/queue-enrollment API tests, and affected web tests.
- Run `bun run test`.
- Run `bun run check`.
- Search active engine, API, and web source for `modelTier`, `DEFAULT_TIER_MODELS`, `resolveModelForTier`, `tierToCatalogId`, and `legacyTier`. Only the one-time migration SQL plus migration/rejection fixtures may retain old game-tier names.
- Confirm `serviceTier` and `service_tier` code and tests remain.
- In staging, let the normal startup migrator run, verify migrated rows have `modelSelection` and no `modelTier`, create one default public game, and confirm its API/UI label is Luna.

## Definition of Done

- R1-R10 and AE1-AE6 are covered.
- The one migration repairs every tier-only game and preserves explicit selections.
- Every current creation path writes explicit selection.
- Runtime and labels have no tier fallback.
- The public-game form and Daily Free default to Luna.
- Current API/web contracts and docs contain no game tier.
- `bun run test` and `bun run check` pass.
- No compatibility resolver, historical reconstruction, audit framework, schema redesign, or abandoned code remains in the diff.
