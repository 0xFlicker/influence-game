# Influence Game

A social-strategy game for AI agents. 4-12 agents compete through public discourse, private Mingle rooms, and strategic voting to be the last one standing.

Each round cycles through phases:

```
INTRODUCTION -> LOBBY -> MINGLE -> RUMOR -> VOTE -> POWER -> REVEAL -> COUNCIL
```

## Prerequisites

- **[Bun](https://bun.sh)** (v1.0+) -- runtime and package manager. Never use npm or pnpm.
- **[Doppler](https://docs.doppler.com/docs/install-cli)** -- injects hosted OpenAI and app secrets from the `social-strategy-agent` project.
- **Optional: [LM Studio](https://lmstudio.ai/)** -- runs local OpenAI-compatible models for simulator experiments.
- **[Docker](https://docs.docker.com/get-docker/)** -- runs the PostgreSQL 16 database container on port 54320.

## Getting Started

Before making repository changes, follow the current-main sync workflow in [`DEVELOPMENT.md`](DEVELOPMENT.md#before-starting-work): inspect branch status, fetch `origin`, update local `main`, then branch or reconcile feature work from that refreshed base.

### 1. Install dependencies

```bash
cd <your-influence-game-checkout>
bun install
```

### 2. Run a simulation (fastest way to see a game)

This runs a batch of AI-vs-AI games in the terminal -- no server or frontend needed.

```bash
# Run 3 games with 6 random agents (default)
bun run simulate

# Customize: 1 game, 4 specific agents
bun run simulate -- --games 1 --players 4 --personas Atlas,Vera,Finn,Mira

# Local LM Studio experiment (no Doppler)
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 4 --model <lm-studio-model-id>

# For Mingle + decision visibility (recommended):
# INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
#   bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
#     --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
#
# Add --strategic-reflections when validating hidden reflection capture
# or Strategy Thread carry-forward:
#   --variant mingle --chatty --strategic-reflections --game-timeout-sec 7200 --llm-timeout-sec 300

# Validation variants
bun run simulate -- --variant mingle
bun run simulate -- --variant power-lobby-mingle
```

The root `simulate` script injects hosted-provider secrets from the Doppler `social-strategy-agent` project's `dev` config. Use `simulate:local` when testing LM Studio or another OpenAI-compatible local endpoint.

Output includes a round-by-round transcript, per-persona win rates, token cost estimates, and per-game artifacts under `packages/engine/docs/simulations/`. Use `game-N-turns.jsonl` for structured per-agent-turn analysis with `thinking` / `reasoningContext`, `game-N-events.jsonl` for replayable accepted domain events, `game-N-progress.jsonl` for lightweight progress, and `game-N.txt` for human-readable transcript review. Mingle intent records are always written to turns JSONL; strategic reflection and `strategy-packet` records are written when `--strategic-reflections` is enabled, and later private decisions may include `strategyPacketUse` markers.

To expose the local simulation corpus to another local MCP client:

```bash
cd packages/engine
bun run mcp:game -- docs/simulations
```

The game MCP is read-only. It discovers past and currently-writing simulation batches, addresses games by `sessionId + gameNumber`, rebuilds projections from `game-N-events.jsonl`, and can list sessions/games, filter events, search logs, read player timelines, and return cited linked records when source pointers are present. Passing a single batch directory still works for focused inspection, but returned records include a `sessionId`. For strategy-observability validation, search turns logs for `mingle-intent`, `strategic-reflection`, `strategy-packet`, `strategyPacketUse`, `strategySignal`, or `movementPurpose`.

### 3. Run the full stack (API + Web UI)

To watch games live in a browser:

**Terminal 1 -- Start the API server:**

```bash
doppler run -- bun run dev:api
```

The API runs on `http://localhost:3000` by default. It connects to a local PostgreSQL database (`influence_dev` on port 54320).

**Terminal 2 -- Start the web frontend:**

```bash
bun run dev:web
```

The frontend runs on `http://localhost:3001` (Next.js default).

**Then:**

1. Open `http://localhost:3001` in your browser
2. Sign in via Privy (wallet or email)
3. Use the admin panel to create a new game, configure player count, and start it
4. Watch the game unfold live via WebSocket

### 4. Run tests

```bash
# Unit tests -- fast, no LLM calls, no secrets needed
bun test:engine

# Full integration tests -- requires a hosted or local OpenAI-compatible LLM provider
bun run test:engine:full

# All packages (unit tests only)
bun test

# Type check everything
bun run typecheck
```

### 5. Close out code-backed work

Before calling code-backed work done, open a reviewable PR and report the PR URL plus the real verification results. The canonical delivery sequence and closeout format live in [`DEVELOPMENT.md`](DEVELOPMENT.md#definition-of-done).

## Project Structure

```
packages/
  engine/           # Core game logic (standalone, no server dependency)
    src/
      types.ts          # Phase enum, Player, GameConfig, messages, events
      event-bus.ts      # RxJS pub/sub event bus
      game-state.ts     # Mutable game state + phase transitions
      phase-machine.ts  # xstate v5 FSM for round cycle
      game-runner.ts    # Orchestrates agents through each phase
      agent.ts          # LLM-backed player (OpenAI-compatible chat completions)
      simulate.ts       # CLI batch simulation runner
      __tests__/        # Unit + integration tests

  api/              # HTTP API + WebSocket server (Bun + Hono)
    src/
      index.ts          # Server entry point
      db/               # PostgreSQL schema, migrations, seed
      routes/           # REST endpoints (games, auth)
      services/         # Game lifecycle, WebSocket manager
      middleware/       # Privy auth middleware

  web/              # Browser frontend (Next.js + Privy + Tailwind)
    src/                # App Router pages and components
```

## Environment Variables

Hosted-provider secrets are injected via Doppler (`doppler run -- <command>`). Local LM Studio experiments can run without Doppler by setting the OpenAI-compatible provider variables below.

### API (`packages/api`) -- injected by Doppler

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes, unless using local provider | -- | Hosted OpenAI API key for LLM agent calls |
| `INFLUENCE_LLM_BASE_URL` | No | -- | OpenAI-compatible endpoint, e.g. `http://127.0.0.1:1234/v1` for LM Studio |
| `INFLUENCE_LLM_API_KEY` | No | `lm-studio` when `INFLUENCE_LLM_BASE_URL` is set | API key for the OpenAI-compatible endpoint |
| `INFLUENCE_LLM_TOOL_CHOICE_MODE` | No | `required` for local base URLs, otherwise `named` | Structured decision-call mode: `named`, `required`, `auto`, or `json_schema` |
| `INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS` | No | `4096` | Minimum completion budget for local structured decisions |
| `INFLUENCE_LLM_LOCAL_MESSAGE_MIN_TOKENS` | No | `8192` | Minimum completion budget for local public messages |
| `INFLUENCE_MODEL_BUDGET` | No | `gpt-5-nano` | Server-side budget tier model override |
| `INFLUENCE_MODEL_STANDARD` | No | `gpt-5-mini` | Server-side standard tier model override |
| `INFLUENCE_MODEL_PREMIUM` | No | `gpt-5.4-mini` | Server-side premium tier model override |
| `PRIVY_APP_ID` | Yes | -- | Privy app ID for auth |
| `PRIVY_APP_SECRET` | Yes | -- | Privy app secret for auth |
| `JWT_SECRET` | Yes | -- | Secret for signing session JWTs |
| `ADMIN_ADDRESS` | No | -- | EVM wallet address granted admin access |
| `PORT` | No | `3000` | HTTP server port |
| `CORS_ORIGIN` | No | -- | Allowed CORS origin when using a single origin |
| `CORS_ORIGINS` | No | -- | Comma-separated list of allowed CORS origins. Overrides `CORS_ORIGIN` when set |
| `DATABASE_URL` | No | `postgresql://influence:influence@127.0.0.1:54320/influence_dev` | PostgreSQL connection string |

### Web (`packages/web`) -- set in `packages/web/.env.local`

Create this file manually:

```bash
cat > packages/web/.env.local << 'EOF'
NEXT_PUBLIC_PRIVY_APP_ID=<your-privy-app-id>
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000
NEXT_PUBLIC_ADMIN_ADDRESS=<your-wallet-address>
EOF
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Privy app ID (same as API) |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL |
| `NEXT_PUBLIC_WS_URL` | Yes | WebSocket URL for live game events |
| `NEXT_PUBLIC_ADMIN_ADDRESS` | Yes | Wallet address for admin panel access |

> If you see "Access denied" in the admin panel, check that `NEXT_PUBLIC_ADMIN_ADDRESS` is set.

## Personas

Influence has a core roster plus experimental personas. The public UI currently exposes 13 persona options; engine/API roster reconciliation is ongoing.

| Name | Style | Strategy |
|---|---|---|
| Atlas | Strategic | Calculated alliances, targets dangerous players |
| Vera | Deceptive | Manipulator, spreads misinformation |
| Finn | Honest | Transparent, genuine coalitions |
| Mira | Social | Charm and likability, avoids confrontation |
| Rex | Aggressive | Fast action, bold moves early |
| Lyra | Paranoid | Trusts no one, pre-emptive elimination |
| Kael | Loyalist | Unwavering alliances, protects partners |
| Echo | Observer | Quiet analysis, strikes at key moments |
| Sage | Diplomat | Builds consensus, mediates conflicts |
| Jace | Wildcard | Unpredictable, chaotic plays |
| Nyx | Contrarian | Challenges consensus, tests group assumptions |
| Rune | Provocateur | Weaponizes information and timed reveals |
| Wren | Martyr | Sacrifices position to protect allies |

## Simulation CLI Reference

```bash
bun run simulate -- [options]

Options:
  --games N        Number of games to run (default: 3)
  --players N      Players per game, 4-10 (default: 6)
  --personas A,B   Comma-separated persona names (default: random selection)
  --model NAME     OpenAI-compatible model ID (default: gpt-5-nano)
  --variant NAME   Variant: baseline, mingle, power-lobby,
                   or power-lobby-mingle (default: baseline)
  --chatty         Print live formatted transcript output
  --strategic-reflections
                   Include hidden strategic-reflection and Strategy Thread records in artifacts
```

## Seeding the Database (optional)

To populate the API database with sample data for development:

```bash
cd packages/api && bun run db:seed
```

## Further Reading

- [Agent Guide](AGENTS.md) -- repo-specific agent operating context
- [Development Guide](DEVELOPMENT.md) -- ownership boundaries, release workflow, coding conventions
- [Local Model Evaluation](docs/local-model-evaluation.md) -- LM Studio and local simulation workflow
