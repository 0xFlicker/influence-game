# Local Model Evaluation

## Purpose

Use this workflow to test LM Studio or another OpenAI-compatible local model server against real Influence simulations. The goal is not only "does it finish?" The useful signal is whether games are enjoyable to watch and whether agents show real strategy: remembered promises, targeted Mingle-room conversations, vote reasoning, alliance continuity, and dramatic but coherent social play.

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

Local OpenAI-compatible providers are not perfectly identical to OpenAI's hosted API. LM Studio may reject `tool_choice` objects like `{ type: "function", function: { name } }`; the default local mode sends `tool_choice: "required"` with one available tool instead. Local structured decision schemas keep the emitted `thinking` field, while raw provider reasoning metadata such as `reasoning_content` is stored separately as `reasoningContext`. If a model/server still struggles with tools, try `INFLUENCE_LLM_TOOL_CHOICE_MODE=json_schema` to skip tool calls and request the tool argument schema as JSON response format.

Local public messages skip the hosted-provider `{ thinking, message }` response schema and request visible speech in `message.content`. When a local server returns native reasoning metadata such as LM Studio's `reasoning_content`, the engine stores that value as transcript `reasoningContext`. This keeps malformed hidden reasoning out of public speech while still preserving local model reasoning for viewer/debug surfaces.

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
  --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
```

Add `--strategic-reflections` when the run is specifically validating private strategic-reflection capture or Strategy Thread carry-forward. This keeps fast release-validation runs bounded by default while still writing `strategic-reflection` records, `strategy-packet` records, and later private `strategyPacketUse` markers when the reflection path produces a packet.

Use `--house-summaries` when you want the same terminal to print only concise `[House MC]` summary lines without turning on the full `--chatty` transcript or hidden reasoning output. Deterministic round facts such as power holder, vote counts, power action, shields, Council candidates, Council vote counts, and elimination stay in the structured `house-mc-summary.response.roundFacts` payload for tooling.

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
  --variant mingle --house-summaries --game-timeout-sec 7200 --llm-timeout-sec 300
```

Use `--diary` when you only want bounded Council diary sessions. Use `--rich-producer` when the run is validating House strategy carry-forward and diary-room production quality. It enables strategic reflections, bounded Council diary sessions, private `house-strategy-bible` packet updates, `house-long-form-summary` records, and per-player `house-producer-brief` records. The ordinary `house-mc-summary` record and clean House system transcript entry are emitted by default in simulation config so you can follow the game between rounds even without `--chatty`.

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
  --variant mingle --chatty --rich-producer --game-timeout-sec 7200 --llm-timeout-sec 300
```

Simulation artifacts are written under `packages/engine/docs/simulations/`. For each game, use `game-N-turns.jsonl` for structured per-agent-turn analysis, `game-N-events.jsonl` for replayable accepted domain facts, `game-N.json` for the full transcript/result bundle, `game-N-progress.jsonl` for lightweight live progress, and `game-N.txt` for human-readable transcript review. `game-N-events.jsonl` uses the same `CanonicalGameEvent` envelope that API-backed games persist in Postgres, but local simulations do not create API database rows unless a future import command is explicitly added. Hidden `mingle-intent` records are always written to turns JSONL with `strategicLens` metadata and repaired live-player target fields; House room-assignment, Mingle turn, vote, private `candidate-selection`, private `shield-pull-up-selection`, power, and `house-mc-summary` records are written by default; hidden `strategic-reflection` and `strategy-packet` records are written there when `--strategic-reflections` is enabled; House Strategy Bible, long-form summary, and producer brief records are written when `--rich-producer` is enabled.

For post-vote Mingle quality, verify that agents react to the prompt's `Current Board Contract`, phase-specific rules, `Current Stakes`, `Revealed Vote Ledger`, `Post-Vote Pressure`, and room-specific opportunity sections. The expected behavior is not forced pleading, but at-risk players should recognize when the empowered player is in their room, safe players should understand how Power can change Council danger, and everyone should be able to use named vote receipts as fuel for apologies, retaliation, pressure, and deals. Room numbers should stay stable across Mingle turns while the turn/beat number changes, and hidden Mingle intent should not carry eliminated or self targets in live target fields.

For API-backed games, the admin durable-run inspection adds a checkpoint hydration passport on each checkpoint summary. Use it as a readiness report only: it summarizes event/projection replay, boundary certificate, Runtime Snapshot v1 evidence, transcript/token cursors, private player/House continuity presence, owner epoch proof, and privacy validation. Runtime Snapshot v1 candidacy requires the token cursor, transcript watermark, actor witness, accumulator registry, and continuity evidence to bind to the same checkpoint boundary. It does not expose the private continuity capsule bodies, and `hydration_candidate` means the available validators passed for a future hydration attempt, not that mid-game resume is implemented.

To query completed and still-growing simulation batches from another local MCP client, run:

```bash
cd packages/engine
bun run mcp:game -- docs/simulations
```

The server is read-only and scans the simulation corpus on demand. It addresses games by `sessionId + gameNumber`, rebuilds projections from `game-N-events.jsonl`, and exposes tools for listing sessions/games, reading projections, filtering canonical events, searching logs, reading player timelines, and following source pointers to linked turn records when present. Older batches without event logs remain searchable through turns/progress/transcript artifacts, but projection tools require canonical events. To validate open strategy choices after a run, use `search_logs` with `sources: ["turns"]` for `mingle-intent`, `mingle-room-assignment`, `mingle-turn`, `strategic-reflection`, `strategy-packet`, `strategicLens`, `strategyPacketUse`, `gotoPlayerName`, `gotoStatus`, `empower-revote`, `candidate-selection`, or `shield-pull-up-selection`. To validate House producer carry-forward, search turns/transcript logs for `house-mc-summary`, legacy `[House MC]`, `house-strategy-bible`, `house-long-form-summary`, `house-producer-brief`, or a named House alliance hypothesis.

For local API durable-run inspection, run the Trace MCP from the API package:

```bash
./scripts/run-trace-mcp-local.sh
```

Use this when the interesting run happened through the API lifecycle rather than the simulator. `list_manifests` shows private trace metadata and counts for one durable run; `read_content` opens one raw JSON/JSONL trace through the manifest access path; `search_reasoning_traces` does run-scoped content search with bounded previews. This is a local producer/debug tool only and depends on local DB/private-storage env. The wrapper bootstraps Postgres plus the local private content bucket, sources private content endpoint/access-key env vars, and keeps setup output off stdout so stdio MCP clients can launch it as a one-line command. `bun run trace:local:smoke` proves the writer/read/search path against a real object store. It does not add product/admin MCP auth, browser login, or a web UI.

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
- whether Current Board Contract facts keep live players, eliminated players, jurors, empowerment, shields, Council status, and endgame status clear without stale targets
- whether the strategy menu creates natural deals, vote counting, pressure, repair, or restraint instead of forced strategy every turn
- quality and usefulness of the per-agent `thinking` and native `reasoningContext` captured in `game-N-turns.jsonl` and the transcript (this is now first-class signal for Mingle and decision-loop debugging)
- whether hidden `mingle-intent` records and House `mingle-room-assignment` records show varied initial rooms, assignment sources, repair notes, and a range of guarded, social, and explicit strategic choices
- whether Council diary questions respect the player's actual Council role, and whether Judgment juror questions avoid repeating prior questions without exposing finalist answers inside question prompts
- whether `strategicLens` values across Mingle intent, strategic reflection, and Strategy Thread packets show varied evidence frames instead of collapsing into presentation/style reads
- whether later `strategyPacketUse` markers show agents following, revising, ignoring, or deferring Strategy Thread context in a way that matches current evidence
- whether House summaries help keep up with teams forming, leverage shifts, unresolved questions, and structured `roundFacts` between rounds without sounding like player-count bookkeeping
- when using `--rich-producer`, whether House Strategy Bible revisions carry alliance hypotheses forward instead of silently forgetting them, and whether diary producer briefs sharpen questions without leaking private producer reads as fact

When running with `--chatty`, the live terminal (and the written `game-*.txt`) will interleave House action lines with high-contrast bright-white `thinking:` and bright-cyan `reasoning:` blocks. These are the primary human-readable artifacts for evaluating whether the model is producing legible, producer-visible strategic reasoning. For scripts, MCP inspection, or post-run scoring, read `game-N-turns.jsonl`; it records each hidden Mingle intent, House Mingle room assignment, Mingle turn, vote, empower revote, private candidate selection, private shield pull-up selection, power action, diary answer, strategic reflection when enabled, Strategy Thread packet update when produced, and endgame decision as clean JSON with `thinking`, `reasoningContext`, and decision-specific producer/debug fields such as `strategicLens` when available. Use `game-N-events.jsonl` when the question is board state, accepted outcomes, or deterministic replay.

## Current Product Context

Local model evaluation is a first-class lane because Influence needs agents that are fun for the user and friends to watch. The biggest qualitative gap is strategic depth. A cheaper or local model is only useful if it can sustain alliances, plans, betrayals, and endgame arguments across a complete game.
