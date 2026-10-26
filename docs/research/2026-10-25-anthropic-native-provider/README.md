---
title: Native Anthropic provider research and model audit
date: 2026-10-25
status: researched
---

# Native Anthropic provider research

Implementation follow-up: [native provider guide](../../native-anthropic.md).
The research-only statements below describe the initial audit; subsequent SDK
installation and authorized $5 localhost evaluations are recorded separately.

## Recommendation

Use the official TypeScript SDK and native Messages API with the existing Doppler API keys. Recommend `anthropic:claude-haiku-5-5` as the next free-account option, subject to implementation and a bounded localhost API gameplay evaluation. Keep the global default, House route, and existing free choices unchanged by this proposal. Sonnet 5.5 is the next quality/cost comparison; Opus 5.5 is an operator option. Implement federation later for both OpenAI and Anthropic at client construction.

## Evidence and limits

Research date is October 25, 2026, America/Denver; machine timestamps in the captures are October 26 UTC. The development Doppler `ANTHROPIC_API_KEY` successfully listed models. The user reports keys in all environments; staging and production key validity and container injection were not tested. No inference, token-counting request, account mutation, deployment, or paid evaluation was performed.

- [anthropic-models.json](anthropic-models.json): complete paginated `GET https://api.anthropic.com/v1/models`, API version `2026-10-21`, using development credentials. One page, 13 models. Only response metadata is saved, with no credentials or request headers. Every returned model reports active lifecycle, structured outputs, and image input. This is advertised capability and account catalog access, not proven inference success or game quality.
- [katana-models.json](katana-models.json): current public `GET https://kat.imgnai.com/v1/models/text`. Eight Claude entries; no Haiku 5.5, Sonnet 5.5, or Opus 5.5 in this response.
- [anthropic-sdk-package.json](anthropic-sdk-package.json): public registry metadata for `@anthropic-ai/sdk`, version **1.3.0**. The matching archive was inspected in a temporary directory and its SHA-512 integrity matched the registry metadata; nothing was installed into the project.
- Pricing comes from the linked official model/pricing documentation, not the Models API: its response does not include prices. Preserve this distinction in the implementation's facts snapshot.

## Model and price shortlist

USD per million tokens, standard global synchronous requests. Cache writes below are five-minute writes. These are published rates, not measured episode costs.

| Direct model ID | Input | Output | Cache read | Cache write | Input/output limits | Proposed use |
|---|---:|---:|---:|---:|---|---|
| `claude-haiku-5-5`, prompt ≤100,000 | $0.10 | $0.50 | $0.01 | $0.125 | 1M / 128K | Free-account candidate |
| `claude-haiku-5-5`, prompt >100,000 | $0.50 | $2.50 | $0.05 | $0.625 | Same model | Account for higher tier |
| `claude-haiku-4-5-20251001` | $1.00 | $5.00 | $0.10 | $1.25 | 200K / 64K | Older-model comparison |
| `claude-sonnet-5-5` | $2.00 | $10.00 | $0.10 | $2.50 | 1M / 128K | Quality upgrade candidate |
| `claude-sonnet-5` | $2.00 | $10.00 | $0.20 | $2.50 | 1M / 128K | Operator comparison |
| `claude-sonnet-4-6` | $3.00 | $15.00 | $0.30 | $3.75 | 1M / 128K | Older-model comparison |
| `claude-opus-5-5` | $4.00 | $20.00 | $0.20 | $5.00 | 1M / 128K | Higher-cost operator option |
| `claude-opus-5` | $5.00 | $25.00 | $0.50 | $6.25 | 1M / 128K | Operator comparison |
| `claude-opus-4-8` | $5.00 | $25.00 | $0.50 | $6.25 | 1M / 128K | Operator comparison |
| `claude-opus-4-7` | $5.00 | $25.00 | $0.50 | $6.25 | 1M / 128K | Operator comparison |
| `claude-opus-4-6` | $5.00 | $25.00 | $0.50 | $6.25 | 1M / 128K | Operator comparison |
| `claude-opus-4-5-20251101` | $5.00 | $25.00 | $0.50 | $6.25 | 200K / 64K | Legacy thinking mode |
| `claude-fable-5-1` | $10.00 | $50.00 | $0.25 | $12.50 | 1M / 128K | Expensive operator experiment |
| `claude-fable-5` | $10.00 | $50.00 | $1.00 | $12.50 | 1M / 128K | Expensive operator experiment |

Sources: [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview), and the saved authenticated catalog for limits/availability.

Haiku's tier threshold includes **all input tokens**, including cache reads and writes. Crossing 100K changes the rate for the whole request, including output. It does not limit valid game context. Thinking consumes the output allocation and is billed even when no summary is displayed. Newer tokenization can produce approximately 30% more tokens for the same text than Haiku 4.5; rate ratios are not episode-savings guarantees. [Haiku specifications](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)

## What Katana adds

| Comparison | Katana input/output | Direct input/output | Interpretation |
|---|---|---|---|
| Same Haiku 4.5 | $1.10 / $5.50 | $1 / $5 | Katana is 10% above direct; direct is 9.09% below Katana |
| Katana Haiku 4.5 → direct Haiku 5.5, ≤100K | $1.10 / $5.50 | $0.10 / $0.50 | 90.91% lower rates; model change dominates savings |
| Katana Haiku 4.5 → direct Haiku 5.5, >100K | $1.10 / $5.50 | $0.50 / $2.50 | 54.55% lower rates at equal token counts |
| Same Sonnet 4.6 | $3.30 / $16.50 | $3 / $15 | 10% markup |
| Katana Sonnet 4.6 → direct Sonnet 5.5 | $3.30 / $16.50 | $2 / $10 | 39.39% lower rates |
| Same Opus 4.8 | $5.20 / $26 | $5 / $25 | 4% markup |
| Katana Opus 4.8 → direct Opus 5.5 | $5.20 / $26 | $4 / $20 | 23.08% lower rates |
| Same Fable 5.1 | $10.10 / $50.50 | $10 / $50 | 1% markup |

Katana also publishes a 0.1-credit minimum and upward rounding to 0.1 credit, with a $0.0052/credit reference: $0.00052 increments per call. These comparisons use its advertised USD reference, not the user's realized credit purchase price. [Live Katana metadata](https://kat.imgnai.com/v1/models/text)

For an illustrative **20K uncached input + 1K total output** call: Katana Haiku 4.5 is $0.02756 after rounding; direct Haiku 4.5 is $0.025; direct Haiku 5.5 is $0.0025; Sonnet 5.5 is $0.05; Opus 5.5 is $0.10. At **120K uncached input + 1K output**, Haiku 5.5 is $0.0625. These are arithmetic scenarios, not benchmark results. The output number includes reasoning.

This makes Haiku 5.5 economically plausible for free accounts, but does not make it the cheapest existing House route. The checked-in Luna Flex rate is $0.05/$0.25 below its long-context threshold; DeepSeek V4 Flash has cheaper output but no image input. Those existing-route comparisons use the October 23 repository snapshots, not a new OpenAI/Meta audit.

## SDK/API findings that affect implementation

- SDK 1.3.0 supports Bun and has native `messages.create`, model pagination, cancellation, custom fetch, typed errors, and credential providers. Its source defaults to API **2026-10-21** and two retries; set `maxRetries: 0` so the durable coordinator remains the retry owner. Set the SDK timeout from the existing attempt deadline. [SDK docs](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript), [SDK repository](https://github.com/anthropics/anthropic-sdk-typescript)
- API 2026-10-21 rejects `temperature`, `top_p`, and `top_k`, including default values, on all models. Native Anthropic capabilities must reflect this transport version, even for older models that accepted sampling controls on the older API. [Migration guide](https://platform.claude.com/docs/en/api/migration-2026-10-21)
- Send the existing exact response schema in `output_config.format`; use `messages.create` and the House decoder. SDK schema helpers can strip unsupported constraints, which conflicts with silently weakening our native contract. Audit actual artifacts and use proven equivalent schema transformations, or report a concrete incompatibility. Preserve case-sensitive ID/enum validation despite the documentation's case-insensitive suggestion. [Structured output reference](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- All 13 catalog models advertise strict outputs, but their thinking modes differ. Haiku 5.5 supports adaptive thinking and low/medium/high efforts already present in House policy. Haiku 4.5 does not support effort; it uses a manual thinking budget. Sonnet/Opus 5.5 cannot use `thinking: disabled`. Prefer explicit adaptive settings for capable models. [Thinking behavior](https://platform.claude.com/docs/en/build-with-claude/thinking)
- The inspected SDK exposes `usage.output_tokens_details.thinking_tokens`. Preserve it when present; do not infer reasoning token counts from summary length. Native summaries, signatures, and redacted blocks belong in private evidence. Authored character `thinking` remains a separate product artifact. [SDK source](https://github.com/anthropics/anthropic-sdk-typescript/blob/v1.3.0/src/resources/messages/messages.ts)
- Cache accounting needs normalization: House prompt tokens must be `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Five-minute and one-hour writes have different prices. Start with five-minute caching only; the existing `promptCache.ttl: "30m"` is not an Anthropic TTL. Haiku 5.5's documented cache minimum is 512 tokens. Never pad prompts just to reach a threshold. [Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Haiku 5.5 low effort is a cost candidate, while medium is a necessary strategy/quality comparison. Use normal authored character explanations, not requests to reveal private model reasoning. Do not blindly port provider advice about server-side fallback or tools into the canonical game runner. [Haiku prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)

See the [implementation plan](../../plans/2026-10-25-001-feat-native-anthropic-provider-plan.md) for acceptance criteria, file ownership, rollout, and the deferred federation boundary.

Research-stage validation: parsed every captured JSON file; checked model count,
uniqueness, complete pagination and capability claims; verified SDK archive
integrity; recalculated price examples and savings; checked document links and
whitespace. Subsequent implementation, automated checks and the authorized
localhost gameplay results are recorded in the [evaluation report](evaluation.md).
