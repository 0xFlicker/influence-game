---
title: OpenAI Flex capacity failover inside durable logical calls
date: 2026-10-31
category: architecture-patterns
module: provider execution
problem_type: reliability_pattern
tags: [openai, flex, recovery, service-tier, provider-journal]
---

# OpenAI Flex capacity failover

Coordinated gameplay disables SDK and legacy fetch-wrapper retries. Flex capacity therefore must fail over in `provider-execution.ts`, not underneath the durable attempt boundary. Explicit hosted OpenAI 429 `flex_unavailable` / `resource_unavailable` retries the same model with `service_tier: "default"`. The installed Responses and Chat Completions SDK contracts accept `default`; unlike `auto`, it explicitly selects standard pricing/performance. See the [official Responses contract](https://developers.openai.com/api/reference/resources/responses/websocket-events#response.create) and [Flex guide](https://developers.openai.com/api/docs/guides/flex-processing).

Persist a Flex-only entry health scope, with a 5-minute default cooldown capped at 15 minutes. Subsequent calls request standard until expiry; an ordinary later call tries Flex again. Keep generic rate limits, authentication, cancellation, schema errors and context overflow distinct. Preserve schema, semantic validation, context hash, reasoning and accepted-result authority. Each network dispatch needs its own durable ordinal and full sanitized evidence. Standard attempts freeze standard pricing and retain returned actual tier; unknown tiers remain unpriced.

Do not count availability or indeterminate attempts as semantic-output exhaustion. Read accepted results before preparation. A crash between dispatch and terminalization may duplicate remote inference/billing; it cannot duplicate canonical acceptance. A known terminal Flex failure must not be redispatched after restart while its cooldown remains active.

When permitted routes cannot supply a decision, defer the same turn. API recovery waves use 1, 2, 4, 8, 16, then 30-minute delays and suspend after 24 waves. Operational blockers requiring repair suspend sooner. Never convert HTTP 429/502 into speeches, abstentions or synthetic votes. Preserve all historical events and receipts, including already completed fallback-heavy games.

Deterministic tests cover native request equivalence for player/House roles, cooldown routing/expiry, PostgreSQL restarts after Flex terminalization and standard acceptance, per-attempt evidence/rate cards, both-tier deferral and bounded suspension. No paid inference is required.
