# Native Haiku 5.5 localhost evaluation

Evaluated October 25–26, 2026 under the user's cumulative **$5 Anthropic ceiling**.
All runs used the durable localhost API, six players, one wolf, Seer and Doctor,
Haiku 5.5 at low effort for every contestant and the House, and no audio or vision.
The final run was capped at two days. No production games or deployments changed.

| Run | Game ID / slug | Result | Attempts / failed | Estimated game charges |
| --- | --- | --- | --- | --- |
| Initial integration diagnostic | `8cbf6625-f9ba-428a-89d0-043fad38735c` / `slim-coral-gem` | Completed, including resumed retrospective; not qualification evidence | 47 / 28 | $0.015630 audit estimate from known usage |
| Recovery integration run | `308ff7df-ddce-4140-9935-e6bc20570424` / `true-navy-hive` | Village won on day two; six retrospectives completed | 66 / 8 | $0.064997 stored estimate |
| Fresh smoke run | `dff1e01f-42ca-4616-b50d-504e72532959` / `grim-khaki-code` | Village won on day two; six retrospectives completed | 61 / 2 | $0.065208 stored estimate |

The fresh run had one invalid House episode title/description and one undecodable
introduction. Both recovered through ordinary retries. It had **no terminal or
degraded failures, schema-configuration errors, or unpriced attempts**. The
earlier runs exposed native grammar incompatibilities and the initial
`standard_only` rate-card normalization bug; their original evidence and receipts
remain intact. Do not use their fallback-affected introductions/discussions as
an unbiased assessment of Haiku's game quality.

## Cost and performance

The cumulative local ledger ended at **$4.50161375** reserved/settled, including
health probes and full holds for requests with unknown usage. It was never reset
or increased. This is a conservative spending guard, **not the provider invoice**.
Known-usage game charges, recomputed without per-receipt rounding, total
**$0.1458281**. That figure excludes health-probe charges and does not assert that
unknown-usage errors were free. The first run's historical unpriced receipts were
not rewritten; its separate audit estimate uses the documented Haiku rates.

The fresh game used 546,210 input tokens and 21,165 output tokens across all
attempts, including 12,585 reported thinking tokens already counted in output.
No cache hits were reported. Every individual prompt remained in the cheaper
input tier; summing episode input does not select the >100K per-request tier.
Attempt latency was 8.59 seconds at the median and 35.689 seconds at p95. The
estimated 6.52-cent game includes the House and failed attempts, but not hosting,
image generation, audio, or other unrelated infrastructure.

## Gameplay observations

- Both later games reached a coherent day-two village win. Seers identified the
  wolf, doctors made meaningful protection choices, and villagers acted on public
  claims and votes. The final wolf contested the Seer's claim instead of exposing
  private role knowledge.
- The fresh run's first discussion was all passes. Its second day produced a
  legible claim, counterargument and majority vote, but speech was repetitive.
  Retrospectives sometimes described events imprecisely; their prose is not game
  authority. Low-effort Haiku is economical, not yet a demonstrated quality leader.
- This supports initial free-account availability at low effort. It is not a
  model ranking or proof of every game format. Influence, medium effort, other
  Claude models, vision, long-context pricing, caching and forced compaction were
  not exercised in paid gameplay. Local tests cover more contracts than this smoke.

## Evidence and validation

All **174 attempts** have stored private provider evidence in the existing object
storage path. Durable game records retain accepted decisions, authored thinking,
available native reasoning, usage and retries. Private local exports, transcripts,
routing snapshots, mutation intents/receipts, attempt audits and the shared ledger
are retained under the ignored directory:

`packages/engine/docs/simulations/2026-10-26-native-haiku-5-5/`

The `clean-run/` and `final-run/` children contain their own immutable exports;
the root holds the diagnostic and cumulative ledger. Canonical evidence remains
accessible through the localhost admin/Studio APIs. Raw private evidence is not
committed into this public research report. The task's game worker was stopped
after completion and the original gateway-only local configuration restored.

- Final provider-free baseline: 3,056 passed, five skipped, zero failed across
  325 files. Native adapter/CLI focused checks: 23 passed, 130 assertions.
- Type checking and lint: passed.
- Final full PostgreSQL baseline: 2,256 passed, zero failed across 201 files
  (29,100 assertions). Tests ran sequentially against the shared test database.

See [native provider configuration](../../native-anthropic.md),
[catalog/pricing research](README.md), and
[schema integration lessons](../../solutions/runtime-errors/anthropic-exact-schema-wire-encoding.md).
