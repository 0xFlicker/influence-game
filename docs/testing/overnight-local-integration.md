# Local multi-model audio and cutout qualification

This checkout integrates the October 25 overnight evaluation. Keep the exact game
IDs, provider evidence, media and shared ledger in the sibling `evidence/` folder.
The existing localhost database and object store retain canonical history. Do not
reset their volumes or change saved character profiles to prepare this evaluation.

Start API, game worker and web in separate terminals using
`bash scripts/overnight-local-services.sh api`, `worker`, and `web`. The script uses
the existing Doppler `social-strategy-agent/dev` configuration, localhost database
and object storage, ports 3000/3002/3001, and the original local upload directory.
No credentials are included in the script. The existing CLI session authenticates
API simulations and exports; browser sign-in remains its ordinary separate flow.

## Shared provider budget

`INFLUENCE_LOCAL_TASK_BUDGET` enables a local-only, operator-controlled ledger.
It is rejected in production. Every game must appear in `allowedGameIds` before
its first model request. Both games, contestant fallback, context adaptation and
House episode naming use the same pre-dispatch hook. Unrelated automatic screening,
learning, image generation, health probes and House Cuts are disabled in this mode.
Generation failures retain canonical acceptance and the existing recovery path.

The ledger maintains independent ceilings of $15 OpenAI, 10,000 Katana credits,
and $15 xAI. Meta Contributor text is conservatively charged against the same
OpenAI-dollar pool, so its inclusion cannot increase the combined text allowance.
Prior-task holds are explicit and must be reconciled from retained evidence.
Never delete, reset or reduce a ledger to enable another request.

Text reservation counts UTF-8 request bytes plus 16,384 framing tokens and the
explicit maximum output allowance at twice the highest documented price tier.
Known terminal usage settles at those conservative rates, retaining the larger
provider receipt. Missing usage or failed evidence persistence retains the entire
reservation. Katana conversion uses its documented $0.0052/credit reference,
rounding upward and retaining native credit receipts. TTS charges every dispatch
at $30 per million UTF-8 bytes, conservatively above its published $15 per million
characters, including markup, retries and uncertain outcomes. No refunds are
assumed for TTS. This is an admission guard and upper-bound ledger, not an invoice.

Focused guard validation:

```sh
bun test packages/engine/src/__tests__/local-task-budget.test.ts
```

Required integration checks remain `bun run test`, sequential `bun run test:postgres`,
and `bun run check`, followed by live paid API games and actual viewer/export checks.
Provider-free fixtures do not establish live provider acceptance or audible output.

## Eight-character cast

GPT Sol, Claude Sonnet, Claude Haiku, Gemini Pro, Meta Spark, Kimi K3, DeepSeek Flash,
and Grok 4.6 retain their current saved profile identities and model preferences.
GPT Luna is the House and common recovery route. Existing circular portraits remain
unchanged. Full-body derivatives must preserve source dimensions and head geometry,
fall back to the original when unavailable, and be pinned into new export snapshots.

Meta Spark retains its existing character identity and images but uses Katana GLM 5.3 Flash Private for this run. The separate paid Meta API is outside the authorized provider allowances and is rejected by the task guard. Each actual xAI audio dispatch reserves from the shared ledger using its durable attempt ID.

The faint rectangle in the supplied Sonnet screenshot came from Werewolf opening CSS (`border` plus rectangular `box-shadow`). Full-body opening shots now retain the same image box with a transparent border and alpha-following shadow. Browser and Remotion share this frame. Portrait fallback styling and all source/cutout pixels remain unchanged.
