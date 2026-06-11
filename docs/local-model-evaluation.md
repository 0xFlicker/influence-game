# Local Model Evaluation

## Purpose

Use this workflow to test LM Studio or another OpenAI-compatible local model server against real Influence simulations. The goal is not only "does it finish?" The useful signal is whether games are enjoyable to watch and whether agents show real strategy: remembered promises, targeted whispers, vote reasoning, alliance continuity, and dramatic but coherent social play.

## Provider Configuration

The engine and API read LLM provider settings through a shared OpenAI-compatible client helper.

| Variable | Default | Notes |
|---|---|---|
| `INFLUENCE_LLM_BASE_URL` | unset | Preferred project-specific base URL. For LM Studio: `http://127.0.0.1:1234/v1`. |
| `INFLUENCE_LLM_API_KEY` | `lm-studio` when a base URL is set | LM Studio usually accepts any value. Set this for other compatible servers that require a key. |
| `OPENAI_BASE_URL` | unset | Compatibility alias if a tool already exports this. |
| `OPENAI_API_KEY` | unset | Hosted OpenAI key, or an explicit key for compatible providers. |
| `LM_STUDIO_BASE_URL` | unset | Compatibility alias for LM Studio-specific shell setup. |
| `LM_STUDIO_API_KEY` | unset | Compatibility alias for LM Studio-specific shell setup. |
| `INFLUENCE_LLM_TOOL_CHOICE_MODE` | `required` for local base URLs, otherwise `named` | Structured decision-call mode. Use `required` for LM Studio servers that reject named OpenAI tool forcing. Other accepted values: `named`, `auto`, `json_schema`. |
| `INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS` | `4096` | Minimum completion budget for local structured decision calls. Useful for models that spend many tokens on internal reasoning before producing tool arguments. |
| `INFLUENCE_LLM_LOCAL_MESSAGE_MIN_TOKENS` | `8192` | Minimum completion budget for local public-message calls. Useful when visible speech is empty because reasoning consumed a small budget. Empty local messages retry once with a doubled budget. |

Project-specific variables win over aliases. If a base URL is configured without an API key, the client uses `lm-studio` as a local default key.

Local OpenAI-compatible providers are not perfectly identical to OpenAI's hosted API. LM Studio may reject `tool_choice` objects like `{ type: "function", function: { name } }`; the default local mode sends `tool_choice: "required"` with one available tool instead. Local structured decision schemas also omit hidden `thinking` fields so smaller models spend their output budget on game actions rather than private notes. If a model/server still struggles with tools, try `INFLUENCE_LLM_TOOL_CHOICE_MODE=json_schema` to skip tool calls and request the tool argument schema as JSON response format.

Local public messages skip the hosted-provider `{ thinking, message }` response schema and request visible speech in `message.content`. When a local server returns native reasoning metadata such as LM Studio's `reasoning_content`, the engine stores that value as the transcript `thinking` field. This keeps malformed hidden reasoning out of public speech while still preserving local model thinking for viewer/debug surfaces.

## Model Tier Overrides

Server-created games resolve model tiers through these variables:

| Tier | Variable | Repo default |
|---|---|---|
| Budget | `INFLUENCE_MODEL_BUDGET` | `gpt-5-nano` |
| Standard | `INFLUENCE_MODEL_STANDARD` | `gpt-5-mini` |
| Premium | `INFLUENCE_MODEL_PREMIUM` | `gpt-5.4-mini` |

For a local API/server test, set all three to the LM Studio model ID if you want every tier to use the same local model.

## Simulator Workflow

1. Start LM Studio's local server.
2. Load a model and copy its exact model ID from LM Studio.
3. Run a small, bounded simulation:

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 4 --model <lm-studio-model-id> \
  --game-timeout-sec 600 --llm-timeout-sec 90
```

4. If the model finishes, run a larger test (add `--chatty` for live colored transcript with per-decision thinking/reasoning visibility — highly recommended for Mingle and vote/power/council work):

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
  --variant open-whisper --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
```

Simulation artifacts are written under `packages/engine/docs/simulations/`.

## Full Stack Local Provider

To run the API against LM Studio:

```bash
export INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1
export INFLUENCE_MODEL_BUDGET=<lm-studio-model-id>
export INFLUENCE_MODEL_STANDARD=<lm-studio-model-id>
export INFLUENCE_MODEL_PREMIUM=<lm-studio-model-id>

doppler run -- bun run dev:api
```

The API still needs app/database/auth secrets from Doppler unless you provide equivalent local env vars.

## What To Record

Create a dated note in `docs/simulations/` or near the generated batch artifacts with:

- model ID and quantization
- command run (include `--chatty` when used)
- player count, variant, timeout settings
- whether the game completed
- duration and token/call counts if available
- examples of good strategy (especially visible in the surfaced `thinking` / `reasoningContext` on VOTE / POWER / COUNCIL lines)
- examples of bad strategy, repetition, incoherence, or empty responses
- whether the output was enjoyable to watch
- quality and usefulness of the per-agent `thinking` and native `reasoningContext` captured in the transcript (this is now first-class signal for Mingle and decision-loop debugging)

When running with `--chatty`, the live terminal (and the written `game-*.txt`) will interleave House action lines with dim-gray `thinking:` and cyan `reasoning:` blocks. These are the primary human-readable artifacts for evaluating whether the model is producing legible, strategic private reasoning.

## Current Product Context

Local model evaluation is a first-class lane because Influence needs agents that are fun for the user and friends to watch. The biggest qualitative gap is strategic depth. A cheaper or local model is only useful if it can sustain alliances, plans, betrayals, and endgame arguments across a complete game.
