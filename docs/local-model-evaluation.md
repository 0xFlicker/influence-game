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

Local OpenAI-compatible providers are not perfectly identical to OpenAI's hosted API. LM Studio may reject `tool_choice` objects like `{ type: "function", function: { name } }`; the default local mode sends `tool_choice: "required"` with one available tool instead. Local structured decision schemas keep the emitted `thinking` field, while raw provider reasoning metadata such as `reasoning_content` is stored separately as `reasoningContext`. Hosted OpenAI reasoning summaries are a separate Responses API feature; they default to `auto` for hosted OpenAI but remain off for local base URLs. Structured decisions use a global 8192-token completion floor, and public message calls use a global 4096-token completion floor with one doubled retry when visible content is empty. House Mingle room assignment, House alliance proposer selection, and House alliance-huddle scheduling/outcome summarization use the same structured floor before falling back to deterministic repair behavior. If a model/server still struggles with tools, try `INFLUENCE_LLM_TOOL_CHOICE_MODE=json_schema` to skip tool calls and request the tool argument schema as JSON response format. Known quirk: Qwen3-style thinking models served by LM Studio (e.g. `qwen3.8-27b-mlx`) route the entire `json_schema` completion into `reasoning_content`, leaving `content` empty even with `enable_thinking: false`; the model is generating valid schema JSON, but it never reaches `content`. For those models keep the default `required` tool mode and avoid `json_schema` — see `docs/simulations/2026-08-16-qwen3.8-27b-capability-probe.md`.

Player and House requests share a provider-independent system context that identifies Influence as a fictional, text-only social-strategy competition among AI characters. It defines targeting, elimination, survival, and format names as voting/removal mechanics rather than physical harm. When reviewing captured prompts, require this context on both hosted and local request shapes; do not treat it as permission to retry a provider `invalid_prompt` rejection unchanged.

Player speech uses the same exact `AgentResponse` contract across hosted and local providers. The provider must return one complete JSON document matching the invocation schema; plain text, fenced or embedded JSON, wrapper objects, extra fields, missing fields, and an empty `message` are structured-output failures and cannot become accepted speech or strategy. The accepted typed value is revalidated when a durable provider call is replayed. When a local server returns native reasoning metadata such as LM Studio's `reasoning_content`, the engine stores that value separately as transcript `reasoningContext`; it never substitutes for the required `thinking` field or public `message`.

Player decision tools use one exact argument contract in native tool mode and `json_schema` compatibility mode. Native mode requires exactly one call to the selected tool and validates its complete argument document; `json_schema` mode requires the complete response text to be that same argument document. Tool-name wrappers, `{ "arguments": ... }`, Markdown fences, JSON embedded in prose, missing or additional fields, and a missing or wrong native tool are typed failures under the shared retry policy. The engine never extracts a plausible object from presentation text.

Alliance-action provider requests keep the root object exact and put the action-specific fields under a required closed `decision` union. A response opportunity therefore exposes only its currently legal non-term actions plus a complete `counter` branch when countering is available; proposer opportunities expose exact `propose`, request-handle-bound `amend`, and `pass` branches. After names and request-local handles resolve, the accepted journal value remains the flat canonical ID-based alliance action. Huddle fact items use a nested `anyOf` of closed fact variants so the same exact schema works with hosted OpenAI and compatible fallback providers.

House control turns also decode to their domain value inside the provider-attempt boundary. Room assignments must cover every room and living player exactly once; proposer selections must spend the exact eligible budget; huddle schedules must form a complete scheduled/skipped partition within budget; huddle interpretations require the exact bounded fields; and diary follow-ups obey the four-question limit. Semantic failure retries as malformed output. Deterministic allocation/scheduling repair is available only after typed provider exhaustion, while invalid engine context and local schema/validator defects fail directly.

Every huddle outcome carries its durable schedule ID as its semantic provider coordinate. This keeps accepted-result identities distinct and restart-stable without relying on sorted-position packing. House controls also validate the provider and accepted representations separately when nullable provider `thinking` normalizes to an omitted accepted field; replay accepts that canonical omission without another dispatch but rejects explicit null and other noncanonical stored values.

API-backed game start performs a provider/model preflight before moving a waiting game into `in_progress`. This catches missing credentials, unavailable model IDs, and incompatible model metadata endpoints before the durable owner claim is created. If a local OpenAI-compatible server can generate normally but does not implement model metadata retrieval, set `INFLUENCE_LLM_PREFLIGHT=off` for that local API process and validate the model with a small simulator run first.

## Model Selection

New API-created games seal an ordered `providerManifest`. Each entry carries a `catalogId`, a reasoning policy, and—on fallbacks—a per-game call cap. The first entry is primary; later entries are tried in order only after bounded retry/repair policy permits failover. The admin form and API simulation CLI can add, remove, replace, and reorder the full list before game creation. `action-policy` is presented as **Adaptive** because the engine chooses the reasoning depth per action.

Game-ready catalog entries:

| Catalog ID | Provider | Model ID | Notes |
|---|---|---|---|
| `openai:gpt-5-nano` | OpenAI | `gpt-5-nano` | Selectable legacy low-cost model |
| `openai:gpt-5-mini` | OpenAI | `gpt-5-mini` | Legacy standard fallback |
| `openai:gpt-5.4-nano` | OpenAI | `gpt-5.4-nano` | Cheapest GPT-5.4-class game-ready model |
| `openai:gpt-5.4-mini` | OpenAI | `gpt-5.4-mini` | Legacy premium fallback |
| `openai:gpt-5.6-luna` | OpenAI | `gpt-5.6-luna` | Product baseline; GPT-5.6 cost-sensitive tier ($1 / $0.10 cached / $6 per 1M) |
| `katana:grok-4-3` | Katana / IMGNAI | `grok-4-3` | Router-backed Grok testing lane |
| `katana:glm-5-2` | Katana / IMGNAI | `glm-5-2` | Qualified preferred secondary Daily fallback; speech, strict JSON Schema, and named tools pass |
| `katana:grok-4-5` | Katana / IMGNAI | `grok-4-5` | Qualified tertiary Daily fallback; speech, strict JSON Schema, and named tools pass |

Known unsuitable catalog entries:

| Catalog ID | Provider | Model ID | Reason |
|---|---|---|---|
| `katana:q-naifu-a3b` | Katana / IMGNAI | `q-naifu-a3b` | Disabled after local API-backed evaluation: JSON Schema transport worked, but core vote/revote/strategy decisions were repeatedly empty or semantically invalid and advanced via fallbacks |

Dynamic text catalog IDs are also accepted for provider evaluation: `katana:<model-id>`, `lm-studio:<model-id>`, and `custom-openai-compatible:<model-id>`. Known catalog entries keep nicer labels and capability hints; dynamic entries let local API-backed runs try newly available Katana or LM Studio text models without waiting for a code change.

Reasoning policy is explicit: `low`, `medium`, or `high` for fixed thinking depth, or `action-policy` (**Adaptive**) for the engine's per-action defaults. The admin UI does not offer `none`.

Legacy games without a `providerManifest` project their existing `modelSelection` into a one-entry manifest during the bounded blue/green compatibility window. New public-game creation selects Luna as the primary entry. Do not use tier env overrides for new work; choose an explicit catalog/provider-manifest path instead.

### Daily fallback qualification — 2026-08-23

The exact Katana model IDs were exercised through the production OpenAI-compatible request shape with SDK retries disabled. Each model completed ordinary Influence speech, one strict JSON Schema vote, and one named-tool vote. The test records only sanitized usage and account credit deltas; it never prints credentials or the account balance.

```bash
doppler run --project social-strategy-agent --config dev -- \
  bun test --config=bunfig.manual.toml \
  packages/engine/src/__tests__/provider-fallback-qualification.live-provider.test.ts \
  --max-concurrency 1
```

| Catalog ID | Calls | Input tokens | Output tokens | Measured Katana credits | Result |
|---|---:|---:|---:|---:|---|
| `katana:grok-4-5` | 3 | 897 | 313 | 0.8 | Speech, JSON Schema, and named tool passed |
| `katana:glm-5-2` | 3 | 286 | 387 | 0.4 | Speech, JSON Schema, and named tool passed |

Katana currently publishes a $0.0052-per-credit reference price. The response usage omitted optional per-response router billing, so the balance delta—not an invented token rate—was the authoritative cost evidence. The Daily caps are 12 Grok calls and 24 GLM calls per game, giving the two fallbacks approximately equal maximum credit exposure under the observed small-call mix. Response speed was measured only as diagnostics and was not an admission criterion.

## Simulator Workflow

### OPERATOR-ONLY: Bounded Format-Kernel Proof

This is a post-handoff real-model confidence gate. **Implementing agents must not run or wait on these commands.** The operator starts from the repository root on the reported implementation branch and HEAD with a clean worktree, chooses one provider recipe, and keeps every run capped at two rounds.

Hosted OpenAI prerequisites: authenticate Doppler for `social-strategy-agent/dev`. That config may set `INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1`; the explicit model catalog below forces hosted OpenAI despite that local base URL.

```bash
cd packages/engine
doppler run --project social-strategy-agent --config dev -- \
  bun run simulate -- \
  --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
  --model-catalog openai:gpt-5-mini --flex --llm-timeout-sec 900
```

Hosted OpenAI game runs use Flex by default, including API-backed durable
games. Use `--standard` (or `--no-flex`) to request the normal auto lane.
Non-OpenAI providers do not receive a service-tier setting. Flex sends
`service_tier: "flex"`; resource-unavailable 429s retry with exponential
backoff three times, then retry once on the `auto` tier for that request. Later
requests begin on Flex again. Flex can be slower, so use a longer per-request
timeout for real-model evaluation runs. The generated `summary.md` separates
successful Flex usage from auto/default fallback usage, then shows the estimated
run spend followed by one all-model comparison table. Flex-supported OpenAI
models use Flex rates; unsupported OpenAI models and Grok retain standard
rates. 429 resource-unavailable retries are excluded because OpenAI does not
charge for them.

API completion metadata persists the requested tier and successful-response
usage grouped by the service tier OpenAI actually returned, including any
per-request fallback to `auto`.

Local LM Studio prerequisites: load the chosen model and start its OpenAI-compatible server on `127.0.0.1:1234`.

```bash
cd packages/engine
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- \
  --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
  --model <lm-studio-model-id> --llm-timeout-sec 300
```

Choose one recipe; do not run both unless comparing providers. Inspect the new `packages/engine/docs/simulations/batch-*/summary.md`, `game-1.txt`, and `game-1-turns.jsonl`, then record the provider/model, batch path, and each check as pass or fail:

- Default games freeze all seven registered formats: Save-or-Exit, The Short List, Safety Bounce, Highest Count, Even Votes, Restricted History, and Two Names. Restricted History is admitted only from round 3; Two Names is admitted with at least five living players. Rounds with two available cards contain `FORMAT MENU`, `FORMAT LOCKED`, and `FORMAT RESOLVE`, with no standard-round power action or Council elimination.
- Every two-card round has a `format-pick` record with useful `thinking` and `decisionSource: "llm"`.
- Save-or-Exit, The Short List, Highest Count, Even Votes, and non-forfeited Restricted History rounds have `format-ballot` records with useful `thinking` and `decisionSource: "llm"`.
- Safety Bounce rounds have `bounce-pointer` and `format-ballot` records with useful `thinking` and `decisionSource: "llm"`. Two Names rounds have initial-name, Override, conditional replacement, ordered plea, finalist-ballot, and conditional tiebreak records; canonical events show one initial Mingle and a second final-names Mingle only when Override is used.
- The Short List reasoning preserves zero-safe/fewest-positive semantics; Highest Count reasoning targets the highest total; Even Votes reasoning manipulates parity and recognizes zero as even plus the all-odd empowered fallback; Restricted History uses only the supplied never-before-targeted legal set and does not treat prior SAVE ballots as target history.
- Each elimination has exactly one `elimination-message` turn after `player.eliminated`; sealed formats expose received counts to that call without named voters.
- Any exercised `format-tiebreak` has useful `thinking` and `decisionSource: "llm"`.
- Any `decisionSource: "fallback"` fails the proof; inspect its `fallbackReason` and matching `agent_turn`.
- Agent thinking applies the active rule, and at least two observed formats produce non-identical coalition scripts.

Random two-card menus are not catalog coverage. To prove one round-1-eligible card, append `--formats <canonical-id>` (or `--format-manifest <canonical-id>`) with one of `save_or_eliminate`, `vote_bomb`, `safety_bounce`, `majority_elimination`, `even_votes`, or `two_names`. These simulation CLI values remain canonical engine IDs; provider and MCP surfaces instead use `save_or_exit`, `short_list`, and `highest_count`. The frozen one-format manifest must emit `format.selected` and complete the round without `format.menu_offered`, a `format-pick` turn, or an empowered pick model call. Restricted History must instead be tested in round 3 with at least one round-1-eligible companion card; `--formats restricted_history` is rejected because rounds 1–2 would have no legal format. A Two-Names-only proof must start with at least five players and inspect both Override branches. Use a separate bounded run per required card. Omitting `--formats` uses the seven-format default; two or more currently available ids retain the normal two-card menu. Whole-game timeout is off by default; add `--game-timeout-sec` only when the operator deliberately wants a wall clock.

Initial triage:

- Hosted run reaches LM Studio: keep `--model-catalog openai:gpt-5-mini`, or clear `INFLUENCE_LLM_BASE_URL`, `OPENAI_BASE_URL`, and `LM_STUDIO_BASE_URL` for that process.
- Local run cannot connect: confirm LM Studio is serving `http://127.0.0.1:1234/v1`.
- A batch misses a format: retain the batch and repeat the same two-round recipe, aggregating coverage.
- A format action falls back: inspect the turn's `fallbackReason`, tool payload, legal options, and reasoning before changing resolver math.

1. Start LM Studio's local server.
2. Load a model and copy its exact model ID from LM Studio.
3. Run a small, bounded simulation:

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 6 --model <lm-studio-model-id> \
  --game-timeout-sec 600 --llm-timeout-sec 90
```

For Katana / IMGNAI router smoke testing, use the catalog path so the simulator selects the Katana provider profile and reasoning policy:

```bash
bun run simulate:katana:grok:smoke
```

Or choose the depth manually:

```bash
doppler run --project social-strategy-agent --config dev -- \
  bun run simulate -- --games 1 --players 6 --variant mingle \
  --model-catalog katana:grok-4-3 --reasoning-policy high \
  --game-timeout-sec 900 --llm-timeout-sec 120
```

4. If the model finishes, run a larger test (add `--chatty` for live colored transcript with per-decision thinking/reasoning visibility — highly recommended for Mingle, format pick, ballot, pointer, and tiebreak work):

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
  --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
```

Add `--diary` when the run is specifically validating post-eviction strategy replacement, optional follow-up refinement, or repair on the next eligible action. Compact strategy rides the diary/gameplay calls already being purchased; there is no strategic-reflection flag or reflection-only cadence. On ordinary decisions, a non-null delta should be exceptional and actionable: a changed target, alliance posture, commitment, threat assessment, priority, or contingency. Strict schemas should return JSON `null` when current strategy still applies; compatible outputs may omit the field. The engine normalizes the exact string `"null"` to the same no-change result. Action summaries, baseline restatements, unchanged intent, and proof-of-consideration filler are quality failures even when mechanically valid.

Use `--house-summaries` when you want the same terminal to print only concise `[House MC]` summary lines without turning on the full `--chatty` transcript or hidden reasoning output. `house-mc-summary.response.roundFacts` remains a House/operator narration helper (including omniscient `formatResolution` ballots for House MC). For durable public format proof prefer canonical events / MCP:

- `format.menu_offered` / `format.selected` / `format.resolved` / Safety Bounce pointer events in `game-N-events.jsonl` or Production `filter_events`
- MCP `read_projection.summary.formatMenu` (`offeredFormatIds`, `selectedFormatId`)
- MCP `read_round_facts.format.acceptedBallots` for the complete sanitized operator ledger immediately after durable acceptance; `ballotPresentation.rollCall` is populated only after resolution for viewer pacing

Private decision rationale still lives in transcript/turn records (`format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`) and must not be treated as the public board-fact path. Participating-agent context remains rule-restricted and must not receive the operator ledger before resolution. The web viewer may buffer already transport-readable sanitized mappings for Tally → Roll Call choreography; that delay is presentation, not confidentiality.

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
  --variant mingle --house-summaries --game-timeout-sec 7200 --llm-timeout-sec 300
```

Use `--diary` when you need bounded diary sessions after the format kernel resolves; legacy/classic runs also retain the post-Council boundary. Use `--rich-producer` when the run is validating House narrative carry-forward and diary-room production quality. It enables those diary surfaces plus private `house-long-form-summary` records over the same House narrative notebook. The ordinary `house-mc-summary` record and clean House system transcript entry are emitted by default in simulation config so you can follow the game between rounds even without `--chatty`.

For compact-delta validation, report each exercised action family with total decision calls, non-null strategy candidates, accepted/rejected/no-change strategy results, and provider output tokens. Review retained deltas for future usefulness, not obedience: pivots and betrayals remain valid, alliance prose is not an obligation, and the accepted action/event remains authoritative. Preserve rejected/no-change diagnostics in producer artifacts rather than filtering them out of the evidence set.

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
  --variant mingle --chatty --rich-producer --game-timeout-sec 7200 --llm-timeout-sec 300
```

Simulation artifacts are written under `packages/engine/docs/simulations/`. For each game, use `game-N-turns.jsonl` for structured per-agent-turn analysis, `game-N-events.jsonl` for replayable accepted domain facts, `game-N.json` for the full transcript/result bundle (producer artifact — may contain private dialogue and is **not** a safe Recall Plan promotion input), `game-N-progress.jsonl` for lightweight live progress, `game-N.txt` for human-readable transcript review, `game-N-prompt-reuse.json` for structural prompt-prefix reuse, and `game-N-recall-plan.json` for the **safe structural Recall Plan receipt aggregate** (prompt-class counts, protected/hot/history token estimates, lane/source-class counts, actor-authorized event boundary — no dialogue, names, entry IDs, prompts, thinking, or reasoning). `game-N-events.jsonl` uses the same `CanonicalGameEvent` envelope that API-backed games persist in Postgres, but pure local simulations do not create API database rows. Live standard rounds begin with one House room-assignment request rather than per-player `mingle-intent` calls; historical or isolated fixtures may still contain intent records. Each alliance window adds one private House `alliance-proposer-selection` call/turn for exactly `ceil(alive / 4)` access seats. The engine repairs invalid, duplicate, excess, or short results underrepresentation-first; only finalized players receive proposer `alliance-action` calls, while invitee response/counter calls remain demand-driven. House room-assignment, Mingle turn, named-alliance `alliance-action`, House `alliance-huddle-schedule`, member `alliance-huddle-turn`, House `alliance-huddle-outcome`, vote, conditional `format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`, diary, and `house-mc-summary` records are written when exercised. Eligible decision records carry `thinking`, optional `reasoningContext`, strategy candidate/result metadata, `decisionSource`, and nullable `fallbackReason`; any fallback is diagnostic evidence, not proof of model-authored play. Canonical format events preserve the public board path for durable replay and MCP: `format.menu_offered` (chooser + pair, absent for one-format manifests), `format.selected` (lock), `format.safety_bounce_*` (public bounce), `format.resolved` (aggregates + elimination), and `format.ballot_cast` (a shared sanitized voter-to-target viewer ledger; raw envelope provenance stays producer-only). Historical `format.resolved` payload version 1 carries only the original trio's exclusive bags; new resolutions use version 2 capability aggregates, while every other canonical event remains version 1. Unsupported event/version pairs fail closed. Legacy/classic `candidate-selection`, `power-action`, and Council records may remain readable in old or explicitly classic artifacts, but they are not the expected default standard-round lane. `--rich-producer` adds private House-authored long-form summary records. Their prose and the House notebook are producer presentation and never contestant knowledge or canonical continuity.

Treat simulation `endgameType` and endgame/Judgment instrumentation as projections of `game-N-events.jsonl`, not transcript inspection. The latest canonical `endgame.stage_set` sequence determines `reckoning`, `tribunal`, or `judgment`; absence means `normal`. Stage totals count canonical stage events, jury-question totals count accepted `judgment.speech_recorded` questions, and jury-ballot totals count `jury.vote_cast`. House banner copy may be localized, changed, duplicated, or absent without changing those results.

For format-aware Mingle quality, verify that agents react to `Current Board Contract`, `Current Format Pressure`, the locked rule sheet, visibility guidance, `Current Stakes`, and room-specific opportunities. Agents should coordinate only legal ballots or pointers after lock, then use the post-room named-alliance window and scarce huddles to build concrete vote blocs with targets, expected votes, and contingencies. They should understand that empowerment is not immunity; Save-or-Exit, The Short List, Highest Count, Even Votes, and Restricted History ballots are sealed; Safety Bounce pointers are public; and its final ballot is sealed. For every `bounce-pointer`, verify the actor reasons from the explicit mapping: SAFE actor → target VULNERABLE and eligible for the final vote; VULNERABLE actor → target SAFE and protected from that vote. Fail the reasoning-quality check if `thinking` or `reasoningContext` treats the pointer itself as SAFE/VULNERABLE or contradicts `response.classification`, even when the engine applied the correct canonical result. Room numbers should stay stable across Mingle turns while the turn/beat number changes. Live standard rounds should have no `mingle-intent` turns.

For saved-agent evaluation, the effective runtime now includes the owner-authored personality prompt, backstory, strategy instructions, persona key, resolved model/provider/reasoning/tool policy, and temperature. When comparing an analytical revision across simulations, hold that entire effective snapshot constant. A profile display/avatar change is not a strategy revision; a model or reasoning-policy change is.

For named-alliance quality, inspect whether the post-pick Format Mingle sequence creates plausible official vote blocs under the locked rules. Use turns JSONL to confirm one private `alliance-proposer-selection` artifact, the exact ceiling access budget, underrepresentation-first repair notes, selected-only proposer calls, and demand-driven invited response/counter calls. The House selects access only: agents retain members, terms, propose/amend/pass, and may decline; consent and activation remain the existing canonical transaction. Continue checking room talk before `alliance-action`, consent/version behavior, `alliance-huddle-schedule` grant/skip rationale, and pass-wise `alliance-huddle-turn` target/action/member-commitment/contingency/confidence/dissent facts. Judge huddle usefulness from concrete decision-relevant coordination, not alliance compliance or raw alliance count. `alliance-huddle-outcome` memory must retain member facts; House prose may compact them but must not manufacture agreement. Huddle commitments are available in full authorized owner/member and producer alliance reads, while compact/public reads remain summary-only. Huddle transcript entries use `scope: "huddle"` and are hidden live/player-safe evidence; public websocket, public transcript export, and public watch intelligence must not expose huddle speech or huddle-derived cognitive artifacts by default.

For API-backed games, current execution authority is the committed logical-turn frontier: XState snapshot, typed cursor, canonical/dialogue heads, player continuity, House narrative continuity, provider-call journal links, and viewer-publication head. Restart the API normally during local evaluation; startup adopts unfinished `in_progress` games and continues the same ID. The admin durable-run read model may still show hydration passports for historical checkpoint rows, but those are forensic status reports and are not current startup selectors. See `docs/statefulness-plan.md` for the exact durability contract and limits.

To query completed and still-growing simulation batches from another local MCP client, run:

```bash
cd packages/engine
bun run mcp:game -- docs/simulations
```

The server is read-only and scans the simulation corpus on demand. It addresses games by `sessionId + gameNumber`, rebuilds projections from `game-N-events.jsonl`, and exposes tools for listing sessions/games, reading projections, filtering canonical events, searching logs, reading player timelines, and following source pointers to linked turn records when present. Older batches without event logs remain searchable through turns/progress/transcript artifacts, but projection tools require canonical events. Tool results include `resourceUri` values such as `influence-game://sessions/<sessionId>/games/<gameNumber>/events`; pass those URIs to `resources/read` to pull full events, turns, progress, transcript, or game JSON artifacts through MCP instead of resolving `sourcePath` against the repo filesystem. To validate open strategy choices after a run, use `search_logs` with `sources: ["turns"]` for `mingle-room-assignment`, `mingle-turn`, `alliance-proposer-selection`, `alliance-action`, `alliance-huddle-schedule`, `alliance-huddle-turn`, `alliance-huddle-outcome`, `format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`, `decisionSource`, `fallbackReason`, `strategyCandidate`, `strategyResult`, `strategyDelta`, `strategy`, `strategicLens`, `gotoPlayerName`, `gotoStatus`, or `empower-revote`. Search `mingle-intent`, legacy `candidate-selection`, `power-action`, and `shieldPullUp` only when inspecting isolated or older batches. To validate canonical alliance truth, use `filter_events` for `alliance.proposed`, `alliance.activated`, `alliance.closed`, `alliance.huddle_scheduled`, `alliance.huddle_completed`, and `alliance.huddle_outcome_recorded`. To validate House producer carry-forward, search turns/transcript logs for `house-mc-summary`, legacy `[House MC]`, `house-long-form-summary`, or a named House alliance hypothesis.

When validating the OAuth-gated path, keep the same corpus but launch the token bridge instead of the direct server. Assign the signed-in wallet the `producer` role, set `INFLUENCE_MCP_INTROSPECTION_SECRET` for both API and bridge, run `bun run mcp:game:login` from `packages/engine`, then run `bun run mcp:game:oauth -- docs/simulations`. The helper saves the one-hour token to `~/.influence-game/mcp-token.json`; set `INFLUENCE_MCP_TOKEN_FILE` if a connected MCP client needs a different path. The bridge uses a producer-capable OAuth token for trusted local validation.

For live or completed API-backed games you own seats in, start with the match-completeness tools under `games:read`: `read_match_manifest` reports independent lane status (canonical facts, authorized dialogue, optional owned cognition) and typed `nextReads` (preferring `read_owned_match_narrative` for token-efficient strategy analysis); `read_owned_match_narrative` groups authorized dialogue with owned strategy (default `strategic`/`compact`; use `full_cognition` for raw thinking); `read_match_transcript` pages owner-unified dialogue through the durable watermark or terminal boundary; `read_owned_match_cognition` pages owned thinking/strategy only when you need the ungrouped timeline. Producers use `read_producer_match_narrative` under `producer` for multi-seat product dialogue + cognition (not private traces). Do not treat transcript, cognition, or narrative prose as board-fact authority, and never reconstruct missing history from private traces. Local simulation artifacts (`game-N.txt`, turns JSONL, `--chatty`) remain first-class for model evaluation and still surface thinking / reasoningContext for human review.

For a producer-side accepted-action check, work from indexes toward raw content: `inspect_durable_run` for the trusted prefix and prompt-reuse coverage/watermark, `list_trace_manifests` for linkage counts and a concrete `decisionId`/`eventSequence`, `read_producer_match_narrative` for the minimal `{seq,type}` citation, and producer `filter_events` for the exact canonical envelope. Use `read_trace_content` only for the selected manifest and cap `maxBytes`. A nonzero prompt-reuse watermark proves that linked accepted actions reached the rollup; `coverage: "partial"` is still expected when speech, reflection, intent, pass, rejection, timeout, fallback, repair, or legacy calls remain unlinked. Aggregate reuse and first-break math do not change.

Only a fresh receipt from the current model call can reach a direct accepted-action pointer. The accepted-action path does not consult `getLastPrivateDecisionId()`. Correlation is forward-only and post-append: no historical inference, no raw-object rewrite, and no gameplay rollback when trace-side reconciliation degrades. Board facts still come from canonical events; owner narrative citations remain cognition-gated and minimal, while public/player event reads remove decision-bearing pointers.

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
bun run simulate:api -- --provider lm-studio --model <lm-studio-model-id> --players 6
```

`simulate:api` uses `INFLUENCE_API_SESSION_TOKEN` when set. Otherwise it reads `INFLUENCE_MCP_TOKEN` or the saved `~/.influence-game/mcp-token.json` token and exchanges that producer MCP OAuth token for a normal app session through the loopback-only `/api/auth/local-cli-session` route. MCP tokens still do not authenticate normal app routes directly; the exchange is explicit local tooling and the minted session uses current RBAC permissions.

API simulator max rounds default to a short player-scaled smoke cap (`6 players -> 7`) unless `--max-rounds` is passed. Passing `--max-rounds auto` delegates to the normal API-created-game default.

For Katana text-model evaluation, run the API with `API_KAT_IMGNAI_KEY` and `API_KAT_IMGNAI_SECRET` available, then choose any Katana text model ID:

```bash
bun run simulate:api -- --provider katana --model deepseek-v4-flash --players 6
```

## What To Record

Create a dated note in `docs/simulations/` or near the generated batch artifacts with:

- model ID and quantization
- provider profile, catalog ID, and reasoning policy when using explicit model selection
- command run (include `--chatty` when used)
- player count, variant, timeout settings
- whether the game completed
- duration and token/call counts if available
- examples of good strategy (especially visible in the surfaced `thinking` / `reasoningContext` on `format-pick`, `format-ballot`, `bounce-pointer`, and `format-tiebreak` records)
- examples of bad strategy, repetition, incoherence, or empty responses
- whether the output was enjoyable to watch
- whether Current Board Contract and Current Format Pressure keep live players, eliminated players, jurors, empowerment, offered/locked format, rule summary, visibility, and endgame status clear without stale Power/Council pressure
- whether the strategy menu creates natural deals, vote counting, pressure, repair, or restraint instead of forced strategy every turn
- quality and usefulness of the per-agent `thinking` and reasoning evidence captured in `game-N-turns.jsonl` and the transcript (raw native `reasoningContext` for local models, labeled provider summaries for hosted OpenAI)
- whether hidden `mingle-intent` records and House `mingle-room-assignment` records show varied initial rooms, assignment sources, repair notes, and a range of guarded, social, and explicit strategic choices
- whether post-pick Format Mingle emits one private House proposer-selection artifact at the exact ceiling budget; repairs favor underrepresented players; only finalized players receive proposer calls; unselected invitees still respond; opportunity-specific alliance schemas avoid rejected actions; response identity is engine-bound rather than UUID-transcribed; amendment consent completes; overlapping memberships stay coherent; universal alliances close before huddle eligibility; and House-scheduled huddles record useful typed member atoms while keeping dialogue and optional House interpretation outside canonical/contestant continuity
- whether legacy Council diary questions remain role-correct when that classic lane is deliberately exercised, and whether Judgment juror questions avoid repeating prior questions without exposing finalist answers inside question prompts
- whether non-null compact strategy deltas are exceptional, actionable changes in targets, alliance posture, commitments, threat assessment, priorities, or contingencies rather than paraphrases of the current action or baseline
- whether the run uses the intended persisted Agent Profile Strategy; unsaved editor text and Owner Learning before/after presentation are never simulation input
- whether action-family counts distinguish non-null, accepted, rejected, and no-change candidates and pair them with output tokens without treating strategy prose as canonical or alliance compliance as a quality metric
- whether the first diary answer after an eviction reconciles the old epoch and whether an optional follow-up refines rather than replaces that accepted baseline
- whether House summaries help keep up with teams forming, leverage shifts, and unresolved questions without treating the currently legacy-shaped `roundFacts` payload as format proof
- when using `--rich-producer`, whether House-authored public and long-form copy carries arcs forward through the single private notebook; whether notebook/private canaries stay out of viewer payload fields and contestant prompts; and whether diary/Judgment questions remain specific while using only actor-scoped knowledge

## House narrative evaluation

House narration is a creative provider lane, not a factual proof lane. A material cadence turn makes one exact-schema provider call returning nullable `publicSummary` and `privateNarrativeNotebook` fields. The engine publishes accepted summary bytes unchanged after shape, control-character, and beat-length validation. A non-null notebook replaces the whole bounded private snapshot; null, malformed output, refusal, or exhaustion preserves the previous snapshot. Neither field is parsed into game state.

The narration context is compiled from bounded canonical events, the canonical projection, accepted dialogue, diary Q&A, and private producer context. Milestone turns may receive the omniscient lanes and update the notebook; ordinary turns normally receive the public/canonical delta and preserve the notebook. The context has no evidence aliases, model-authored claims, receipts, source maps, fact-read action, or deterministic renderer. Canonical events and projections remain authoritative because reducers and classifications never consume House prose.

`--rich-producer` enables diary sessions and private House long-form copy. It does not add a Strategy Bible, per-player producer brief, or another House memory call. Diary interviewers and Judgment agents use actor-scoped `PhaseContext` plus that player's own prior diary Q&A. They never receive House summaries, the private notebook, other players' diary answers, peer-only private conversations, or sealed decisions owned by somebody else.

### R32 provider-surface comparison

This opt-in paid lane captures the visible presentation plus engine-generated status, provider calls, latency, usage, and cost for two diary controls, ordinary and milestone summaries, one long-form producer sample, and Judgment Q&A. It generates no semantic pack hashes, prompt fingerprints, source attestations, or automatic factual grades.

```bash
doppler run --config dev -- \
  bun run --cwd packages/engine evaluate:r32-provider-surfaces -- \
    --stage=after \
    --catalog-id=openai:gpt-5.6-luna \
    --reasoning-policy=low \
    --tool-choice-mode=named \
    --service-tier=flex \
    --reasoning-summary=auto \
    --samples=3 \
    --output-dir=.local-uploads/r32-provider-surfaces/house-narrative-after
```

Raw prompts, provider payloads, reasoning, private narration context, notebook state, and visible outputs stay in the owner-only `private-run.json`. `manifest.json` is a whitelist of scenario coordinates and operational telemetry. Review the before/after visible outputs side by side for summary legibility, arc continuity, diary specificity, and player-knowledge compliance; record qualitative notes as human review, never by parsing prose into asserted game facts.

Run the provider-free mechanics first:

```bash
bun test --config=../../bunfig.toml \
  ./src/__tests__/house-summary-frontier.test.ts \
  ./src/__tests__/house-interviewer-structured-output.test.ts \
  ./src/__tests__/house-summary-cadence.test.ts \
  ./src/__tests__/house-long-form.test.ts \
  ./src/__tests__/diary-room-strategy.test.ts \
  ./src/__tests__/extracted-modules.test.ts \
  ./src/__tests__/provider-scenario-evaluation.test.ts \
  --max-concurrency 1
bun run --cwd packages/engine typecheck
```

The superseded R21 receipt/frontier comparison is retained only in git history. Its low-legibility deterministic summaries and proof-call overhead motivated this simpler authored-narrative contract; its emission, specificity, alias, fact-read, and receipt gates no longer define success.

When running with `--chatty`, the live terminal (and the written `game-*.txt`) will interleave House action lines with high-contrast bright-white `thinking:` and bright-cyan `reasoning:` blocks. For local models, `reasoning:` is raw native metadata such as `reasoning_content`; for hosted OpenAI simulations, it may be a labeled `OpenAI reasoning summary (...)` when summaries are enabled. These are the primary human-readable artifacts for evaluating whether the model is producing legible, producer-visible strategic reasoning. For scripts, MCP inspection, or post-run scoring, read `game-N-turns.jsonl`; it records House room assignment, Mingle turns, named-alliance actions and huddles, votes, empower revotes, `format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`, diary answers, strategy-operation results, and endgame decisions as clean JSON with `thinking`, `reasoningContext`, and producer/debug fields. Reasoning and strategy prose explain an attempted decision; they are never canonical game facts. Use `game-N-events.jsonl` when the question is board state, accepted outcomes, or deterministic replay.

### Selective context recall evaluation levels

Agent prompts are built from a server-owned **Recall Plan** (protected Board Contract + compact strategy + authorized typed huddle fact atoms, hot active-room speech, and — only for `strategic_decision` — budgeted authorized history). Ordinary speech has no historical archive lane. Protected overflow does not erase all strategic recall: decisions retain at most 1,200 archive characters while protected material remains complete. Relevant current-round statements from living players named in compact strategy receive bounded ranking preference; zero-overlap dialogue still cannot enter history. Reviewers should:

1. **Prove the release gate with fixture tests** (deterministic, offline):
   ```bash
   bun test packages/engine/src/__tests__/context-recall-evaluation.test.ts
   bun test packages/engine/src/__tests__/context-recall-plan.test.ts
   bun test packages/engine/src/__tests__/context-recall-replay.test.ts
   ```
   These assert ≥50% estimated input-token reduction vs the frozen late-game baseline, equal model-call count, full protected coverage, zero unauthorized private selections, and a relevant authorized memory under protected overflow. Token estimates use `ceil(characters / 4)`; provider usage is informational only.
2. **Inspect structural receipts** from a simulation via `game-N-recall-plan.json` (`coverage: "structural_recall_receipts"`). Use lane counts and event-boundary rollups only.
3. **Do not** treat full `game-N.json`, private-trace JSON, or turns JSONL as the promotion input for context reduction. Those remain producer debug surfaces; they can contain foreign private dialogue that must never re-enter another seat's Recall Plan.

Use the deterministic fixture gate for structural promotion evidence. If one concrete context decision remains unresolved, use the local [real-thread context evaluator](prompt-thread-context-evaluation.md) to replay an authorized durable thread through isolated policy revisions and blind review. Its `strategic-probe` makes zero provider calls and proves only selection direction for the two real Mingle-intent contexts, not model use or behavior. Inspect its rank slot, lexical/combined score, current-round and target-speaker matches, serialized cost, and terminal reason before changing a reserve. Curator and panel dispatch require separate immutable approvals and must never be launched as an implementation-agent completion step. Use a bounded full-game simulation only for the remaining integration/watchability question. A real-thread win is case-specific, and a full-game impression is not controlled causal evidence.

Privacy contract for call sites and replay: historical Mingle eligibility requires modern `speakerPlayerId` / `audiencePlayerIds` (no display-name upgrade on legacy rows). Huddle protected memory uses immutable `participantPlayerIds` (or recovery from matching completed-session speakers only). See `docs/reasoning-transcript-observability.md` § Selective Context Recall and `CONCEPTS.md` (Recall Plan).

## Current Product Context

Local model evaluation is a first-class lane because Influence needs agents that are fun for the user and friends to watch. The biggest qualitative gap is strategic depth. A cheaper or local model is only useful if it can sustain alliances, plans, betrayals, and endgame arguments across a complete game.
