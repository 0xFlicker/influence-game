# Muse Ember catalog audit — 2026-11-09

Added `meta-muse:muse-ember-1.0` (Meta Muse Ember 1.0) as a free evaluation candidate, available to every user as a character model preference. No default, historical frozen route or gameplay qualification changed.

## Documented facts

Sources checked 2026-11-09:

- [Muse Ember](https://dev.meta.ai/docs/muse-ember): model ID `muse-ember-1.0`, Standard mode only (no Contributor variant), text/image/video/audio/PDF input and text output, 1,048,576-token context window, 524,288 max output tokens, Responses / Chat Completions / Messages endpoints, and the same request body as Muse Spark (including tool calling and structured output).
- [Pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits#muse-ember-pricing): up to 200K input tokens, $0.10 input / $0.004 cached input / $0.50 output per million tokens; over 200K input tokens, the whole request bills at $0.30 / $0.012 / $1.50. The tier is recorded as `minPromptTokens: 200001`, because a request over 200K bills in full at the long-context rates, not only past 200K.
- [Reasoning](https://dev.meta.ai/docs/reasoning): Meta's dial runs `minimal` to `max`; the catalog keeps the application's supported subset (`low`, `medium`, `high`) already used by the other Muse routes, sent through the existing Meta Responses adapter with strict JSON Schema.

Older Meta Muse facts keep their 2026-10-23 check date; only Ember carries the 2026-11-09 date.

## Account-access evidence and limits

A Meta-only live listing on 2026-11-09 (`providerModelInventory` restricted to the `meta-muse` profile, no inference) returned `muse-ember-1.0` as available. Before this change it resolved only as an inferred dynamic entry with no rate card; a listing proves visibility, not successful inference or game quality. No inference, paid simulation or external write was run, so Ember remains `evaluation-candidate` until separately authorized gameplay qualification.

## Coverage

Engine tests pin Ember's exact documented metadata, rates and the 200,000 / 200,001 input-token tier boundary, its free but non-game-ready status, and its strict-JSON-Schema Responses compilation. The provider-models API tests pin privileged discovery of Ember with documented evidence and its dated rate card, plus ordinary-user free availability, while non-text Meta models remain excluded.
