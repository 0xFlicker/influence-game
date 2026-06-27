---
date: 2026-06-27
topic: multi-model-provider-grok-router
focus: Grok xAI support, Katana/imgnAI router use, and future multi-model provider direction for Influence agents
mode: repo-grounded
---

# Ideation: Multi-Model Provider Support for Grok and Routers

## Grounding Context

Influence's product strategy is explicitly about persistent agents that players watch, understand, and improve. The current strategy doc names agent reasoning access as a core track because the spectator loop becomes an improvement loop when owners can see why agents acted, not only what happened (`STRATEGY.md:12`, `STRATEGY.md:36`). The same doc still lists extended model support as "not working on" (`STRATEGY.md:54`), so this ideation should bias toward a reversible slice: enough provider flexibility to evaluate Grok and routers without turning the whole product into a model marketplace.

The current server-created game surface is per-game, not per-agent. `POST /api/games` accepts `modelTier` and stores it in `config.modelTier` (`packages/api/src/routes/games.ts:86`, `packages/api/src/routes/games.ts:144`). That matches the requested scope: keep per-agent model support deferred, but make per-game selection better than today's budget/standard/premium tier indirection.

The shared LLM helper is OpenAI SDK shaped. It already accepts `INFLUENCE_LLM_BASE_URL`, `OPENAI_BASE_URL`, and `LM_STUDIO_BASE_URL`, and it resolves API keys from project-specific or alias env vars (`packages/engine/src/llm-client.ts:118`). It also already defaults a local base URL to an `lm-studio` key and labels localhost as OpenAI-compatible local (`packages/engine/src/llm-client.ts:45`, `packages/engine/src/llm-client.ts:129`). That is a strong base for Katana, OpenRouter-style routers, and LM Studio.

The gap is capability modeling. The engine currently treats only `o*` and `gpt-5*` model IDs as reasoning models (`packages/engine/src/agent.ts:3315`). Action-level reasoning effort exists already, with low/medium/high effort passed into decisions throughout the agent surface and with token overhead assumptions documented in the code (`packages/engine/src/agent.ts:3348`). But a `grok-4-3` model behind an OpenAI-compatible base URL will not currently enter the reasoning path just because it is a reasoning model.

The local-model docs are highly relevant. They say the useful local signal is not only "does it finish?", but whether games are enjoyable to watch and agents show real strategy (`docs/local-model-evaluation.md:3`). They also document LM Studio/OpenAI-compatible env vars, local structured-output modes, and raw provider reasoning metadata captured as `reasoningContext` (`docs/local-model-evaluation.md:13`, `docs/local-model-evaluation.md:26`). Any new router work should reuse this validation lane instead of creating a separate evaluation culture.

External grounding:

- xAI docs show Grok 4.3 usage through `https://api.x.ai/v1` and Responses/streaming examples that surface reasoning events: https://docs.x.ai/docs/guides/reasoning
- Katana's compact docs state text models use OpenAI-compatible `/v1/chat/completions`, support combined bearer credentials of `<api_key>:<api_secret>`, expose model metadata through `GET /v1/models`, and expose reasoning text as `choices[].message.reasoning_content` when supplied: https://kat.imgnai.com/llms.txt
- Katana's model catalog currently lists `grok-4-3`, `grok-build-0-1`, and `grok-4-20-multi-agent`. The `grok-4-3` card describes configurable reasoning effort as none/low/medium/high with low as the default, 1M context, tool calling, structured output, and anonymized privacy.
- Live probe on 2026-06-27 through Doppler dev secrets: `GET /v1/me/balance` returned `{"credits":"20814.0"}`. A minimal `grok-4-3` chat completion returned the exact requested phrase and `usage.imgnai.credits_charged` of `0.1`, so the account credits are usable.

## Topic Axes

- Provider configuration and credentials
- Reasoning capability and action policy
- Per-game model selection
- Simulation and local development parity
- Router economics and observability
- Future native and multi-agent lanes

## Ranked Ideas

### 1. Provider Profile Registry

**Description:** Introduce a small provider profile layer that resolves one per-game model choice into base URL, auth shape, transport family, tool mode, reasoning capabilities, and billing/observability labels. Profiles should cover at least `openai`, `lm-studio`, `katana`, and `custom-openai-compatible`; later `xai-native`, `bankr`, `venice`, and `imgn` can slot into the same shape. The immediate user-facing choice stays per-game: model/provider preset, not per-agent customization.

**Axis:** Provider configuration and credentials

**Basis:** `direct:` The repo already centralizes provider setup in `createLlmClientFromEnv`, but only as base URL plus API key and a generic provider label (`packages/engine/src/llm-client.ts:114`). `external:` Katana uses OpenAI-compatible chat completions plus a nonstandard combined key/secret bearer token, while xAI native examples use `https://api.x.ai/v1`.

**Rationale:** This is the strongest foundation because it separates "where/how to call" from "which model string did the game choose." It also prevents a series of one-off env var hacks as each router arrives.

**Downsides:** More abstraction before the second provider is deeply proven. Needs careful naming so "provider" does not leak into player-facing copy.

**Confidence:** 90%

**Complexity:** Medium

### 2. Grok Reasoning Ladder Experiment

**Description:** Add a Grok-specific capability profile for `grok-4-3` with allowed reasoning efforts `low`, `medium`, and `high`, deliberately excluding `none`. Use the existing action-level effort intent as the default mapping, then allow a per-game override for experiments: all-low, all-medium, all-high, or action-policy. The first shipped evaluation should compare the same Mingle simulation across low/medium/high and judge strategy quality, output reliability, latency, and billing.

**Axis:** Reasoning capability and action policy

**Basis:** `direct:` The engine already passes action-level reasoning hints such as low for simpler decisions and medium/high for more complex ones (`packages/engine/src/agent.ts:3348`, `packages/engine/src/agent.ts:3417`). `external:` Katana's `grok-4-3` card exposes none/low/medium/high with low as default; the user explicitly wants low/medium/high and not none.

**Rationale:** Influence agents benefit from reasoning, but "high everywhere" might produce slower or overthought play. A ladder experiment preserves the user's instinct while generating real evidence about cost and watchability.

**Downsides:** The current reasoning-model detector will not treat `grok-4-3` as reasoning-aware. This idea needs capability-driven reasoning support, not only a model override.

**Confidence:** 88%

**Complexity:** Medium

### 3. Katana Quick Lane with Credit-Aware Smoke Tests

**Description:** Add a Katana profile that sets `baseURL=https://kat.imgnai.com/v1`, authenticates with `API_KAT_IMGNAI_KEY` and `API_KAT_IMGNAI_SECRET` as a combined bearer token, and maps the initial model to `grok-4-3`. Include a tiny non-game smoke test that checks balance, lists models, and runs one deterministic prompt before any long simulation starts. Keep the smoke command cheap and explicit, like the probe from this turn.

**Axis:** Router economics and observability

**Basis:** `external:` Katana documents `/v1/me/balance`, `/v1/models`, and OpenAI-compatible chat completions with combined bearer auth. `direct:` This turn's live probe verified `20814.0` credits and a successful `grok-4-3` response with a 0.1 credit charge.

**Rationale:** The fastest useful path is not "build all providers"; it is "prove one router can run Grok with credits and visible billing." Once this is stable, router economics become observable instead of speculative.

**Downsides:** Katana may not expose every native xAI reasoning control through exactly the same request fields. The quick lane should be explicitly marked OpenAI-compatible, not native xAI.

**Confidence:** 86%

**Complexity:** Low

### 4. Model Catalog Allowlist for Per-Game Selection

**Description:** Store a curated model catalog in code or config with model ID, display name, provider profile, capability tags, default reasoning policy, and "evaluation status" for Influence. The UI/API can offer only curated per-game choices even when a router lists dozens of models. For Katana, the catalog can start with `grok-4-3` plus a few back-burner records for `grok-build-0-1` and `grok-4-20-multi-agent` marked as not-game-agent-ready.

**Axis:** Per-game model selection

**Basis:** `direct:` Game creation already persists `modelTier`, but that tier maps to environment variables rather than explicit model/provider choices (`packages/api/src/routes/games.ts:144`, `packages/engine/src/llm-client.ts:103`). `external:` Katana's `/v1/models` response includes many candidates, far more than a game creator should see raw.

**Rationale:** This gives per-game support without opening per-agent complexity. It also creates a place to record which models are good at Influence rather than merely available.

**Downsides:** Catalog freshness becomes a maintenance responsibility. Fully dynamic router browsing should stay out of the first slice.

**Confidence:** 82%

**Complexity:** Medium

### 5. Simulation/API Provider Parity

**Description:** Move simulator provider selection toward the same provider-profile resolver used by API-backed games, while preserving the standalone CLI workflow. The simulator can still accept `--model`, but it should also accept a provider/profile preset or read the same per-game model config shape. Longer term, local simulations should be runnable through the API lifecycle when that is the easiest way to share state, traces, and replay.

**Axis:** Simulation and local development parity

**Basis:** `direct:` The simulator has its own `--model` argument and writes local artifacts (`packages/engine/src/simulate.ts:115`, `packages/engine/src/simulate.ts:1460`). The local-model docs already expect LM Studio experiments to use real simulations and `--chatty` reasoning inspection (`docs/local-model-evaluation.md:42`).

**Rationale:** Simulator support is still a separate thing today, but every provider experiment needs simulator evidence first. Aligning config shape avoids evaluating a model in one path and accidentally running it differently in the product path.

**Downsides:** A full API-backed simulator lane touches statefulness and durable-run boundaries. The first version should only share config resolution, not force every CLI run through the API.

**Confidence:** 78%

**Complexity:** High

### 6. Provider Usage and Reasoning Telemetry

**Description:** Extend token/cost tracking and private trace metadata to capture provider label, model ID, requested reasoning effort, observed reasoning token fields, router billing fields, and raw provider reasoning context when available. For Katana, preserve `usage.imgnai` billing metadata in private traces or simulation summaries. For local LM Studio, continue treating `reasoning_content` as private `reasoningContext`, not emitted `thinking`.

**Axis:** Router economics and observability

**Basis:** `direct:` The engine already records reasoning token usage when providers expose it (`packages/engine/src/agent.ts:3378`) and separates raw reasoning metadata from emitted `thinking` (`packages/engine/src/agent.ts:3600`). `external:` Katana's non-streaming responses include `usage.imgnai` billing metadata, and the live probe returned reservation, charge, and refund fields.

**Rationale:** Multi-model support without telemetry becomes vibes immediately. Influence model selection should be based on completed game quality, reasoning usefulness, latency, and actual cost per game.

**Downsides:** Private trace storage and public watch surfaces have strict privacy boundaries. This metadata should stay producer/debug unless deliberately summarized.

**Confidence:** 84%

**Complexity:** Medium

### 7. Native xAI and Back-Burner Agents Lane

**Description:** Keep a native xAI provider behind the registry, but do not make it the first dependency unless Katana cannot pass reasoning effort through cleanly. Native xAI is where Responses-specific reasoning summaries, streaming reasoning events, Grok multi-agent endpoints, and Grok Build can be explored. Mark `grok-build-0-1` as a development-agent/coding lane, and `grok-4-20-multi-agent` as a research/analysis lane rather than a game-agent model for now.

**Axis:** Future native and multi-agent lanes

**Basis:** `external:` xAI reasoning docs show native Responses/streaming examples for `grok-4.3`, while Katana lists Grok Build and Grok multi-agent variants as separate model keys. `reasoned:` Game agents need consistent turn-taking, structured outputs, and bounded latency; multi-agent research endpoints and coding models may be useful for tooling, but they should not be dropped into player turns without evidence.

**Rationale:** This gives future-forward thinking without bloating the immediate slice. It keeps the architecture open for genuinely native features while letting the current credit-bearing router prove value first.

**Downsides:** If Katana's OpenAI-compatible surface cannot set `low`/`medium`/`high`, native xAI may become necessary sooner. The registry should make that a profile swap, not a rewrite.

**Confidence:** 74%

**Complexity:** Medium

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Offer per-agent model selection now | Scope overrun. The requested near-term product shape is per-game; per-agent models multiply fairness, debugging, and cost interpretation before the base provider seam is proven. |
| 2 | Add `none` as a Grok reasoning option for completeness | Contradicts the product need and the user's explicit constraint. Influence agents benefit from reasoning; none should not be offered in normal game setup. |
| 3 | Start with native xAI only | Less pragmatic than the Katana quick lane because the current credits and router smoke test already work, while native xAI does not answer the user's router/open-market direction. |
| 4 | Use raw `/v1/models` as the game model picker | Too noisy and unstable for creators. A curated allowlist better fits per-game selection and model-quality tracking. |
| 5 | Integrate x402 payment now | Interesting long term for crypto-native deployment, but not needed while API-key credits work. It adds wallet signing and settlement concerns before provider quality is known. |
| 6 | Run Grok Build as the in-game agent model | Model mismatch. Grok Build is worth keeping warm for coding/automation, not as the first social-strategy turn model. |
| 7 | Use Grok multi-agent endpoint for player turns now | Interesting but structurally risky. It may perform parallel deep research rather than bounded persona turn-taking; keep it for producer analysis experiments. |
| 8 | Replace tier model env vars with a database model marketplace immediately | Too much product surface. First prove profile resolution and per-game selection, then decide whether persistence/UI needs a larger marketplace. |
| 9 | Treat every OpenAI-compatible router the same | Insufficient. Routers differ on auth, reasoning controls, billing metadata, tool behavior, privacy labels, and streaming support. |
| 10 | Skip simulator support and only wire API games | Risky for Influence. Model quality needs cheap, repeated, inspectable simulations before live product games. |
| 11 | Make high reasoning the universal default | Plausible but unverified. Low/medium/high should be compared with real Mingle games before choosing a default. |
