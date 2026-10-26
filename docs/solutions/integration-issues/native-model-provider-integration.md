---
title: Integrate a native model provider without bypassing durable game execution
module: Provider execution
date: 2026-10-26
problem_type: integration_issue
tags: [provider-integration, anthropic, structured-output, accounting, model-routing, evaluation]
---

# Integrating a native model provider

## Context and evidence

[PR #222](https://github.com/0xFlicker/influence-game/pull/222) added native
Anthropic support, then added a separate cutover for existing Claude choices.
The implementation exposed failures that a successful model listing or mocked
SDK response could not reveal: native grammar rejection, service-tier pricing
normalization, and unchanged stored routes despite a new provider catalog.

These lessons come from the merged implementation and its
[retained localhost evaluation](../../research/2026-10-25-anthropic-native-provider/evaluation.md).
They describe the October 2026 integration, not a fresh audit of provider prices,
SDK versions, or capabilities. Consult current provider documentation when adding
another provider, and record the source and audit date with its facts.

## Establish the provider contract before enabling routes

Treat discovery, documented capability, adapter support, and gameplay qualification
as separate evidence. Listing a model proves account visibility; it does not prove
that the model accepts the game's exact schemas or plays a coherent game.

Use authenticated, paginated discovery without making inference calls. Save
sanitized catalog metadata separately from documented prices. Audit the SDK's
actual types and API version, including message roles, image inputs, thinking
modes, output limits, caching, stop reasons, and error envelopes. A provider's
advertised tool support does not imply that this decision adapter accepts tool
history: the Anthropic adapter explicitly rejects it and assistant prefilling.

Centralize audited model facts in
[provider-model-facts.ts](../../../packages/engine/src/provider-model-facts.ts)
so catalog resolution and cost accounting agree. Freeze native capabilities and
reasoning policy with each game route; recovery must not reinterpret an old
game using today's model discovery. Unknown native model IDs require an audit
before routing, even if discovery returns them.

## Keep transport inside the shared execution boundary

Construct the native SDK in
[llm-client.ts](../../../packages/engine/src/llm-client.ts), with explicit
credentials, endpoint and API version. Test that unrelated OpenAI-compatible
environment variables cannot redirect it. Disable SDK retries and logging;
forward cancellation and attempt deadlines, and use the credential-sanitizing
evidence transport. Configure both gateway and game worker, including the budget
ledger used for local paid work.

Implement the existing adapter contract: validate compatibility, compile the
native request, dispatch, and classify the outcome. The shared coordinator owns
attempt ordinals, retries, fallback budgets, context adaptation, semantic
acceptance, and recovery. Player and House calls must use that same path; no
direct House-call bypasses or `as any` shortcuts. The
[Anthropic adapter](../../../packages/engine/src/anthropic-provider-adapter.ts)
is a concrete example, not a reason to duplicate its native controls for a
different provider.

HTTP success is not decision success. Refusal, truncation, unexpected blocks,
empty output, malformed JSON and schema violations need typed outcomes before
canonical acceptance. Preserve the original sanitized response and available
usage even when decoding fails. Genuine context overflow must invoke supported
context adaptation or routing; never fail a valid game solely because of an
estimated input size, or endlessly retry the same oversized prompt.

## Exercise actual provider-visible schemas

Audit the exact schemas produced at real call sites, including House calls,
retrospectives and context summaries. Distinguish provider schemas from schemas
used only to validate accepted domain values. During review, a suspected
`uniqueItems` incompatibility was withdrawn after tracing it to the latter;
keyword search alone did not establish a dispatch failure.

Native strict JSON support is a subset, not a promise to accept arbitrary JSON
Schema. Preserve the contract with explicit reversible encodings where possible:
validate the wire value, decode the declared representation, validate the original
schema, then run the owning semantic validator. Reject unsupported transformations
clearly. Do not strip constraints, repair malformed JSON, invent required fields,
or reinterpret prose as decisions. See the focused
[schema encoding lesson](../runtime-errors/anthropic-exact-schema-wire-encoding.md)
for the nullable, bounded-collection and grammar-complexity failures found live.

## Normalize accounting before accepting success or failure

Capture usage before parsing the decision. For this native API, prompt tokens
include uncached input, cache reads and cache writes; output already includes
thinking. Count each once. Select long-context pricing per request, including
cached input, rather than from episode totals.

Normalize native request labels to the supported frozen rate card explicitly.
The initial `standard_only` mismatch produced unpriced receipts even when usage
was present. Unknown speed, region, cache duration or service tier must remain
unpriced instead of borrowing a familiar rate. Test exact tier boundaries,
cache accounting, billable failed responses, and unknown tiers. Preserve old
receipts after fixing accounting; publish a separate audit estimate rather than
rewriting historical evidence.

Budget every paid path, including provider-health probes. Reserve before dispatch
and settle only after private evidence is durable. Retain conservative holds
when usage is unknown; never reset the ledger to make another run affordable.
Distinguish estimated charges, conservative reservations and actual invoices.
In this evaluation, the retained ledger total was much larger than known-usage
game estimates; that difference was not evidence of an accounting overcharge.

## Make adoption explicit and preserve frozen authority

Adding native catalog entries does not prefer them over stored provider-qualified
selections. Decide separately whether the change adds an option, changes a
default, replaces a transport, or upgrades a model generation. Confirm the exact
replacement mapping before migrating; much of this integration's expected saving
came from a generation upgrade, not just removing an intermediary.

When a forced switch is required, migrate mutable preferences and unsealed waiting
games and prevent new selections from recreating obsolete routes. Cover profile
preferences, both games' seats, House and contestant manifests, overrides,
exclusions, and older selection fields. Handle duplicate routes and exclusion
collisions without increasing fallback budgets. Keep historical catalog lookup,
frozen runtimes, accepted events and provider receipts unchanged. The
[cutover lesson](claude-provider-cutover-preserves-frozen-games.md) records the
specific migration and its regression coverage. Deploy credentials and adapter
code together through the coordinated release, draining old writers before
cutover.

## Qualify the complete path and state its limits

Start with provider-free transport/decoder tests and PostgreSQL tests for durable
failure evidence, pricing and routing changes. Cover malformed and ambiguous
documents, missing/extra fields, exhausted retries, cancellation, and frozen
route recovery. Test migration idempotence and unchanged historical records.

Paid evaluation requires explicit authorization and runs over the durable
localhost API. Create a waiting lobby, authorize its game ID in the ledger,
freeze contestant and House routes, then start. Retain accepted decisions,
authored thinking, available native reasoning, every sanitized attempt, usage,
retries and failures in the existing private object-storage boundary. Do not
continue spending after evidence persistence fails or overwrite diagnostic runs
with the later clean run.

Run a fresh smoke after fixing integration failures. Recovery runs prove recovery;
fallback-heavy conversations are poor model-quality evidence. The fresh Haiku
run completed, but its first discussion was all passes and later speech was
repetitive. Completion and low estimated cost therefore did not establish a
quality ranking. Record model, effort, game, player count and enabled surfaces;
do not extend that result to Influence, other models, vision, caching, or forced
compaction when those were not exercised.

Keep local and CI results distinct. This review's local render-proof teardown
timeout reproduced on the original PR revision while its assertions and the
required CI shards passed. Record that distinction rather than attributing every
suite failure to the new provider or claiming every local check passed.
