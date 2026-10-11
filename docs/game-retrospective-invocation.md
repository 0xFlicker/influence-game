# Strict retrospective final statements

Mandatory `getRetrospectiveStatement` methods on `IAgent` / `InfluenceAgent` and `WerewolfAgent` / `WerewolfModelAgent` run through both existing engines and their durable API authorities. Simulations retain complete artifacts and bounded local MCP inspection. See the [runtime](game-retrospective-runtime.md), [contract](game-retrospective-contract.md), [context compiler](game-retrospective-context.md) and [task plan](plans/2026-10-10-004-feat-game-retrospectives-implementation-plan.md).

## Model contract and context

[retrospective-invocation.ts](../packages/engine/src/retrospective-invocation.ts) constructs a dedicated postgame prompt using the unchanged canonical context serialization: the complete original game account, the speaker's original persona/backstory/game-specific strategy and every earlier accepted speech verbatim. It snapshots and checks the request/input hash, actor and exact predecessor references before asynchronous work. Current memories, editable profiles, opponents' strategy/cognition and visual scene preparation do not enter the prompt. Influence's ordinary phase argument supplies execution metadata only.

The prompt asks for an 80–150 word reflection on the contestant's contribution, successes/failures, changed understanding and earlier speeches. Canonical facts and untrusted quoted dialogue stay separate. A quote cannot instruct the model or establish that a promise was fulfilled. The native tool is exactly `submit_retrospective`, with the existing `{ speech: string }` artifact: nonblank, at most 2,000 Unicode code points, no extra fields. Accepted whitespace and Unicode remain unchanged. There is no pass, cue, private-thinking field, strategy delta or new gameplay action.

Both agents use `executeModelInvocation` and their existing coordinator and sealed provider manifest. Influence retains its configured structured-attempt limit (default two); Werewolf retains three attempts per entry. The coordinator alone owns retries, fallback traversal, cancellation, accounting and accepted-value replay. SDK retries are disabled. Exhaustion propagates a typed provider failure; no default speech is fabricated. RT-04/05/06 own representation and recovery of that failure.

Influence retains its planned durable-turn/subcall coordinate when staged, or an explicit retrospective phase-call coordinate for standalone invocation. Werewolf retains its event action-slot coordinate. No provider-coordinate version or alternate journal is introduced. The staged inventory includes the method and bypasses scene generation, preserving existing art for later presentation work. Provider receipts account for every dispatched attempt; Influence's token tracker records newly accepted generation usage, including cached/reasoning tokens, without recounting replay.

## Verified capacity admission

`prepareRetrospectiveCapacityPolicy(sealedRuntimes, signal)` derives a budget for **every** effective primary/fallback entry. Budget `modelId` is the sealed **catalog ID**, distinguishing provider profiles. RT-04/05 initialization must supply this policy to the existing whole-roster preflight before the first statement: every speaker must fit with worst-case predecessor speeches. Each fresh statement also checks its exact serialized UTF-8 size against all entries before generation.

The adapter requires the hosted `https://api.openai.com/v1` endpoint and uses documented exact limits for the six supported OpenAI models, verified on 2026-10-10. A custom endpoint using an OpenAI model name cannot borrow hosted limits:

| Models | Context window | Maximum input | Maximum output |
| --- | ---: | ---: | ---: |
| [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) | 400,000 | 272,000 | 128,000 |
| [GPT-5.6 luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-6 luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 1,050,000 | 922,000 | 128,000 |

The adapter compiles the real system/tool/schema/reasoning settings and calls the native [Responses input-token count endpoint](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count). A one-space user input preserves the actual single-string input shape and conservatively reserves its token. This read sends no game dossier, strategy or earlier speeches. The installed SDK predates the named endpoint helper, so its existing public `post()` method sends `/responses/input_tokens` with zero SDK retries. Native count failures, malformed evidence, absent admission support and unverified model/profile routes fail with `capacity_unavailable`; insufficient budget fails with `context_capacity_exceeded`. Cancellation retains the caller's reason; admission is bounded to 120 seconds.

The admitted context-byte ceiling is:

```text
min(documented maximum input, context window − reserved output) − native fixed-prefix input tokens
```

The invocation reserves 16,384 output tokens. Native [Responses `max_output_tokens`](https://developers.openai.com/api/reference/resources/responses/methods/create) includes both visible output and reasoning; sealed runtime reasoning overrides also apply to the counted prefix. From the GPT byte-BPE representation described in the [official token-counting guide](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken), the variable canonical context uses a conservative one-token-per-UTF-8-byte upper bound. This is an admission bound, **not** measured token usage or a character-to-token estimate. RT-02 reserves six serialized JSON bytes per possible prior-speech code point, including escaping. No compressible placeholder speech is tokenized, account truncated or model-family/custom-provider window guessed. LM Studio and Katana require their own verified admission capability before retrospective generation can use those routes.

Fresh-dispatch admission runs once before the coordinator enters its attempt loop. It is a non-generating native metadata read, not a speech retry/fallback loop or accepted speech receipt. Accepted journal replay revalidates the artifact and supplied context without counting or generating remotely. Whole-roster admission remains the initializing driver's responsibility; RT-03 does not persist a second progress or capacity authority.

## Deterministic proof

Run `bun test packages/engine/src/__tests__/retrospective-invocation.test.ts`. All HTTP responses are local fetch fixtures, including native counting. Tests cover exact full context/priors in both agents, primary/fallback admission, strict malformed-output exhaustion, no continuity/game mutation, disabled SDK retries, cancellation, context drift, replay without transport, accounting and staging without scene generation. [Fixture agents](../packages/engine/src/fixtures/retrospective-agent.ts) satisfy both mandatory contracts and capture detached exact contexts for later driver proofs. They are provider-free fixtures, never production failure fallbacks.

Required verification remains `bun run test`, `bun run test:postgres` and `bun run check`. These tests do not establish paid-provider, deployed-runtime, MCP, replay, export or model-quality acceptance. Keep exact types without `as any` and call House methods directly when adding future orchestration.
