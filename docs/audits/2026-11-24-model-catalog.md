# Native provider catalog refresh, November 24, 2026

The development accounts returned model listings for all four providers. The native catalog adds the following evaluation candidates, with documented image input, strict structured output and Standard rates. Listing access and provider documentation establish account visibility and request capabilities. Gameplay qualification uses a separate localhost API evaluation.

| Provider | New evaluation candidates | Standard USD per million input / cached input / output tokens |
| --- | --- | --- |
| OpenAI | GPT-6.2 Sol, GPT-6.2 Astra | $2 / $0.10 / $10 and $8 / $0.40 / $40 |
| xAI | Grok 4.7 | $2 / $0.50 / $6 |
| Anthropic | Claude Fable 5.2 | $8 / $0.20 / $40 |

OpenAI's 6.2 models have a 1.05M-token context and a 128K output limit. The entire request uses the higher rate above 272K input tokens. Flex is unavailable on these models. The House exposes its existing Standard route for them. [OpenAI model specs](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

Grok 4.7 has a 500K context. Above 200K prompt tokens, input, cached input and output rates double for the entire request. The House exposes its existing low, medium and high effort settings. Two older Grok 4.20 single-agent variants also appeared in the account inventory and remain outside the audited contestant catalog. [xAI model specs](https://docs.x.ai/developers/models/grok-4.7) · [xAI release notes](https://docs.x.ai/developers/release-notes)

Fable 5.2 is an explicit premium option alongside Fable 5.1. Anthropic requires 30-day retention for both models. Fable 5.2 has a 1M-token context, 128K output limit and adaptive thinking. Anthropic enforces exact prior conversation prefixes when clients resend signed thinking blocks. The House retains reasoning evidence and sends fresh Messages requests. [Anthropic model specs](https://platform.claude.com/docs/en/models/fable-5-2/overview) · [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Meta listed Spark 1.1 through 1.3, Spark 1.2 and 1.3 Contributor, Wonder 1.0 and Ember 1.0. The Spark and Wonder rates and controls were rechecked. Ember's existing rates still apply. Meta's open-weight Spark Open and Glimmer require self-hosting or separate hosted routes. The existing Contributor choices retain their training terms. [Meta models](https://dev.meta.ai/docs/models) · [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits)

## Retirement notices

| Provider | Retirement date | Models relevant to the catalog |
| --- | --- | --- |
| Anthropic | November 30, 2026 | Claude Sonnet 4.5 and its undated alias. Anthropic recommends Sonnet 5.5. |
| OpenAI | December 11, 2026 | GPT-5, GPT-5 mini, GPT-5 nano, GPT-5 pro, o3 and o3-pro, including the documented snapshots. |
| OpenAI | January 14, 2027 | GPT-4o, GPT-4o mini, GPT-4.1 and GPT-4.1 mini, including the remaining documented snapshots. |
| Anthropic | January 22, 2027 | Claude Opus 4.5 and its undated alias. Anthropic recommends Opus 5.5. |
| OpenAI | April 1, 2027 | GPT-5.1, GPT-5.3 Codex and GPT-5.4 nano, including the documented snapshots. |

OpenAI lists November 30, 2026 as the end of GPT-5.6 Sol promotional pricing. Its API retirement schedule has no GPT-5.6 Sol shutdown date. Anthropic still lists Claude Haiku 4.5 as active. xAI retired Grok Build 0.1 on November 19, 2026. It was outside the native contestant catalog. Meta's public documentation still lists the older Spark versions as available. [OpenAI retirement schedule](https://developers.openai.com/api/docs/deprecations) · [GPT-5.6 Sol pricing](https://developers.openai.com/api/docs/models/gpt-5.6-sol) · [Anthropic retirement schedule](https://platform.claude.com/docs/en/about-claude/model-deprecations) · [xAI release notes](https://docs.x.ai/developers/release-notes) · [Meta Spark availability](https://dev.meta.ai/docs/muse-spark)

Documented catalog entries can carry a static `retired` flag and an announced `deprecation` notice with a retirement date and provider-recommended replacement. The inventory also reports live availability for each configured provider. See [model routing](../model-routing.md#authority-and-recovery) for how the current picker and new-game admission use retirement dates. Claude's current selection rules already keep the 4.5 models out of new selections. Frozen route IDs and rate cards remain the authority for historical games.
