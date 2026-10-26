---
title: Preserve model generations and billed costs in the native xAI cutover
module: Provider execution
date: 2026-10-26
problem_type: integration_issue
tags: [xai, grok, provider-integration, migration, accounting, frozen-games]
---

# Native xAI cutover

Native xAI is a distinct `xai.responses` route using the existing OpenAI SDK.
It must not inherit hosted OpenAI Flex, cache controls, reasoning summaries or
endpoint overrides. The model names differ: Katana `grok-4-6` maps to native
`grok-4.6`; the multi-agent equivalent is `grok-4.20-multi-agent-0309`.
Keep an explicit mapping and reject unknown Katana Grok IDs during cutover;
punctuation replacement or a blanket newest-model upgrade is not equivalent.

Migration 0141 changes mutable profiles and unsealed waiting games only,
including seats, House/default manifests, overrides and exclusions. Preserve
sealed snapshots and receipt provenance. Remove obsolete new selections from
API/MCP validation and discovery while retaining historical execution. Update
the shared default fallback too; migrating existing data alone leaves new
games trying to recreate the old route. Tests for new writes must move to the
native IDs; historical journal and accounting fixtures must keep Katana IDs.

xAI exposes actual billed `cost_in_usd_ticks`: divide by 10,000 for micro-USD,
retaining exact original ticks in native-unit metadata/private evidence. Responses
output tokens already include reasoning. Capture these facts before decoding
and on terminal failures, with idempotent spend projection. Unknown service
tiers must not borrow a frozen default estimate.

The visible-output limit does not bound billable reasoning. Do not copy an
OpenAI-style output-cap reservation into a hard-budget xAI evaluation. The
current local guards reject xAI pending a verified total bound when those guards
are configured. A user-authorized game without a requested dollar ceiling can
use the ordinary API path and report actual spend; do not impose an unsolicited
cap or silently disable an existing one. Catalog discovery alone is not gameplay
qualification.

The subsequent [six-player Grok 4.3 localhost run](../../reviews/2026-10-26-native-xai-werewolf.md)
completed with a day-two village victory and all six retrospective statements.
All 51 attempts were usable and retained private evidence; actual LLM spend was
$0.393445. This proves the native Werewolf path for that model and low effort,
not every model, Influence schema, or strategic-quality target.

See [native xAI](../../native-xai.md) for audited sources and deployment steps,
and [native provider integration](native-model-provider-integration.md) for the
Anthropic lessons applied here. Provider-free and PostgreSQL tests prove local
contracts, not hosted schema acceptance or gameplay quality.
