---
title: "Character model selection, House routing, and admin fallbacks"
date: 2026-10-23
status: planned
type: feat
---

# Character model selection, House routing, and admin fallbacks

## Outcome and authorization

Allow an admin to create an Influence or Werewolf game with eight characters preferring eight different models, independently choose the House model, and keep play moving through explicit fallback routes. Give free users a small model picker while retaining broad model access for admins and sysops.

This document records the agreed implementation scope. Saving it authorizes documentation only: no application changes, paid tests, live profile changes, deployment, or provider calls that generate content. Implementation and paid evaluation are separate future work.

Model choice is always best effort. The game records both the preferred route and the actual route responsible for each accepted result. Catalog vetting means documenting capabilities and pricing, not requiring a paid certification run for every model.

## Settled product decisions

### Initial free selection

| Picker option | Provider | Exact model ID | Service policy |
|---|---|---|---|
| Default — Let the House decide | Resolved by game configuration | Game's default contestant model | Inherit that route's policy |
| GPT-6 Luna | OpenAI | `gpt-6-luna` | Flex only |
| GLM Flash | Katana | `glm-5-3-flash-private` | Provider's configured route |
| DeepSeek Flash | Katana | `deepseek-v4-flash` | Provider's configured route |
| Muse 1.3 Contributor | Meta | `muse-spark-1.3-contributor` | Contributor |

Luna stays Flex, including when used by the House or as a fallback. Do not introduce automatic Standard recovery or an alternate Luna route that cannot enforce Flex. Muse's free/default route uses Contributor under the existing terms covering provider training and avoiding personal information; no additional consent flow is in scope. Admins may explicitly select other Muse variants as part of their broader access; never substitute Standard implicitly.

Admins/sysops may select any text-generation model through a configured provider, including discovered models and manually supplied model IDs. A curated allowlist governs free access, not the full admin picker. Model-family preference does not waive strict output validation or known technical incompatibilities.

### Character and game settings

Each character has one model preference shared across Influence and Werewolf. Influence and Werewolf strategy notes remain separate. An admin can override a character's model for one game without changing the saved character.

Game creation provides:

| Setting | Responsibility |
|---|---|
| Default contestant model | Resolve characters choosing Default |
| Contestant fallback chain | Ordered recovery routes for contestants |
| House model | All game-scoped House LLM responsibilities |
| House fallback chain | Ordered recovery routes for House invocations |
| Model exclusions | Optional restrictions on models used in this game |
| Fallback usage limits | Bound recovery spending per route and game |

These game policy settings and cast overrides are admin/sysop operations; free users choose their own character preference. The default contestant model is independent of the House model. Default is resolved before play. Both defaults and fallback order are explicit in the admin-managed game template; this plan does not choose a new global fallback order.

Games allow all compatible models unless restricted. Exclusions apply to contestant and House primaries and fallback routes. A model's context size is not an exclusion reason by itself: use context adaptation. Capability checks concern the input and strict response contract required by the relevant actor's calls, not every feature offered by the provider.

Ordinary users receive this small explanation near model selection or in help text, without an agreement checkbox:

> Model preferences are best effort. The House may use another supported model to keep the game running.

## Requirements

### R1. Catalog, discovery, and access

- Represent curated routes, provider-discovered text models, and admin-entered exact IDs in one catalog view. Do not automatically equate discovery with proven game quality.
- Enforce the four-model free allowlist and Default for user-selected profile preferences and enrollment across UI/API/MCP. A user must own or otherwise have permission to edit the profile; model access does not grant profile ownership. Use existing admin/sysop authorization rather than client-supplied role claims.
- Model identifiers do not authorize arbitrary endpoints or credentials. A new provider requires a configured integration and an adapter.
- Distinguish provider/model identity, family/display name, and service tier. The same family through different providers is a different execution route.
- Admins can select experimental models, including models previously excluded from the free selection for poor quality. Show documented limitations and unknowns in admin surfaces without a paid qualification gate.
- Known incompatibility must have a concrete explanation. Unknown capabilities may be attempted through a supported adapter, but no permissive output parser or invented request contract may be introduced to make the model work.
- Distinguish unsupported capabilities, missing provider configuration, retired IDs, and temporary outages. Discovery failure must not erase curated records or frozen running-game routes.
- Keep entitlements separate from rate cards so future premium access does not require an execution redesign. Subscription billing is out of scope.

Start with four explicit free records, provider metadata, and existing adapters; no hand-written record is required for every admin model. Manual IDs use the configured adapter's strict response mechanism. Unknown behavior is experimental; known inability to produce the required strict schema is a pre-start incompatibility.

### R2. Capability and pricing evidence

For each route, capture the available information below, preserving unknown values rather than treating them as false or zero:

| Category | Fields or evidence |
|---|---|
| Structured responses | Provider-native exact strict JSON-schema mechanism, supported schema subset, adapter implementation |
| Inputs | Text/image support and other documented modalities relevant to selection |
| Request controls | Reasoning options, temperature support, output-token parameter, transport restrictions |
| Capacity | Documented context/output limits and source; used for adaptation rather than size-only failure gates |
| Pricing | Input/output/cache read/cache write rates, service tier, long-context tiers, minimum charges and rounding |
| Provenance | Source URL or provider metadata, checked date, effective date where supplied, explicit conflicts |
| Observations | Derive actual usage, failures/refusals, latency, and fallback frequency from existing attempt receipts; no new scoring system |

Provider-documented support and adapter-implemented support must be distinguishable. Tool support alone does not satisfy the current strict JSON-schema response requirement. Admin selection cannot bypass that requirement.

**Existing bug cleanup — unknown-model cost estimates:** the audit found that the general `estimateCost()` helper in `packages/engine/src/token-tracker.ts` substitutes the default model's rates when the requested model has no pricing entry. This can misprice an unknown model; it does not change which model executes. Remove that substitution and report unknown pricing explicitly while retaining usage. This is an existing reporting bug, not new model-selection functionality; broader admin selection makes it more likely to surface. Add a regression test proving an unpriced model does not inherit Luna's rates. Unknown pricing must not prevent an admin experiment.

For the catalog/routing work, pricing must be provider-qualified and versioned in accounting receipts. Keep measured/provider-reported cost separate from estimates and include unsuccessful billable attempts. Preserve the rate used by each receipt instead of repricing history from today's catalog. Review metadata when adding/changing routes; a scheduled catalog/pricing synchronization service is not required.

Recheck the October 14 audit findings during implementation: missing Grok 4.6 pricing, conflicting GLM 5.2 rates, Katana rounding, generic capability inference, and image-capability gaps. These are historical findings, not current guarantees. Retain source conflicts and surface material pricing changes; do not silently replace the agreed free selection.

### R3. Enrollment, filling, and resolution

- Resolve a contestant using: authorized per-game override, then the enrolled character preference, then game default contestant model. An explicit Default override selects the game default; an absent override inherits the enrolled preference.
- The game default must resolve to a concrete route. Existing profiles without a saved preference mean Default.
- Snapshot the requested character preference at enrollment. Later profile edits affect future enrollments, not an existing lobby; an authorized cast edit can change the lobby's selection before start.
- For user enrollment, validate the owner's requested-model entitlement. An admin's per-game override is authorized by the admin, not by the character owner's tier. Game defaults and recovery routes are authorized by the game's admin-managed policy. Record the selection source so these cases cannot be confused.
- Resolve technical eligibility from the configured adapter, actor requirements, provider configuration, and game exclusions. Automatic filling selects eligible characters and resolves their assignments together. Manual filling identifies known incompatible seats before start rather than silently replacing the explicit preference. An underfilled automatic roster stays pending with a reason; it does not silently downgrade characters.
- Revalidate selection authorization and the final roster before start. If access changed, require a corrected selection or a current admin override. Do not silently replace it. A transient provider/discovery outage is not a permanent incompatibility; execution may use the configured recovery chain.
- Freeze concrete contestant routes, House route, reasoning settings, Flex policy, fallback order, and limits atomically before execution. Prevent roster edits racing with the start boundary.
- Later profile, entitlement, catalog, or default changes must not rewrite an active or recoverable game's execution plan.
- Daily/free-queue creation uses an explicit House-managed configuration through the same resolver. It must not maintain a parallel assignment implementation.

### R4. One runtime authority and durable continuity

Extend the current game manifest authority to cover contestants and the House. Keep small assignment and policy metadata in the existing game/player records; do not build a second routing service or generic workflow system. Do not leave an independent player model string competing with provider/model configuration in another field. Reuse the existing adapters, provider coordinator, health handling, journal, owner-epoch fencing, and accounting machinery.

Route every contestant invocation through that contestant's frozen configuration, including game-specific actions and postgame contributions. The House must not accidentally supply a contestant retrospective or decision merely because it is a production-stage call.

Accepted journal results replay without fresh generation or re-resolution against current defaults. Preserve semantic call coordinates, accepted-result provenance, and atomic game acceptance. Influence and Werewolf retain their own canonical execution and replay semantics, including historical Werewolf versions.

Before changing the persisted execution format, inspect existing pending/running/recoverable configurations and the current upgrade mechanism. Use the smallest explicit cutover that preserves their sealed routes, limits, and accepted history. If the shape must change, document its exact mapping and recovery proof before release; do not presume a broad migration or add a permanent compatibility layer. Leave completed historical evidence immutable and preserve its read path. New-game free defaults and Flex rules must not retroactively rewrite old games. Remove obsolete execution writes/reads only when no recoverable game needs them.

### R5. Separate House model

- Inventory every game-scoped House LLM call site: summaries, room assignments, huddle selection where applicable, titles/descriptions, interviews, and other game-scoped production text.
- Inject the game's House route and House fallback chain consistently; no hidden global model for an inventoried responsibility.
- Start with one House configuration, not separate per-action model settings.
- Keep House requests, accepted evidence, failures, and spend distinguishable from contestant records.
- Require exact strict JSON-schema responses and semantic validation for consequential output. House prose never becomes canonical facts by parsing or inference.
- Character creation outside a game and image/audio/video generation model selection remain outside this House text-model setting.

Classify calls by responsibility rather than file location. Postgame contestant speech remains contestant work; summaries and game metadata are House work. Inventory existing calls only: this feature does not add new House activities or turn deterministic room/rule logic into LLM decisions. Any existing model-backed context adaptation must receive an explicit game route and retain the original actor's audience boundary.

### R6. Admin-defined best-effort fallback

The admin configures ordered contestant and House fallback chains with call caps, reusing existing provider limits. Use one shared contestant chain. Admin-authorized recovery may use a premium model for a free contestant without granting that user premium selection access.

Reject duplicate entries within a chain. For each actor, skip its primary and entries known incompatible with its required input/schema contract, retaining order. The creation preview shows the resulting chain, including any actor with no alternate route. Admins control whether to supply an empty chain; it means no cross-model recovery, not relaxed validation or disabled context adaptation. Excluded routes cannot appear in the saved configuration. Unknown prices/capabilities alone do not remove a route.

| Failure | Required handling |
|---|---|
| Refusal/content filter | Advance to the next eligible route without repeatedly retrying the same refusal |
| Network/timeout/service error | Existing bounded retry policy, then fallback |
| Rate limit | Honor provider backoff and shared health policy, then fallback within bounded waiting |
| Malformed or semantically invalid schema response | Bounded attempt-boundary retries, then fallback; never accept repaired prose or fabricated defaults |
| Known route/configuration incompatibility | Skip dispatch or fail the attempt clearly, record diagnostics, and use a valid recovery route |
| Estimated or actual context overflow | Adapt context or use suitable routing; never size-only suspension/failure or endless identical retries |
| All routes exhausted for another cause | Existing owning-phase rules-legal failure behavior, or a clear unresolved failure; never fabricate a decision |

Fallback applies to the invocation. Later invocations prefer the requested route again when healthy; provider-health cooldowns prevent repeated outage delays. One refusal does not permanently replace a character's preference. Cancellation and lost ownership fences stop work rather than triggering more provider spending.

Each contestant-chain entry has one per-game attempt allowance shared by all contestants; House-chain entries have separate allowances. Reuse durable attempt reservations before transport, retaining reservations for indeterminate dispatches after a crash. Retries consume allowance; accepted replay, skipped routes, and primary use of the same model do not. Preserve existing aggregate safeguards. These are call caps, not dollar ceilings, especially for unpriced routes.

### R7. Context, evidence, and storage

- Reuse context adaptation and storage paths, changing only demonstrated integration gaps. Preserve canonical facts, legal choices, identities, continuity, and audience boundaries. Prefer compatible routing where it solves a context limit. Compaction cannot manufacture facts or disclose private observations.
- Retain structured thinking, available native reasoning/summaries/encrypted payloads, complete sanitized requests/responses, usage, retries, and failures, including successful attempts.
- Large context/evidence documents stay in object storage; PostgreSQL holds metadata/references. Verify durable upload and hashes before accepting references, retain access boundaries and orphan handling, and stop paid work on persistence failure.
- No storage refactor is planned. If one proves necessary, follow the full [storage cutover runbook](../deployment/private-payload-storage-cutover.md), including all affected existing payloads in local, staging, and production. New-writes-only conversion is incomplete.

### R8. Simulation and reporting

- Accept a roster specification identifying each character/seat, preferred provider-qualified model, and optional permitted reasoning setting, plus independent House and fallback configuration.
- Offer a convenience ordered model list with exactly one entry per seat; reject count mismatches rather than silently cycling or randomizing models. Reuse the production resolver rather than adding separate simulation routing semantics.
- Print a preflight preview of final assignments, unknown pricing/capabilities, and fallback policies without generating content. The offline preview uses supplied/cached metadata and makes no provider request; live metadata refresh is a separate read-only operation.
- Paid simulations run through the localhost API and preserve game IDs for replay, Studio, and MCP. Local LM Studio remains best-effort experimental support.
- Keep reproducible roster/seed/configuration evidence and append-only run artifacts, normally under `packages/engine/docs/simulations/`.
- Report preferred versus actual routes per accepted decision, fallbacks, failure classes, and per-actor plus House costs. Preferred-route share is accepted model decisions from the preferred route divided by all accepted model decisions for that actor. Report unavailable/rules-legal outcomes and failed attempts separately; do not count them as successful model decisions. Label a zero denominator as no accepted model decisions.
- Preserve existing fallback CLI meanings; do not reinterpret repeated provider entries as contestant assignments.

### R9. UI/API/MCP parity and House-owned characters

- Character editing, admin game creation, cast overrides, exclusions, and fallback settings have corresponding authorized API/MCP operations where those resources are exposed.
- Free users see the small picker; admins see discovery/manual selection and capability/pricing uncertainty.
- Keep model substitution details in diagnostics and simulation reports; ordinary users get the short best-effort copy.
- Diversify a deliberately selected set of House-owned characters across the four free models using explicit preferences, leaving other characters on Default. Apply to future games only.
- Prepare a reviewable character-to-model assignment list before changing live House profiles. This plan does not itself authorize those writes.

## Acceptance criteria

All criteria below are pending implementation. Deterministic transport fixtures prove routing mechanics, not deployed provider availability or gameplay quality.

| ID | Acceptance criterion | Evidence |
|---|---|---|
| AC1 | Free users can save Default or each of the four routes; direct requests for other models or privileged settings are rejected | API authorization tests and picker journey |
| AC2 | Admin/sysop can select curated, discovered, and exact-ID experimental text models through configured providers, with uncertainty shown | Catalog/API tests and admin journey |
| AC3 | Resolution precedence and enrollment snapshots are consistent across manual creation, filling, daily queue, and simulation; explicit Default overrides, entitlement changes, underfilled rosters, and start races have the specified behavior | Resolver and PostgreSQL integration tests |
| AC4 | Influence and Werewolf each execute an eight-seat, eight-distinct-route fixture with a separately configured House | API-backed deterministic games and per-call route assertions |
| AC5 | Every inventoried House text responsibility uses the House route; contestant actions and retrospectives use their own routes | Call-site inventory plus focused route tests |
| AC6 | Luna requests remain Flex through primary execution, House execution, retries, fallback use, and resume; no Standard recovery request is emitted | Captured request assertions |
| AC7 | Refusal, transport failure, rate limits, and malformed output follow the frozen chain; preview resolves duplicates/compatibility per actor and shows empty recovery chains; exhaustion never fabricates decisions | Provider coordinator and configuration tests |
| AC8 | Malformed non-JSON, embedded/fenced JSON, empty objects, missing/extra fields, invalid semantics, and exhausted retries cannot mutate continuity or masquerade as accepted speech | Exact-schema failure coverage |
| AC9 | Resume reuses accepted results and provenance; shared contestant caps and separate House caps retain attempt reservations across crashes, including indeterminate dispatches; primary use/replay do not spend fallback allowance; cancellation/ownership loss stop work | PostgreSQL crash/replay and fencing tests |
| AC10 | Large valid contexts and genuine provider context-limit responses adapt and continue with required meaning and privacy intact | Deterministic context-adaptation integration tests |
| AC11 | Existing bug cleanup: an unpriced model never inherits default-model rates. Catalog/routing functionality: pricing is route/tier specific, includes rounding where applicable, and separates estimates from actual receipts | Unknown-model regression test, cost fixtures, and reporting tests |
| AC12 | Reports distinguish preference from actual execution and separate House costs; evidence remains complete and access-controlled | Read-model, artifact, and privacy tests |
| AC13 | Simulation preview is provider-free; later paid runs use localhost API game IDs and stop on evidence-persistence failure | CLI/API contract tests |
| AC14 | UI/API/MCP enforce profile ownership, user entitlements, admin override authority, and admin-managed Default/recovery policies consistently; an override cannot be forged by a free user | Cross-surface authorization tests |
| AC15 | Existing recoverable games preserve their sealed routes and history through the chosen cutover; no competing legacy model authority remains | Inventory, conversion checks, and recovery proof |
| AC16 | House-owned default changes affect only future games and match a reviewed assignment list | Profile-change preview and future-game resolution checks |

## Delivery sequence

Each pass leaves its delivered path working. Do not expose partially wired model selection. Deployment is the gate; do not add feature flags or disabled-but-visible controls. Later-pass acceptance criteria are completed when their surfaces exist, not claimed early from unit tests alone.

### Pass 1 — Catalog and pricing foundation

- Existing bug cleanup: remove default-model price substitution from unknown-model estimates and add its regression test (R2/AC11). This changes reporting only, not execution or fallback policy.
- New functionality: implement the R1/R2 catalog and pricing foundation, explicitly register the four free routes, and use provider-qualified cost records. Do not expose new profile-selection writes yet.
- Reconcile current provider metadata with the October 14 findings; preserve unknowns and source conflicts.
- Define capability and entitlement resolution as one shared contract, with deterministic fixtures for discovered/manual models.
- Exit: catalog/access contract tests and AC11 accounting mechanics pass; existing game execution remains intact. AC1/AC2 full selection flows remain pending until Pass 3.

### Pass 2 — Durable mixed-model execution and House routing

- Implement R3–R7 runtime behavior through authorized admin API entry points: explicit roster assignments, both game runtimes, inventoried House calls, and fallback counters. Reuse existing context/storage paths and address only demonstrated integration gaps.
- Determine whether the persisted shape requires conversion, then implement and prove the smallest necessary cutover; retain immutable historical evidence.
- Add a minimal API-backed deterministic mixed-roster proof so the execution slice works end to end before UI expansion.
- Exit: AC4–AC10 and AC15 pass for the admin API path. Prove AC3 resolver/start behavior and AC12 retained execution evidence here; queue/UI/simulation coverage and formatted reports remain pending for their later passes.

### Pass 3 — Character, game creation, queue, and API/MCP surfaces

- Add the free/admin pickers, saved preferences, per-game cast overrides, default contestant model, House model, separate fallback chains, usage limits, and exclusions.
- Integrate daily/free filling, actionable pre-start errors, and short best-effort copy.
- Exit: AC1/AC2, AC3 profile/queue/UI coverage, and AC14 pass with server-side enforcement.

### Pass 4 — Simulation ergonomics and reports

- Implement roster/model-list input, provider-free preview, and preferred/actual route reports through the shared API contracts.
- Preserve API game IDs, seeds, sanitized evidence, and spend by contestant and House.
- Exit: AC3 simulation parity and AC12/AC13 pass. Document ready-to-run examples without executing paid tests.

### Pass 5 — House-owned character rollout preparation

- Produce the proposed character-to-model assignment list and future-game preview.
- Apply live profile changes only when separately authorized, then verify future-game resolution without modifying running games.
- Exit: a reviewed assignment artifact and deterministic AC16 proof complete implementation preparation. Live application remains pending until authorized and must be reported separately; paid model-quality experiments are also optional, separately authorized work.

## Validation and documentation obligations

For future code-backed implementation, run the repository's required provider-free, PostgreSQL, and broader checks using Bun: `bun run test`, `bun run test:postgres`, and `bun run check`. Use the current classification rules and shared-database locking helpers. Add focused deterministic browser coverage for the new flows. Required CI receives no live-provider credentials.

Update `docs/reasoning-transcript-observability.md`, `docs/local-model-evaluation.md`, relevant `DEVELOPMENT.md`/`README.md` examples, and simulation JSDoc whenever decision evidence or simulation output changes. Update `CONCEPTS.md`, ops/cutover documentation, and relevant `docs/solutions/` learnings. Keep direct-House-call and no-`as any` disciplines explicit.

Report local checks, CI checks, and live/deployed evidence separately. No paid test is required merely to list an admin model or establish documented capability/cost records.

## Implementation seams to inspect

These are navigation pointers, not a claim that the October 14 implementation inventory is still complete. Reinspect owning sources at implementation time.

- Catalog/defaults: `packages/engine/src/model-catalog.ts`, `packages/engine/src/model-defaults.ts`.
- Provider transport/coordinator: `packages/engine/src/provider-adapters.ts`, `packages/engine/src/provider-execution.ts`.
- Accounting: `packages/engine/src/token-tracker.ts`, `packages/api/src/services/provider-cost-accounting.ts`.
- Discovery and authorization: `packages/api/src/routes/provider-models.ts`, existing RBAC and profile services.
- Influence execution: `packages/api/src/services/game-lifecycle.ts`.
- Werewolf execution: `packages/api/src/services/werewolf-runtime.ts`, `werewolf-games.ts`, `werewolf-lobbies.ts`.
- Journaling: `packages/api/src/services/provider-call-journal.ts` and existing durable game stores.
- Enrollment: `packages/api/src/routes/free-queue.ts`, `packages/api/src/services/daily-provider-manifest.ts`, character/profile services.
- UI: `packages/web/src/app/dashboard/agents/agent-form.tsx`, `packages/web/src/app/admin/games/new/create-game-form.tsx`.
- Simulation: `packages/engine/src/api-simulate.ts`, `packages/engine/src/werewolf/api-simulate.ts`, simulation reporting and JSDoc.
- MCP: `packages/api/src/game-mcp/agent-tool-schemas.ts` and corresponding handlers.

## Out of scope

- Subscription billing, public model rankings, automatic model optimization, and per-action model selection.
- A catalog database/admin editor, scheduled metadata synchronization, a general capability-rule language, new universal compaction infrastructure, or per-seat editable fallback chains.
- New provider integrations solely to expand the initial free set.
- Paid certification of every discovered model, unattended paid experiments, or automatic live House-profile reassignment.
- Implicit Luna Standard recovery, implicit Muse Standard substitution, or a new consent flow. Explicit admin selection of other Muse variants remains allowed.
- Image/audio/video model selection, unrelated game-rule changes, or weakening schemas to accommodate a model.

## References

- [Current agent instructions](../../AGENTS.md).
- [One game provider-manifest authority](../solutions/architecture-patterns/keep-one-game-model-selection-authority.md): retain the single-authority principle; its historical compatibility window is not a requirement to introduce new compatibility layers.
- [Storage cutover runbook](../deployment/private-payload-storage-cutover.md).
- [Local model evaluation](../local-model-evaluation.md) and [reasoning/transcript observability](../reasoning-transcript-observability.md).
- October 14, 2026 research sources: [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Meta models](https://dev.meta.ai/docs/models), [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits), [Meta strict structured output](https://dev.meta.ai/docs/structured-output), [Katana documentation](https://kat.imgnai.com/llms.txt), and [Katana model metadata](https://kat.imgnai.com/v1/models/text). Prices and capabilities must be refreshed when implementation begins; this plan does not assert a new October 23 provider audit.
