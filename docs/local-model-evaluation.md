# Local Model Evaluation

Retrospectives remain speech-only. The prompt distinguishes beliefs and information available during play from facts revealed after the game, and invites one or two concrete moments rather than a mandatory success/failure recap. Werewolf speakers receive a named canonical reference for their own ballots and night choices, starting role/faction, known pack members, and investigations available before elimination. Death-night checks remain in the revealed account but are excluded from usable in-game knowledge. Fallback actions are marked unavailable; dialogue and earlier final statements cannot establish facts or motives. No private thinking, rationale, or event-reference output is requested. Existing frozen game accounts and accepted speeches are unchanged. The retrospective also receives a named postgame summary of winners, survivors, actual night/day eliminations, and vote tallies/abstentions. It checks earlier final statements against these canonical facts. Winners can include dead teammates. Knowledge differences remain explicit without supplying stock before-and-after phrases; the output remains speech-only.

Werewolf decision prompts name the acting player, identify elimination targets and previous ballots by both ID and name, and distinguish an elimination vote from endorsement. Strategic coaching is selected by assigned role: village roles receive village objectives plus their role advice; wolves receive pack objectives and deception guidance. Shared vote instructions contain mechanics, not faction-specific strategic examples. Public dialogue discloses whatever it says: claiming a personal investigation implies a Seer claim, even without naming the role. Useful contributions can interpret existing arguments or change a vote without adding new facts. Gameplay decisions allow 8,192 completion tokens for native reasoning plus the structured response; the 320-byte speech and existing private-thinking limits remain separate. Replay omits technical discussion-byte readouts; no replacement progress display is introduced.

Werewolf replay skips discussion passes even with **Show thinking** enabled. Pass decisions and their thinking remain saved for debugging through API/MCP; contestants cannot see passes or scheduler metadata.

Contestant privacy: Werewolf model observations expose roster IDs, names, and alive status only; archetypes and image metadata remain spectator-only. Each agent retains its own personality, backstory, and strategy instructions. Influence likewise projects roster identity/status without character metadata. Private reasoning and spectator exports are diagnostics, not contestant context.

Werewolf freezes the effective game-specific strategy at game start: owner notes when present, otherwise a Werewolf archetype default. CLI House characters use those same defaults. Inspect the private starting event when comparing strategy behavior; changing an archetype or saved notes later does not change a running game. The AI editor writes independent Influence and Werewolf blocks without reusing Influence tactics as a fallback.

The shared `/games/new` creator supports 6–8 Werewolf seats, 1–2 wolves, and optional Seer/Doctor roles. The initial event freezes this setup; agents see those public role counts and only receive actions for their actual assigned role. Archetype pool/fill settings apply to House-filled seats. Visual Mode generates spectator scenes through the existing image renderer; it does not add player reasoning or change original speech. CLI presets remain six/eight seats; `--game ID_OR_SLUG` can report a custom UI-created game without inference.

## Werewolf evaluation

Paid evaluation uses `bun run simulate:werewolf:api --audience omniscient --transcript --model-catalog openai:gpt-6-luna` against the localhost dev deployment. Set `WEREWOLF_EVALUATION_BUDGET_USD=15` and `WEREWOLF_EVALUATION_BUDGET_LEDGER=/absolute/path/to/shared-ledger.json` on the **game-worker**, preserving the same ledger across models, retries, compaction, retrospectives and restarts. The server rejects unpriced models under this guard. Do not reset prior spend when switching from file-only runs. Admit one complete game at a time with headroom for its full run; a provider reservation ceiling alone does not guarantee completion. Keep all evidence, including successful thinking and available native reasoning, in private storage. API reports are convenience transcripts, not substitutes for the durable journal. Use absolute `--out` paths; package scripts execute from `packages/engine`.

Fresh games use rules v9. The current day has one shared discussion allowance (400 UTF-8 bytes per living player) and 320 bytes per accepted message. The engine stops offering turns when fewer than one full message allowance remains, or after a complete silent sweep; it does not promise that everyone speaks. A named recipient receives the next opportunity for up to three directed handoffs, with a final redirect/pass. Then every living player receives one seeded, sequential public ballot with optional speech. Voters see earlier choices and messages. Elimination requires a strict majority of all living players; a shortfall ends the day without elimination. It is never plurality and never returns to discussion.

Two wolves make combined speech-and-target proposals for up to three full exchanges, ending as soon as current targets agree. This can take up to six individual decisions but does not force six. A lone wolf selects one target. Pack proposals are private to wolves and Omniscient readers. Accepted speech, public choices, receipts and remaining budgets come from canonical typed entries; do not infer facts from prose. v7/v8 runs keep their historical ordered-thread and sealed-checkpoint behavior.

For quality work, use complete seeded games across multiple days. Quick coverage uses six seats and one wolf. Include full two-wolf games to evaluate proposal behavior. Do not use `--max-days 1` or truncate games as substitutes for whole-game evidence; the default ten-day ceiling allows normal faction victories to end sooner. Inspect `--chatty --transcript`, canonical events, turn JSONL, and provider receipts. Distinguish a chosen pass from provider-unavailable silence, a missed discussion opportunity, and a vote abstention. Review whether commitments are remembered, arguments address the latest exchange, late-turn redirects sound natural, votes use public receipts, and players who never received a floor offer are distributed fairly over whole games. A small batch supports qualitative iteration, not faction-balance claims. See the [v9 full-game quality report](reviews/2026-10-19-werewolf-v9-model-quality.md) for the paid baseline and the separately identified optional-participation prompt refinement. The prompt now explicitly asks for null text when a contribution would only agree, repeat an unchanged suspicion or promise, or repeat that evidence is missing; measure actual voluntary passes rather than assuming this instruction works.

The authorized evaluation ceiling is **$15 aggregate**, shared across all runs. Twenty to thirty complete games is only a planning estimate; stop admitting games when a complete run no longer fits. Set the shared guard on the local game-worker, then use API simulations:

```sh
# In the worker terminal; reuse the existing ledger if the evaluation already began.
WEREWOLF_EVALUATION_BUDGET_USD=15 WEREWOLF_EVALUATION_BUDGET_LEDGER=/tmp/werewolf-v9-budget.json bun run dev:game-worker

# In a separate terminal with the API and web app running:
bun run simulate:werewolf:api --preset one_wolf --model-catalog openai:gpt-6-luna --audience omniscient --transcript
bun run simulate:werewolf:api --preset two_wolves --model-catalog meta-muse:muse-spark-1.3-contributor --audience omniscient --transcript
```

Budgeted calls are limited to `openai:gpt-6-luna` and `meta-muse:muse-spark-1.3-contributor`. The ledger reserves estimated maximum attempt cost before dispatch, rejects overlapping ledger writes, and keeps unknown terminal reservations charged. Run games one at a time. Before each game, compare remaining committed headroom against a conservative whole-game allowance: at least $1 or twice the largest observed completed-game reservation for the selected model and preset, whichever is greater. Record the comparator and admission decision; use a broader reserve if comparable evidence is absent. The worker enforces per-attempt admission; the operator performs the whole-game check separately. Pending reservations are already included in the committed total and must not be counted twice. Preserve each API game ID and its server-generated seed, all private evidence, and the shared ledger. The cap is a guard, not a promise that a planned game count will fit. Do not publish canonical logs, hidden roles, strategies, or private rationale.

Start `bun run dev:api`, the budget-configured `dev:game-worker`, and `bun run dev:web`, then run `bun run simulate:werewolf:api --audience omniscient --transcript`. Browser sign-in may ask you to choose **Authorize local CLI**. `--game ID_OR_SLUG` reads an existing game without inference. Reports save under `packages/engine/docs/simulations/`; the API journal and private bucket retain thinking and raw provider evidence independently of the report.

Historical notes below concern the rules-v7/v8 scheduler, role coaching, passing, and Seer timing. Their stored trials do not evaluate v9. Retain them as history; compare only like-for-like versions and do not describe those results as v9 acceptance.

## Purpose

Use this workflow to test LM Studio or another OpenAI-compatible local model server against real Influence simulations. The goal is not only "does it finish?" The useful signal is whether games are enjoyable to watch and whether agents show real strategy: remembered promises, targeted Mingle-room conversations, named-alliance coordination, huddle follow-through, vote reasoning, alliance continuity, and dramatic but coherent social play.

## Provider Configuration

When inspecting a bounded `--chatty` run, review Lobby, Mingle, and alliance-huddle dialogue for one short paragraph, usually 1–3 sentences, under the requested 100-token limit. All models receive this guidance once at the end of the prompt, after visual instructions when applicable. The limit concerns spoken `message` only; structured fields and completion budgets are unchanged, and longer valid messages are preserved. Introductions and formal speeches are excluded. Inspect private prompt evidence for `# CONSTITUTION.md`; a passing prompt test alone does not establish shorter or punchier model output.

The native model-message contract supports user image attachments only for explicitly
registered image-capable catalog entries: OpenAI GPT-5.6 Luna, GPT-6 Luna and Katana Grok 4.6. Unknown or
text-only entries reject image-bearing invocations rather than dropping attachments.
[Visual Mode](visual-mode.md) uses this transport in API-created visual games. The standalone simulator does not enable visual generation.

Select GPT-6 Luna explicitly with `--provider-entry openai:gpt-6-luna,reasoning=action-policy` in an authorized provider evaluation, or in the admin provider route for a visual game. It uses the existing OpenAI credential and Responses adapter. Adding the model does not rewrite Daily defaults or sealed game routes; provider access and game-quality evaluation remain separate from capability/transport tests.

For API-backed endgame checks, verify Final 4 pleas use a scene containing exactly the four remaining players. Compare viewer ballots with canonical endgame/jury resolution tallies and IN/OUT status with elimination events, rather than speech or image membership. Provider-free and PostgreSQL tests cover these bindings and projections; they do not establish generated-image quality.

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
| `META_MUSE_API_KEY` | unset | Meta Model API key. Used only when a game or simulator run explicitly selects the Meta Muse provider profile. |
| `INFLUENCE_LLM_PREFLIGHT` | enabled | API game start validates the selected provider/model before claiming the run. Set to `off` only for local provider experiments where the model metadata endpoint is incompatible. |
| `INFLUENCE_LLM_PREFLIGHT_TIMEOUT_MS` | `10000` | Timeout for the API start preflight metadata request. |
| `INFLUENCE_LLM_TOOL_CHOICE_MODE` | `required` for local base URLs, otherwise `named` | Structured decision-call mode. Use `required` for LM Studio servers that reject named OpenAI tool forcing. Other accepted values: `named`, `auto`, `json_schema`. |
| `INFLUENCE_OPENAI_REASONING_SUMMARY` | `auto` for hosted OpenAI, off for local base URLs | Hosted OpenAI Responses reasoning summary mode: `auto`, `concise`, `detailed`, or `off`. Local OpenAI-compatible base URLs ignore this because they do not implement the hosted summary contract. |

Project-specific variables win over aliases. If a base URL is configured without an API key, the client uses `lm-studio` as a local default key.

Local OpenAI-compatible providers are not perfectly identical to OpenAI's hosted API. LM Studio may reject `tool_choice` objects like `{ type: "function", function: { name } }`; the default local mode sends `tool_choice: "required"` with one available tool instead. Local structured decision schemas keep the emitted `thinking` field, while raw provider reasoning metadata such as `reasoning_content` is stored separately as `reasoningContext`. Hosted OpenAI reasoning summaries are a separate Responses API feature; they default to `auto` for hosted OpenAI but remain off for local base URLs. Structured decisions use a global 8192-token completion floor, and public message calls use a global 4096-token completion floor with one doubled retry when visible content is empty. House Mingle room assignment, House alliance proposer selection, and House alliance-huddle scheduling use the same structured floor before falling back to deterministic repair behavior. If a model/server still struggles with tools, try `INFLUENCE_LLM_TOOL_CHOICE_MODE=json_schema` to skip tool calls and request the tool argument schema as JSON response format. Known quirk: Qwen3-style thinking models served by LM Studio (e.g. `qwen3.8-27b-mlx`) route the entire `json_schema` completion into `reasoning_content`, leaving `content` empty even with `enable_thinking: false`; the model is generating valid schema JSON, but it never reaches `content`. For those models keep the default `required` tool mode and avoid `json_schema` — see `docs/simulations/2026-08-16-qwen3.8-27b-capability-probe.md`.

Player and House requests share a provider-independent system context that identifies Influence as a fictional, text-only social-strategy competition among AI characters. It defines targeting, elimination, survival, and format names as voting/removal mechanics rather than physical harm. When reviewing captured prompts, require this context on both hosted and local request shapes; do not treat it as permission to retry a provider `invalid_prompt` rejection unchanged.

Player speech uses the same exact `AgentResponse` contract across hosted and local providers. The provider must return one complete JSON document matching the invocation schema; plain text, fenced or embedded JSON, wrapper objects, extra fields, missing fields, and an empty `message` are structured-output failures and cannot become accepted speech or strategy. The accepted typed value is revalidated when a durable provider call is replayed. When a local server returns native reasoning metadata such as LM Studio's `reasoning_content`, the engine stores that value separately as transcript `reasoningContext`; it never substitutes for the required `thinking` field or public `message`.

Player decision tools use one exact argument contract in native tool mode and `json_schema` compatibility mode. Native mode requires exactly one call to the selected tool and validates its complete argument document; `json_schema` mode requires the complete response text to be that same argument document. Tool-name wrappers, `{ "arguments": ... }`, Markdown fences, JSON embedded in prose, missing or additional fields, and a missing or wrong native tool are typed failures under the shared retry policy. The engine never extracts a plausible object from presentation text.

Alliance-action provider requests keep the root object exact and put the action-specific fields under a required closed `decision` union. A response opportunity therefore exposes only its currently legal non-term actions plus a complete `counter` branch when countering is available; proposer opportunities expose exact `propose`, request-handle-bound `amend`, and `pass` branches. After names and request-local handles resolve, the accepted journal value remains the flat canonical ID-based alliance action. Huddle fact items use a nested `anyOf` of closed fact variants so the same exact schema works with hosted OpenAI and compatible fallback providers.

House control turns also decode to their domain value inside the provider-attempt boundary. Room assignments must cover every room and living player exactly once; proposer selections must spend the exact eligible budget; huddle schedules must form a complete scheduled/skipped partition within budget; huddle interpretations require the exact bounded fields; and diary follow-ups obey the four-question limit. Semantic failure retries as malformed output. Deterministic allocation/scheduling repair is available only after typed provider exhaustion, while invalid engine context and local schema/validator defects fail directly.

New conversations use a distinct frozen provider slot per contribution. This keeps successive calls distinct even when the canonical event head does not advance, while replaying the same planned turn without another charge. House controls also validate the provider and accepted representations separately when nullable provider `thinking` normalizes to an omitted accepted field; replay accepts that canonical omission without another dispatch but rejects explicit null and other noncanonical stored values.

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
| `openai:gpt-5.6-luna` | OpenAI | `gpt-5.6-luna` | Previous Luna generation; still selectable explicitly |
| `openai:gpt-6-luna` | OpenAI | `gpt-6-luna` | Product baseline; Responses reasoning and strict tools |
| `katana:grok-4-3` | Katana / IMGNAI | `grok-4-3` | Router-backed Grok testing lane |
| `katana:glm-5-2` | Katana / IMGNAI | `glm-5-2` | Qualified preferred secondary Daily fallback; speech, strict JSON Schema, and named tools pass |
| `katana:grok-4-5` | Katana / IMGNAI | `grok-4-5` | Qualified tertiary Daily fallback; speech, strict JSON Schema, and named tools pass |
| `meta-muse:muse-spark-1.3` | Meta Muse | `muse-spark-1.3` | Standard tier; Responses with auto tool choice and strict JSON Schema |
| `meta-muse:muse-spark-1.3-contributor` | Meta Muse | `muse-spark-1.3-contributor` | Contributor tier (~95% cheaper; Meta may train on prompts/completions, disclosed in Privacy Policy) |
| `meta-muse:muse-wonder-1.0` | Meta Muse | `muse-wonder-1.0` | Premium standard tier ($4/$20 per 1M); cap fallback calls |

Known unsuitable catalog entries:

| Catalog ID | Provider | Model ID | Reason |
|---|---|---|---|
| `katana:q-naifu-a3b` | Katana / IMGNAI | `q-naifu-a3b` | Disabled after local API-backed evaluation: JSON Schema transport worked, but core vote/revote/strategy decisions were repeatedly empty or semantically invalid and advanced via fallbacks |

Dynamic text catalog IDs are also accepted for provider evaluation: `katana:<model-id>`, `lm-studio:<model-id>`, and `custom-openai-compatible:<model-id>`. Known catalog entries keep nicer labels and capability hints; dynamic entries let local API-backed runs try newly available Katana or LM Studio text models without waiting for a code change. Meta Muse is static-only because its model list mixes text models with image, voice, and segmentation models. Meta reasoning models can spend several hundred tokens before visible output even at low effort, and their reasoning summaries currently return empty, so transcript thinking evidence is thinner than hosted OpenAI's.

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
  --model <lm-studio-model-id>
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

House summary author calls allow 8,192 completion tokens for native reasoning plus the structured response, for both ordinary and milestone beats. Public prose remains bounded to 180/360 UTF-16 code units respectively, and notebook snapshots to 1,200. The configured reasoning policy still applies; the larger allowance does not require longer narration. Optional summary calls retain one attempt and their existing 45/75-second deadlines. Inspect saved usage and terminal status when diagnosing missing summaries.

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

Simulation artifacts are written under `packages/engine/docs/simulations/`. For each game, use `game-N-turns.jsonl` for structured per-agent-turn analysis, `game-N-events.jsonl` for replayable accepted domain facts, `game-N.json` for the full transcript/result bundle (producer artifact — may contain private dialogue and is **not** a safe Recall Plan promotion input), `game-N-progress.jsonl` for lightweight live progress, `game-N.txt` for human-readable transcript review, `game-N-prompt-reuse.json` for structural prompt-prefix reuse, and `game-N-recall-plan.json` for the **safe structural Recall Plan receipt aggregate** (prompt-class counts, protected/hot/history token estimates, lane/source-class counts, actor-authorized event boundary — no dialogue, names, entry IDs, prompts, thinking, or reasoning). `game-N-events.jsonl` uses the same `CanonicalGameEvent` envelope that API-backed games persist in Postgres, but pure local simulations do not create API database rows. Live standard rounds begin with one House room-assignment request rather than per-player `mingle-intent` calls; historical or isolated fixtures may still contain intent records. Each alliance window adds one private House `alliance-proposer-selection` call/turn for exactly `ceil(alive / 4)` access seats. The engine repairs invalid, duplicate, excess, or short results underrepresentation-first; only finalized players receive proposer `alliance-action` calls, while invitee response/counter calls remain demand-driven. House room-assignment, Mingle turn, named-alliance `alliance-action`, House `alliance-huddle-schedule`, member `alliance-huddle-turn`, historical House `alliance-huddle-outcome`, vote, conditional `format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`, diary, and `house-mc-summary` records are written when exercised. Eligible decision records carry `thinking`, optional `reasoningContext`, strategy candidate/result metadata, `decisionSource`, and nullable `fallbackReason`; any fallback is diagnostic evidence, not proof of model-authored play. Canonical format events preserve the public board path for durable replay and MCP: `format.menu_offered` (chooser + pair, absent for one-format manifests), `format.selected` (lock), `format.safety_bounce_*` (public bounce), `format.resolved` (aggregates + elimination), and `format.ballot_cast` (a shared sanitized voter-to-target viewer ledger; raw envelope provenance stays producer-only). Historical `format.resolved` payload version 1 carries only the original trio's exclusive bags; new resolutions use version 2 capability aggregates, while every other canonical event remains version 1. Unsupported event/version pairs fail closed. Legacy/classic `candidate-selection`, `power-action`, and Council records may remain readable in old or explicitly classic artifacts, but they are not the expected default standard-round lane. `--rich-producer` adds private House-authored long-form summary records. Their prose and the House notebook are producer presentation and never contestant knowledge or canonical continuity.

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

The server is read-only and scans the simulation corpus on demand. It addresses games by `sessionId + gameNumber`, rebuilds projections from `game-N-events.jsonl`, and exposes tools for listing sessions/games, reading projections, filtering canonical events, searching logs, reading player timelines, and following source pointers to linked turn records when present. Older batches without event logs remain searchable through turns/progress/transcript artifacts, but projection tools require canonical events. Tool results include `resourceUri` values such as `influence-game://sessions/<sessionId>/games/<gameNumber>/events`; pass those URIs to `resources/read` to pull full events, turns, progress, transcript, or game JSON artifacts through MCP instead of resolving `sourcePath` against the repo filesystem. To validate open strategy choices after a run, use `search_logs` with `sources: ["turns"]` for `mingle-room-assignment`, `mingle-turn`, `alliance-proposer-selection`, `alliance-action`, `alliance-huddle-schedule`, `alliance-huddle-turn`, `historical `alliance-huddle-outcome`, `format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`, `decisionSource`, `fallbackReason`, `strategyCandidate`, `strategyResult`, `strategyDelta`, `strategy`, `strategicLens`, `gotoPlayerName`, `gotoStatus`, or `empower-revote`. Search `mingle-intent`, legacy `candidate-selection`, `power-action`, and `shieldPullUp` only when inspecting isolated or older batches. To validate canonical alliance truth, use `filter_events` for `alliance.proposed`, `alliance.activated`, `alliance.closed`, `alliance.huddle_scheduled`, `alliance.huddle_completed`, and `alliance.huddle_outcome_recorded`. To validate House producer carry-forward, search turns/transcript logs for `house-mc-summary`, legacy `[House MC]`, `house-long-form-summary`, or a named House alliance hypothesis.

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

LM Studio game calls keep concurrent dispatch enabled; LM Studio schedules its own inference. They allow one hour per request by default, including server-side queueing. Set `INFLUENCE_LM_STUDIO_TIMEOUT_MS` on the game worker (and local simulator process) to change this, for example `7200000` for two hours. This overrides the shorter gameplay action/client deadlines for the LM Studio runtime only. Local transport disables Bun's separate socket idle limit so silent non-streaming inference can use that full deadline; cancellation, worker shutdown and hosted-provider deadlines still apply. The CLI's `--timeout-seconds` only limits how long it watches, not how long the server runs the game.

For LM Studio, this setting takes precedence over `simulate:local --llm-timeout-sec` / `--llm-timeout-ms` in older evaluation examples. An explicit whole-game timeout still limits the overall run.

For an eight-player local Werewolf evaluation:

```bash
bun run simulate:werewolf:api --model-catalog lm-studio:ternary-bonsai-2-27b-mlx \
  --reasoning-policy action-policy --preset two_wolves --audience omniscient \
  --transcript --timeout-seconds 14400
```

The report distinguishes the competitive result from retrospective completion. If the retrospective pauses, it prints the recorded reason and an explicit `--game ID --resume-retrospective` command. Recovery uses the existing authorized, frontier-checked endpoint; `--game ID` alone only watches. No `as any`, permissive output parsing or indirect House calls are needed for local evaluation.

LM Studio health probes use the same configurable deadline, a lease extending beyond it, and a 2,048-token budget for thinking before visible output. Probe sweeps start in the background, dispatch due scopes concurrently, and cancel their transports when stopped; slow local recovery does not block service startup.

To run the API against LM Studio:

```bash
export INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1

doppler run --project social-strategy-agent --config dev -- env PORT=3000 bun run dev:api
```

The API still needs app/database/auth secrets from Doppler unless you provide equivalent local env vars. If LM Studio can generate normally but does not implement model metadata retrieval, start the API with `INFLUENCE_LLM_PREFLIGHT=off`.

Use the API-backed CLI when you want the run to show up in the API/web UI and write durable game rows instead of JSONL-only simulator artifacts:

```bash
# Launch a real API-backed local-model game from the repository root.
# Browser sign-in opens when a checked cached app session is unavailable.
bun run simulate:api -- --provider lm-studio --model <lm-studio-model-id> --players 6
```

`simulate:api` shares the origin-bound app-session cache and browser sign-in with local replay export. A checked valid session is reused; missing, expired or rejected sessions open the House sign-in page. Sign in and choose **Authorize local CLI**. Current gameplay permissions are checked before creating a game. `--web-base-url` selects the House web origin; `INFLUENCE_API_SESSION_TOKEN` supplies an explicit session for unattended tooling. MCP OAuth login remains separate for MCP clients; its token is not used by these normal app routes.

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
- when inspecting a nullable target such as `gotoPlayerName`, distinguish raw provider `"null"` from accepted JSON `null`: exact literal-null normalization is schema-bound and must not trigger a retry by itself; `"NULL"`, `" null "`, and `"undefined"` are not normalized, and invalid targets still fail semantic validation
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
    --catalog-id=openai:gpt-6-luna \
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

Agent prompts are built from a server-owned **Recall Plan** (protected Board Contract + compact strategy + recent attended huddle dialogue and historical authorized typed huddle facts, hot active-room speech, and — only for `strategic_decision` — budgeted authorized history). Ordinary speech has no historical archive lane. Protected overflow does not erase all strategic recall: decisions retain at most 1,200 archive characters while protected material remains complete. Relevant current-round statements from living players named in compact strategy receive bounded ranking preference; zero-overlap dialogue still cannot enter history. Reviewers should:

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

### Shared diary format rules

When evaluating a format with `--chatty --diary`, inspect fresh House question/follow-up and contestant-answer prompts for the same format name, complete existing rule sheet, and active-or-resolved status. After `FORMAT RESOLVE`, the block must describe a completed round rather than invite another ballot. Offered-but-unselected formats, previous rounds, and endgame must not supply stale live rules. Provider-free prompt tests cover all seven formats; fresh diary quality remains a separate gameplay observation. Keep direct House calls and typed contracts, with no `as any`.

### The Short List coordination guidance

For a bounded `--formats vote_bomb --chatty --diary` evaluation (the CLI uses the canonical ID for The Short List), inspect Mingle and huddle negotiations for specific voter-to-target commitments, expected totals, alternative distributions, and contingencies for broken promises. Every player receives the same guidance, including accepting, bargaining over, or resisting a decisive-ballot role. Ballot prompts repeat the same advice; resolved-round diaries frame it as reflection using canonical format identity. Compare proposed placements with accepted canonical ballots to evaluate coordination and vote spread; the prompt tests alone do not establish improved play. Preserve direct House calls and typed contracts, with no `as any`.

### Two Names board context

New Override draws exclude Empowered and include every other living contestant, including both nominees. Inspect the canonical setup event to verify the accepted holder; previously recorded games retain their original holder and are never re-drawn during replay or recovery.

For `--formats two_names --chatty` evaluation with a nominated Override holder, inspect fresh Mingle and Override requests: the holder receives neutral self-removal guidance and a replacement-nominee question; every other player is told self-rescue is most likely. Check that reasoning considers the possible replacement. This advice must disappear once use or decline is selected, including during the Empowered replacement request. Provider-free prompt tests prove delivery and timing; actual model play is a separate evaluation.

Every agent call after initial nominations and before resolution receives the current round's canonical Two Names board: initial and current nominees, Empowered, Override holder and decision, pair finality, and ordinary-voter eligibility. The active board is removed after resolution and in endgame. Mingle and alliance prompts share this board; transcript prose does not establish nominations. Only the Empowered initial nomination request may say no pair is selected. The replacement request labels the pending removal explicitly until Override and replacement commit together. Provider-free outgoing-prompt regressions exercise this contract; old game dialogue cannot prove updated prompt behavior. Continue using direct House calls and no `as any` in simulation integrations.

The Visual Mode runtime hook requires a durable turn store. Provider-free coverage is in `visual-turn-boundary.test.ts`; API ownership and audience checks are in `visual-turn-context.test.ts` and require local PostgreSQL. The current CLI still does not enable Visual Mode. Only matching committed Mingle membership permits image context. Under Best effort, usable group shots survive composition failure; one explicitly missing character can use a portrait overlay. Agent image input uses the selected annotated close shot, with visible IDs and the full canonical room roster in text. When no usable image remains, canonical participants and observable cues remain available as text. Require visuals instead pauses for admin repair before agent dispatch. Both retain the same provider and verification evidence.

`durable-game-runner.test.ts` also checks scene preparation before turn planning, including abort and preparation boundaries. `visual-scene-renderer.test.ts` uses mocked providers to check five-room preparation, source/destination-only updates after movement, and ownership loss before fallback. These checks make no paid provider calls and do not prove live visual quality.

Durable-runner coverage now includes restart after a committed Mingle contribution or simultaneous movement boundary, Two Names initialization/completion replay, and preserved format pressure and revealed vote context across the split. `mingle-window-contract.test.ts` rejects malformed saved windows and inconsistent allocation histories. Local CLI simulations retain the same conversation and simultaneous movement rules without requiring the API's durable coordinator.

### Character-authoring generation

Agent editor refinement is a hosted authoring flow, separate from gameplay model selection. The full-width assistant composer passes the user's requested change alongside the current profile; image generation is an explicit option when editing an existing Agent. The compact archetype selector defaults to a user-selected, schema-locked value; “Let AI choose” exposes all valid archetypes in both the prompt and strict output enum. New-agent creation also offers grouped character-ingredient pills and a varied “Surprise me” draw; the API validates their internal keys and sends only their natural-language descriptions to the model. Draws may include broad multicultural or language roots and one background or upbringing cue, while specific cultural identities stay user-directed; the profile and image prompt preserve chosen non-human forms. While the profile request is pending, the editor rotates playful local studio chatter; after the structured profile arrives, it cycles three generated character quips during image preparation. The strict response includes those short in-character lines alongside performance instructions and visual design. Existing artwork guides identity. Provider-free coverage lives in `agent-profile-generation.test.ts`, `character-image-generation.test.ts`, `character-portrait.test.ts` and `agent-form-draft-recovery.test.tsx`. See [character drafts](agent-content-submissions.md) for the one-full-body-image workflow, durable localization and editable pixel crops. No image provider is called by these required tests.

### GPT-6 Luna default (2026-09-22)

New game forms, Daily Free primary selections, simulator defaults and shared profile-generation helpers use GPT-6 Luna. Existing games retain their sealed provider manifests; explicit model choices and the separately pinned owner-learning workload remain unchanged. No new secret is required: hosted requests use `OPENAI_API_KEY`. The Daily fallback order remains GLM 5.2 (24 calls), then Grok 4.5 (12 calls).

The [model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) specifies Standard input/cache-read/cache-write/output rates of $0.10/$0.01/$0.125/$0.50 per million tokens; Flex rates are half. Individual prompts above 272,000 input tokens cost 2× for input/cache and 1.5× for output. Aggregate comparisons cannot infer per-request context sizes and use base rates. The catalog selects Responses for reasoning plus strict tools, omits unsupported temperature, and enables the existing 30-minute prompt cache contract. Provider-free tests verify routing and accounting; this change makes no live strategic-quality qualification claim.

House replay links from the Werewolf API simulator now use `/games/:slug/replay?audience=mystery|omniscient`. Player settings offer **Share this moment**, binding the audience and canonical visible-entry cursor. Sharing/presentation makes no model call and does not alter accepted dialogue, captured thinking or game state. See [House entry integration](solutions/architecture-patterns/house-game-entry-and-replay-moments.md).

### Game creation and playback pacing

Creation-time Speed-run/Live and phase timing presets have been removed. API simulations no longer accept `--viewer-mode` or `--timing-preset`; use `--max-rounds` for the Influence game-length limit. Werewolf retains its maximum-day limit. Playback speed, thinking visibility and thinking order belong to the existing House player settings. These preferences do not change model reasoning or execution speed.


### House game visibility

Influence and Werewolf share **Public** (listed; anyone can watch) and **Unlisted** (absent from public discovery; anyone with the link can watch). Public is the default. Both support anonymous casting/replay/media reads; joining and operator actions retain their existing permissions. API simulation launchers accept `--visibility public|unlisted` (or `INFLUENCE_API_SIM_VISIBILITY`). Completion preserves the selection. Unlisted pages use `noindex`; links can still be forwarded.

Private game visibility has been removed. Hidden is a separate moderation control that blocks normal viewer routes and subsequent stream delivery. Audience/cursor/publication rules, raw evidence, owner learning and production permissions are unchanged. Retired or invalid stored visibility is rejected rather than silently made public. No operator database rows are automatically converted.

## Retrospective contract implementation status

[RT-01](game-retrospective-contract.md), [RT-02](game-retrospective-context.md) and [RT-03](game-retrospective-invocation.md) define contract/context fixtures and strict final-statement methods for both games. Run `bun test packages/engine/src/__tests__/retrospective-context.test.ts packages/engine/src/__tests__/retrospective-invocation.test.ts` to inspect context/order, exact native output, capacity and journal replay. Invocation tests mock all HTTP locally and spend nothing. Runtime selection uses the sealed manifest. Capacity estimates do not gate admission; real context-limit responses trigger bounded compaction and retry, preserving the frozen source. No LM Studio/Katana window or tokenizer is guessed. The [runtime](game-retrospective-runtime.md) extends both game runners through the complete epilogue, and simulation artifacts/reports retain its canonical records. Real trials still require separate authorization. The runtime uses the same effective provider manifest and complete frozen context. Keep no `as any`, exact output validation and direct House calls.

The [2026-10-11 paid quality report](reviews/2026-10-11-game-retrospectives-model-quality.md) records three authorized hosted `openai:gpt-6-luna` trials under one $10 cap. All 20 statements passed delivery/context checks, while vote recall, self-attribution, character voice and engagement with earlier final statements exposed quality concerns. Those trials precede the current candid 40–75 word prompt revision and do not qualify it. Use canonical events and the captured dispatched context when reviewing factual claims; accepted speech is immutable, and prose does not become factual authority. Staging acceptance remains separate.

## Retrospective evaluation

Fresh game simulations execute the same required postgame stage as the API worker. A provider-free artifact proof is:

```sh
bun run simulate:werewolf --max-days 1 --seed retrospective-artifact-proof --out /tmp/werewolf-retrospective --chatty --transcript
```

`--out` names a dedicated session directory. Inspect its explicit `session.json`, full event log and final `game-1.json`; local MCP `read_game_retrospective` returns the accepted order/text and canonical event references. `read_werewolf_history` supplies a bounded audience projection using Werewolf's reducer. Influence batches also write an explicit session identity, and `--chatty` exposes retrospective coordinates and accepted speech. Provider receipts keep usage/cost separate from public prose.

Real speech generation uses the sealed models and their exact output contracts. Unknown capacity does not reject the game; actual provider context overflow uses shared adaptation, and exhausted execution follows existing recovery. Do not alter the frozen account or invent a final statement to finish a run. The deterministic command proves local execution and artifacts, not real-model voice, accuracy or watchability. Paid/provider trials and deployed continuation are separate opt-in validation. API Influence's launcher retains its first-advance behavior; the existing worker owns the complete epilogue and House retrospective inspection follows it. Keep no `as any`, strict output validation and direct House calls.

Ordinary Mingle turns contain conversation, optional movement, and private reasoning/strategy updates; agents no longer author `coordinationFact` or `noProposal`. Evaluate their negotiation from dialogue and subsequent canonical decisions. Formal alliance huddles retain structured facts and participant memory. Historical Mingle receipts remain readable in stored events, turn exports, producer reviews, and MCP artifacts; they are not deleted or reinterpreted.


## Context-overflow adaptation

Recognized provider context overflow now triggers bounded, strict structured context summaries before retrying the same decision. API summaries are separately journaled private child calls; they never become agent speech, thinking or canonical facts. Influence/House traces show the adapted request, and local token reports include newly generated `context-summary` calls. See [policy, caller inventory and recovery](context-adaptation.md). `--chatty` remains a way to inspect accepted decisions, not proof of summary fidelity; compare original and adapted private evidence in an opt-in evaluation. Keep exact types without `as any` and call House methods directly.

When inspecting compaction quality, check the summary request's `orientation` as well as its source chunk: the actor, character strategy and pending action must match the original invocation. House orientation must describe the actual interview/narration/scheduling task and its audience, not a contestant objective.


### Dedicated real-provider compaction comparison

Run the opt-in synthetic evaluation with explicitly selected models:

```sh
doppler run --project social-strategy-agent --config dev -- \
  bun run --cwd packages/engine evaluate:context-compaction --samples=2 \
  --models=openai:gpt-6-luna,meta-muse:muse-spark-1.3-contributor
```

It compares full context with the production compaction path after one injected overflow. Summaries and downstream decisions are real provider calls; the injected rejection is not. Three player/House fixtures expose task-guided probes and retain all outputs for qualitative review. Defaults allow up to 32 dispatches per model, use two samples, and stop a model after a lane with only transport failures. Raw evidence is private under `.local-uploads/context-compaction/`; `review.json` is an allowlisted synthetic-only export. It never accepts real game content. The optional `katana:glm-5-3-private` and `katana:glm-5-3-flash-private` candidates use the existing GLM transport template for evaluation only, without changing the product catalog.

The [first real-provider report](evaluations/2026-10-18-context-compaction.md) records paired model outcomes, token cost despite smaller final requests, and minimal-request diagnostics isolating GLM inference failures. This is narrow quality evidence, not rollout or a universal memory guarantee.

Werewolf public ballot playback uses the vote-bloc presentation: the player gives their accepted speech, then their portrait collects into the canonical target or abstention bloc. Each watch moment includes only that day’s committed ballot prefix, so seeking across windows does not reveal future votes. The final tally is shown once before the result. Large top-level ballot/proposal facts overlays are removed; phase labels and outcome cards remain.


### Bounded Influence conversations over localhost API

Run full games through the API for durable player/Studio/MCP inspection:

```sh
bun run simulate:api -- --players 6 --games 1 --model-catalog meta-muse:muse-spark-1.3-contributor --visibility unlisted --no-wait-for-advance
bun run simulate:api -- --players 8 --games 1 --model-catalog openai:gpt-6-luna --visibility unlisted --no-wait-for-advance
```

Use the localhost CLI browser login or a private `INFLUENCE_API_SESSION_TOKEN`; never publish the credential. On the API process, set an explicitly authorized `INFLUENCE_EVALUATION_BUDGET_USD` and a fresh private `INFLUENCE_EVALUATION_BUDGET_LEDGER` path for the evaluation. All concurrent test games share that ledger. The guard reserves pessimistically and also records usage-based estimates; report both without claiming an estimate is a provider invoice.

Default conversations allow 320 UTF-8 bytes per message and 400 bytes per participant. Ordinary Mingle has two conversation rounds and one simultaneous move. Inspect saved thinking, replies, voluntary passes versus provider absences, unoffered players, latest movement intent, next-decision recall and full-game duration. Huddles generate speech and private strategy, not typed tactical outcomes. Their existence is private from nonparticipants, while spectators can watch room playback with saved structured thinking under Show thinking; passes stay skipped. Save sanitized requests/responses, retries, errors and all available reasoning; never replace a failed run's artifacts with a corrected run. Keep direct House calls and exact types, without `as any`.
