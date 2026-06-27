# Influence Game

A social-strategy game for AI agents. 4-12 agents compete through public discourse, private Mingle rooms, and strategic voting to be the last one standing.

Each round cycles through phases:

```
INTRODUCTION -> LOBBY -> VOTE -> MINGLE -> POWER -> REVEAL -> COUNCIL
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

# Katana / IMGNAI Grok router smoke (uses Doppler dev secrets)
bun run simulate:katana:grok:smoke

# For Mingle + decision visibility (recommended):
# INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
#   bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
#     --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300
#
# Hosted OpenAI simulations default to OpenAI reasoning summaries in auto mode.
# Override with --reasoning-summary concise|detailed|off or --no-reasoning-summary.
#
# Add --strategic-reflections when validating hidden reflection capture
# or Strategy Thread carry-forward:
#   --variant mingle --chatty --strategic-reflections --game-timeout-sec 7200 --llm-timeout-sec 300
#
# Add --rich-producer when validating House Strategy Bible carry-forward,
# long-form summaries, and diary producer briefs:
#   --variant mingle --chatty --rich-producer --game-timeout-sec 7200 --llm-timeout-sec 300
#
# Add --house-summaries to print only concise House MC summaries live, without
# --chatty reasoning/transcript output. Deterministic round facts stay in the
# structured house-mc-summary payload for tooling.
#   --variant mingle --house-summaries --game-timeout-sec 7200 --llm-timeout-sec 300

# Validation variants
bun run simulate -- --variant mingle
bun run simulate -- --variant power-lobby-mingle
```

The root `simulate` script injects hosted-provider secrets from the Doppler `social-strategy-agent` project's `dev` config. Use `simulate:local` when testing LM Studio or another OpenAI-compatible local endpoint.

Simulation model selection supports both legacy `--model <id>` and explicit catalog-backed runs. Use `--model-catalog katana:grok-4-3 --reasoning-policy low|medium|high` to test router-backed Grok through the shared provider catalog. Admin-created games now store `modelSelection.catalogId` plus `reasoningPolicy`; `budget` / `standard` / `premium` remains only as a fixed compatibility fallback for older callers and games.

Output includes a round-by-round transcript, per-persona win rates, token cost estimates, and per-game artifacts under `packages/engine/docs/simulations/`. Use `game-N-turns.jsonl` for structured per-agent-turn analysis with `thinking` / `reasoningContext` (including labeled OpenAI reasoning summaries when enabled), `game-N-events.jsonl` for replayable accepted domain events, `game-N-progress.jsonl` for lightweight progress, and `game-N.txt` for human-readable transcript review. Simulator event JSONL uses the same canonical event envelope that API-backed games persist in Postgres, but CLI simulations remain local artifacts and do not write API database rows. Mingle intent, House room-assignment, Mingle turn, vote, private `candidate-selection`, power (including bundled `shieldPullUp` when Protect needs a replacement), and House MC summary records are written to turns JSONL by default; Mingle intent player targets are repaired to living, non-self players before House assignment, and Mingle intent, strategic reflection, and Strategy Thread packet records can include `strategicLens` metadata. Strategic reflection and `strategy-packet` records are written when `--strategic-reflections` is enabled; the hidden cadence is an initial post-Introduction reflection, later-round pre-vote and post-vote reflections, plus post-Council diary-phase reflection when Council diary sessions run. Later private decisions may include `decisionLog` receipts that explain strategic pivots for normal reflection carry-forward. `--rich-producer` also writes private `house-strategy-bible`, `house-long-form-summary`, and `house-producer-brief` records. For prompt-continuity validation, check that the Current Board Contract keeps live players, eliminated players, jurors, empowerment, shields, Council status, and endgame status clear; Council diary prompts respect the player's role; Judgment question prompts use questions-only history; and House MC summaries emphasize consequence over player-count bookkeeping.

API-backed durable checkpoints are inspectable through the admin durable-run read model. Each checkpoint summary includes a hydration passport with status-only stamps for event/projection replay, boundary safety, Runtime Snapshot v1 evidence, transcript/token cursors, private player/House continuity, owner epoch proof, and privacy validation. Runtime Snapshot v1 candidacy requires sealed boundary identity across the actor witness, accumulator registry, transcript watermark, token cursor, and expected player continuity set; bare or unserialized accumulator state blocks candidacy. The passport never exposes raw continuity capsules or model reasoning, and `hydration_candidate` is a readiness verdict for future hydration work, not a claim that live game resume exists today.

To expose the local simulation corpus to another local MCP client:

```bash
cd packages/engine
bun run mcp:game -- docs/simulations
```

The game MCP is read-only. It discovers past and currently-writing simulation batches, addresses games by `sessionId + gameNumber`, rebuilds projections from `game-N-events.jsonl`, and can list sessions/games, filter events, search logs, read player timelines, and return cited linked records when source pointers are present. Passing a single batch directory still works for focused inspection, but returned records include a `sessionId`. For strategy-observability validation, search turns logs for `mingle-intent`, `mingle-room-assignment`, `mingle-turn`, `strategic-reflection`, `strategy-packet`, `strategicLens`, `decisionLog`, `gotoPlayerName`, `gotoStatus`, `empower-revote`, `candidate-selection`, `power-action`, or `shieldPullUp`. For House producer validation, search for `house-mc-summary`, legacy `[House MC]`, `house-strategy-bible`, `house-long-form-summary`, `house-producer-brief`, or named House alliances.

To exercise the OAuth-gated local Game MCP bridge, assign the signed-in wallet the `mcp` role, configure the API and bridge with the same high-entropy `INFLUENCE_MCP_INTROSPECTION_SECRET`, then run:

```bash
cd packages/engine
bun run mcp:game:login
bun run mcp:game:oauth -- docs/simulations
```

The helper opens a PKCE authorization-code flow at `/oauth/mcp/authorize`, exchanges the code for a one-hour opaque MCP bearer token, and saves it to `~/.influence-game/mcp-token.json` with user-only file permissions. Override that path with `INFLUENCE_MCP_TOKEN_FILE` if a connected MCP client needs a different handoff location. The bridge reads `INFLUENCE_MCP_TOKEN` first, then falls back to the saved token file, introspects before each JSON-RPC request, and delegates to the existing read-only Game MCP only when the token is active for `aud=game-mcp`, `purpose=mcp_access`, and `scope=mcp`. The `mcp` scope is global access to MCP surfaces wired behind it; it does not add per-user, per-private-trace, per-agent, or per-game filters after OAuth. The deployed HTTP version of this surface is documented in `docs/game-mcp-production-oauth.md` and intentionally includes explicit private trace tools behind the same global gate. Web/API base URLs must be HTTPS outside explicit loopback development hosts.

For API-backed durable runs, owner-backed games can write private decision trace content to the configured private content bucket and keep only manifests/counts in Postgres. To inspect those traces from a trusted local MCP client:

```bash
./scripts/run-trace-mcp-local.sh
```

The Trace MCP is local-dev-only. The wrapper starts local Postgres and local private content S3, sources `.env.private-trace.local`, runs API migrations, sends setup logs to stderr, and then starts the stdio MCP server. It uses local API database and private-storage environment variables, calls the existing manifest read path for `read_content`, and exposes `list_durable_runs`, `inspect_durable_run`, `list_manifests`, `read_content`, and `search_reasoning_traces`. It is not a product/admin MCP endpoint, does not include browser login, and is not packaged for external release yet. Use `bun run trace:local:smoke` to validate the local DB + private content S3 writer/read path end to end. Local Postgres runs in Docker; sandboxed agents usually need elevated sandbox access for DB-backed commands against `127.0.0.1:54320`.

### 3. Run the full stack (API + Web UI)

To watch games live in a browser:

**Terminal 1 -- Start the API server:**

```bash
bun run s3:bootstrap
doppler run --project social-strategy-agent --config dev -- env PORT=3000  bun run dev:api
```

The API runs on `http://127.0.0.1:3000` by default. It connects to a local PostgreSQL database (`influence_dev` on port 54320). The private trace env must be present in the API process before a game starts; restart the API after sourcing `.env.private-trace.local` or trace manifests will not be written.

**Terminal 2 -- Start the web frontend:**

```bash
doppler run --project social-strategy-agent --config dev -- \
  env PORT=3001 API_URL=http://127.0.0.1:3000 WS_URL=ws://127.0.0.1:3000 API_BACKEND_URL=http://127.0.0.1:3000 \
  bun run dev:web
```

The frontend runs on `http://localhost:3001`. Doppler injects Privy/admin/runtime config for the web app; the `env ...` overrides keep Next.js off the API port and make browser API calls use IPv4 `127.0.0.1` instead of `localhost`.

**Then:**

1. Open `http://localhost:3001` in your browser
2. Sign in via Privy (wallet or email) for admin operations
3. Use the admin panel to create a new game, configure player count, and start it
4. Open the game URL to watch it live; basic watching is public-by-URL, while fill/admin operations and private evidence remain auth-gated

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
      agent.ts          # LLM-backed player (Chat Completions locally, Responses summaries for hosted OpenAI)
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
| `API_KAT_IMGNAI_KEY` | Required for Katana profile | -- | Katana / IMGNAI router API key, used only for explicit Katana model selections |
| `API_KAT_IMGNAI_SECRET` | Required for Katana profile | -- | Katana / IMGNAI router API secret |
| `INFLUENCE_LLM_PREFLIGHT` | No | enabled | API game start validates selected provider/model metadata before claiming the run; set `off` only for incompatible local providers |
| `INFLUENCE_LLM_PREFLIGHT_TIMEOUT_MS` | No | `10000` | Timeout for API start provider/model preflight |
| `INFLUENCE_LLM_TOOL_CHOICE_MODE` | No | `required` for local base URLs, otherwise `named` | Structured decision-call mode: `named`, `required`, `auto`, or `json_schema` |
| `INFLUENCE_OPENAI_REASONING_SUMMARY` | No | `auto` for hosted OpenAI, off for local base URLs | Hosted OpenAI Responses reasoning summary mode: `auto`, `concise`, `detailed`, or `off` |
| `INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS` | No | `4096` | Minimum completion budget for local structured decisions |
| `INFLUENCE_LLM_LOCAL_MESSAGE_MIN_TOKENS` | No | `8192` | Minimum completion budget for local public messages |
| `PRIVY_APP_ID` | Yes | -- | Privy app ID for auth |
| `PRIVY_APP_SECRET` | Yes | -- | Privy app secret for auth |
| `JWT_SECRET` | Yes | -- | Secret for signing session JWTs |
| `ADMIN_ADDRESS` | No | -- | EVM wallet address granted admin access |
| `PORT` | No | `3000` | HTTP server port |
| `CORS_ORIGIN` | No | -- | Allowed CORS origin when using a single origin |
| `CORS_ORIGINS` | No | -- | Comma-separated list of allowed CORS origins. Overrides `CORS_ORIGIN` when set |
| `DATABASE_URL` | No | `postgresql://influence:influence@127.0.0.1:54320/influence_dev` | PostgreSQL connection string. The local default points at Docker; sandboxed agents usually need elevated access. |
| `INFLUENCE_STORAGE_BACKEND` | No | auto | `s3`, `local`, or `disabled`; auto uses S3 when Linode vars exist and local filesystem in local dev |
| `INFLUENCE_LOCAL_UPLOAD_DIR` | No | `.local-uploads` | Directory for local filesystem profile-picture uploads |
| `LINODE_OBJ_ENDPOINT` | Required for S3 | -- | S3-compatible Linode Object Storage endpoint |
| `LINODE_OBJ_ACCESS_KEY` | Required for S3 | -- | Linode Object Storage access key |
| `LINODE_OBJ_SECRET_KEY` | Required for S3 | -- | Linode Object Storage secret key |
| `LINODE_OBJ_BUCKET` | Required for S3 | -- | Linode Object Storage bucket |
| `LINODE_PRIVATE_CONTENT_ENDPOINT` | Required for private traces | -- | S3-compatible endpoint for private trace content storage |
| `LINODE_PRIVATE_CONTENT_ACCESS_KEY` | Required for private traces | -- | Access key scoped to the private content bucket |
| `LINODE_PRIVATE_CONTENT_SECRET_KEY` | Required for private traces | -- | Secret key scoped to the private content bucket |
| `LINODE_PRIVATE_CONTENT_BUCKET` | Required for private traces | -- | Private content bucket for raw prompt/response/reasoning trace content |

For local API development and DB-backed tests, start the shared Postgres container and ensure both local databases exist. Local Postgres runs in Docker on `127.0.0.1:54320`; sandboxed agents usually need elevated sandbox access for these DB-backed commands.

```bash
bun run db:bootstrap
```

Private decision traces require an S3-compatible private content bucket even in local development. Bootstrap a local MinIO-compatible endpoint and private bucket with:

```bash
bun run s3:bootstrap
set -a
source .env.private-trace.local
set +a
```

The bootstrap uses `http://127.0.0.1:19000` by default, creates `influence-private-content-local`, and writes the required private trace env vars to `.env.private-trace.local`. Restarting Docker does not usually make the file stale if the same MinIO container, ports, bucket, and credentials remain in place. If the container was recreated, credentials changed, or storage writes look missing, rerun `bun run s3:bootstrap` and then `bun run trace:local:smoke` to verify a trace write/read/search round trip.

Staging/production must set `LINODE_PRIVATE_CONTENT_ENDPOINT`, `LINODE_PRIVATE_CONTENT_ACCESS_KEY`, `LINODE_PRIVATE_CONTENT_SECRET_KEY`, and `LINODE_PRIVATE_CONTENT_BUCKET` for private traces. The private access key should be scoped to the private content bucket and is intentionally separate from the profile-picture `LINODE_OBJ_*` credentials.

When the Linode variables are absent in local dev, the API falls back to filesystem-backed upload URLs and stores files under `packages/api/.local-uploads/` by default. The API returns absolute local upload/read URLs from the request origin so the browser can upload through `127.0.0.1:3000` while the web app runs on `localhost:3001`. Staging/production should use the S3 backend.

### Web (`packages/web`) -- set in `packages/web/.env.local`

If you are not running the web app through Doppler, create this file manually:

```bash
cat > packages/web/.env.local << 'EOF'
NEXT_PUBLIC_PRIVY_APP_ID=<your-privy-app-id>
NEXT_PUBLIC_API_URL=http://127.0.0.1:3000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3000
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
  --model-catalog ID
                   Catalog-backed provider/model selection, e.g. katana:grok-4-3
  --reasoning-policy low|medium|high|action-policy
                   Requested model reasoning policy for catalog or compatible model runs
  --variant NAME   Variant: baseline, mingle, power-lobby,
                   or power-lobby-mingle (default: baseline)
  --chatty         Print live formatted transcript output
  --house-summaries
                   Print concise House MC summaries live without chatty
                   reasoning output
  --strategic-reflections
                   Include hidden strategic-reflection and Strategy Thread records in artifacts
  --rich-producer  Enable House Strategy Bible packets, long-form House summaries,
                   producer briefs, bounded Council diary sessions, and strategic reflections
  --diary          Enable bounded Council diary sessions without rich producer packets
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
