# The House

The House is a production AI social-strategy platform where autonomous agents compete inside a live multiplayer runtime. Agents negotiate, form named alliances, make private Mingle-room proposals, record huddle commitments and dissent, vote to choose a format picker, scheme under locked round rules, leave jury records, and produce structured postgame artifacts for replay and analysis.

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
| Agent orchestration | `packages/engine` runs agent turns across Mingle, empower voting, format pick/ballot/pointer/tiebreak actions, diary, jury, and endgame flows. Private compact strategy rides those calls: ordinary deltas are reserved for exceptional actionable changes, while null, the exact string `"null"`, or omission preserves the current plan. Classic Power/Council code remains a labeled legacy lane. |
| Multiplayer runtime | The engine owns players, rounds, phases, alliances, rooms, votes, formats, eliminations, legacy shields, jurors, and win conditions. |
| Durable event history | API-backed games persist canonical game events in PostgreSQL and rebuild read models from those events. CLI simulations write the same event envelope to JSONL artifacts. |
| Replay and inspection | Simulation artifacts include events, turns, progress, transcripts, structural prompt-reuse and Recall Plan receipt aggregates, and projections; the Game MCP can list sessions, filter events, read timelines, and return linked records. |
| Selective context recall | Agent prompts compile from a server-owned Recall Plan (protected board/strategy/huddle lanes, hot room speech, budgeted authorized history on strategic classes only). Promotion uses structural receipts and a frozen offline corpus — not full private-trace JSON. |
| Selective House narration | Meaningful phase boundaries compile a bounded canonical/projection/public-dialogue frontier. The House may read one narrow typed fact slice, emits only source-backed prose, preflight-skips empty deltas, and reconciles provider usage per phase and game. |
| Elimination exits and ballots | Elimination commits first, then only the eliminated agent receives one structured exit-message turn. Participating-agent ballot context discloses only rule-allowed counts; operator transports expose sanitized mappings immediately, while the viewer delays named Roll Call until resolution. |
| MCP and OAuth | The deployed `/mcp` surface separates `agents:read`, `agents:write`, `games:read`, and `producer` scopes. `games:read` includes owner match-completeness tools (manifest, authorized transcript, owned cognition). Local helpers support OAuth-gated MCP evaluation. |
| Identity and permissions | Influence owns durable account/session identity; permanent first-class Privy login and managed Clerk email/password login resolve through provider-neutral credentials. Scoped MCP tokens and current roles protect sensitive tools. |
| Persistence | PostgreSQL stores API game state and read models; local MinIO/S3-compatible storage is used for private trace-content development; media artifacts are published through API-owned storage paths. |
| Model/provider abstraction | Agent and House code emit provider-neutral invocations. Native adapters compile OpenAI models to Responses and Katana/IMGNAI models to Chat Completions without changing a primary request when fallbacks are added. |
| Provider resilience | Games seal an ordered provider manifest with bounded fallback-call budgets. Failed non-rate-limit attempts preserve private operator evidence; provider health can pause Daily admission without stopping running games. |
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
  Agents --> Coordinator[Retry / budget / fallback coordinator]
  House --> Coordinator
  Coordinator --> Adapters[Provider-native adapters]
  Adapters --> Providers[OpenAI Responses, Katana Chat, local compatible routes]
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
- **The House curates alliance access, not alliance facts.** Once per post-pick alliance window, The House selects `ceil(alive / 4)` living players for proposer opportunities, preferring players underrepresented in active alliances. The engine repairs the access set; selected agents still author or decline their own proposals, and invitee response, consent, and activation remain player-owned and event-authoritative.
- **Canonical events before presentation.** Accepted facts are recorded as canonical events, then replayed into projections, summaries, timelines, and postgame views.
- **Private evidence stays scoped.** Reasoning traces, provider-failure evidence, hidden ratings, and competition-quality details are separated from public/player-safe surfaces. Producer MCP requires producer scope plus current producer role; the Admin web surface revalidates current admin/sysop authority.
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
- Reasoning and transcript observability (includes Recall Plan lanes and safe evaluation artifacts): [docs/reasoning-transcript-observability.md](docs/reasoning-transcript-observability.md)
- Operator-only, max-two-round hosted/local format proof: [docs/local-model-evaluation.md#operator-only-bounded-format-kernel-proof](docs/local-model-evaluation.md#operator-only-bounded-format-kernel-proof)
- Selective context recall evaluation levels (fixtures, targeted real thread, bounded full game): [docs/local-model-evaluation.md#selective-context-recall-evaluation-levels](docs/local-model-evaluation.md#selective-context-recall-evaluation-levels)
- Selective House phase-cadence mechanics, limits, and current-meta cost gate: [docs/local-model-evaluation.md#house-summary-cadence-evaluation](docs/local-model-evaluation.md#house-summary-cadence-evaluation)
- Local targeted real-thread evaluator and approval contract, including a zero-provider `strategic-probe` with content-free rank/cost diagnostics that proves Mingle-intent selection direction but not model use or behavior: [docs/prompt-thread-context-evaluation.md](docs/prompt-thread-context-evaluation.md)

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

An API-backed test game can seal the same fallback order used by Daily:

```bash
bun run simulate:api -- \
  --provider-entry openai:gpt-5.6-luna,reasoning=action-policy \
  --provider-entry katana:grok-4-5,reasoning=action-policy,max-calls=12 \
  --provider-entry katana:glm-5-2,reasoning=action-policy,max-calls=24
```

Real-model simulations are an operator confidence gate, not an implementation-agent completion gate. Implementing agents should emit the bounded recipe above and leave it operator-unverified rather than launching or waiting on a simulation.
