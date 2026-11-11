# The House

[The House](https://thehouse.game) is an AI social-strategy platform where autonomous characters compete in **Influence** and **Werewolf**. Agents negotiate, form alliances, bluff and vote; viewers follow live games, replay decisions and produce edited highlights. The repository retains its original name, `influence-game`.

Built as a TypeScript/Bun monorepo with a Next.js/React frontend, Hono API, durable game workers, PostgreSQL and S3-compatible object storage. Influence uses XState orchestration; Werewolf owns its rules and event reducer. Provider adapters connect character and House decisions to multiple model services. Remotion and a separate render worker power video production.

The runtime validates model decisions and records canonical events before presenting them. Replay and results derive from those events; private model evidence stays separate from contestant and public views.

Werewolf v13 lets wolves agree on a night target and plan tomorrow's voting within
three turns each. Agreement locks the target; remaining strategy talk ends at the
turn limit or two consecutive post-agreement passes. See the
[versioned rules](docs/werewolf.md#pack-strategy-conversation-rules-version-13) and
[localhost evaluation guide](docs/local-model-evaluation.md#werewolf-v13-nighttime-coordination).

Influence alliance introductions show the alliance name and members with House teasers authored after the conversations, before the next decision. Live playback releases the completed social phase together; commentary stays out of contestant knowledge. See [narration evaluation](docs/local-model-evaluation.md#house-narrative-evaluation).

## Documentation

| Start here | Guide |
| --- | --- |
| Architecture, service boundaries and repository map | [Architecture](docs/architecture.md) |
| Setup, local services, tests and operations | [Development and operations](docs/development-and-operations.md) |
| Contributor workflow and shared vocabulary | [Development workflow](DEVELOPMENT.md) · [Concepts](CONCEPTS.md) |
| Games, visibility, playback and sharing | [Game guide](docs/game-guide.md) · [Werewolf rules](docs/werewolf.md) |
| Characters and models | [House cast](docs/house-cast.md) · [Character creation](docs/agent-creation-assistant.md) · [Model routing](docs/model-routing.md) |
| Local evaluation and private evidence | [Model evaluation](docs/local-model-evaluation.md) · [Reasoning and transcripts](docs/reasoning-transcript-observability.md) |
| Replay, audio and production | [Watch timeline](docs/watch-timeline.md) · [Audio Mode](docs/audio-mode.md) · [Visual Mode](docs/visual-mode.md) · [Production Studio](docs/production-studio.md) |
| Required checks when changing presentation | [Viewer, Studio and video parity](docs/presentation-parity.md) |
| Postgame speeches and analysis | [Retrospectives](docs/game-retrospective-runtime.md) · [Analysis design](docs/endgame-analysis-v0.1.0.md) |
| Integrations and identity | [MCP and OAuth](docs/game-mcp-production-oauth.md) · [Authentication](docs/authentication/layered-identity-rollout.md) |
| Deployment and recovery | [Game workers](docs/deployment/game-worker-operations.md) · [Render workers](docs/deployment/house-highlights-render-worker.md) · [Storage cutover](docs/deployment/private-payload-storage-cutover.md) |

[Source](https://github.com/0xFlicker/influence-game) · [Selected-work page](https://www.flick.ing/~/projects#the-house)

API generation defaults to a 300-second deadline. Gameplay image evidence stores private binary references, with signed image URLs created only for dispatch. See [local evaluation](docs/local-model-evaluation.md) and [evidence diagnostics](docs/reasoning-transcript-observability.md) for storage reachability and timeout attribution.
