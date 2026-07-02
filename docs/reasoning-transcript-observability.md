# Reasoning & Transcript Observability

These rules and patterns apply to the game engine (`packages/engine`) for surfacing agent internal reasoning during simulations, particularly for Mingle workflows and decision phases.

## Purpose

Private `thinking` + model-side reasoning evidence are captured so that long unattended `--chatty` runs (especially Mingle + vote/power/council loops for 8->4 player testing) are actually debuggable and enjoyable for the human. Local OpenAI-compatible servers may provide raw native `reasoningContext` such as `reasoning_content`; hosted OpenAI Responses calls may provide provider-generated reasoning summaries that are labeled as OpenAI summaries. Agents' real rationale for hidden Mingle intent, Mingle turns, empower/expose votes, empower revotes, private exposure-bench candidate selections, power actions (pass/protect/eliminate, including bundled shield pull-up choices), normal council votes, empowered council tiebreakers when normal votes tie, strategic reflections, Strategy Thread packet updates, direct endgame votes, and jury votes must be visible in local debug artifacts when useful and persisted in structured simulation artifacts. Initial Mingle room assignment is House-authored from all hidden intents and recorded as producer/debug assignment metadata. The House also emits between-round MC summary artifacts by default; rich producer simulations can add private House Strategy Bible packets, long-form summaries, and diary producer briefs for carry-forward validation.

This observability layer exists because "master wants to see reasoning for voting as well" and equivalent signals for power and council decisions. Public player messages stay clean. Player-private cognitive lanes may store the agent's own reasoning and strategy reflections for the relevant player/participants. Producer-private trace lanes additionally store provider profile, model/catalog IDs, requested reasoning effort, reasoning policy, full prompt request, raw provider response, observed provider reasoning metadata, usage counts, and router billing fields when available. Provider wrappers, prompts, responses, storage keys, source pointers, and private trace manifests stay in producer/debug surfaces.

## Architecture / Data Flow

`callTool<T>(...)` (in `agent.ts`) is the single source of truth:

- It always augments the returned object with `reasoningContext` via clean intersection:
  ```ts
  const args = JSON.parse(...) as T & { reasoningContext?: string };
  args.reasoningContext = reasoningContext;
  // (same pattern for parsedContent, jsonFallback, and mismatch paths)
  ```
- Never use `as any`.
- Hosted OpenAI calls with `openAIReasoningSummary` enabled use the Responses API with JSON Schema output. The returned simulation/debug object gets a labeled `OpenAI reasoning summary (...)` display string when the provider supplies one; private traces keep the structured `providerReasoningSummary` payload separate from raw `reasoningContext`.

Decision methods on `IAgent` / `InfluenceAgent` return the extra fields (typed on the interface and impl):

- `getMingleIntent(...)` → `{ seekPlayers: string[]; avoidPlayers: string[]; preferredRoomSize: ...; purpose: string; provisionalTarget: string | null; noTargetReason: string | null; openingAsk: string; strategicLens: StrategicLens; strategicLensRationale: string; thinking?: string; reasoningContext?: string; decisionLog?: string | null }`
- `takeMingleTurn(...)` → `{ thinking?: string; message?: string | null; noReply?: boolean; gotoRoomId?: number | null; gotoPlayerName?: string | null; reasoningContext?: string; decisionLog?: string | null }`
- `getRumorMessage(...)` → `{ thinking: string; message: string; strategicLens?: StrategicLens; strategicLensRationale?: string; reasoningContext?: string; decisionLog?: string | null }`
- `getVotes(...)` → `{ empowerTarget: UUID; exposeTarget: UUID; thinking?: string; reasoningContext?: string; decisionLog?: string | null }`
- `getEmpowerRevote(...)` → `{ empowerTarget: UUID; thinking?: string; reasoningContext?: string; decisionLog?: string | null }`
- `getCandidateSelection(...)` → `{ selectedCandidateIds: UUID[]; thinking?: string; reasoningContext?: string; decisionLog?: string | null }`
- `getPowerAction(...)` → `PowerAction & { thinking?: string; reasoningContext?: string; decisionLog?: string | null; shieldPullUpCandidateIds?: UUID[] }`
- `getCouncilVote(...)` → `{ target: UUID; thinking?: string; reasoningContext?: string; decisionLog?: string | null }` (normal Council voters; empowered player only when normal votes tie)
- `getStrategicReflection(...)` → `{ certainties: string[]; suspicions: string[]; allies: string[]; threats: string[]; plan: string; strategicLens: StrategicLens; strategicLensRationale: string; strategyPacket?: StrategyPacketSummary; thinking?: string; reasoningContext?: string } | null`
- `getEndgameEliminationVote(...)` / `getJuryVote(...)` → `{ target: UUID; thinking?: string; reasoningContext?: string; decisionLog?: string | null }`

(Similar treatment for public messages, `getPowerLobbyMessage`, diary entries, accusations, jury questions, etc.)

Phase runners receive the rich result, record only the narrow game-state value when required, then forward the reasoning fields:

- `phases/vote.ts`: `logger.logSystem(..., votes.thinking, votes.reasoningContext)`
- `phases/vote.ts`: emits private `candidate-selection` agent turns when the exposure bench leaves initial Council candidate ambiguity after Vote.
- `phases/power.ts`: `logger.logSystem(..., powerActionResult.thinking, powerActionResult.reasoningContext)`
- `phases/power.ts`: emits private `power-action` agent turns; when Protect removes a candidate and the replacement slot is unresolved, the same turn carries `response.shieldPullUp` with eligible choices, selected replacement, fallback status, and resolved candidates.
- `phases/council.ts`: `logger.logSystem(..., voteResult.thinking, voteResult.reasoningContext)`
- `phases/mingle.ts`: emits hidden `mingle-intent` agent turns before House room assignment, records private `mingle-room-assignment` turns with `assignmentSource` (`house`, `repaired`, `fallback`, or later-beat `movement`), repair notes, and summary-only intent metadata including `strategicLens`, then records private Mingle turn responses with `gotoRoomId`, `gotoPlayerName`, `gotoStatus`, and `decisionLog` rather than viewer-facing room text. Mingle room numbers remain stable within a Mingle phase; `beat`/turn carries the temporal distinction.
- `diary-room.ts`: emits hidden `strategic-reflection` and `strategy-packet` agent turns when `enableStrategicReflections` is enabled and the reflection produces a packet. Reflection and packet records include the selected strategic lens.
- `diary-room.ts`: emits private `house-producer-brief` agent turns before diary questions when `enableHouseProducerBriefs` is enabled. The brief can sharpen the House's question but must separate safe-to-reveal material from private producer reads.
- `game-runner.ts`: emits one House interstitial after each completed normal round. `house-mc-summary` records plus clean House system transcript prose are on by default unless `enableHouseRoundSummaries` is `false`; `house-strategy-bible` and `house-long-form-summary` are private producer/debug records gated by rich producer config.
- Every phase runner that resolves an agent call also emits an `agent_turn` stream event via `logger.emitAgentTurn(...)` with the normalized response the game used.
- Decision agent turns can include `response.decisionLog` as a compact private receipt of what the action meant strategically. Strategy Thread revision evidence remains separate from the decision note and is produced by the regular strategic-reflection cadence.
- Mingle intent and strategic-reflection records include `response.strategicLens` and `response.strategicLensRationale` so validation can distinguish vote math, room traffic, coalition geometry, promise debt, social cover, broad reads, and sparse presentation reads without parsing prose.

`AgentTurnEvent` (game-runner.types.ts) is the structured simulation-analysis shape:

```ts
export interface AgentTurnEvent {
  type: "agent_turn";
  round: number;
  phase: Phase;
  timestamp: number;
  action: string;
  actor: { id?: UUID; name: string; role?: "player" | "juror" | "house" };
  visibility: "public" | "private" | "anonymous" | "diary" | "system";
  response: Record<string, unknown>;
  thinking?: string;
  reasoningContext?: string;
  scope?: TranscriptEntry["scope"];
  text?: string;
  to?: string[];
  roomId?: number;
}
```

`TranscriptLogger` (all `log*` methods, especially `logSystem`):

```ts
logSystem(text: string, phase: Phase, thinking?: string, reasoningContext?: string): void {
  const entry: TranscriptEntry = {
    ...
    ...(thinking && { thinking }),
    ...(reasoningContext && { reasoningContext }),
  };
  ...
}
```

`TranscriptEntry` (game-runner.types.ts) remains the canonical replay/human-viewing shape:

```ts
export interface TranscriptEntry {
  ...
  /** Agent's internal thinking when producing this message (hidden from players, visible to viewers) */
  thinking?: string;
  /**
   * Model-side reasoning evidence. Local models may provide raw `reasoning_content`;
   * hosted OpenAI Responses calls may provide a labeled provider summary.
   * Captured separately from the agent's "thinking" field for richer simulation traces.
   */
  reasoningContext?: string;
  ...
}
```

Public websocket `message` events do not publish the internal `TranscriptEntry`
object directly. `packages/api/src/services/ws-manager.ts` builds a
`PublicWsTranscriptEntry` by selecting the viewer-safe fields used by the web
client: round, phase, sender, scope, recipients, room identifiers, public room
metadata (`rooms` and `excluded` only), text, timestamp, and viewer-facing
`thinking`, plus viewer-safe anonymous rumor metadata (`anonymous` and
`displayOrder`). Hidden `reasoningContext`, room allocation diagnostics,
prompts, raw provider responses, storage keys, source pointers, decision logs,
private trace manifests, and producer-only evidence must stay out of that
websocket payload. This keeps live watch/replay useful without changing MCP or
cognitive-artifact authorization policy.

For `--chatty` live viewing (`simulate.ts`):

```ts
function formatEntry(e: TranscriptEntry): string {
  ...
  if (e.thinking) {
    line += `\n    ${thinkingColor}thinking: ${e.thinking}${reset}`;
  }
  if (e.reasoningContext) {
    line += `\n    ${reasoningColor}reasoning: ${e.reasoningContext}${reset}`;
  }
  if (e.from === "House" || e.scope === "system") {
    line = `${yellow}${line}${reset}`;
  }
  return line;
}
```

For live House narration without transcript/reasoning spam, `--house-summaries` prints only concise `house-mc-summary` turns to the launching terminal. Deterministic round facts for empowered player, empower/expose counts, power action, shield, Council candidates/votes, and elimination stay in `response.roundFacts` for tooling instead of being prepended to the viewer-facing House prose. `pass` power actions are represented without a target because passing declines intervention; it does not transfer power to another player:

```bash
bun run simulate -- --variant mingle --house-summaries
```

House MC summaries (`house-interviewer.ts` + direct calls in `game-runner.ts`) are emitted as structured `house-mc-summary` agent-turn records and logged via the same `logSystem` path for richer traces. The system transcript receives clean House prose only; deterministic facts are stored under `response.roundFacts`, so MCP/replay tooling does not have to parse the summary prose:

```ts
const summary = await this.houseInterviewer.generateHouseSummary(summaryContext);
this.emitHouseSummaryTurn("house-mc-summary", resolvedPhase, summary, "system", evidence.roundFacts);
this.logger.logSystem(summary.summary, resolvedPhase);
```

`PowerAction` interface itself (types.ts) stays narrow:

```ts
export interface PowerAction {
  action: PowerActionType;
  target: UUID;
}
```

The extras live only on the agent return value, `TranscriptEntry`, and `AgentTurnEvent`. Game state and tally logic never see them.

## API-Backed Private Traces

Simulation runs persist per-turn reasoning in local JSONL artifacts. API-backed owner runs can also persist a deeper private trace for model-call inspection:

- `PrivateDecisionTrace` is emitted at the model-call boundary where prompt messages, the prompt request envelope, raw provider response, tool arguments or parsed JSON output, emitted `thinking`, native `reasoningContext`, hosted OpenAI `providerReasoningSummary` payloads, provider profile, model/catalog IDs, requested reasoning effort, usage counts, and router billing metadata still exist.
- `InfluenceAgent` and `LLMHouseInterviewer` receive an optional `privateTraceSink`; without a sink, engine behavior and simulation artifacts are unchanged.
- `game-lifecycle.ts` supplies the sink only for owner-backed API runs. The sink calls the API private trace writer, which stores raw JSON content in private S3-compatible content storage and creates a `game_evidence_manifests` row with producer-private counts/facets such as model identity, requested reasoning policy, token usage, and router billing when present. The manifest must not contain raw prompt, response, or reasoning text.
- Local validation must use a real S3-compatible private content endpoint, not the profile-picture filesystem fallback. Run `bun run s3:bootstrap`, source `.env.private-trace.local`, and use `bun run trace:local:smoke` to verify the local writer/read/search path.
- Trace write failures degrade trace diagnostics but must not throw into canonical gameplay, accepted events, transcript logging, or checkpoint persistence.
- The local Trace MCP (`cd packages/api && bun run mcp:trace`) is the local producer inspection path for API durable runs. Use `list_manifests` for metadata, `read_content` for explicit raw content reads, and `search_reasoning_traces` for bounded run-scoped search.
- The deployed HTTP MCP surface is one `/mcp` resource with scope-filtered tools. User-facing grants use `agents:read`, `agents:write`, and `games:read` for rules, owned agents, supported pre-match enrollment, accessible game inspection, and authorized cognitive artifact reads; they do not expose private trace metadata or raw trace content. The `producer` scope plus the current `producer` role exposes explicit private trace tools (`list_trace_manifests`, `read_trace_content`, and `search_reasoning_traces`) for developer/global inspection.

Private trace content is not public transcript, not canonical board truth, and not checkpoint resume authority. It is the API durable-run sibling of `game-N-turns.jsonl`: useful for debugging one weird run, not a product/admin content portal.

## API-Backed Cognitive Artifacts

New API-created games set `games.cognitive_artifact_capture_version = 1` and fan out first-class cognitive artifact rows beside private trace writing. Old/imported/pre-capture games remain version `0` and return `not_captured_for_game` after authorization. The product path never reads producer private trace storage to reconstruct missing split artifacts.

- User-facing Production Game MCP pairs cognitive artifacts with `read_round_facts`, a sanitized canonical-event-derived facts tool for resolved vote, power, Council, and player-status context. Use that tool when an artifact refers to votes or candidates; do not treat `decisionLog`, `thinking`, or `reasoningContext` as authoritative gameplay facts. If canonical events have not flushed yet, `read_round_facts` reports `not_yet_flushed`/`not_yet_resolved` availability instead of falling back to artifacts.
- Public web watching uses `GET /api/games/:idOrSlug/watch-intelligence` for the selected-agent inspector. The endpoint is public-by-URL, requires an `actorPlayerId` before returning cognitive cards, returns active `thinking` artifacts, whitelisted `strategy` fields, visible transcript `thinking`, and `buildRevealedRoundFacts(...)` receipts, and excludes `reasoning` artifacts plus raw payload/debug fields.
- Completed-game review uses `GET /api/games/:idOrSlug/results` as the public-by-URL canonical result read. The result rollup is canonical-event-first: it replays persisted events, builds per-round revealed facts, and exposes elimination order, vote ledgers, endgame votes, jury votes, placements, source status, and degradation diagnostics. The compact postgame views (`GET /api/games/:id/postgame/brief`, `/postgame/jury`, `/postgame/players/:player/summary`, `/postgame/turning-points`, plus the Production Game MCP postgame tools) are denormalized DTOs over the same canonical facts. V2 postgame payloads begin with a maximum-five-item deterministic `executiveSummary`; expose short round `headline` values; rename ambiguous `majorEliminations` to rule-based `highlightedEliminations` while temporarily carrying the old alias; enrich `derivedVoteCohorts` with size, first/last observed round, shared votes, cohesion score, confidence, and a not-alliance note; split jury support into `winnerSupporters` and `runnerUpSupporters`; add deterministic `juryNarrative`, sparse `gameMomentum`, and conservative player `overallGameShape`. Derived confidence describes the derivation only. These payloads can summarize round arcs, jury breakdowns, majority alignment, derived vote cohorts, momentum, and turning points, but they must not reconstruct missing facts from transcripts, `thinking`, `reasoningContext`, private traces, or prose summaries. Cognitive artifacts are optional context only; the endpoint may surface limited active `thinking` and whitelisted `strategy` snippets, but raw payloads, `reasoningContext`, provider wrappers, private trace manifests, storage keys, source pointers, and arbitrary debug fields stay out of player-safe responses and cannot define what happened.
- `reasoning` artifacts come only from `PrivateDecisionTrace.reasoningContext` and/or `PrivateDecisionTrace.providerReasoningSummary.text` and are owner-only for user-facing access. User-facing payloads store provider summaries as text only; provider wrappers such as `parts` and `outputItemIds` remain private-trace evidence.
- `thinking` artifacts come only from `PrivateDecisionTrace.emittedThinking` and are readable by the owner plus same-game participants.
- `strategy` artifacts come only from normalized trace fields such as `decisionLog`, `strategicLens`, `strategicLensRationale`, `strategyPacketRevision`, `strategyPacketUpdate`, `strategyPacketSummary`, and `strategicReflectionSummary`; they are readable by the owner plus same-game participants.
- Producer/admin access may read all split artifacts directly, including degraded diagnostics. Raw prompts, raw responses, full request envelopes, model/provider IDs, requested reasoning effort, token usage, router billing, tool arguments, storage keys, source-pointer internals, and arbitrary `output` blobs are excluded from cognitive payload construction.
- Oversized cognitive payloads are stored as `capture_degraded` diagnostics with an empty user payload. Revisit object-storage manifests only if p95 artifact payload size exceeds 64 KiB, more than 1 percent of artifacts hit the 256 KiB cap, or typical captured games exceed 5-10 MiB of cognitive artifact payload.

## Core Style & Safety Rules

1. No `as any` anywhere in agent return paths, House calls, or reasoning threading. Use intersections or proper widening of return types. "`as any` scares master."

2. House calls must be direct (`await this.houseInterviewer.generateHouseSummary(...)`, `await this.houseInterviewer.updateStrategyBible(...)`, etc.) — no `if (typeof ... === 'function')` guards or `as any`.

3. Every structured decision that should be observable by viewers (votes, power, council, mingle turns, etc.) must solicit `"thinking"` in its tool schema (see `TOOL_CAST_VOTES`, `TOOL_POWER_ACTION`, `TOOL_COUNCIL_VOTE`) and return it + the attached `reasoningContext` or labeled provider summary display when present.

4. Public player-visible output (`message` in `AgentResponse` and Mingle room text) must never contain the hidden thinking; it is stripped or kept in a separate field.

5. Strategy Thread packets are private producer/debug state. They live on the live agent during the current uninterrupted run, are refreshed through strategic reflection, and are not written to `MemoryStore`, canonical events, player-visible transcript text, or websocket-visible UI state. A packet's target posture is a prompt-level standing-target hint, not a hard gate: agents should keep it pointed at a living player when evidence supports one, pivot away from eliminated targets, or explicitly carry no standing target when they are still gathering reads.

6. Strategy Thread packets are decision context, not a replacement for per-turn traces. Transcript entries and private `agent_turn` records may both carry `thinking` / `reasoningContext` in local simulation artifacts; live `--chatty` output should avoid printing the same trace twice.

7. Checkpoint continuity capsules are the private snapshot lane for supported resume paths and future hydration of live agent and House behavior. They may carry structured Strategy Thread summaries, reflection summaries, notes, commitments, and House Strategy Bible-derived state, but they are not canonical projection truth, not player-visible transcript, and not websocket-visible UI state. The admin durable-run hydration passport may expose only readiness stamps such as `playerContinuity`, `houseContinuity`, `runtimeSnapshot`, `boundaryCertificate`, `transcriptCursor`, `tokenCursor`, `ownerEpoch`, and `privacy`; it must not expose raw capsule bodies, `thinking`, `reasoningContext`, prompts, responses, storage keys, or source pointers. A passing Runtime Snapshot v1 passport requires sealed token cursor boundary, expected active-player continuity coverage, and drained or proven-empty accumulators; accumulator capture labels are not a v1 evidence contract.

8. Terminal UX for `--chatty` (and persisted `game-*.txt` / `.json`) is a first-class human output. `game-*-turns.jsonl` is the per-agent-turn machine-analysis output and `game-*-events.jsonl` is the accepted-domain-event replay output; both must stay clean JSON without ANSI formatting.

9. When backing out experiments (e.g. the old `mingle-loop` variant that caused phase pollution / extra INTRODUCTION/LOBBY entries), prefer clean removal over more guards. The state machine must remain understandable.

10. Fallbacks in agent methods must still return the shape with `thinking` / `reasoningContext` (even if the thinking is a short "fallback..." note).

11. API private traces and cognitive artifacts must keep the engine/API boundary clean. Engine code emits typed trace envelopes only; API code owns storage, first-class cognitive artifact rows, read authorization, and MCP/API access. Do not import API storage or database code into `packages/engine`.

12. Missing cognitive artifacts are not reconstructed from private traces. User-facing access must return authorized no-capture/degraded states rather than falling back to producer evidence.

## Local Model Specifics

See `docs/local-model-evaluation.md` for the full provider table. Key points that interact with reasoning capture:

- `INFLUENCE_LLM_TOOL_CHOICE_MODE=required` (default for local base URLs) + `json_schema` fallback. Local servers often reject object `tool_choice`.
- `extractReasoningContext` (with a deprecated `extractNativeThinking` wrapper) pulls only the raw `reasoning_content` / hidden channel and attaches it exclusively as `reasoningContext`. It never falls back to the agent's emitted "thinking".
- `REASONING_TOKEN_OVERHEAD`, `REASONING_OVERHEAD_HIGH/LOW`, and the `local*MinTokens` floors (`INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS`, `INFLUENCE_LLM_LOCAL_MESSAGE_MIN_TOKENS`) give reasoning models room before the visible/structured payload.
- House Mingle room assignment is a direct House call, not an agent tool call, but it uses strict JSON Schema output and the local structured token floor before deterministic assignment fallback.
- Local paths no longer omit the `thinking` field from decision tool schemas. Agents are still expected to emit their internal reasoning (the "thinking" the prompts and schemas solicit). The raw hidden server channel (if present) is captured *separately* into `reasoningContext` only and never overwrites the emitted `thinking`. This gives high-contrast bright-white `thinking:` + bright-cyan `reasoning:` in --chatty for local models.
- `--chatty` + long timeouts (`--game-timeout-sec`, `--llm-timeout-sec`) are the recommended way to watch Mingle hardening and decision quality in real time.

## Hosted OpenAI Reasoning Summaries

Hosted OpenAI reasoning summaries are an official Responses API summary path, not raw chain-of-thought. Influence requests them only for hosted OpenAI agent calls when a summary mode is configured:

- `INFLUENCE_OPENAI_REASONING_SUMMARY=auto|concise|detailed|off` controls API/server-created games. `INFLUENCE_LLM_REASONING_SUMMARY` is accepted as a compatibility alias.
- Hosted OpenAI defaults to `auto`. OpenAI-compatible base URLs default to off and ignore summary modes because local servers do not implement the hosted Responses summary contract.
- Simulations can override with `--reasoning-summary auto|concise|detailed|off` or disable with `--no-reasoning-summary`.
- When enabled, common agent message and structured decision prompts use Responses API JSON Schema output instead of Chat Completions tool forcing. The model-call trace stores `providerReasoningSummary: { provider: "openai_responses", mode, text, parts, outputItemIds? }`; the simulation-facing return object gets a labeled `OpenAI reasoning summary (${mode}): ...` value in the reasoning display lane.
- Private trace manifests store summary byte counts only. User-facing cognitive artifact payloads may include the summary text as owner-only `reasoning` artifacts, but they do not include provider wrappers, parts, output item IDs, manifests, or public game content.

## Testing & Mock Discipline

- `MockAgent` (and test doubles such as `GoodbyeProbeAgent`) must implement the widened return shapes (see `packages/engine/src/__tests__/mock-agent.ts`).
- Structured-output tests (`agent-structured-output.test.ts`) and phase tests (`goodbye-message.test.ts`, full-game, etc.) must assert (or tolerate via `toMatchObject` / `expect.any(String)`) the presence of `thinking` / `reasoningContext` on the relevant returns.
- When a test stub supplies tool arguments containing `thinking`, the object returned from the agent method must surface it (and the attached `reasoningContext`).

## Recommended Patterns

**Threading from callTool through a decision method (getCouncilVote example):**

```ts
const result = await this.callTool<{ thinking?: string; eliminate: string; reasoningContext?: string }>(...);
...
return { target, thinking: result.thinking, reasoningContext: result.reasoningContext };
```

**Logging an observable action (power phase):**

```ts
const powerActionResult = await empoweredAgent.getPowerAction(phaseCtx, prelim);
const powerAction: PowerAction = { action: powerActionResult.action, target: powerActionResult.target };
gameState.setPowerAction(powerAction);
logger.logSystem(
  `${name} power action: ${powerAction.action} -> ${targetName}`,
  Phase.POWER,
  powerActionResult.thinking,
  powerActionResult.reasoningContext,
);
```

**Chatty formatting (already in simulate.ts):**

See `formatEntry` above. Yellow House lines + indented bright-white thinking + bright-cyan reasoning.

**Direct House round interstitial (non-fatal, after a normal round resolves):**

```ts
try {
  const summary = await this.houseInterviewer.generateHouseSummary(summaryContext);
  this.emitHouseSummaryTurn("house-mc-summary", resolvedPhase, summary, "system", evidence.roundFacts);
  this.logger.logSystem(summary.summary, resolvedPhase);
} catch {
  // non-fatal for House narration
}
```

## What To Record / Usage

In simulation batches under `packages/engine/docs/simulations/`, each game writes:

- `game-N.txt`: human-readable formatted transcript; includes ANSI colors for `--chatty`.
- `game-N.json`: full transcript JSON plus result metadata.
- `game-N-progress.jsonl`: lightweight progress events for monitoring a running game.
- `game-N-turns.jsonl`: one clean structured JSON record per agent turn, including the normalized response the game used plus `thinking` and `reasoningContext` / labeled provider summaries when available.
- `game-N-events.jsonl`: one clean canonical domain event record per accepted game-state fact. Replay this through `replayCanonicalEvents(...)` to rebuild the game projection; do not parse transcript prose as board state. API-backed games persist the same canonical envelope in Postgres for live runs, while CLI simulations remain local JSONL artifacts unless a future import path explicitly loads them.

`game-N-turns.jsonl` always includes hidden `mingle-intent` records and House `mingle-room-assignment` records. Mingle intent player-target fields are normalized to living, non-self players before House assignment; stale names may remain only as historical prose context or `repairNotes`, not as active `seekPlayers`, `avoidPlayers`, or `provisionalTarget`. It includes private `candidate-selection` records when exposure-bench ambiguity requires an empowered-player choice, and private `power-action` records carry `response.shieldPullUp` when Protect bundles an unresolved replacement choice. Council vote records are emitted for normal Council voters; the empowered player emits a `council-vote` record only when normal votes tie and a tiebreaker is required. It includes `house-mc-summary` records by default because `enableHouseRoundSummaries` is enabled in simulation config. It includes hidden `strategic-reflection` and `strategy-packet` records when the simulator is run with `--strategic-reflections` (or `INFLUENCE_SIM_STRATEGIC_REFLECTIONS=true`) and the reflection produces a packet. It includes private `house-strategy-bible`, `house-long-form-summary`, and `house-producer-brief` records when the simulator is run with `--rich-producer` (or `INFLUENCE_SIM_RICH_PRODUCER=true`). Later private decision records may include `response.decisionLog` receipts that explain pivots for normal Strategy Thread reflection. These records are producer/debug artifacts only; they are not player-visible speech.

Recommended invocation for Mingle + visibility work:

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
```

For validation runs that need to prove strategic-reflection capture or Strategy Thread carry-forward is working, add `--strategic-reflections`. For House carry-forward validation, use `--rich-producer`; this also enables strategic reflections, bounded Council diary sessions, private House Strategy Bible packets, long-form House summaries, and per-player producer briefs.

API-backed live games run bounded diary sessions after each resolved Council. Simulator `--diary` / `--rich-producer` uses the same Council-bounded cadence unless that simulation config is changed explicitly. Strategic reflection is hidden and separate from visible diary: when enabled, agents run an initial reflection after Introductions, then later-round pre-vote and post-vote reflections; post-Council diary sessions also trigger a diary-phase reflection after interviews complete.

The "Progress: R1 VOTE | alive=..." lines + the following House action lines are the primary place humans see per-agent rationale in real time. After the run, use `game-N-turns.jsonl` for structured agent-decision analysis and `game-N-events.jsonl` for replay/projection queries instead of parsing colored terminal output.

For MCP-backed analysis, run `bun run mcp:game -- docs/simulations` from `packages/engine`. The MCP scans the whole local simulation corpus, including old batches and currently-writing batches, and every game query is addressed by `sessionId + gameNumber`. Tool responses include `resourceUri` values such as `influence-game://sessions/<sessionId>/games/<gameNumber>/turns`; use `resources/read` with those URIs to retrieve full event logs, turn logs, progress logs, transcripts, or full game JSON through MCP. `sourcePath` is only a local diagnostic path and may be relative to the MCP corpus process, not the repo root.

Useful validation queries:

- `search_logs` over `sources: ["turns"]` for `mingle-intent`
- `search_logs` over `sources: ["turns"]` for `repairNotes`, `seekPlayers`, `avoidPlayers`, or `provisionalTarget`
- `search_logs` over `sources: ["turns"]` for `strategic-reflection`
- `search_logs` over `sources: ["turns"]` for `strategy-packet`
- `search_logs` over `sources: ["turns"]` for `decisionLog` or a packet `revisionId`
- `search_logs` over `sources: ["turns"]` for `gotoPlayerName`, `gotoStatus`, or `decisionLog`
- `search_logs` over `sources: ["turns"]` for `candidate-selection`, `power-action`, `shieldPullUp`, `selectedCandidates`, or `fallbackReason`
- `search_logs` over `sources: ["turns", "transcript"]` for `house-mc-summary` or legacy `[House MC]`
- `search_logs` over `sources: ["turns"]` for `house-strategy-bible`, `house-long-form-summary`, `house-producer-brief`, or a House alliance name

Update simulation batch notes (the dated `.md` next to `results.json` etc.) with observations about the quality of the surfaced reasoning, not just win rates or token counts. When writing scripts, read `game-N-turns.jsonl` for per-turn decisions, `game-N-events.jsonl` for accepted domain facts, and `game-N.json` for full transcript context.

## Review Checklist

- Did we thread both thinking and reasoning evidence all the way from the LLM response through the agent method, the phase log call, TranscriptEntry, AgentTurnEvent, and formatEntry?
- Is there any `as any` left in the changed paths?
- Are House calls still direct?
- Do player prompts render the Current Board Contract before decisions, including negative facts such as no current empowerment before a normal vote and no active shields/empowerment in endgame?
- Do phase-specific rules keep Council choices separate from normal Vote empower/expose choices, and do typed recent decisions show the player's own current-path vote/power/Council/Judgment history?
- Do hidden Mingle intent records and House assignment inputs avoid eliminated/self live targets while preserving any stale-target cleanup in `repairNotes`?
- Do Council diary prompts use the interviewee's actual role (candidate, voter, survivor vote, empowered tiebreaker, or empowered player whose tiebreak was not needed) without inventing a vote?
- Do Judgment juror question prompts receive questions-only history while finalist answer, closing, and jury-vote prompts can still use full Q&A history?
- Do House MC summaries lead with consequence, leverage, debt, heat, and next tension while keeping deterministic round facts in `response.roundFacts`?
- Does the Strategic Play Menu stay hidden in system prompt context and avoid leaking into public player-visible messages?
- If Strategy Thread packets changed, can MCP `search_logs` find a `strategy-packet` record plus later `decisionLog` evidence that explains whether the agent carried, revised, or deferred the strategy?
- If House producer carry-forward changed, can MCP `search_logs` find `house-strategy-bible`, `house-mc-summary`, `house-long-form-summary`, and `house-producer-brief` records in a rich producer run?
- Are packet content and decision logs absent from websocket-visible events and canonical board state?
- Do API durable events, simulator JSONL records, and replay/projection tests still use the same `CanonicalGameEvent` envelope?
- Do mocks and tests compile and pass with the new shapes?
- If checkpoint continuity or hydration-passport fields changed, does an admin durable-run route or service test prove the response exposes stamp/status facts without raw private continuity, and does at least one real `GameRunner` checkpoint prove drained transcript-buffer and sealed token-boundary evidence?
- Are the ANSI color rules, terminal output expectations, clean `game-*-turns.jsonl`, and clean `game-*-events.jsonl` artifacts documented?
- Did we update the cross-referenced usage docs and AGENTS.md where the contract changed?
- Can a future reader understand why this observability layer exists (Mingle debugging + "master wants to see reasoning for voting as well")?

## Related

- `docs/local-model-evaluation.md` — primary reference for local provider setup and what makes a useful `--chatty` run.
- `packages/engine/src/simulate.ts` — chatty entry point, `formatEntry`, and JSONL artifact writers.
- `packages/engine/src/canonical-events.ts`, `canonical-event-log.ts`, `game-projection.ts` — accepted-domain-event envelope, append log, and replay reducer.
- `packages/engine/src/game-mcp/` — local read-only MCP/query server over simulation event logs.
- `packages/engine/src/agent.ts` — `callTool` and the decision methods.
- `packages/engine/src/transcript-logger.ts` and `game-runner.types.ts` — the transcript and agent-turn data models.
- `CONCEPTS.md` — project vocabulary for `TranscriptEntry`, `reasoningContext`, `chatty` mode, `House MC`, House Strategy Bible packets, producer briefs, long-form summaries, and the `callTool` reasoning augmentation.
- `feat/inf-228-mingle-hardening` branch context: this observability work was driven by the need to debug and enjoy the new Mingle room system + the full decision loop down to 4 players.
