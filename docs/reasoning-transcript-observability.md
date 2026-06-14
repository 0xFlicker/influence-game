# Reasoning & Transcript Observability

These rules and patterns apply to the game engine (`packages/engine`) for surfacing agent internal reasoning during simulations, particularly for Mingle workflows and decision phases.

## Purpose

Private `thinking` + raw `reasoningContext` (local `reasoning_content` etc.) are captured so that long unattended `--chatty` runs (especially Mingle + vote/power/council loops for 8->4 player testing) are actually debuggable and enjoyable for the human. Agents' real rationale for hidden Mingle intent, Mingle turns, empower/expose votes, empower revotes, power actions (pass/protect/eliminate), council votes, strategic reflections, Strategy Thread packet updates, direct endgame votes, and jury votes must be visible in local debug artifacts when useful and persisted in structured simulation artifacts. Initial Mingle room assignment is House-authored from all hidden intents and recorded as producer/debug assignment metadata. The House also emits between-round MC summary artifacts by default; rich producer simulations can add private House Strategy Bible packets, long-form summaries, and diary producer briefs for carry-forward validation.

This observability layer exists because "master wants to see reasoning for voting as well" and equivalent signals for power and council decisions. Public player messages stay clean; the hidden reasoning is only for viewers, replays, and simulation analysis.

## Architecture / Data Flow

`callTool<T>(...)` (in `agent.ts`) is the single source of truth:

- It always augments the returned object with `reasoningContext` via clean intersection:
  ```ts
  const args = JSON.parse(...) as T & { reasoningContext?: string };
  args.reasoningContext = reasoningContext;
  // (same pattern for parsedContent, jsonFallback, and mismatch paths)
  ```
- Never use `as any`.

Decision methods on `IAgent` / `InfluenceAgent` return the extra fields (typed on the interface and impl):

- `getMingleIntent(...)` → `{ seekPlayers: string[]; avoidPlayers: string[]; preferredRoomSize: ...; purpose: string; provisionalTarget: string | null; noTargetReason: string | null; openingAsk: string; strategicLens: StrategicLens; strategicLensRationale: string; thinking?: string; reasoningContext?: string; strategyPacketUse?: StrategyPacketUseMarker }`
- `takeMingleTurn(...)` → `{ thinking?: string; message?: string | null; noReply?: boolean; gotoRoomId?: number | null; strategySignal?: string | null; movementPurpose?: string | null; reasoningContext?: string; strategyPacketUse?: StrategyPacketUseMarker }`
- `getRumorMessage(...)` → `{ thinking: string; message: string; strategicLens?: StrategicLens; strategicLensRationale?: string; reasoningContext?: string; strategyPacketUse?: StrategyPacketUseMarker }`
- `getVotes(...)` → `{ empowerTarget: UUID; exposeTarget: UUID; thinking?: string; reasoningContext?: string; strategyPacketUse?: StrategyPacketUseMarker }`
- `getEmpowerRevote(...)` → `{ empowerTarget: UUID; thinking?: string; reasoningContext?: string; strategyPacketUse?: StrategyPacketUseMarker }`
- `getPowerAction(...)` → `PowerAction & { thinking?: string; reasoningContext?: string; strategyPacketUse?: StrategyPacketUseMarker }`
- `getCouncilVote(...)` → `{ target: UUID; thinking?: string; reasoningContext?: string; strategyPacketUse?: StrategyPacketUseMarker }`
- `getStrategicReflection(...)` → `{ certainties: string[]; suspicions: string[]; allies: string[]; threats: string[]; plan: string; strategicLens: StrategicLens; strategicLensRationale: string; strategyPacket?: StrategyPacketSummary; thinking?: string; reasoningContext?: string } | null`
- `getEndgameEliminationVote(...)` / `getJuryVote(...)` → `{ target: UUID; thinking?: string; reasoningContext?: string }`

(Similar treatment for public messages, `getPowerLobbyMessage`, diary entries, accusations, jury questions, etc.)

Phase runners receive the rich result, record only the narrow game-state value when required, then forward the reasoning fields:

- `phases/vote.ts`: `logger.logSystem(..., votes.thinking, votes.reasoningContext)`
- `phases/power.ts`: `logger.logSystem(..., powerActionResult.thinking, powerActionResult.reasoningContext)`
- `phases/council.ts`: `logger.logSystem(..., voteResult.thinking, voteResult.reasoningContext)`
- `phases/mingle.ts`: emits hidden `mingle-intent` agent turns before House room assignment, records private `mingle-room-assignment` turns with `assignmentSource` (`house`, `repaired`, `fallback`, or later-beat `movement`), repair notes, and summary-only intent metadata including `strategicLens`, then records `strategySignal` / `movementPurpose` on private Mingle turn records rather than viewer-facing room text.
- `phases/rumor.ts`: emits anonymous rumor turns with public rumor text plus private `strategicLens` / `strategicLensRationale` metadata for producer/debug review.
- `diary-room.ts`: emits hidden `strategic-reflection` and `strategy-packet` agent turns when `enableStrategicReflections` is enabled and the reflection produces a packet. Reflection and packet records include the selected strategic lens.
- `diary-room.ts`: emits private `house-producer-brief` agent turns before diary questions when `enableHouseProducerBriefs` is enabled. The brief can sharpen the House's question but must separate safe-to-reveal material from private producer reads.
- `game-runner.ts`: emits one House interstitial after each completed normal round. `house-mc-summary` records plus clean House system transcript prose are on by default unless `enableHouseRoundSummaries` is `false`; `house-strategy-bible` and `house-long-form-summary` are private producer/debug records gated by rich producer config.
- Every phase runner that resolves an agent call also emits an `agent_turn` stream event via `logger.emitAgentTurn(...)` with the normalized response the game used.
- Decision agent turns include `response.strategyPacketUse` only when a live Strategy Thread packet existed and the model self-reported how the decision used it (`followed`, `revised`, `ignored`, or `deferred`).
- Mingle intent, rumor, and strategic-reflection records include `response.strategicLens` and `response.strategicLensRationale` so validation can distinguish vote math, room traffic, coalition geometry, promise debt, social cover, broad reads, and sparse presentation reads without parsing prose.

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
   * Raw model reasoning context (e.g. `reasoning_content` from local models like Gemma via LM Studio).
   * Captured separately from the agent's "thinking" field for richer simulation traces.
   */
  reasoningContext?: string;
  ...
}
```

For `--chatty` live viewing (`simulate.ts`):

```ts
function formatEntry(e: TranscriptEntry): string {
  ...
  if (e.thinking) {
    line += `\n    ${dim}${gray}thinking: ${e.thinking}${reset}`;
  }
  if (e.reasoningContext) {
    line += `\n    ${cyan}reasoning: ${e.reasoningContext}${reset}`;
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

## Core Style & Safety Rules

1. No `as any` anywhere in agent return paths, House calls, or reasoning threading. Use intersections or proper widening of return types. "`as any` scares master."

2. House calls must be direct (`await this.houseInterviewer.generateHouseSummary(...)`, `await this.houseInterviewer.updateStrategyBible(...)`, etc.) — no `if (typeof ... === 'function')` guards or `as any`.

3. Every structured decision that should be observable by viewers (votes, power, council, mingle turns, etc.) must solicit `"thinking"` in its tool schema (see `TOOL_CAST_VOTES`, `TOOL_POWER_ACTION`, `TOOL_COUNCIL_VOTE`) and return it + the attached `reasoningContext`.

4. Public player-visible output (`message` in `AgentResponse`, whisper/rumor text) must never contain the hidden thinking; it is stripped or kept in a separate field.

5. Strategy Thread packets are private producer/debug state. They live on the live agent during the current uninterrupted run, are refreshed through strategic reflection, and are not written to `MemoryStore`, canonical events, player-visible transcript text, or websocket-visible UI state. A packet's target posture is a prompt-level standing-target hint, not a hard gate: agents should keep it pointed at a living player when evidence supports one, pivot away from eliminated targets, or explicitly carry no standing target when they are still gathering reads.

6. When a prompt includes a live Strategy Thread, player-visible transcript entries and websocket messages must not carry that call's hidden `thinking` or `reasoningContext`. The private `agent_turn` record remains the debug artifact.

7. Checkpoint continuity capsules are the private snapshot lane for future hydration of live agent and House behavior. They may carry structured Strategy Thread summaries, reflection summaries, notes, commitments, and House Strategy Bible-derived state, but they are not canonical projection truth, not player-visible transcript, and not websocket-visible UI state. The admin durable-run hydration passport may expose only readiness stamps such as `playerContinuity`, `houseContinuity`, `snapshotManifest`, `boundaryCertificate`, `transcriptCursor`, `tokenCursor`, `ownerEpoch`, and `privacy`; it must not expose raw capsule bodies, `thinking`, `reasoningContext`, prompts, responses, storage keys, or source pointers.

8. Terminal UX for `--chatty` (and persisted `game-*.txt` / `.json`) is a first-class human output. `game-*-turns.jsonl` is the per-agent-turn machine-analysis output and `game-*-events.jsonl` is the accepted-domain-event replay output; both must stay clean JSON without ANSI formatting.

9. When backing out experiments (e.g. the old `mingle-loop` variant that caused phase pollution / extra INTRODUCTION/LOBBY/RUMOR entries), prefer clean removal over more guards. The state machine must remain understandable.

10. Fallbacks in agent methods must still return the shape with `thinking` / `reasoningContext` (even if the thinking is a short "fallback..." note).

## Local Model Specifics

See `docs/local-model-evaluation.md` for the full provider table. Key points that interact with reasoning capture:

- `INFLUENCE_LLM_TOOL_CHOICE_MODE=required` (default for local base URLs) + `json_schema` fallback. Local servers often reject object `tool_choice`.
- `extractReasoningContext` (with a deprecated `extractNativeThinking` wrapper) pulls only the raw `reasoning_content` / hidden channel and attaches it exclusively as `reasoningContext`. It never falls back to the agent's emitted "thinking".
- `REASONING_TOKEN_OVERHEAD`, `REASONING_OVERHEAD_HIGH/LOW`, and the `local*MinTokens` floors (`INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS`, `INFLUENCE_LLM_LOCAL_MESSAGE_MIN_TOKENS`) give reasoning models room before the visible/structured payload.
- Local paths no longer omit the `thinking` field from decision tool schemas. Agents are still expected to emit their internal reasoning (the "thinking" the prompts and schemas solicit). The raw hidden server channel (if present) is captured *separately* into `reasoningContext` only and never overwrites the emitted `thinking`. This gives clean gray `thinking:` + cyan `reasoning:` in --chatty for local models.
- `--chatty` + long timeouts (`--game-timeout-sec`, `--llm-timeout-sec`) are the recommended way to watch Mingle hardening and decision quality in real time.

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

See `formatEntry` above. Yellow House lines + indented gray thinking + cyan reasoning.

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
- `game-N-turns.jsonl`: one clean structured JSON record per agent turn, including the normalized response the game used plus `thinking` and `reasoningContext` when available.
- `game-N-events.jsonl`: one clean canonical domain event record per accepted game-state fact. Replay this through `replayCanonicalEvents(...)` to rebuild the game projection; do not parse transcript prose as board state. API-backed games persist the same canonical envelope in Postgres for live runs, while CLI simulations remain local JSONL artifacts unless a future import path explicitly loads them.

`game-N-turns.jsonl` always includes hidden `mingle-intent` records and House `mingle-room-assignment` records. It includes `house-mc-summary` records by default because `enableHouseRoundSummaries` is enabled in simulation config. It includes hidden `strategic-reflection` and `strategy-packet` records when the simulator is run with `--strategic-reflections` (or `INFLUENCE_SIM_STRATEGIC_REFLECTIONS=true`) and the reflection produces a packet. It includes private `house-strategy-bible`, `house-long-form-summary`, and `house-producer-brief` records when the simulator is run with `--rich-producer` (or `INFLUENCE_SIM_RICH_PRODUCER=true`). Later private decision records may include `response.strategyPacketUse` markers that link a decision back to the packet revision as self-reported linkage evidence. These records are producer/debug artifacts only; they are not player-visible speech.

Recommended invocation for Mingle + visibility work:

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
```

For validation runs that need to prove strategic-reflection capture or Strategy Thread carry-forward is working, add `--strategic-reflections`. For House carry-forward validation, use `--rich-producer`; this also enables strategic reflections, bounded Council diary sessions, private House Strategy Bible packets, long-form House summaries, and per-player producer briefs.

The "Progress: R1 VOTE | alive=..." lines + the following House action lines are the primary place humans see per-agent rationale in real time. After the run, use `game-N-turns.jsonl` for structured agent-decision analysis and `game-N-events.jsonl` for replay/projection queries instead of parsing colored terminal output.

For MCP-backed analysis, run `bun run mcp:game -- docs/simulations` from `packages/engine`. The MCP scans the whole local simulation corpus, including old batches and currently-writing batches, and every game query is addressed by `sessionId + gameNumber`.

Useful validation queries:

- `search_logs` over `sources: ["turns"]` for `mingle-intent`
- `search_logs` over `sources: ["turns"]` for `strategic-reflection`
- `search_logs` over `sources: ["turns"]` for `strategy-packet`
- `search_logs` over `sources: ["turns"]` for `strategyPacketUse` or a packet `revisionId`
- `search_logs` over `sources: ["turns"]` for `strategySignal` or `movementPurpose`
- `search_logs` over `sources: ["turns", "transcript"]` for `house-mc-summary` or legacy `[House MC]`
- `search_logs` over `sources: ["turns"]` for `house-strategy-bible`, `house-long-form-summary`, `house-producer-brief`, or a House alliance name

Update simulation batch notes (the dated `.md` next to `results.json` etc.) with observations about the quality of the surfaced reasoning, not just win rates or token counts. When writing scripts, read `game-N-turns.jsonl` for per-turn decisions, `game-N-events.jsonl` for accepted domain facts, and `game-N.json` for full transcript context.

## Review Checklist

- Did we thread both thinking and reasoningContext all the way from the LLM response through the agent method, the phase log call, TranscriptEntry, AgentTurnEvent, and formatEntry?
- Is there any `as any` left in the changed paths?
- Are House calls still direct?
- If Strategy Thread packets changed, can MCP `search_logs` find a `strategy-packet` record plus a later `strategyPacketUse` marker?
- If House producer carry-forward changed, can MCP `search_logs` find `house-strategy-bible`, `house-mc-summary`, `house-long-form-summary`, and `house-producer-brief` records in a rich producer run?
- Are packet content and packet-use markers absent from websocket-visible events and canonical board state?
- Do API durable events, simulator JSONL records, and replay/projection tests still use the same `CanonicalGameEvent` envelope?
- Do mocks and tests compile and pass with the new shapes?
- If checkpoint continuity or hydration-passport fields changed, does an admin durable-run route test prove the HTTP response exposes stamp/status facts without raw private continuity?
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
