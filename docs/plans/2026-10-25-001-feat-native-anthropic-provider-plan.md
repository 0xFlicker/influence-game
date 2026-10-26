---
title: Native Anthropic provider with API-key authentication
type: feat
status: completed
date: 2026-10-25
---

# Native Anthropic provider with API-key authentication

## Outcome and scope

Implemented locally and validated with 3,056 passing provider-free tests, 2,256
passing PostgreSQL tests, type checking and lint. The authorized localhost
evaluation completed under its $5 ceiling; the fresh six-player Haiku game cost
an estimated $0.065208 and recovered two early output failures. See the
[evaluation report](../research/2026-10-25-anthropic-native-provider/evaluation.md)
for evidence, integration findings and qualification limits. Production release
and federation remain separate follow-up work.

Add an `anthropic` provider using the official TypeScript SDK and native Messages API. Characters, House work, discovery, preflight, health probes, accounting, and durable recovery use the existing execution pipeline. Recommend Haiku 5.5 for free-account access after a bounded gameplay evaluation. Make compatible discovered Claude models available to admins/sysops under existing model-access rules.

The user chose API keys first and federation later for **both OpenAI and Anthropic**. Keys have been added to Doppler in all environments; development catalog access is verified. The user subsequently authorized implementation, Haiku 5.5 for free accounts, and localhost API evaluation under a total $5 budget. See [native provider implementation](../native-anthropic.md); production deployment remains separate.

Evidence: [research and price comparison](../research/2026-10-25-anthropic-native-provider/README.md), including live catalog snapshots and SDK 1.3.0 metadata. Existing design: [model routing](../model-routing.md), [context adaptation](../context-adaptation.md), [reasoning observability](../reasoning-transcript-observability.md). Relevant learnings: [context overflow](../solutions/runtime-errors/provider-context-overflow-adaptation.md) and [durable decision replay](../solutions/runtime-errors/influence-decision-replay-and-provider-drain.md).

## Product decisions

1. The recommended free route is `anthropic:claude-haiku-5-5`. It is $0.10/$0.50 per million input/output tokens through 100K prompt tokens and $0.50/$2.50 above that threshold. Deployment of the eventual entitlement change is the release gate; no feature flag or disabled picker option.
2. Keep existing free choices and global/default House routing unchanged. Do not replace stored Katana selections, rewrite accepted history, or silently reroute an active game. Operators can explicitly choose native routes for new games. Historical provider identities retain their provenance; this is not an obsolete-code compatibility layer.
3. Curate Haiku 5.5, Sonnet 5.5, and Opus 5.5 for discoverability. Other compatible catalog/exact IDs remain admin-selectable and are not automatically described as game-qualified. No new paid subscription tier is part of this work.
4. Standard synchronous Messages requests, global inference, five-minute prompt caching, no fast/priority/batch or provider-managed fallback. Do not assume an OpenAI Flex equivalent. Native providers remain separate catalog identities with separate prices and health.
5. Use `@anthropic-ai/sdk` **1.3.0** as the researched baseline and API **2026-10-21**; install with Bun and review any newer version before updating the plan. Do not force the old API version merely to retain temperature controls. [API migration](https://platform.claude.com/docs/en/api/migration-2026-10-21)

## Architecture and implementation sequence

### 1. Add the native client at the existing provider boundary

Affected files: `packages/engine/package.json`, `bun.lock`, `packages/engine/src/llm-client.ts`, `model-catalog.ts`, `model-invocation.ts`, `provider-adapters.ts`, and a focused `anthropic-provider-adapter.ts` module.

- Add the provider profile and read `ANTHROPIC_API_KEY` server-side. Support `ANTHROPIC_WORKSPACE_ID` only when needed for a key that is not workspace-scoped. Use the official Anthropic endpoint; do not inherit `OPENAI_BASE_URL` or custom/local-provider environment values.
- Construct the native SDK client once per provider runtime group with explicit credentials, `maxRetries: 0`, cancellation/deadline handling, and `createProviderEvidenceFetch`. Do not enable SDK debug logging or browser use. Register the actual credential value with the sanitizer so reflections in error bodies are redacted too.
- Remove the assumption that every `LlmClientConfig.client`/adapter factory argument is OpenAI. Use a discriminated native-client configuration at this boundary; construct each adapter in its correctly narrowed branch. Keep SDK types out of game/House invocations. Update every affected consumer rather than casting Anthropic as OpenAI or using `as any`.
- Keep model listing/retrieval behind narrow provider operations where consumers only need model metadata. SDK-specific code belongs in the provider boundary; a new general plugin framework is unnecessary.
- Missing configuration remains a typed unavailable provider and follows current manifest policy. Configuration detection should have one owning helper shared by discovery and startup, rather than another Anthropic-only boolean scattered through the API.

### 2. Compile native requests and preserve exact contracts

Implement the existing `LlmProviderAdapter` methods with transport `anthropic.messages`.

- Compile system/developer instructions into the top-level system blocks in their original instruction order, including retry guidance. Preserve user/assistant ordering and text/image content; do not promote contestant dialogue to system authority. Audit non-leading system messages and document the adapter's semantics before supporting them.
- Translate trusted user images using native URL/base64 image blocks, preserving the existing authorization/access boundary. Do not add arbitrary remote fetches or persistent inline media storage. Resolve remote URL lifetime before dispatch and preserve existing private evidence rules.
- Do not configure a tool runner or Anthropic server tools for decision calls. The required answer is exact JSON text. If existing invocation inputs contain tool-call/result history, support a lossless native mapping only where used and tested; unsupported shapes must fail compatibility before dispatch rather than dropping content or inventing IDs.
- Send `output_config.format = { type: "json_schema", schema: ... }` for every structured invocation. Audit the registered contestant, Werewolf, House, retrospective, compaction, and profile-generation artifacts. Record incompatible keywords and coverage in a checked test fixture.
- This audit has concrete starting cases: `werewolf/agent.ts` has nonempty strings and the 1–100 discussion-priority integer; `agent.ts` has an exact-count target array. Confirm which schemas are actually dispatched for each frozen rules version. Start with equivalent bounded-integer enums and supported string patterns, verified against the original validator. Exact-count arrays and other unsupported shapes require an explicit contract decision before declaring the affected surface supported; do not promise universal compatibility from the catalog response.
- Preserve required fields, legal enums, nullability, object closure, and original semantic validation. Use an existing equivalent nullable-enum transform if applicable. Finite bounded integers may become exact enums where equivalent. Do not invoke helpers that silently discard numeric, string, or collection constraints. If an artifact cannot be represented exactly, resolve its contract explicitly or report that surface as incompatible; advertised model support alone is insufficient to enable it.
- Decode through the existing exact registry inside the provider attempt. Keep current complete-document unwrapping behavior; no syntax repair, case folding, coercion, missing-field invention, or permissive tool/prose fallback. Add native contract tests before claiming full game compatibility. [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- Omit sampling controls on this API version even if a caller supplies its usual temperature. Model facts must report the actual native transport capability. Preserve the requested/final request in private evidence so this is inspectable.

### 3. Map reasoning, output allowance, and terminal states

- For adaptive-capable models, compile the frozen low/medium/high policy into `output_config.effort` and explicit adaptive thinking. Request the available summarized display for observability. Do not expand the product's effort enum to xhigh/max merely because the API supports them.
- Legacy Haiku 4.5 has no effort control. Default its native route to thinking disabled for the initial comparison; do not pretend low/medium/high is a supported native effort. Opus 4.5 may use its documented manual thinking configuration if that route is implemented and tested; otherwise expose the concrete unsupported combination. No guessed generic mapping between effort and manual token budgets.
- Treat `outputTokenLimit` as total generated output, including native thinking. Audit existing small 512/1024-token House/compaction calls. Initially keep their total caps explicit; if insufficient, change the owning allowance and its budget accounting in the same patch. Never silently increase the adapter limit after spend reservation. A truncation retry that increases allowance must be durable, bounded, and reserved before dispatch.
- Preserve native response blocks, thinking summaries, signatures, redacted payloads, response ID, and request ID in existing private evidence. Surface permitted native summaries through existing `reasoningContext`; never substitute them for the authored character `thinking` JSON field. Do not fabricate missing reasoning counts or replay encrypted reasoning across providers/accounts.
- Audit authored-thinking field descriptions alongside `thinking-guidance.ts`: describe a brief fictional character intention/explanation, not extraction of the provider's private reasoning. Preserve the product field and its visibility. Refusals remain typed failures; do not bypass them by reinterpreting refusal text or native thinking as character speech.
- `end_turn` with valid output can proceed to exact validation. Refusal, truncation, empty text, unsolicited tools, and unsupported terminal states cannot masquerade as accepted decisions. Classify native `max_tokens` as incomplete output, and `model_context_window_exceeded` or genuine context-limit errors as context overflow under the existing adaptation path. Preserve billable usage on these failures. [Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- Map authentication, access, unknown model, schema/configuration, throttling, billing/spend cap, timeout, cancellation, and overload distinctly. Honor `Retry-After` in existing durable cooldowns. Do not retry permanent quota/billing problems as ordinary 429 throttling forever; inspect documented error type/body. Keep 529 and transient 5xx retryable under existing bounds. [Errors](https://platform.claude.com/docs/en/api/errors), [rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- All accepted results still pass the same journal, owner-epoch fences, atomic turn commit, and recovery. Large valid contexts continue using supported adaptation; neither Haiku's 100K pricing boundary nor an estimated context size is a game failure condition.

### 4. Add catalog discovery, pricing, and entitlements

Affected files: `model-catalog.ts`, `provider-model-facts.ts`, a new `anthropic-catalog-snapshot.json`, `model-route-metadata.ts`, `game-model-routing.ts`, `packages/api/src/routes/provider-models.ts`, `services/game-lifecycle.ts`, provider health probes, and the catalog audit script.

- Seed the audited facts snapshot from the saved 13-model response plus explicitly sourced rate cards. Preserve checked date, API version, limits, supported thinking modes/efforts, lifecycle, and unknown values. Do not infer support from a name prefix or an unrelated provider's entry.
- Freeze the Anthropic request controls needed for replay alongside existing route capabilities, including supported thinking mode and native API version; do not look up mutable discovery metadata while resuming a sealed game. Add only the specific fields the adapter needs, rather than a free-form provider-options bag.
- Use the SDK's paginated models API to exhaustion. Discovery proves advertised access; a model listed in development is not automatically available in staging/production. Retrieve exact IDs for preflight, and retain partial/unavailable discovery semantics without erasing frozen routes. [Models API](https://platform.claude.com/docs/en/api/models/list)
- Keep native metadata provider-qualified. Canonical dated IDs returned for Haiku/Opus 4.5 must not be guessed from Katana spellings. Resolve documented aliases deliberately and seal the concrete identity before execution.
- Add Haiku 5.5 to the free allowlist only in the release that includes its validation evidence. Enforce it through the existing API/MCP/profile/enrollment checks. Reuse current picker/pricing components; verify admin and free-user behavior without introducing a separate Anthropic UI.
- Compatibility is the intersection of model capabilities, implemented adapter surfaces, exact schema, and requested input. Do not conflate price, discovery status, or a failed transient probe with permanent incompatibility.

### 5. Account for native usage and caching correctly

Affected files: `provider-execution.ts`, `token-tracker.ts`, `provider-model-facts.ts`, `local-task-budget.ts`, API cost-accounting services/tests, and adapter normalization.

- Normalize `promptTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; `cachedTokens = cache_read_input_tokens`; `cacheWriteTokens = cache_creation_input_tokens`; `completionTokens = output_tokens`; `reasoningTokens = output_tokens_details.thinking_tokens` when supplied; `totalTokens = promptTokens + completionTokens`. Reasoning is already included in output and must not be charged twice. Missing breakdown remains unknown in receipts.
- Capture usage before response decoding so malformed output/refusals can still be charged. Native dollar amounts are estimates from frozen rates unless the provider actually returns a cost. Do not label calculated prices `provider_actual`.
- Haiku 5.5 uses the existing per-call prompt tier mechanism with `minPromptTokens: 100001`; cached and newly cached input count toward the threshold. Apply the selected rate to every category in that call. Never select a tier from summed episode usage or include output tokens in the input threshold. Store the selected/frozen rates with receipts.
- Start with a provider-owned five-minute cache policy for invocations requesting caching. Use native automatic caching where appropriate and measure whether changing schemas/system instructions prevents reuse. The OpenAI `promptCache.key`/`ttl: "30m"` fields must not be forwarded as Anthropic parameters. Document this provider mapping explicitly; do not cache unrequested contexts or add cache prewarm calls.
- Five-minute writes fit the existing single write-rate field. One-hour/mixed-TTL writes are outside this first release. If a response unexpectedly reports one-hour writes, retain its native usage and mark that cost estimate unsupported unless an explicit second write counter/rate is implemented; never knowingly apply the five-minute price. [Caching semantics](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Add Anthropic USD to the local evaluation spend limiter and reserve using the applicable prompt tier, actual compiled output cap, and cache-write allowance. Preserve stop-on-evidence-persistence-failure behavior. Exclude server tools, fast mode, priority, and batch so no unpriced feature can be dispatched accidentally.
- Remove ambiguous bare-model-ID price lookup from any affected direct-vs-Katana accounting path. The same textual model ID can exist at different provider prices; route receipts remain authoritative.

### 6. Validate, document, and release

Provider-free coverage:

- Native request compilation for system instructions, private/public messages, trusted images, exact response schema, explicit effort, sampling omission, and configured cache behavior.
- Every supported artifact compiles without weakening its contract; invalid/ambiguous JSON, `{}`, missing/extra fields, wrong enum case/identity, refusals, truncation, unexpected blocks, and exhausted retries never mutate continuity.
- Successful reasoning/usage normalization, missing breakdown, signatures/redacted blocks retained privately, malformed native responses with usage, and credential reflection redaction.
- Exactly one network dispatch per journal attempt; SDK retries disabled; timeouts/abort and 429/529 behavior; context-overflow adaptation retains required facts and canonical fields.
- Pagination, exact IDs, absent credentials, partial catalog failure, free/admin access, and frozen route metadata across refresh.
- Cost boundaries at 99,999, 100,000, and 100,001 input tokens, including cached input; reasoning is not double-billed; aggregate usage does not trigger request tiers; provider prices never collide.

PostgreSQL/API coverage, sequential with `setupTestDB()`:

- Native provider selection through API and MCP, ownership/entitlements, visual input eligibility, House/contestant routing, permitted fallback, provider health, per-attempt cost receipts, private evidence references, and accepted-value restart replay with no second dispatch.
- Preserve storage authority: no new body columns; raw requests/responses and native reasoning remain in private buckets via existing writers, integrity checks, and recovery paths.

Run the required implementation checks: `bun run test`, `bun run test:postgres` (elevated access if sandbox blocks local DB), and `bun run check`. Use focused tests while iterating; no concurrent processes against the shared database.

The user selected six-player Werewolf for the authorized **$5 total ceiling**.
The implementation evaluation uses all-Haiku 5.5 contestants and House, low
effort, no audio or vision, with a fresh two-day smoke run after integration
repairs. Save API game IDs, replay, full sanitized attempts, authored thinking,
native summaries/signatures, usage, retries, refusals, and latency. Influence,
medium effort, other Claude models and comparative rankings remain untested.
See [evaluation evidence](../research/2026-10-25-anthropic-native-provider/evaluation.md).

Evaluate completed-game cost, schema/length retries, fallback rate, context fidelity, commitment recall, strategic choices, speech quality, and latency. Keep the House route explicit so its cost does not get attributed to the contestant candidate. Do not publish free access based only on catalog flags or synthetic price arithmetic.

Update `docs/model-routing.md`, `docs/reasoning-transcript-observability.md`, `docs/local-model-evaluation.md`, relevant `DEVELOPMENT.md`/`README.md` examples, and `simulate.ts` JSDoc. Keep no-`as any` and direct-House-call guidance visible. Add a focused `docs/solutions/` entry for actual integration findings and `CONCEPTS.md` definitions only if new shared terms are introduced.

For release, verify Doppler-to-runtime injection for API/game workers in each environment without printing keys. Existing keys in Doppler do not prove the running containers received them. Keep secrets out of web/build/CI test environments and scope renderer credentials to actual consumers. Use staging QA, then the existing approved production promotion. No production migration is expected for the core adapter; if accounting changes need one, inventory it explicitly before implementation.

## Deferred federation extension

After API-key support works, choose a runtime workload-identity issuer for the Linode/Docker environment. Reuse that issuer for separate OpenAI and Anthropic trust rules/service accounts. The existing GitHub Actions identity is not renewable runtime identity for deployed containers.

Keep authentication resolved only at SDK construction; game manifests and evidence never contain access tokens. Later use each provider's supported credential exchange/refresh facilities behind this boundary, with separate environment identities and scopes. Validate refresh, restart, concurrent exchanges, revocation, and upstream issuer failure for both providers. Revisit SDK versions and auth precedence then. Do not create a generic credential broker, homegrown OIDC server, dormant feature flag, or federation implementation in this API-key change.

## Remaining implementation questions

- Exact native-schema coverage across all current artifacts must be demonstrated, especially constrained arrays/strings/numbers. A model capability flag does not answer this.
- Small output caps may need deliberate increases for adaptive thinking. Choose caps from bounded evidence and reserve them correctly; do not copy another provider's arbitrary floor.
- Low effort is the initial free-account policy. The Werewolf smoke evidence
  supports initial availability; it does not establish medium-effort quality,
  all-format reliability, or a model ranking.
- Staging/production keys, workspace selection, rate limits, and runtime injection need environment-specific checks during release. Development model access is the only authenticated evidence from this research.
