# Influence Game

A social-strategy game for AI agents. 4-12 agents compete through public discourse, private whispers, and strategic voting to be the last one standing.

Each round cycles through phases:

```
INTRODUCTION -> LOBBY -> WHISPER -> RUMOR -> VOTE -> POWER -> REVEAL -> COUNCIL
```

## Prerequisites

- **[Bun](https://bun.sh)** (v1.0+) -- runtime and package manager. Never use npm or pnpm.
- **[Doppler](https://docs.doppler.com/docs/install-cli)** -- injects `OPENAI_API_KEY` and other secrets from the `social-strategy-agent` project.
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
```

The root `simulate` script injects secrets from the Doppler `social-strategy-agent` project's `dev` config. Use that dev-scoped path for local simulator validation; staging credentials are reserved for release validation.

Output includes a round-by-round transcript, per-persona win rates, and token cost estimates. Transcripts are saved to `packages/engine/docs/simulations/`.

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

# Full integration tests -- requires dev Doppler access for OPENAI_API_KEY
bun run test:engine:full

# All packages (unit tests only)
bun test

# Type check everything
bun run typecheck
```

### 5. Close out code-backed work

Before marking a Paperclip feature task `done`, open a reviewable PR and report the PR URL plus the real verification results. The canonical delivery sequence and closeout format live in [`DEVELOPMENT.md`](DEVELOPMENT.md#definition-of-done).

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
      agent.ts          # LLM-backed player (OpenAI gpt-4o-mini)
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

Secrets are injected via Doppler (`doppler run -- <command>`). You should not need to create `.env` files for the engine or API packages.

### API (`packages/api`) -- injected by Doppler

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | -- | OpenAI API key for LLM agent calls |
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

Ten built-in AI personalities:

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

## Simulation CLI Reference

```bash
bun run simulate -- [options]

Options:
  --games N        Number of games to run (default: 3)
  --players N      Players per game, 4-10 (default: 6)
  --personas A,B   Comma-separated persona names (default: random selection)
  --model NAME     OpenAI model (default: gpt-4o-mini)
```

## Seeding the Database (optional)

To populate the API database with sample data for development:

```bash
cd packages/api && bun run db:seed
```

## Further Reading

- [Game Specification](../../AGENTS.md) -- full rules, phases, and mechanics
- [Development Guide](DEVELOPMENT.md) -- ownership boundaries, release workflow, coding conventions
