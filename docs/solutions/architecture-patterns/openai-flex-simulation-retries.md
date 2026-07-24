---
title: OpenAI Flex Simulation Retries
date: 2026-07-24
category: architecture-patterns
module: engine simulation OpenAI transport
problem_type: reliability_pattern
component: service_object
severity: medium
applies_when:
  - adding a lower-priority OpenAI simulation run
  - handling Flex resource-unavailable responses
  - modifying simulator provider request transport
tags: [openai, flex, simulations, retries, service-tier, rate-limits]
related_components: [simulation-runner, llm-client, local-model-evaluation]
---

# OpenAI Flex Simulation Retries

## Guidance

`--flex` is a hosted-OpenAI simulation option, not a generic OpenAI-compatible
provider option. Inject `service_tier: "flex"` only into Responses and Chat
Completions POST bodies for the hosted provider.

Treat Flex 429 resource-unavailable responses as expected: retry three times
with bounded exponential backoff, honoring `Retry-After` only up to the same
30-second maximum. The next attempt uses `service_tier: "auto"` for that
request only; later simulation calls begin by probing Flex again. An auto-tier
429 is returned to the normal caller retry policy rather than looping inside
the Flex wrapper.

When rewriting a request body, remove the inherited `content-length` header so
the fetch implementation calculates the new length. Backoff must observe the
request AbortSignal, otherwise a configured request timeout cannot interrupt a
pending retry sleep.

## Cost accounting

Record the effective `service_tier` returned by each successful OpenAI response
beside its usage counters. A Flex batch summary reports its tier-aware estimated
spend: Flex rows use the Flex/Batch rate card; auto/default fallback rows use
the standard rate card and remain visible rather than being normalized away.
Resource-unavailable 429 attempts have no usage or cost. The single comparison
table retains the familiar OpenAI and Grok rows: Flex-supported OpenAI models
use Flex rates, while unsupported OpenAI models and Grok retain standard rates.
This is a rate-card estimate, not an invoice; returned tiers without a
configured rate must be left unpriced and called out in the summary.
