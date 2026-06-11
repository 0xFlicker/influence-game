# Reasoning & Transcript Observability

These rules and patterns apply to the game engine (`packages/engine`) for surfacing agent internal reasoning during simulations, particularly for Mingle workflows and decision phases.

## Purpose

Private `thinking` + raw `reasoningContext` (local `reasoning_content` etc.) are captured so that long unattended `--chatty` runs (especially Mingle + vote/power/council loops for 8->4 player testing) are actually debuggable and enjoyable for the human. Agents' real rationale for empower/expose votes, power actions (pass/protect/eliminate), and council votes (including empowered tiebreakers) must be visible in the terminal and persisted in transcripts.

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

- `getVotes(...)` → `{ empowerTarget: UUID; exposeTarget: UUID; thinking?: string; reasoningContext?: string }`
- `getPowerAction(...)` → `PowerAction & { thinking?: string; reasoningContext?: string }`
- `getCouncilVote(...)` → `{ target: UUID; thinking?: string; reasoningContext?: string }`

(Similar treatment for `takeMingleTurn`, `getPowerLobbyMessage`, diary entries, etc.)

Phase runners receive the rich result, record only the narrow game-state value when required, then forward the reasoning fields:

- `phases/vote.ts`: `logger.logSystem(..., votes.thinking, votes.reasoningContext)`
- `phases/power.ts`: `logger.logSystem(..., powerActionResult.thinking, powerActionResult.reasoningContext)`
- `phases/council.ts`: `logger.logSystem(..., voteResult.thinking, voteResult.reasoningContext)`

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

`TranscriptEntry` (game-runner.types.ts) is the canonical persisted + streamed shape:

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

House MC summaries (`house-interviewer.ts` + direct calls in `game-runner.ts`) are logged via the same `logSystem` path (e.g. after COUNCIL) for richer traces:

```ts
const summary = await this.houseInterviewer.generateGameplaySummary(...);
this.logger.logSystem(`[House MC] ${summary}`, Phase.COUNCIL);
```

`PowerAction` interface itself (types.ts) stays narrow:

```ts
export interface PowerAction {
  action: PowerActionType;
  target: UUID;
}
```

The extras live only on the agent return value and the `TranscriptEntry`. Game state and tally logic never see them.

## Core Style & Safety Rules

1. No `as any` anywhere in agent return paths, House calls, or reasoning threading. Use intersections or proper widening of return types. "`as any` scares master."

2. House calls must be direct (`await this.houseInterviewer.generateGameplaySummary(...)`) — no `if (typeof ... === 'function')` guards or `as any`.

3. Every structured decision that should be observable by viewers (votes, power, council, mingle turns, etc.) must solicit `"thinking"` in its tool schema (see `TOOL_CAST_VOTES`, `TOOL_POWER_ACTION`, `TOOL_COUNCIL_VOTE`) and return it + the attached `reasoningContext`.

4. Public player-visible output (`message` in `AgentResponse`, whisper/rumor text) must never contain the hidden thinking; it is stripped or kept in a separate field.

5. Terminal UX for `--chatty` (and persisted `game-*.txt` / `.json`) is a first-class output. Colors and indentation exist so a human can scan long runs without losing the model's rationale.

6. When backing out experiments (e.g. the old `mingle-loop` variant that caused phase pollution / extra INTRODUCTION/LOBBY/RUMOR entries), prefer clean removal over more guards. The state machine must remain understandable.

7. Fallbacks in agent methods must still return the shape with `thinking` / `reasoningContext` (even if the thinking is a short "fallback..." note).

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

**Direct House summary (non-fatal, after council):**

```ts
try {
  const summary = await this.houseInterviewer.generateGameplaySummary(
    this.logger.transcript.slice(-30),
    this.gameState.round,
    Phase.COUNCIL,
    ...
  );
  this.logger.logSystem(`[House MC] ${summary}`, Phase.COUNCIL);
} catch {
  // non-fatal for summary generation
}
```

## What To Record / Usage

In simulation batches under `packages/engine/docs/simulations/`, the full transcript JSON (and the `.txt` when using `--chatty`) now contains the `thinking` and `reasoningContext` fields on VOTE, POWER, and COUNCIL `"system"` entries (plus any House MC summaries).

Recommended invocation for Mingle + visibility work:

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
```

The "Progress: R1 VOTE | alive=..." lines + the following House action lines are now the primary place humans see per-agent rationale in real time.

Update simulation batch notes (the dated `.md` next to `results.json` etc.) with observations about the quality of the surfaced reasoning, not just win rates or token counts.

## Review Checklist

- Did we thread both thinking and reasoningContext all the way from the LLM response through the agent method, the phase log call, TranscriptEntry, and formatEntry?
- Is there any `as any` left in the changed paths?
- Are House calls still direct?
- Do mocks and tests compile and pass with the new shapes?
- Are the ANSI color rules and terminal output expectations documented?
- Did we update the cross-referenced usage docs and AGENTS.md where the contract changed?
- Can a future reader understand why this observability layer exists (Mingle debugging + "master wants to see reasoning for voting as well")?

## Related

- `docs/local-model-evaluation.md` — primary reference for local provider setup and what makes a useful `--chatty` run.
- `packages/engine/src/simulate.ts` — chatty entry point and `formatEntry`.
- `packages/engine/src/agent.ts` — `callTool` and the decision methods.
- `packages/engine/src/transcript-logger.ts` and `game-runner.types.ts` — the data model.
- `CONCEPTS.md` — project vocabulary for `TranscriptEntry`, `reasoningContext`, `chatty` mode, `House MC`, and the `callTool` reasoning augmentation.
- `feat/inf-228-mingle-hardening` branch context: this observability work was driven by the need to debug and enjoy the new Mingle room system + the full decision loop down to 4 players.
