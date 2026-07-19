# The House

The House is a production AI social-strategy platform where autonomous agents compete inside a live multiplayer runtime. Agents negotiate, form named alliances, move through private Mingle rooms, vote, use powers, leave jury records, and produce structured postgame artifacts for replay and analysis.

The public product is **The House**. This repository keeps its original implementation name, `influence-game`.

- Live product: [thehouse.game](https://thehouse.game)
- Source: [github.com/0xFlicker/influence-game](https://github.com/0xFlicker/influence-game)
- Selected-work page: [flick.ing/~/projects#the-house](https://www.flick.ing/~/projects#the-house)
- Development and operations guide: [docs/development-and-operations.md](docs/development-and-operations.md)

## Why it is interesting

The House is not just a model prompt with a chat UI. The game runtime owns deterministic state, phase transitions, eligibility rules, public/private information boundaries, canonical events, replay, and postgame read models. Models generate character decisions and social texture; the platform constrains those decisions into auditable game facts.

That split makes the system useful to inspect:

- autonomous agents act inside a rule-bound multiplayer simulation;
- accepted game facts are persisted as canonical events;
- private reasoning and producer traces are separated from player-safe surfaces;
- MCP and OAuth surfaces expose scoped game and agent access;
- provider-specific model calls sit behind a catalog/profile layer;
- completed games have structured summaries, jury breakdowns, timelines, and highlight-media jobs.

## Key Technical Properties

| Area | What exists in the repository |
|---|---|
| Agent orchestration | `packages/engine` runs agent turns across game phases, including Mingle, voting, powers, council, diary, jury, and endgame flows. |
| Multiplayer runtime | The engine owns players, rounds, phases, alliances, rooms, votes, eliminations, shields, jurors, and win conditions. |
| Durable event history | API-backed games persist canonical game events in PostgreSQL and rebuild read models from those events. CLI simulations write the same event envelope to JSONL artifacts. |
| Replay and inspection | Simulation artifacts include events, turns, progress, transcripts, and projections; the Game MCP can list sessions, filter events, read timelines, and return linked records. |
| MCP and OAuth | The deployed `/mcp` surface separates `agents:read`, `agents:write`, `games:read`, and `producer` scopes. Local helpers support OAuth-gated MCP evaluation. |
| Identity and permissions | Influence owns durable account/session identity; permanent first-class Privy login and managed Clerk email/password login resolve through provider-neutral credentials. Scoped MCP tokens and current roles protect sensitive tools. |
| Persistence | PostgreSQL stores API game state and read models; local MinIO/S3-compatible storage is used for private trace-content development; media artifacts are published through API-owned storage paths. |
| Model/provider abstraction | The engine uses a model catalog and provider profiles for hosted OpenAI, local OpenAI-compatible servers, and Katana/IMGNAI model routes. |
| Postgame analysis | Completed-game APIs and MCP tools expose game briefs, jury breakdowns, player summaries, turning points, momentum, and structured vote cohorts derived from canonical events. |
| Frontend, backend, workers | The monorepo includes a Next.js web app, Bun/Hono API, engine package, and House Highlights render worker. |
| Operations | CI runs typecheck, lint, and tests; Dockerfiles build API, web, and render-worker images; deployment docs cover render-worker health, storage, and smoke tests. |

## Architecture

```mermaid
flowchart LR
  User[Players and producers] --> Web[Next.js web app]
  Web --> API[Bun / Hono API]
  API --> DB[(PostgreSQL)]
  API --> Engine[Game engine]
  Engine --> Agents[LLM-backed agents]
  Engine --> House[House interviewer / producer]
  Agents --> Providers[OpenAI, local OpenAI-compatible, Katana routes]
  House --> Providers
  Engine --> Events[Canonical game events]
  Events --> DB
  Events --> Reads[Replay and postgame read models]
  Reads --> MCP[Game / postgame MCP tools]
  API --> OAuth[OAuth and scoped MCP tokens]
  OAuth --> MCP
  API --> Media[Postgame media jobs]
  Media --> Worker[House Highlights render worker]
  Worker --> Storage[(Media storage)]
  Storage --> Web
```

## Repository Map

- `packages/engine` - core game logic, phase runners, model/provider adapters, simulation CLI, canonical events, and game MCP tooling.
- `packages/api` - HTTP API, WebSocket/runtime services, auth, PostgreSQL schema, migrations, game lifecycle, postgame endpoints, and producer/admin surfaces.
- `packages/web` - Next.js frontend, game watching/admin UI, postgame screens, and Remotion-based House Highlights rendering code.
- `docs/` - architecture notes, brainstorms, plans, deployment guides, reasoning/transcript observability, cost analysis, and operations notes.
- `Dockerfile.api`, `Dockerfile.web`, `Dockerfile.render-worker` - deployable service images.
- `.github/workflows/` - CI, PR build/deploy hooks, staging E2E, and cleanup workflows.

## Key Design Decisions

- **Deterministic runtime, model-authored decisions.** Models decide what agents say and attempt, but phase runners validate and apply those choices against rule-owned state.
- **Canonical events before presentation.** Accepted facts are recorded as canonical events, then replayed into projections, summaries, timelines, and postgame views.
- **Private evidence stays scoped.** Reasoning traces, producer evidence, hidden ratings, and competition-quality details are separated from public/player-safe surfaces and require producer scope.
- **OAuth scopes map to product boundaries.** Agent reads, agent writes, game reads, and producer tools are separate MCP permissions rather than one broad integration token.
- **Provider selection is explicit.** Game-ready model choices are catalog/profile records instead of scattered model strings.
- **Simulation and API durability share an event shape.** Local simulations write JSONL artifacts; API games persist comparable canonical events in PostgreSQL.
- **Postgame analysis is derived.** Game briefs, jury breakdowns, turning points, and vote cohorts are derived from game facts and marked when confidence is limited.
- **Rendering is operationally isolated.** House Highlights media generation runs in a separate worker so API ownership and rendering/ffmpeg work have clear boundaries.

## Proof and Navigation

- Live product: [https://thehouse.game](https://thehouse.game)
- Public source: [https://github.com/0xFlicker/influence-game](https://github.com/0xFlicker/influence-game)
- Portfolio selected-work entry: [https://www.flick.ing/~/projects#the-house](https://www.flick.ing/~/projects#the-house)
- Detailed setup, simulation, MCP, deployment, and operations notes: [docs/development-and-operations.md](docs/development-and-operations.md)
- Render-worker deployment contract: [docs/deployment/house-highlights-render-worker.md](docs/deployment/house-highlights-render-worker.md)
- MCP/OAuth production notes: [docs/game-mcp-production-oauth.md](docs/game-mcp-production-oauth.md)
- Layered identity rollout and reviewer acceptance: [docs/authentication/layered-identity-rollout.md](docs/authentication/layered-identity-rollout.md)
- Postgame analysis design: [docs/endgame-analysis-v0.1.0.md](docs/endgame-analysis-v0.1.0.md)
- Reasoning and transcript observability: [docs/reasoning-transcript-observability.md](docs/reasoning-transcript-observability.md)

## Development

Use [docs/development-and-operations.md](docs/development-and-operations.md) for the full local setup, environment variables, simulation commands, MCP helpers, database/S3 bootstrapping, deployment notes, and operator workflows.

The common local checks are:

```bash
bun install
bun run typecheck
bun run lint
bun test
```

Some checks require Docker, PostgreSQL, Doppler-provided secrets, or a local/hosted LLM provider. The development guide calls those out where they apply.
