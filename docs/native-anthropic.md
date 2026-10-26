# Native Anthropic

The `anthropic` provider uses `@anthropic-ai/sdk` 1.3.0 and the native Messages API,
version `2026-10-21`. Set `ANTHROPIC_API_KEY` in the API gateway and game worker
environment; `ANTHROPIC_WORKSPACE_ID` is optional. OpenAI-compatible endpoint
variables do not redirect this client. Doppler remains the secret source.
Federation is deferred for both Anthropic and OpenAI.

Select `anthropic:claude-haiku-5-5` for a character, cast override, contestant
manifest, or House manifest. Haiku 5.5 joins the existing free-account choices.
The global default remains unchanged. Current Claude selections use native
Haiku 5.5, Sonnet 5.5, Opus 5.5, or Fable 5.1; older native and Katana Claude
routes are unavailable for new selections. Historical catalog entries remain
readable for frozen games and accounting. Newly discovered IDs require an
audited facts entry before native routing. Discovery paginates but makes no
inference requests. See [catalog research](research/2026-10-25-anthropic-native-provider/README.md).

## Request and evidence contract

- The existing provider coordinator owns retries, cancellation, semantic
  validation, durable acceptance, context adaptation, and private bucket evidence.
  SDK automatic retries are disabled. No direct House calls or `as any` shortcuts.
- System/developer instructions become native `system`; user/assistant turns and
  supported images retain their roles. Tool history and assistant prefilling are
  rejected by this decision adapter. No temperature, top-p, or top-k is sent.
- Adaptive models use the frozen effort and request available summarized thinking.
  Models without adaptive support use disabled thinking and action policy. The
  owning invocation's output cap includes reasoning; the adapter never increases it.
- Native structured output uses `output_config.format`. Nullable nonempty text
  uses an empty wire string for null; nullable enums use exact string choices
  with the same explicit null encoding. Bounded integers become exact enums; bounded collections become
  closed objects with numbered item properties and decode back to ordered arrays.
  Unit coordinates have an explicit decimal-string wire encoding. String length
  constraints become patterns. Unsupported transformations fail closed. The wire
  value and original schema are both validated before semantic acceptance.
- Never repair JSON, change enum casing, invent fields, or accept native thinking
  as a game decision. HTTP 200 refusal, truncation, malformed output, and native
  context overflow remain typed outcomes. Schema/request configuration failures
  enter provider-health recovery, rather than being disguised as valid choices.
- Requested `thinking` means a short fictional character explanation. Native
  summaries, signatures and redacted thinking remain private provider evidence;
  they never enter another contestant's observation or public exports.

## Accounting and evaluation

Haiku 5.5 Standard costs $0.10/$0.50 per million input/output tokens through
100,000 prompt tokens, and $0.50/$2.50 above that threshold. All input, including
cache reads and writes, selects the tier for the entire request. Five-minute
cache writes cost 1.25 times input; cache reads cost 0.1 times input. These are
documented estimates, never provider-reported actual charges.

Usage normalizes uncached input + cache reads + cache writes into `promptTokens`.
Output already includes thinking, so it is charged once. The native
`standard_only` request freezes a Standard rate card before dispatch. Unexpected
Fast, region, or one-hour-cache receipts remain unpriced. Caching, when requested
by the caller, uses five minutes; OpenAI's 30-minute setting is not forwarded.

For paid local work use the localhost API and retain the game ID. Set
`INFLUENCE_LOCAL_TASK_BUDGET` to the same private ledger on gateway and worker.
The ledger has an `anthropicUsd` allowance, explicit `allowedGameIds`, and zero
allowances for unauthorized providers. Create a waiting lobby, register its ID,
freeze all contestant and House routes, then start it. Local health probes also
require their `provider-health:<scopeKey>` identity in the ledger and settle only
after their private evidence is durable.

Reservations use twice the highest documented input/cache-write and output tier,
plus request-framing allowance. Missing usage retains the full reservation.
Therefore the ledger's held amount deliberately exceeds estimated billed spend.
Never reset it or release uncertain holds to fit another run into the budget.
See [local evaluation](local-model-evaluation.md) and
[reasoning observability](reasoning-transcript-observability.md).

The [localhost evaluation report](research/2026-10-25-anthropic-native-provider/evaluation.md)
records the completed six-player Werewolf smoke, recovery runs, exact game IDs,
costs, evidence locations and remaining qualification limits. Haiku 5.5 is marked
game-ready for initial availability; the other audited Claude models remain
evaluation candidates.

## Deployment

Deploy the engine dependency and API/worker changes together using the normal
coordinated release and drain old writers before cutover. Confirm the gateway
and worker runtime environments both receive the Doppler key before applying
migration `0140_native_claude_selections`. It upgrades character preferences and
unsealed waiting-game selections (including House routes, overrides, exclusions,
and both games’ enrollment snapshots) within each Claude family. When multiple
versions collapse to one route, the first entry and its reasoning/budget win;
removed fallback entries do not add allowance to the retained route. Started,
suspended, completed, and already-sealed games retain their actual routes.
Exclusions also follow the family upgrade. If a selected and excluded version
collapse to the same family, the explicit selection wins and the conflicting
exclusion is removed so the waiting game can still start. No issuer registration, new bucket, or feature flag is required. The SDK was installed with a package-specific command-line
release-age override after inspecting its archive and integrity; the repository's
seven-day dependency waiting period remains configured for ordinary installs.
