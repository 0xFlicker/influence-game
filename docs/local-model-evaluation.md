# Local Model Evaluation

## Purpose

Use this workflow to test LM Studio or another OpenAI-compatible local model server against real Influence simulations. The goal is not only "does it finish?" The useful signal is whether games are enjoyable to watch and whether agents show real strategy: remembered promises, targeted Mingle-room conversations, named-alliance coordination, huddle follow-through, vote reasoning, alliance continuity, and dramatic but coherent social play.

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
| `API_KAT_IMGNAI_KEY` | unset | Katana router API key. Used only when a game or simulator run explicitly selects the Katana provider profile. |
| `API_KAT_IMGNAI_SECRET` | unset | Katana router API secret paired with `API_KAT_IMGNAI_KEY`. |
| `INFLUENCE_LLM_PREFLIGHT` | enabled | API game start validates the selected provider/model before claiming the run. Set to `off` only for local provider experiments where the model metadata endpoint is incompatible. |
| `INFLUENCE_LLM_PREFLIGHT_TIMEOUT_MS` | `10000` | Timeout for the API start preflight metadata request. |
| `INFLUENCE_LLM_TOOL_CHOICE_MODE` | `required` for local base URLs, otherwise `named` | Structured decision-call mode. Use `required` for LM Studio servers that reject named OpenAI tool forcing. Other accepted values: `named`, `auto`, `json_schema`. |
| `INFLUENCE_OPENAI_REASONING_SUMMARY` | `auto` for hosted OpenAI, off for local base URLs | Hosted OpenAI Responses reasoning summary mode: `auto`, `concise`, `detailed`, or `off`. Local OpenAI-compatible base URLs ignore this because they do not implement the hosted summary contract. |

Project-specific variables win over aliases. If a base URL is configured without an API key, the client uses `lm-studio` as a local default key.

Local OpenAI-compatible providers are not perfectly identical to OpenAI's hosted API. LM Studio may reject `tool_choice` objects like `{ type: "function", function: { name } }`; the default local mode sends `tool_choice: "required"` with one available tool instead. Local structured decision schemas keep the emitted `thinking` field, while raw provider reasoning metadata such as `reasoning_content` is stored separately as `reasoningContext`. Hosted OpenAI reasoning summaries are a separate Responses API feature; they default to `auto` for hosted OpenAI but remain off for local base URLs. Structured decisions use a global 8192-token completion floor, and public message calls use a global 4096-token completion floor with one doubled retry when visible content is empty. House Mingle room assignment and House alliance-huddle scheduling/outcome summarization use the same structured floor before falling back to deterministic repair behavior. If a model/server still struggles with tools, try `INFLUENCE_LLM_TOOL_CHOICE_MODE=json_schema` to skip tool calls and request the tool argument schema as JSON response format.

Local public messages skip the hosted-provider `{ thinking, message }` response schema and request visible speech in `message.content`. When a local server returns native reasoning metadata such as LM Studio's `reasoning_content`, the engine stores that value as transcript `reasoningContext`. This keeps malformed hidden reasoning out of public speech while still preserving local model reasoning for viewer/debug surfaces.

API-backed game start performs a provider/model preflight before moving a waiting game into `in_progress`. This catches missing credentials, unavailable model IDs, and incompatible model metadata endpoints before the durable owner claim is created. If a local OpenAI-compatible server can generate normally but does not implement model metadata retrieval, set `INFLUENCE_LLM_PREFLIGHT=off` for that local API process and validate the model with a small simulator run first.

## Model Selection

New API-created games store an explicit per-game `modelSelection` with `catalogId` and `reasoningPolicy`. The legacy `budget` / `standard` / `premium` tier remains as a compatibility fallback for old games and older callers, but new admin creation should prefer model + thinking depth.

Initial game-ready catalog entries:

| Catalog ID | Provider | Model ID | Notes |
|---|---|---|---|
| `openai:gpt-5-nano` | OpenAI | `gpt-5-nano` | Legacy budget fallback |
| `openai:gpt-5-mini` | OpenAI | `gpt-5-mini` | Legacy standard fallback |
| `openai:gpt-5.4-mini` | OpenAI | `gpt-5.4-mini` | Legacy premium fallback |
| `katana:grok-4-3` | Katana / IMGNAI | `grok-4-3` | Router-backed Grok testing lane |

Known unsuitable catalog entries:

| Catalog ID | Provider | Model ID | Reason |
|---|---|---|---|
| `katana:q-naifu-a3b` | Katana / IMGNAI | `q-naifu-a3b` | Disabled after local API-backed evaluation: JSON Schema transport worked, but core vote/revote/strategy decisions were repeatedly empty or semantically invalid and advanced via fallbacks |

Dynamic text catalog IDs are also accepted for provider evaluation: `katana:<model-id>`, `lm-studio:<model-id>`, and `custom-openai-compatible:<model-id>`. Known catalog entries keep nicer labels and capability hints; dynamic entries let local API-backed runs try newly available Katana or LM Studio text models without waiting for a code change.

Reasoning policy is explicit: `low`, `medium`, or `high` for fixed thinking depth, or `action-policy` for the engine's per-action defaults. The admin UI does not offer `none`.

Games without explicit `modelSelection` still map legacy tiers to fixed catalog defaults for old rows and older callers: budget -> `openai:gpt-5-nano`, standard -> `openai:gpt-5-mini`, premium -> `openai:gpt-5.4-mini`. Do not use tier env overrides for new work; choose an explicit catalog/model path instead.

## Simulator Workflow

1. Start LM Studio's local server.
2. Load a model and copy its exact model ID from LM Studio.
3. Run a small, bounded simulation:

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 4 --model <lm-studio-model-id> \
  --game-timeout-sec 600 --llm-timeout-sec 90
```

For Katana / IMGNAI router smoke testing, use the catalog path so the simulator selects the Katana provider profile and reasoning policy:

```bash
bun run simulate:katana:grok:smoke
```

Or choose the depth manually:

```bash
doppler run --project social-strategy-agent --config dev -- \
  bun run simulate -- --games 1 --players 4 --variant mingle \
  --model-catalog katana:grok-4-3 --reasoning-policy high \
  --game-timeout-sec 900 --llm-timeout-sec 120
```

4. If the model finishes, run a larger test (add `--chatty` for live colored transcript with per-decision thinking/reasoning visibility — highly recommended for Mingle and vote/power/council work):

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
  --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
```

Add `--strategic-reflections` when the run is specifically validating private strategic-reflection capture or Strategy Thread carry-forward. This keeps fast release-validation runs bounded by default while still writing `strategic-reflection` records, `strategy-packet` records, and later private `decisionLog` receipts when action tools produce them.

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

Simulation artifacts are written under `packages/engine/docs/simulations/`. For each game, use `game-N-turns.jsonl` for structured per-agent-turn analysis, `game-N-events.jsonl` for replayable accepted domain facts, `game-N.json` for the full transcript/result bundle, `game-N-progress.jsonl` for lightweight live progress, and `game-N.txt` for human-readable transcript review. `game-N-events.jsonl` uses the same `CanonicalGameEvent` envelope that API-backed games persist in Postgres, but local simulations do not create API database rows unless a future import command is explicitly added. Hidden `mingle-intent` records are always written to turns JSONL with `strategicLens` metadata and repaired live-player target fields; House room-assignment, Mingle turn, named-alliance `alliance-action`, House `alliance-huddle-schedule`, member `alliance-huddle-turn`, House `alliance-huddle-outcome`, vote, private `candidate-selection`, power records with bundled `shieldPullUp` details when Protect needs a replacement, normal Council votes, empowered Council tiebreakers only when normal Council votes tie, and `house-mc-summary` records are written by default. Canonical event logs carry accepted alliance facts such as proposals, activation, closure/archive, huddle scheduling, huddle completion, and huddle outcome records. Hidden `strategic-reflection` and `strategy-packet` records are written when `--strategic-reflections` is enabled, starting after Introductions and then at later-round vote / Council-diary reflection boundaries; House Strategy Bible, long-form summary, and producer brief records are written when `--rich-producer` is enabled.

For post-vote Mingle quality, verify that agents react to the prompt's `Current Board Contract`, phase-specific rules, `Current Stakes`, `Revealed Vote Ledger`, `Post-Vote Pressure`, and room-specific opportunity sections. The expected behavior is not forced pleading, but at-risk players should recognize when the empowered player is in their room, safe players should understand how Power can change Council danger, and everyone should be able to use named vote receipts as fuel for apologies, retaliation, pressure, and deals. Room numbers should stay stable across Mingle turns while the turn/beat number changes, and hidden Mingle intent should not carry eliminated or self targets in live target fields.

For saved-agent evaluation, the effective runtime now includes the owner-authored personality prompt, backstory, strategy instructions, persona key, resolved model/provider/reasoning/tool policy, and temperature. When comparing an analytical revision across simulations, hold that entire effective snapshot constant. A profile display/avatar change is not a strategy revision; a model or reasoning-policy change is.

For named-alliance quality, inspect whether Mingle I creates plausible official alliances without replacing post-vote fallout. Use turns JSONL to check sequential `alliance-action` proposer opportunities, invited response/counter resolution, consent/version behavior, `alliance-huddle-schedule` grant/skip rationale, pass-wise `alliance-huddle-turn` records, and compact `alliance-huddle-outcome` memory. Use events JSONL or the local game MCP projection tools for canonical alliance truth instead of parsing transcript prose. Huddle transcript entries use `scope: "huddle"` and are hidden live/player-safe evidence; public websocket, public transcript export, and public watch intelligence must not expose huddle speech or huddle-derived cognitive artifacts by default.

For API-backed games, the admin durable-run inspection adds a checkpoint hydration passport on each checkpoint summary. Use it as a readiness report only: it summarizes event/projection replay, boundary certificate, Runtime Snapshot v1 evidence, transcript/token cursors, private player/House continuity presence, owner epoch proof, and privacy validation. Runtime Snapshot v1 candidacy requires the token cursor, transcript watermark, actor witness, accumulator registry, and continuity evidence to bind to the same checkpoint boundary. It does not expose the private continuity capsule bodies, and `hydration_candidate` is not by itself resume support. Supported phase-boundary startup recovery exists only for checkpoints accepted by the implemented recovery selector; see `docs/statefulness-plan.md` for the current boundary list.

To query completed and still-growing simulation batches from another local MCP client, run:

```bash
cd packages/engine
bun run mcp:game -- docs/simulations
```

The server is read-only and scans the simulation corpus on demand. It addresses games by `sessionId + gameNumber`, rebuilds projections from `game-N-events.jsonl`, and exposes tools for listing sessions/games, reading projections, filtering canonical events, searching logs, reading player timelines, and following source pointers to linked turn records when present. Older batches without event logs remain searchable through turns/progress/transcript artifacts, but projection tools require canonical events. Tool results include `resourceUri` values such as `influence-game://sessions/<sessionId>/games/<gameNumber>/events`; pass those URIs to `resources/read` to pull full events, turns, progress, transcript, or game JSON artifacts through MCP instead of resolving `sourcePath` against the repo filesystem. To validate open strategy choices after a run, use `search_logs` with `sources: ["turns"]` for `mingle-intent`, `mingle-room-assignment`, `mingle-turn`, `alliance-action`, `alliance-huddle-schedule`, `alliance-huddle-turn`, `alliance-huddle-outcome`, `strategic-reflection`, `strategy-packet`, `strategicLens`, `decisionLog`, `gotoPlayerName`, `gotoStatus`, `empower-revote`, `candidate-selection`, `power-action`, or `shieldPullUp`. To validate canonical alliance truth, use `filter_events` for `alliance.proposed`, `alliance.activated`, `alliance.closed`, `alliance.huddle_scheduled`, `alliance.huddle_completed`, and `alliance.huddle_outcome_recorded`. To validate House producer carry-forward, search turns/transcript logs for `house-mc-summary`, legacy `[House MC]`, `house-strategy-bible`, `house-long-form-summary`, `house-producer-brief`, or a named House alliance hypothesis.

When validating the OAuth-gated path, keep the same corpus but launch the token bridge instead of the direct server. Assign the signed-in wallet the `producer` role, set `INFLUENCE_MCP_INTROSPECTION_SECRET` for both API and bridge, run `bun run mcp:game:login` from `packages/engine`, then run `bun run mcp:game:oauth -- docs/simulations`. The helper saves the one-hour token to `~/.influence-game/mcp-token.json`; set `INFLUENCE_MCP_TOKEN_FILE` if a connected MCP client needs a different path. The bridge uses a producer-capable OAuth token for trusted local validation.

For live or completed API-backed games you own seats in, start with the match-completeness tools under `games:read`: `read_match_manifest` reports independent lane status (canonical facts, authorized dialogue, optional owned cognition) and typed `nextReads` (preferring `read_owned_match_narrative` for token-efficient strategy analysis); `read_owned_match_narrative` groups authorized dialogue with owned strategy (default `strategic`/`compact`; use `full_cognition` for raw thinking); `read_match_transcript` pages owner-unified dialogue through the durable watermark or terminal boundary; `read_owned_match_cognition` pages owned thinking/strategy only when you need the ungrouped timeline. Producers use `read_producer_match_narrative` under `producer` for multi-seat product dialogue + cognition (not private traces). Do not treat transcript, cognition, or narrative prose as board-fact authority, and never reconstruct missing history from private traces. Local simulation artifacts (`game-N.txt`, turns JSONL, `--chatty`) remain first-class for model evaluation and still surface thinking / reasoningContext for human review.

For completed API-backed games, prefer the compact postgame read surfaces before reaching for raw events or private traces. The Production Game MCP exposes `read_game_brief`, `read_jury_breakdown`, `read_player_game_summary`, `read_game_turning_points`, `list_agent_games`, and producer-only `read_producer_game_analysis`; REST mirrors the game-scoped reads at `/api/games/:id/postgame/brief`, `/postgame/jury`, `/postgame/players/:player/summary`, and `/postgame/turning-points`. These DTOs are derived from persisted canonical events and completed result rows, so they are suitable for quick LLM analysis of who won, how the jury split, what each player did, and which derived vote cohorts, highlighted eliminations, momentum shifts, or turning points mattered. `read_game_brief` is the default first call: v2 briefs start with `executiveSummary`, include round `headline` values, expose `gameMomentum`, and carry confidence on derived objects. Derived vote cohorts are repeated shared vote outcomes, not confirmed alliance membership.

For local API durable-run inspection, run the Trace MCP from the API package:

```bash
./scripts/run-trace-mcp-local.sh
```

Use this when the interesting run happened through the API lifecycle rather than the simulator. `list_manifests` shows private trace metadata and counts for one durable run; `read_content` opens one raw JSON/JSONL trace through the manifest access path; `search_reasoning_traces` does run-scoped content search with bounded previews. This stdio wrapper is a local producer/debug tool and depends on local DB/private-storage env. The wrapper bootstraps Postgres plus the local private content bucket, sources private content endpoint/access-key env vars, and keeps setup output off stdout so stdio MCP clients can launch it as a one-line command. Local Postgres runs in Docker; sandboxed agents usually need elevated sandbox access for DB-backed commands against `127.0.0.1:54320`. `bun run trace:local:smoke` proves the writer/read/search path against a real object store. The deployed HTTP Production Game MCP surface wires equivalent explicit private trace tools behind the `producer` scope, while `games:read` clients should use `read_round_facts` for sanitized canonical vote/power/Council context alongside cognitive artifacts; see `docs/game-mcp-production-oauth.md`.

## Full Stack Local Provider

To run the API against LM Studio:

```bash
export INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1

doppler run --project social-strategy-agent --config dev -- env PORT=3000 bun run dev:api
```

The API still needs app/database/auth secrets from Doppler unless you provide equivalent local env vars. If LM Studio can generate normally but does not implement model metadata retrieval, start the API with `INFLUENCE_LLM_PREFLIGHT=off`.

Use the API-backed CLI when you want the run to show up in the API/web UI and write durable game rows instead of JSONL-only simulator artifacts:

```bash
# First obtain a producer MCP OAuth token if you do not already have one:
cd packages/engine
bun run mcp:game:login

# Then launch a real API-backed local-model game:
cd ../..
bun run simulate:api -- --provider lm-studio --model <lm-studio-model-id> --players 4
```

`simulate:api` uses `INFLUENCE_API_SESSION_TOKEN` when set. Otherwise it reads `INFLUENCE_MCP_TOKEN` or the saved `~/.influence-game/mcp-token.json` token and exchanges that producer MCP OAuth token for a normal app session through the loopback-only `/api/auth/local-cli-session` route. MCP tokens still do not authenticate normal app routes directly; the exchange is explicit local tooling and the minted session uses current RBAC permissions.

API simulator max rounds default to a short player-scaled smoke cap (`4 players -> 5`) unless `--max-rounds` is passed. Passing `--max-rounds auto` delegates to the normal API-created-game default.

For Katana text-model evaluation, run the API with `API_KAT_IMGNAI_KEY` and `API_KAT_IMGNAI_SECRET` available, then choose any Katana text model ID:

```bash
bun run simulate:api -- --provider katana --model deepseek-v4-flash --players 4
```

## What To Record

Create a dated note in `docs/simulations/` or near the generated batch artifacts with:

- model ID and quantization
- provider profile, catalog ID, and reasoning policy when using explicit model selection
- command run (include `--chatty` when used)
- player count, variant, timeout settings
- whether the game completed
- duration and token/call counts if available
- examples of good strategy (especially visible in the surfaced `thinking` / `reasoningContext` on VOTE / POWER / COUNCIL lines)
- examples of bad strategy, repetition, incoherence, or empty responses
- whether the output was enjoyable to watch
- whether Current Board Contract facts keep live players, eliminated players, jurors, empowerment, shields, Council status, and endgame status clear without stale targets
- whether the strategy menu creates natural deals, vote counting, pressure, repair, or restraint instead of forced strategy every turn
- quality and usefulness of the per-agent `thinking` and reasoning evidence captured in `game-N-turns.jsonl` and the transcript (raw native `reasoningContext` for local models, labeled provider summaries for hosted OpenAI)
- whether hidden `mingle-intent` records and House `mingle-room-assignment` records show varied initial rooms, assignment sources, repair notes, and a range of guarded, social, and explicit strategic choices
- whether Mingle I forms useful named alliances, overlapping memberships stay coherent, universal alliances close before huddle eligibility, and House-scheduled huddles produce compact outcomes without leaking hidden huddle transcript to public/player-safe surfaces
- whether Council diary questions respect the player's actual Council role, including empowered players whose tiebreak was not needed, and whether Judgment juror questions avoid repeating prior questions without exposing finalist answers inside question prompts
- whether `strategicLens` values across Mingle intent, strategic reflection, and Strategy Thread packets show varied evidence frames instead of collapsing into presentation/style reads
- whether later `decisionLog` receipts explain strategic pivots clearly enough for the next scheduled strategic reflection to reconcile them with the Strategy Thread
- whether House summaries help keep up with teams forming, leverage shifts, unresolved questions, and structured `roundFacts` between rounds without sounding like player-count bookkeeping
- when using `--rich-producer`, whether House Strategy Bible revisions carry alliance hypotheses forward instead of silently forgetting them, and whether diary producer briefs sharpen questions without leaking private producer reads as fact

When running with `--chatty`, the live terminal (and the written `game-*.txt`) will interleave House action lines with high-contrast bright-white `thinking:` and bright-cyan `reasoning:` blocks. For local models, `reasoning:` is raw native metadata such as `reasoning_content`; for hosted OpenAI simulations, it may be a labeled `OpenAI reasoning summary (...)` when summaries are enabled. These are the primary human-readable artifacts for evaluating whether the model is producing legible, producer-visible strategic reasoning. For scripts, MCP inspection, or post-run scoring, read `game-N-turns.jsonl`; it records each hidden Mingle intent, House Mingle room assignment, Mingle turn, vote, empower revote, private candidate selection, power action with bundled shield pull-up details when applicable, diary answer, strategic reflection when enabled, Strategy Thread packet update when produced, and endgame decision as clean JSON with `thinking`, `reasoningContext`, and decision-specific producer/debug fields such as `strategicLens` when available. Use `game-N-events.jsonl` when the question is board state, accepted outcomes, or deterministic replay.

## Current Product Context

Local model evaluation is a first-class lane because Influence needs agents that are fun for the user and friends to watch. The biggest qualitative gap is strategic depth. A cheaper or local model is only useful if it can sustain alliances, plans, betrayals, and endgame arguments across a complete game.
