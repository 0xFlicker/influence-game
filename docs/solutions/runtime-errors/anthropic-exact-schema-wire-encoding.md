---
title: Preserve exact game contracts through Anthropic's native schema subset
module: Provider execution
problem_type: integration_issue
date: 2026-10-25
tags: [anthropic, structured-output, schema, provider-journal, accounting]
---

The native Messages API advertises strict JSON output, but its grammar compiler
does not implement every JSON Schema constraint used by game decisions. Live
Haiku 5.5 calls rejected numeric bounds, heterogeneous nullable enum/type
combinations, and some patterns or nullable branches as too complex. Merely
removing those constraints would weaken the model's decision contract.

`anthropic-output-schema.ts` uses explicit reversible wire encodings instead:
bounded integers become exact enums, nullable nonempty text uses empty text for
null, nullable enum choices use exact strings, and bounded arrays use numbered
properties in closed objects. The adapter validates the native wire value,
decodes only that declared representation, and validates the original schema
before the owning semantic validator runs. It never repairs malformed JSON or
invents missing decisions. Unsupported schema transformations fail closed.

Avoid `\\s|\\S` expansion in nonempty-string patterns: the native compiler can
reject otherwise small conversation schemas. The compact nullable encoding
removed the remaining live conversation grammar failures. Provider-free tests
cover more shapes than the paid Werewolf smoke run; finite string bounds,
Influence-only collection contracts, vision and forced compaction still need
their own live qualification before claiming those surfaces were exercised.

Usage must be captured before decoding. Typed failure accounting takes precedence
over attempts to infer usage from the raw SDK response. Native `standard_only`
requests freeze the Standard card; unknown tiers remain unpriced. Do not rewrite
old receipts when a price-normalization bug is fixed: retain them and report a
separate audit estimate. Local health probes share the task budget and settle
only after their evidence is durable. Unknown usage keeps its reservation.

See [native provider documentation](../../native-anthropic.md) and
[evaluation evidence](../../research/2026-10-25-anthropic-native-provider/evaluation.md).
