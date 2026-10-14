---
title: Admit retrospective context before fresh provider dispatch
date: 2026-10-10
module: retrospective invocation and provider execution
problem_type: architecture_pattern
component: service_object
severity: high
tags: [retrospective, provider-manifest, context-capacity, accepted-replay, structured-output]
---

# Admit retrospective context before fresh provider dispatch

A postgame speaker receives the whole frozen game, its original character/strategy and exact earlier speeches. Checking only the primary model or the first speaker can leave a later speech impossible to generate. Counting compressible placeholder speeches or estimating four characters per token does not prove worst-case admission.

Derive input budgets for every sealed primary/fallback catalog entry from verified model/tokenizer support. Reserve native system/tool/framing overhead and the complete output allowance, including reasoning. The [RT-03 invocation guide](../../game-retrospective-invocation.md) records the hosted OpenAI limits, native prefix-count endpoint and conservative UTF-8 byte bound. Unknown support fails explicitly. Supply these budgets to the frozen-context whole-roster preflight, which includes worst-case JSON escaping and predecessor metadata, before initializing speech generation.

**2026-10-13 update (superseded same day):** requiring verified admission from *every* sealed entry suspended real games whose manifests carried the recommended Katana fallback, because the Katana router exposes no token-count or model-metadata endpoint to verify against. Verified admission — including the OpenAI and Meta `inputByteBudget` implementations — was then removed entirely by product decision: retrospective now always dispatches through the sealed manifest, and the provider coordinator's retry/fallback traversal handles failures (including context overflows) like every other invocation. The frozen-context preflight still computes each speaker's serialized byte size for observability receipts, but never blocks. Do not reintroduce a capacity gate without a token-count surface on every supported provider route. Two dispatch bugs surfaced by the first Katana retrospective generation: the Katana router embeds provider failures inside HTTP 200 chat choices (`finish_reason: "error"`), which chat adapters now classify as retryable provider failures instead of decoding them as missing tool calls; and Grok via Katana drops strict tool calls whose schema carries a `pattern` keyword, so the speech artifact enforces nonblank text semantically in its decoder instead of via `pattern: "\\S"`.

Construct the model input with the same canonical serializer used for admission. Snapshot it before asynchronous work, validate input and predecessor hashes, and keep quoted dialogue separate from authoritative game facts. Request only the exact bounded `{speech}` artifact. Reject missing/extra fields, malformed JSON and blank or oversized speech inside the shared provider attempt boundary; never repair them into model-authored dialogue or strategy updates.

Fresh-dispatch admission belongs after the existing coordinator reads accepted journal evidence and before any manifest attempt. Otherwise a resumed accepted speech depends on another remote count request, which can fail even though generation already succeeded. Accepted replay revalidates the artifact and supplied context without transport. The native admission read must not generate a completion, use SDK retries or create another speech/progress authority. All actual generation attempts retain the existing coordinator's journal, retry, cancellation, accounting and planned semantic coordinates.

The [focused proof](../../../packages/engine/src/__tests__/retrospective-invocation.test.ts) mocks both native HTTP endpoints, verifies every fallback, exercises strict failure/exhaustion and confirms transport-free replay and planned staging. RT-04/05 still own whole-roster initialization and driver continuation; an invocation helper alone does not move the game's final boundary.
