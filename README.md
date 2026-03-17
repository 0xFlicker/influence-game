# Influence Game

A social-strategy game for AI agents. 4–12 agents compete through public discourse, private whispers, and strategic voting to be the last one standing.

## Overview

Each round cycles through eight phases:

```
INTRODUCTION → LOBBY → WHISPER → RUMOR → VOTE → POWER → REVEAL → COUNCIL
```

Agents speak publicly, send private whispers, vote to empower one player (who gains a power action), and vote in council to eliminate a candidate. The game ends when only one agent remains or the round limit is reached.

See [AGENTS.md](../../AGENTS.md) for the full game specification.

## Quick Start

```bash
# Install dependencies
bun install

# Run unit tests (no LLM calls required)
bun test src/__tests__/game-engine.test.ts

# Run full integration tests (requires OPENAI_API_KEY via Doppler)
doppler run -- bun test
```

## Project Structure

```
src/
  types.ts          # Phase enum, Player, GameConfig, message & event types
  event-bus.ts      # RxJS pub/sub bus (GameEventBus)
  game-state.ts     # GameState class — mutable state + phase transitions
  phase-machine.ts  # xstate v5 FSM driving the round cycle
  game-runner.ts    # GameRunner — orchestrates agents through each phase
  agent.ts          # InfluenceAgent — LLM-backed player (OpenAI, gpt-4o-mini)
  __tests__/
    game-engine.test.ts   # Deterministic unit tests (no LLM)
    full-game.test.ts     # Integration tests with real LLM calls
    mock-agent.ts         # MockAgent for scripted, deterministic play
```

## Architecture

### Game Loop

`GameRunner.run()` drives the loop:
1. Notifies all agents of game start via `onGameStart()`
2. Starts the xstate machine (defined in `phase-machine.ts`)
3. Runs `runGameLoop()` — listens to machine state and dispatches to phase handlers
4. Each phase handler: collects agent responses via the event bus, updates `GameState`, then sends the machine's `NEXT` event
5. Returns `{ winner, rounds, transcript }` when the machine reaches `END`

### Agent Interface (`IAgent`)

Any object implementing `IAgent` can play. The contract:

```typescript
interface IAgent {
  id: string;
  name: string;
  onGameStart(gameId: string, allPlayers: Player[]): Promise<void>;
  onPhaseStart(context: PhaseContext): Promise<void>;
  getIntroduction(context: PhaseContext): Promise<string>;
  getLobbyMessage(context: PhaseContext): Promise<string>;
  getWhispers(context: PhaseContext): Promise<WhisperMessage[]>;
  getRumorMessage(context: PhaseContext): Promise<string>;
  getVotes(context: PhaseContext): Promise<{ empower: string; expose: string }>;
  getPowerAction(context: PhaseContext): Promise<PowerAction>;
  getCouncilVote(context: PhaseContext): Promise<string>;
  getLastMessage(context: PhaseContext): Promise<string>;
  getDiaryEntry(context: PhaseContext): Promise<string>;
}
```

`InfluenceAgent` implements this via OpenAI calls. `MockAgent` implements it with scripted responses for deterministic testing.

### Phase Context

Every phase handler passes a `PhaseContext` to each agent:

```typescript
interface PhaseContext {
  gameId: string;
  round: number;
  phase: Phase;
  selfId: string;
  selfName: string;
  alivePlayers: { id: string; name: string }[];
  publicMessages: { from: string; text: string; phase: Phase }[];
  whisperMessages: WhisperMessage[];      // only whispers addressed to this agent
  empoweredId: string | null;
  councilCandidates: string[];
}
```

### Event Bus

`GameEventBus` wraps RxJS subjects. The game runner uses two key methods:

- `collectActions(type, agentIds, timeoutMs)` — waits for all agents to submit an action of a given type, with a timeout for partial collection
- `waitForAction(type, agentId, timeoutMs)` — waits for a single agent

### State Machine

`phase-machine.ts` defines the xstate v5 actor. Context tracks round, alive players, empowered agent ID, council candidates, and elimination results. Guards control branching: `gameIsOver` (≤1 alive or max rounds) and `autoEliminateTriggered` (empowered chose eliminate, skip council).

### Game State

`GameState` owns the mutable truth: players, votes, round results, shields. Key methods:

| Method | Purpose |
|---|---|
| `startRound()` | Increment round, reset tallies |
| `recordVote()` | Register empower + expose vote |
| `tallyEmpowerVotes()` | Plurality vote, random tiebreak |
| `setPowerAction()` | Record empowered agent's choice |
| `determineCandidates()` | Compute council candidates, handle shields & auto-eliminate |
| `recordCouncilVote()` | Register council vote |
| `tallyCouncilVotes()` | Eliminate candidate, empowered breaks ties |

## Personas

Six built-in personalities in `agent.ts`:

| Name | Personality | Style |
|---|---|---|
| Atlas | Strategic | Calculated alliances, targets dangerous players |
| Vera | Deceptive | Manipulator, spreads misinformation |
| Finn | Honest | Transparent, genuine coalitions |
| Mira | Social | Charm and likability, avoids confrontation |
| Rex | Aggressive | Fast action, bold moves early |
| Lyra | Paranoid | Trusts no one, pre-emptive elimination |

`createAgentCast()` in `agent.ts` returns the full six-agent cast.

## Configuration

```typescript
const config: GameConfig = {
  timers: {
    introduction: 3 * 60 * 1000,   // 3 min
    lobby:        5 * 60 * 1000,   // 5 min
    whisper:      4 * 60 * 1000,   // 4 min
    rumor:        3 * 60 * 1000,   // 3 min
    vote:         3 * 60 * 1000,   // 3 min
    power:        2 * 60 * 1000,   // 2 min
    council:      3 * 60 * 1000,   // 3 min
  },
  maxRounds: 10,
  minPlayers: 4,
  maxPlayers: 12,
};
```

## Running Tests

```bash
# Unit tests — deterministic, no LLM, runs fast
bun test src/__tests__/game-engine.test.ts

# Integration tests — requires OPENAI_API_KEY
doppler run -- bun test src/__tests__/full-game.test.ts

# All tests
doppler run -- bun test

# Watch mode
doppler run -- bun test --watch

# Type check
bun run typecheck
```

## Transcript

`GameRunner.run()` returns a `transcript: TranscriptEntry[]`:

```typescript
interface TranscriptEntry {
  round: number;
  phase: Phase;
  timestamp: number;
  from: string;        // agent id
  scope: 'public' | 'whisper' | 'system';
  to?: string[];       // whisper recipients
  text: string;
}
```

All public messages, whispers, system announcements, and diary entries are logged here. Use this for post-game analysis.

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `openai` | ^4.77.0 | LLM API calls |
| `rxjs` | ^7.8.2 | Event bus |
| `xstate` | ^5.20.1 | Phase state machine |
| `typescript` | ^5.8.3 | Type checking |
| `bun-types` | ^1.3.10 | Bun runtime types |

**Package manager: Bun only.** Never use npm or pnpm.
