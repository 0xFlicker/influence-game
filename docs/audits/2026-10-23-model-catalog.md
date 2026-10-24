# Model catalog audit — 2026-10-23

Audited the complete current configured hosted listings, not only the curated choices: 92 OpenAI IDs, 65 Katana IDs and six Meta text IDs. Public documentation and model-list requests only; no inference requests, paid qualification or gameplay claims. Local LM Studio and the custom OpenAI-compatible endpoint were unavailable and could not be audited. Their pricing remains unknown.

## Corrections

- OpenAI: added missing family and explicitly documented snapshot prices, image-input support, Responses routing, exact-output support, reasoning restrictions and published context tiers. Fixed cached-input discounts for GPT-4.1 and o-series. Chat-branded models no longer inherit reasoning support just from a GPT-5 prefix. Only documented aliases inherit metadata.
- Katana: all 65 records now use the provider's declared tools, reasoning-effort, sampling and token-limit parameters as well as image/structured-output support. Kimi does not accept temperature; GLM Flash supports reasoning and `max_completion_tokens`; Grok multi-agent does not support tools. Removed the competing simulator price table, including its stale GLM 5.2 rate. Pricing uses precise per-token fields, not rounded display cells; retain provider minimums, rounding and prompt-based tier boundaries.
- Meta: added Spark 1.1, 1.2 and 1.2 Contributor with their published prices and capabilities. Sampling is supported. The existing dedicated Responses adapter and automatic tool-choice discipline remain in place.
- Eligibility: discovery omits documented models without exact structured response support (including old GPT-4/GPT-3.5, early GPT-4o, deep-research models, GPT-5.2/5.4 Pro, and Katana's Qwen3 Coder 480B private route). Exact-ID submission rejects those same incompatibilities. Search-only models that always perform web search are outside the game-decision adapter. Media models remain excluded. Unknown text IDs remain operator-selectable with inferred capabilities and unknown pricing.
- OpenAI documentation marks some IDs as retired even though the account's live listing still returns them. This status is retained in diagnostic metadata; it does not silently remove an operator's best-effort access. Discovery is not a successful inference test.
- Provider identity remains part of every rate lookup. For example, native OpenAI Astra and Katana Astra have distinct prices. Custom/local endpoints with the same model name do not inherit either rate.

After corrections, the current listings expose **67 OpenAI, 64 Katana and six Meta choices**, all with documented capability records and pricing. This is 137 documented choices, not 137 paid-tested models. Future discovery gaps are reported together by `bun run audit:models`; unknown facts are never filled from Luna or another provider.

## Sources and boundaries

- [OpenAI pricing](https://developers.openai.com/api/docs/pricing), plus the per-family source URLs recorded in `openai-catalog-snapshot.json`. The Markdown pricing tables include Standard and Flex separately. Low/medium/high are the application's supported reasoning controls; model-specific subsets are retained. The exact-schema boundary for early GPT-4o comes from [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search): Chat Completions search models always search before answering.
- [Katana text catalog](https://kat.imgnai.com/v1/models/text): current prices, minimums, tiers, input/output types, tool support and supported request parameters. The catalog declares structured-output support; this does not prove every schema subset or gameplay quality.
- [Meta model catalog](https://dev.meta.ai/docs/models), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), and [Responses protocol](https://dev.meta.ai/docs/protocols/responses). Contributor prices remain the approved free-tier choice.

Known limits: base UI prices are provider token estimates; tool charges, regional uplifts and account-specific contracts are not a complete invoice. Current game prompt caching uses the 30-minute write rate. The pricing page does not publish a long-context Flex rate for GPT-5.5 Pro; no Flex rate card is supplied for that model rather than applying a base-context estimate to larger requests. Priority and future OpenAI service tiers have no recorded rate card and remain unknown instead of inheriting Standard prices. Local/custom deployment costs require deployment-specific facts. No historical frozen assignments or receipts are rewritten by this audit.

## Regression coverage

The checked inventory fixture contains the provider IDs observed in this audit. Tests require every eligible ID to resolve documented facts and a price, reject known strict-output incompatibilities through exact-ID selection, preserve provider identity and unknown future IDs, and exercise cached/long-context accounting. Adapter tests cover adaptive effort on Pro models. UI tests require explicit labels and no label, placeholder or transport detail for Default.

Validation: `bun run test` passed 2,817 tests (five existing skips); `bun run test:postgres` passed 2,171 tests against a disposable local database; `bun run check` passed. The live catalog-only audit returned zero metadata gaps across the 137 selectable hosted models. Browser verification confirmed explicit model labels beside archetypes and in avatar previews, with no label for Default. No inference requests or paid tests were run.
