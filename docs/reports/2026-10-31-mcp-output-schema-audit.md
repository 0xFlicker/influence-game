---
title: The House MCP output-schema audit
date: 2026-10-31
status: audit-complete-with-execution-limitations
scope: production-game-mcp-and-ancillary-local-servers
implementation_status: local-fix-implemented-not-deployed
---

# The House MCP output-schema audit

## Executive result

This inventory records the pre-fix audit. The implementation follow-up at the end
describes the authorized local repair; the production observations below are not
a claim that the repair has deployed.

**One production-breaking output-schema defect is confirmed.** `read_game` rejects
valid Influence viewer decisions containing `publicDecisionSpeech`. The engine
emits that field, but the checked-in generated MCP schema omits it and closes the
event object with `additionalProperties: false`. This is schema drift, not evidence
that the game is corrupt.

The wider audit found substantial enforcement gaps: of **70 production tools**, **38
declare output schemas** and **32 declare none**. Only **13** validate emitted data
against their full JSON Schema using Ajv. Six use hand-written assertions; the other
19 schema-bearing tools serialize output without enforcing the advertised schema.
These gaps are not 51 additional proven production failures.

All production tools were inventoried and their output path classified. Selected
read-only production variants were exercised; no mutation, enrollment, generation,
resume, moderation action, signing, or publication was attempted. Other than the
specific `read_game` variant, sampled calls returned normally. That does not certify
every optional field, lifecycle state, historical variant, or mutation result.

The separate live replay issue is not explained by this MCP defect. The browser
uses another presentation path. Keep the fixes separate unless shared-source
evidence establishes a connection.

## Evidence and method

- Local owning source inspected at `ef8a7524`; the production deployment SHA was
  not independently established. Production calls below are direct current evidence.
- Reviewed the production descriptor/dispatch inventory in
  `packages/api/src/game-mcp/server.ts`, schema families, output adapters, owning
  service types/projectors, and relevant test/generator paths.
- Parsed all 10 checked-in generated House schemas using Python's JSON parser.
  All 343 local `$ref` occurrences resolve. None contains a `publicDecisionSpeech`
  property. Valid references do not establish semantic freshness.
- Checked the generated Phase enum against current engine phases, and inspected
  Werewolf action/rules-version/conversation shapes, result/retrospective contracts,
  and transcript adapters. Rules versions 7–11 and the current Phase members are
  already represented; no additional concrete mismatch was established there.
- Checked current successful production result shapes for both games, retrospective,
  rules/catalog, thinking, editorial moments, profile, postgame/index, and learning-list
  reads. Successful calls in unchecked families mean transport success, not a full
  independent schema-validation pass.
- Node dependencies are absent in this checkout; Ajv and the pinned generator are
  unavailable locally. Python `jsonschema` is also absent. No dependencies were
  installed, schemas regenerated, application tests run, or production records changed.
- Trace-MCP and engine-local MCP inventory/shape review was independently supplied
  by the parent reviewer and incorporated below.
- Parent review verified 70 distinct production inventory rows against the connected
  tool count, reconciled the 13 Ajv / 6 custom / 51 unchecked output paths and
  32 missing schemas, and reviewed the incident proof chain and limitations.

## Findings

### F1 — P1: `read_game` rejects valid public decision speech metadata (confirmed)

Reproduced call:

```json
{"gameIdOrSlug":"open-tan-ghost","view":"current","limit":20}
```

Production returns JSON-RPC error `-32000`, beginning `Invalid read_game output`.
The same game with `limit: 1` succeeds and returns only `round.result_recorded` in
its facts page. An initial replay page with `limit: 20` also succeeds. The failure
is therefore content-dependent, not an inaccessible game or universally broken tool.

Proof chain:

1. `packages/engine/src/viewer-decision-events.ts:32` declares optional
   `publicDecisionSpeech: Array<{ actorId; action }>` in `ViewerDecisionEventBase`.
2. Its `viewerEventBase` at line 507, specifically line 514, emits this property
   for accepted required public speeches on bounce-pointer, format tie-break, and
   the public Two Names decision actions.
3. `packages/api/src/services/house-influence-inspection.ts:57` passes the projected
   viewer decision through into House facts. `readHouseGame` returns those facts
   and a snapshot through `houseContent`.
4. `packages/api/src/game-mcp/house-output-schemas.json:4866` defines the closed
   `format.resolved` viewer event without that property. The same omission exists
   throughout the generated viewer-event base definitions.
5. `packages/api/src/game-mcp/house-contracts.ts:107` rejects the response before
   returning structured data. `server.ts:237` surfaces the thrown error as JSON-RPC.

Production `filter_events` previously returned round 2 event 511 with
`publicDecisionSpeech: [{ actorId: "91ce57d4-a736-4ab7-88be-b9afaca0a9e1",
action: "format-tiebreak" }]`, matching the source-level mismatch. There is no need
to remove or reinterpret this valid field. Surface vocabulary differences such as
`save_or_exit` versus canonical `save_or_eliminate` are explicitly mapped in the
legacy read-model path and are not this demonstrated failure.

**Blast radius:** Influence `read_game` current/replay pages or snapshots containing
these metadata-bearing decisions, including Safety Bounce pointers and Two Names
public actions as well as empowered format tie-breaks. Not all pages fail; the
latest non-decision snapshot and an early replay page can work. No corresponding
Werewolf failure was reproduced.

**Fix:** regenerate the closed House schemas from current owning types with the
pinned generator, review the complete diff, and retain strict rejection of genuine
unknown fields. Add actual projector-produced fixtures with and without
`publicDecisionSpeech`, including current view, replay pagination, and a snapshot
whose last event carries the field. Include pointer, tie-break, and Two Names
variants. Do not disable Ajv or set blanket `additionalProperties: true`.

### F2 — P2: generated schemas can drift without a freshness gate (confirmed gap)

`scripts/generate-house-mcp-schemas.cjs:22` derives contracts from ReturnTypes in
`house-contract-types.ts`, using pinned `typescript-json-schema@0.65.1`, and writes
the checked-in JSON at line 63. The script first runs API typechecking, but typechecks
do not compare the checked-in JSON with current inferred service output.

Repository CI/package-script inspection found no generated-schema freshness check.
F1 demonstrates why a valid TypeScript change can still break MCP at runtime.
The generator's `ignoreErrors: true` is documented as accommodating its older TS
parser after authoritative typechecking; it is not by itself proof of F1's cause.

**Fix:** provide reproducible pinned generation in CI, emit to a temporary target,
and compare against the checked-in schema. Run behavioral response validation too;
freshness alone cannot prove that a service actually emits its declared type.

### F3 — P2: advertised schema enforcement is inconsistent (confirmed gap)

`server.ts:2258` (`postgameContent`) and `server.ts:2317` (`content`) attach arbitrary
values as `structuredContent` without checking the tool's advertised output schema.
This affects 19 tools that do declare schemas: six postgame tools, three fact/index
tools, eight owner-learning tools, and two agent mutation tools.

Five match-completeness/narrative tools and public profile use custom assertions.
For example, `contracts.ts:2112` validates selected manifest keys and follow-ups;
it is not a full recursive JSON Schema evaluation. Existing manual checks remain
useful semantic checks, but must not be described as full schema enforcement.

**Fix:** centrally validate every schema-bearing successful structured response
against that descriptor before emission, retaining semantic/privacy assertions.
For mutation tools, validate domain results within a design that preserves durable
receipts and idempotent recovery if response validation fails after a committed
mutation; never encourage a fresh mutation retry because serialization failed.

### F4 — P2: 32 production tools have no output schema (confirmed coverage gap)

The helper at `server.ts:1576` only advertises `outputSchema` when explicitly supplied.
The inventory below identifies the omitted tools, including event inspection,
model routing, provider health, moderation, and multiple agent-management reads.
They often still return structured content, but no advertised schema can detect
contract drift. Absence alone is not an MCP protocol violation or a demonstrated
bad response. The four schema-less trace tools and nine engine-local tools below
are primarily text JSON surfaces and have the same coverage limitation.

**Fix:** define current typed success/error output contracts by owning service,
starting with operational reads and mutation receipts. Model legitimate variants
explicitly. Do not add permissive `object` placeholders merely to raise coverage.

### F5 — P2: one schema-test helper can silently miss violations (confirmed gap)

`packages/api/src/__tests__/production-game-mcp-server.test.ts:94–136` implements a
small custom validator. It does not resolve `$ref`, enforce integer/numeric bounds,
or validate values under schema-valued `additionalProperties`; non-object schema
shapes it does not recognize can return an empty error list. This means some tests
may pass without checking the contract they appear to check.

Other tests, including `house-game-inspection.test.ts`, call real `houseContent`
and therefore real Ajv. This is a subset weakness, not a claim that every contract
test is ineffective. Direct `publicDecisionSpeech` fixtures are absent from the
House inspection test source; indirect fixtures cannot be ruled out by text search.

**Fix:** use the actual JSON Schema validator and production descriptor for these
tests, with negative mutations proving unknown keys, `$ref` constraints, array
counts, map values, enums, nullability, and bounds fail.

### F6 — P3: union validation errors obscure the actionable mismatch (confirmed)

`house-contracts.ts:110` serializes all Ajv union errors using `errorsText` with
`allErrors: true`. The production failure lists missing fields from unrelated
Werewolf/error variants as well as the real Influence event mismatch. This is not
dozens of independent data failures, but it makes diagnosis unnecessarily difficult.

**Fix:** return a bounded stable contract-error summary with tool and relevant JSON
path/variant; retain detailed diagnostics privately without dumping response bodies
or private evidence. Preserve strict validation and the distinction between a
contract defect and an expected domain error.

## Production inventory: all 70 tools

Legend: **Ajv** = full output JSON Schema enforcement; **custom** = selected manual
assertions; **none** = no output validation at dispatch. “Read OK” means the sampled
production call returned normally; it does not certify all variants. “Static” means
descriptor/adapter/service review only. Mutating tools were never invoked.

| Tool | Output schema / enforcement | Evidence |
| --- | --- | --- |
| list_games | generated House / Ajv | Read OK, public mixed-game catalog |
| read_game | generated House / Ajv | F1 reproduced; narrow/current and initial replay pass; Werewolf Mystery current passes |
| read_game_results | generated House / Ajv | Read OK for completed Influence and Werewolf; expected not_completed error passes |
| read_game_retrospective | generated House / Ajv | Read OK completed Influence; expected not_completed error passes |
| resume_game_retrospective | generated House / Ajv | Static; mutation not invoked |
| read_game_cuts | generated House / Ajv | Read OK, not_prepared variant |
| read_game_thinking | generated House / Ajv | Read OK Influence actor cutoff; expected invalid_input variant passes |
| get_rules | generated House / Ajv | Read OK Influence and Werewolf |
| search_rules | generated House / Ajv | Read OK Influence search |
| list_archetypes | generated House / Ajv | Read OK with strategy hints |
| read_production_moments | editorial / Ajv | Read OK, public Influence, thinking false |
| preview_production_cut | editorial / Ajv | Static; successful preview variant not executed |
| update_production_moment_tags | editorial / Ajv | Static; mutation not invoked |
| read_player_profile | public-player schema / custom | Read OK, thehouse found variant |
| read_match_manifest | match contract / custom | Static |
| read_match_transcript | match contract / custom | Static |
| read_owned_match_cognition | match contract / custom | Static |
| read_owned_match_narrative | match contract / custom | Static |
| read_producer_match_narrative | match contract / custom | Static |
| list_agent_games | postgame / none | Static |
| read_game_brief | postgame / none | Read OK completed Influence |
| read_jury_breakdown | postgame / none | Read OK completed Influence |
| read_player_game_summary | postgame / none | Static |
| read_game_turning_points | postgame / none | Read OK completed Influence |
| read_producer_game_analysis | postgame / none | Read OK completed Influence, brief |
| read_round_facts | round-facts / none | Read OK incident round 2 |
| list_cognitive_artifacts | index / none | Read OK, limit 1 |
| list_trace_manifests | index / none | Read OK, limit 1 |
| list_learning_review_inputs | learning / none | Read OK |
| list_open_learning_reviews | learning / none | Read OK |
| preflight_learning_review | learning / none | Static |
| read_learning_review | learning / none | Static |
| start_or_resume_learning_review | learning / none | Static; mutation not invoked |
| retry_learning_review | learning / none | Static; mutation not invoked |
| apply_learning_review | learning / none | Static; mutation not invoked |
| resolve_learning_review | learning / none | Static; mutation not invoked |
| create_agent | agent command / none | Static; mutation not invoked |
| update_agent | agent command / none | Static; mutation not invoked |
| read_game_model_routing | absent / none | Static |
| set_game_model_routing | absent / none | Static; mutation not invoked |
| list_seasons | absent / none | Static |
| read_season_standings | absent / none | Static |
| read_season_game_receipts | absent / none | Static |
| read_projection | absent / none | Static |
| read_agent_alliances | absent / none | Static |
| filter_events | absent / none | Read OK incident events in preceding investigation |
| player_timeline | absent / none | Static |
| read_cognitive_artifact | absent / none | Static |
| read_moderation | absent / none | Static |
| act_on_moderation | absent / none | Static; mutation not invoked |
| read_producer_season_diagnostics | absent / none | Static |
| read_producer_visual_production | absent / none | Static |
| inspect_durable_run | absent / none | Static |
| read_provider_health | absent / none | Static |
| read_producer_game_cost_detail | absent / none | Static |
| read_trace_content | absent / none | Static |
| search_reasoning_traces | absent / none | Static; preceding empty-query attempt correctly rejected input |
| read_model_catalog | absent / none | Static |
| set_agent_model | absent / none | Static; mutation not invoked |
| list_agents | absent / none | Static |
| get_agent | absent / none | Static |
| search_agents | absent / none | Static |
| get_queue_status | absent / none | Static |
| list_open_games | absent / none | Static |
| read_agent_season | absent / none | Static |
| export_agent_season_data | absent / none | Static |
| generate_agent_visual_reference | absent / none | Static; paid generation not invoked |
| crop_agent_portrait | absent / none | Static; asset write not invoked |
| join_queue | absent / none | Static; mutation not invoked |
| leave_queue | absent / none | Static; mutation not invoked |

Production source anchors: descriptors in `server.ts:807–1574`; dispatch in
`server.ts:341–718`; House schemas in `house-contracts.ts:74–85`; editorial schemas
in `production-editorial-contracts.ts:31–43`; match/learning schemas in
`contracts.ts`; agent mutation schemas in `agent-tool-schemas.ts`; public profile
schema/assertions in `public-player-tool-schema.ts`.

The 19 declared-but-unchecked tools are not all fully strict schemas: several
postgame/index nested shapes deliberately allow arbitrary extra properties, e.g.
`server.ts:1690–1793`. Tightening them requires defining the intended current
contract, not declaring arbitrary historical payloads corrupt.

## Ancillary MCP inventories

These are separate server surfaces; their counts are not added to the 70 unique
production tool names above. Review was static and supplied by the parent reviewer.

| Server | Tool | Output contract assessment |
| --- | --- | --- |
| API trace-MCP | list_manifests | Declares schema; source success/invalid_cursor fields match; no runtime enforcement demonstrated |
| API trace-MCP | list_durable_runs | No schema; text JSON |
| API trace-MCP | inspect_durable_run | No schema; text JSON |
| API trace-MCP | read_content | No schema; text JSON |
| API trace-MCP | search_reasoning_traces | No schema; text JSON |
| engine-local game-MCP | read_game_retrospective | No schema; text JSON |
| engine-local game-MCP | read_werewolf_history | No schema; text JSON |
| engine-local game-MCP | list_sessions | No schema; text JSON |
| engine-local game-MCP | list_games | No schema; text JSON |
| engine-local game-MCP | read_projection | No schema; text JSON |
| engine-local game-MCP | filter_events | No schema; text JSON |
| engine-local game-MCP | player_timeline | No schema; text JSON |
| engine-local game-MCP | search_logs | No schema; text JSON |
| engine-local game-MCP | linked_records | No schema; text JSON |

Anchors: `packages/api/src/trace-mcp/server.ts:47–94` and descriptors at lines
159–224; `packages/api/src/services/private-trace-read-model.ts:315–334`, `442–450`,
`772`; `packages/engine/src/game-mcp/server.ts`. Ancillary names were checked against
these server descriptors.

## Remediation order and acceptance

1. **Repair F1 first:** regenerate strict House schemas, add projected-event
   regression fixtures, and verify the exact failing call succeeds without
   dropping `publicDecisionSpeech`. Exercise replay pages that cross the event,
   not just a first page or a narrow current snapshot.
2. **Prevent recurrence:** establish deterministic schema generation/freshness CI
   and replace the incomplete test validator with Ajv. Validate representative
   current/legacy states for both game kinds, all format event variants, optional
   metadata, lifecycle errors, and pagination.
3. **Unify enforcement:** validate all advertised structured outputs at emission,
   preserving domain checks and mutation idempotency. Add schemas to the missing
   production surfaces in coherent owning-service groups; do not conflate this
   larger hardening work with the targeted incident fix.
4. **Improve diagnostics:** concise tool/path/variant contract errors, with bounded
   private detail and no raw response leakage.

Future implementation validation should include focused MCP/Ajv fixtures, required
PostgreSQL tests with `setupTestDB()` and sequential database access, then repo
baselines `bun run test`, `bun run test:postgres`, and `bun run check`. A later
read-only production smoke after an authorized deployment is separate evidence.

The audit established one proven break plus inventory/enforcement gaps;
unexecuted branches remain explicitly unverified.

## Authorized implementation follow-up (2026-11-01)

- Regenerated the ten strict House output schemas from their current service
  types. All 26 projected decision-event definitions now include the optional
  typed `publicDecisionSpeech` field. Closed objects remain closed; no catch-all
  compatibility branch or dropped response field was introduced.
- Added database-backed fixtures for Safety Bounce pointer, format tiebreak and
  Two Names setup events across frozen game versions 1, 2 and 3. Both current
  snapshots and one-entry replay pages are validated, including a negative
  unexpected-field check. Historical versions retain their own speech semantics.
- Added one production dispatch boundary that checks every advertised
  `outputSchema` using Ajv before emitting the response. This covers all 38
  schema-bearing tools, including the previously unchecked 19, and retains
  existing domain assertions. Successful typed tools must return structured
  content; challenge/error envelopes may omit it. Committed mutations are not
  rolled back by an output failure; their existing idempotency/recovery contracts
  still apply.
- Replaced the partial test validator with Ajv, repaired two stale output mocks,
  and added negative dispatch checks. Focused validator tests exercise nested
  references, typed maps, integer limits, unknown keys and structured envelopes.
- Pinned `typescript-json-schema` 0.65.1 as a development dependency. Bun scripts
  regenerate or compare the generated schema; required CI checks freshness after
  typechecking. The generator still uses the repository compiler as its type
  authority before its older embedded parser emits schemas.
- Bounded schema-failure diagnostics to three truncated coordinates and keywords;
  rejected response values and the full union error tree are not emitted.

The remaining 32 production tools without output schemas and 13 ancillary tools
without schemas remain separately scoped hardening work. No claim is made that
their every payload variant was exercised. This change does not deploy, modify
stored games, repair the separate live replay pacing issue, or replace a
post-deployment smoke test of the original production call.

Local validation performed:

- `bun run mcp:schemas:check`: passed, including API typecheck and exact generated
  JSON comparison.
- Four focused PostgreSQL test files (`house-game-inspection`, production game
  MCP server, owner learning and editorial MCP): clean final run **90 passed,
  zero failed, 1,455 expectations** in 91.35 seconds. The run used a 120-second
  per-test timeout and sequential database access.
- Targeted catalog/dispatch rerun: three passed, including compilation of all 38
  advertised output schemas and rejection of malformed postgame/round facts.
- Validator unit tests: three passed, 15 expectations. `git diff --check` passed.

Required whole-repository baselines and PR review are tracked by the parent task;
they are separate from these focused results. No production deployment or
post-deployment smoke is claimed.
