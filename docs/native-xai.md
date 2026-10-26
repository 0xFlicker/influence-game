# Native xAI

The `xai` provider uses the existing OpenAI TypeScript SDK against
`https://api.x.ai/v1/responses`, with `XAI_API_KEY` supplied to both API gateway
and game worker. The same secret name is already used by image and audio work.
OpenAI/custom endpoint environment variables cannot redirect this client. SDK
retries are disabled; the shared execution coordinator owns attempts, deadlines,
semantic validation, context adaptation, recovery and private evidence.

## Same-generation cutover

| Old selection | Native selection |
|---|---|
| `katana:grok-4-6` | `xai:grok-4.6` |
| `katana:grok-4-5` | `xai:grok-4.5` |
| `katana:grok-4-3` | `xai:grok-4.3` |
| `katana:grok-4-20-multi-agent` | `xai:grok-4.20-multi-agent-0309` |

The multi-agent native dated ID is the documented target of the
`grok-4.20-multi-agent` alias. This is not an upgrade to Grok 4.7. Migration
0141 rewrites profile preferences and unsealed waiting-game preferences/configs,
including both games' seats, House/default manifests, overrides and exclusions.
Duplicate routes retain the first entry and its budget. Explicit choices win
when old/native exclusions collide. Unmapped Katana Grok selections abort the
transaction with their ID so operators can audit them before cutover.

Sealed waiting, running, suspended and completed games retain their actual
routes, seats, accepted events, private objects and receipts. Historical catalog
lookup and Katana execution remain available for recovery, but new writes and
picker discovery cannot recreate Katana Grok selections. The shared new-game
fallback is now native Grok 4.6 with the same 24-call allowance. Free-account
model entitlements are unchanged; explicit Grok preferences require admin/sysop.

## Native contract

Responses requests preserve message ordering and roles, send the original exact
schema in `text.format`, and use the frozen low/medium/high effort. They request
available encrypted reasoning with `include`, disable provider response storage,
and never rely on `previous_response_id`. No search/server tools, tool history,
OpenAI Flex, summary controls or cache-retention options are sent. Native opaque
reasoning stays in private response evidence; it is not exposed as authored
thinking or automatically injected into another decision's context. No direct
House-call bypasses or `as any` shortcuts.

The shared exact decoder validates the provider schema and owning semantic
contract inside the attempt. Complete wrapped JSON may be unwrapped; broken or
ambiguous JSON, missing/extra fields and illegal decisions are never repaired.
xAI's documented schema subset includes best-effort constraints: local validation
remains mandatory. Grok 4.3 passed the Werewolf run below; other models and
Influence-specific schemas still need live qualification. Context
overflow uses shared adaptation rather than size-only game failure.

Native Responses output usage includes reasoning tokens. Count output once.
`usage.cost_in_usd_ticks` is authoritative billed cost: 10^10 ticks per USD,
10^4 per micro-USD. Preserve original ticks and private response; accounting
projects rounded micro-USD. Capture billing even for HTTP-200 terminal failures.
Absent actual billing, freeze provider-qualified global/default prices with the
attempt. Unknown service tiers are unpriced. The >=200K input-token tier applies
to the entire request, including cached input. Do not rewrite historical receipts.

## Validation and release

Read-only authenticated development discovery on 2026-10-26 returned all four
target IDs. A subsequent native Grok 4.3 localhost Werewolf run completed:

- Game `zen-blue-crane` (`52aa63e0-6d1f-4ed0-b879-59eb0feea41c`), six players,
  one-wolf preset, low reasoning, ten-day maximum.
- Village victory on day two; all six retrospective statements completed.
- 51 provider attempts, all usable, with every completed attempt's private
  evidence stored. Actual LLM charges, including retrospective: **$0.393445**.
- 266,202 input tokens (10,368 cached); 28,632 output tokens including 25,095
  reasoning tokens. Do not add reasoning tokens to output again.
- [Run report](reviews/2026-10-26-native-xai-werewolf.md) records the command,
  local replay and retained evidence locations.

This proves one native Werewolf run, not broad strategic quality or all-model
qualification. Catalog entries remain evaluation candidates pending broader
coverage. Katana gameplay results do not qualify this transport. Provider-free tests cover
requests, accounting, malformed decisions and old-route recovery; PostgreSQL
tests exercise migration, discovery and spend recording.

Paid evaluation requires authorization and runs over the localhost API.
The API CLI accepts `--provider xai --model grok-4.3`. A dollar ceiling is optional;
do not invent one when the user simply authorizes a game. The successful run
used the ordinary API path with no budget guard configured and recorded actual spend.
**When a hard budget is requested or configured, current budget guards reject
native xAI**: documented `max_output_tokens` caps visible output rather than
billable reasoning, so output-cap reservations cannot guarantee that ceiling.
Verify a provider-enforced total spending/token bound before enabling hard-budget
runs; never silently remove an existing guard. Retain every game ID and sanitized
attempt, and stop additional spending if evidence persistence fails.

For each environment: inventory mutable Grok IDs, audit any unmapped ID, verify
gateway/worker key availability and model access, then drain old writers and
apply the coordinated code/migration release. Check migrated counts and frozen
history, verify picker/API/MCP selection and game-start behavior, and resume.
Staging precedes production; production needs its normal manual approval. Roll
forward on a cutover defect: old code cannot execute newly sealed xAI games.
Do not reverse frozen routes or delete evidence as a rollback mechanism.

Sources audited 2026-10-26:
- [Models](https://docs.x.ai/developers/models)
- [Multi-agent model and aliases](https://docs.x.ai/developers/models/grok-4.20-multi-agent-0309)
- [Responses migration](https://docs.x.ai/developers/model-capabilities/text/comparison)
- [Structured output subset](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)
- [Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [Output cap semantics](https://docs.x.ai/developers/model-capabilities/text/best-practices)
- [Pricing](https://docs.x.ai/developers/pricing)
- [Actual cost ticks](https://docs.x.ai/developers/cost-tracking)

Applied learnings: [native provider integration](solutions/integration-issues/native-model-provider-integration.md),
[frozen-game cutover](solutions/integration-issues/claude-provider-cutover-preserves-frozen-games.md),
and [context adaptation](solutions/runtime-errors/provider-context-overflow-adaptation.md).
