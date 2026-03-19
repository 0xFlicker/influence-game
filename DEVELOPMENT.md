# Development Guide

This document covers development practices for the Influence game prototype and how the Founding Engineer and Lead Game Designer collaborate concurrently.

## Ownership Boundaries

Two agents work on this codebase with distinct, non-overlapping domains:

### Founding Engineer owns:
- Core game loop (`game-runner.ts`, `phase-machine.ts`, `game-state.ts`, `event-bus.ts`)
- Type definitions (`types.ts`)
- Test infrastructure (`game-engine.test.ts`, `mock-agent.ts`)
- Dependency management (`package.json`, `tsconfig.json`, `bunfig.toml`)
- Integration test scaffolding (`full-game.test.ts`)
- Fundamental rule enforcement (vote tallying, shield mechanics, elimination logic)

### Lead Game Designer owns:
- Personality prompt text inside `agent.ts` (the `getSystemPrompt()` / personality description strings)
- The default persona cast (`createAgentCast()` configuration)
- Simulation analysis and balance reports (stored in `docs/simulations/`)
- Proposals for new game mechanics and persona archetypes
- Design documents and player agent flow specs

### Shared / coordination required:
- Adding new personality types (LGD designs, FE implements interface changes)
- New `GameConfig` parameters (LGD proposes values, FE decides implementation)
- Phase timing adjustments (LGD proposes, FE lands)
- Changes to `PhaseContext` fields that affect what agents can see

## Conflict Avoidance

The most common merge conflict source is `agent.ts`. Avoid it:

1. **Personality prompts** (LGD) live in the `getSystemPrompt()` method and the `personalities` map. Changes there are LGD territory.
2. **Agent behavior methods** (`getVotes`, `getPowerAction`, LLM call structure) are FE territory.
3. When in doubt, open a Paperclip issue to coordinate before editing.

If `types.ts` needs new fields, the FE makes those changes. LGD should never edit `types.ts` directly — instead open an issue describing what new data you need in `PhaseContext` or elsewhere.

## Change Proposal Process

### For LGD proposing game mechanic changes:
1. Run at least one simulation with the existing code to establish a baseline.
2. Document the finding in `docs/simulations/YYYY-MM-DD-analysis.md`.
3. Open a Paperclip issue describing the proposed change, attach the analysis.
4. **Changes to the core game loop require board approval** before shipping. The FE will not implement core-loop changes without an approved issue.
5. Personality prompt changes (in `agent.ts`) and simulation parameter tuning do not require board approval — the LGD can PR those directly.

### For FE making engine changes:
1. Check `docs/simulations/` for any recent LGD analyses that might be affected.
2. If a change alters `PhaseContext`, `IAgent` interface, or `GameConfig` shape, post a comment on the active LGD issue so they can update their simulations.
3. Unit tests in `game-engine.test.ts` must pass before any merge.

## Testing Contract

Every change must satisfy:

```bash
# Must always pass (no LLM, fast)
bun test src/__tests__/game-engine.test.ts

# Must pass before merging engine changes
doppler run -- bun test
```

Rules:
- New game mechanics require new unit tests in `game-engine.test.ts`.
- New personas require a mock-game smoke test or a note in the PR explaining why one wasn't added.
- Never merge code that breaks `game-engine.test.ts`.
- Integration tests (`full-game.test.ts`) are allowed to be flaky due to LLM non-determinism, but should not systematically fail.

## Adding a New Persona

The LGD owns persona design. The process:

1. LGD writes the personality description, name, and strategic prompt.
2. LGD tests the persona by temporarily editing `createAgentCast()` in a branch.
3. LGD posts a simulation result showing the persona's behavior.
4. FE reviews the `agent.ts` diff and merges if it passes tests.

Persona format in `agent.ts`:

```typescript
personalities[PersonalityType.NEW_TYPE] = {
  description: "One sentence summary of this personality.",
  strategy: "How this agent approaches alliances, votes, and power actions.",
};
```

Add the new type to the `AgentPersonality` or equivalent union in `types.ts` — coordinate with FE for that step.

## Simulation Storage

LGD stores simulation output and analyses here:

```
docs/
  simulations/
    YYYY-MM-DD-<topic>.md    # Analysis report
    YYYY-MM-DD-<topic>.json  # Raw transcript (optional)
```

Format for analysis reports:

```markdown
# Simulation: <title>
**Date:** YYYY-MM-DD
**Runs:** N games
**Config:** maxRounds=N, cast=[...]

## Findings
...

## Recommendations
...
```

The FE references these when making engine changes to avoid regressing known good behavior.

## Extending the Game

### Adding a new Phase
1. Add the phase to the `Phase` enum in `types.ts`.
2. Update `phase-machine.ts` with new state and transitions.
3. Add a phase handler method in `game-runner.ts`.
4. Add the corresponding `IAgent` method to the interface and `GameRunner`.
5. Implement in `InfluenceAgent` and `MockAgent`.
6. Add unit tests in `game-engine.test.ts`.

**This is FE work.** LGD can propose the design in an issue but should not implement phase additions.

### Adding a new Config Field
1. Add to `GameConfig` in `types.ts`.
2. Wire it into `GameRunner` constructor and relevant phase handlers.
3. Update `GameState` if it affects state transitions.
4. Document the default value and valid range in this file and `README.md`.

### Adding a new GameEvent
1. Add to the `GameEventType` enum in `types.ts`.
2. Emit via `GameEventBus.emitEvent()` in the appropriate runner phase.
3. If agents need to react to the event, update `IAgent` with a new handler method.

## Code Style

- TypeScript strict mode is enabled. No `any` without a comment explaining why.
- No `console.log` in source files (use the event bus / transcript for logging).
- `console.log` in tests is fine for debugging output.
- Async/await throughout — no raw Promise chains.
- Bun runtime only. No Node-specific APIs unless they're available in Bun.

## Git Practices

- One logical change per commit.
- Commit message format: `<type>: <short summary>` (e.g., `feat: add protect power action`, `fix: shield expiry off-by-one`, `test: add council tiebreak coverage`).
- Always add co-author: `Co-Authored-By: Paperclip <noreply@paperclip.ing>`
- Branch off `main`, merge back to `main` via PR.
- Do not commit `node_modules/`, `.env`, or any secrets.

## Release Workflow

### Version Scheme

Semantic versioning: `v0.MINOR.PATCH` (pre-1.0 development stage).

- **MINOR bump** (0.1.0 → 0.2.0): New features, game mechanic changes, interface changes
- **PATCH bump** (0.1.0 → 0.1.1): Bug fixes, personality tuning, config adjustments

Version is tracked in two places that must stay in sync:
- `package.json` `version` field
- Git annotated tags

### Workspace Isolation

Both agents share the project directory. To allow parallel work on different versions:

- **Founding Engineer** works in `workspace/influence-game/` (on `main` or feature branches)
- **Lead Game Designer** tests in `workspace/influence-game-test/` (a git worktree at a tagged release)

This ensures the Engineer can continue development while the Designer tests a stable release.

### Release Process (Founding Engineer)

When a set of changes is ready for testing:

1. Ensure all tests pass: `bun test src/__tests__/game-engine.test.ts`
2. Commit all changes with descriptive messages
3. Update `version` in `package.json` to the new version
4. Commit the version bump: `release: v0.X.Y`
5. Create an annotated tag:
   ```bash
   git tag -a v0.X.Y -m "v0.X.Y: <summary of changes>"
   ```
6. Push with tags: `git push origin main --tags`
7. Comment on the relevant Paperclip issue:
   ```markdown
   ## Released v0.X.Y
   - Change 1
   - Change 2
   ```

### Picking Up a Release (Lead Game Designer)

To test a specific release:

1. From `workspace/influence-game/`, create a worktree at the tag:
   ```bash
   git fetch --tags
   git worktree add ../influence-game-test v0.X.Y
   ```
2. Install dependencies in the worktree:
   ```bash
   cd ../influence-game-test && bun install
   ```
3. Run simulations:
   ```bash
   doppler run -- bun test
   ```
4. Write analysis referencing the version in the filename:
   ```
   docs/simulations/v0.X.Y-<topic>.md
   ```
5. Comment on the Paperclip issue:
   ```markdown
   ## Tested v0.X.Y
   - Finding 1
   - Finding 2
   ```
6. When done, clean up:
   ```bash
   cd ../influence-game && git worktree remove ../influence-game-test
   ```

If a worktree already exists and needs updating to a new version:
```bash
cd ../influence-game-test && git fetch --tags && git checkout v0.X.Y && bun install
```

### Version Referencing in Communication

All Paperclip issue comments must reference specific versions:

- **Releases**: "Released v0.2.0" with bullet points of changes
- **Test reports**: "Tested v0.2.0" with findings and recommendations
- **Bug reports**: "Found in v0.2.0: description"
- **Fix references**: "Fixed in v0.2.1: description"

### Future: QA Integration

When a QA agent is added:

- QA gets a dedicated worktree: `workspace/influence-game-qa/`
- Release candidates use `-rc` suffix: `v0.3.0-rc.1`
- QA tests release candidates and signs off before the final tag
- Flow: Engineer tags `rc` → QA tests → QA approves → Engineer tags final release

## Environment

Secrets are injected via Doppler. Never hardcode API keys.

```bash
# Always prefix LLM-calling commands with:
doppler run -- bun test
```

The `OPENAI_API_KEY` env var is consumed by `InfluenceAgent`. `gpt-4o-mini` is the default model — cheap and fast for simulations. Only upgrade the model when quality is demonstrably insufficient.

### Environment Strategy

Three Doppler configs exist under the `social-strategy-agent` project:

| Config | Purpose | Database | API Port | Web Port | Network |
|--------|---------|----------|----------|----------|---------|
| `dev` | Active development | SQLite (local `influence.db`) | 3000 | 3001 | localhost |
| `stg` | Board testing, release validation | SQLite (`~/Development/influence/staging/data/influence.db`) | 4000 | 4001 | Tailnet only (100.100.251.4) |
| `prd` | Future production | TBD (PostgreSQL) | TBD | TBD | Public |

**Agents always use the `dev` config** for local development. Staging is deployed from tagged releases only — agents never run against staging directly.

### Staging Deployment

Deploy a tagged release to staging (tailnet-only):

```bash
# Deploy latest tag
./scripts/deploy-staging.sh

# Deploy specific version
./scripts/deploy-staging.sh v0.6.0

# Check status
./scripts/staging-status.sh

# Stop staging
./scripts/stop-staging.sh
```

Staging uses a git worktree at `~/Development/influence/staging/app/`, checked out at the specified tag. The API binds to the Tailscale IP (`100.100.251.4`) so it is only accessible from the tailnet.

**Board access URLs:**
- API: `http://100.100.251.4:4000`
- Web: `http://100.100.251.4:4001`

### Port Allocation

| Service | Dev | Staging |
|---------|-----|---------|
| API (Hono) | 3000 | 4000 |
| Web (Next.js) | 3001 | 4001 |

The API respects `PORT` and `HOST` env vars (set in Doppler per environment). In dev, `HOST` defaults to `0.0.0.0`. In staging, `HOST=100.100.251.4` restricts access to the tailnet.

### Database Strategy

**Current:** SQLite via Drizzle ORM across all environments. Simple, zero-config, good enough for pre-1.0 development.

**Dev database:** Local file (`influence.db`) in the package directory. Disposable — agents can reset it anytime with `db:migrate` + `db:seed`.

**Staging database:** Persistent file at `~/Development/influence/staging/data/influence.db`. Persists across deployments. Migrations run automatically during deployment.

**Future (production):** PostgreSQL. Drizzle supports PG natively — migration is a config change, not a rewrite. The VPS already runs PostgreSQL for Paperclip.

## Pre-Commit Checklist

Before EVERY commit, agents MUST run:

```bash
bun run typecheck   # Must pass (test file errors are exceptions, not source errors)
bun run lint        # Must pass
bun test            # All mock tests must pass (138+ tests, 0 failures)
```

If any check fails, fix it before committing. No exceptions.

## Pre-Release Checklist

Before creating a version tag:

1. All pre-commit checks pass
2. Full test suite passes: `doppler run -- bun test`
3. All package.json `version` fields are synced to the new version
4. Commit message: `release: vX.Y.Z`
5. Annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z: <summary>"`
6. Push: `git push origin main --tags`
7. Deploy to staging: `./scripts/deploy-staging.sh vX.Y.Z`
8. Comment on Paperclip issue with release notes

## Release Cadence

Releases are cut when a meaningful set of changes lands — not on a fixed schedule. The process:

```
Development → Tests Pass → Version Bump → Tag → Push → Deploy Staging → Board Tests
```

- **MINOR** releases (0.7.0): new features, mechanic changes, interface changes
- **PATCH** releases (0.6.1): bug fixes, personality tuning, config tweaks
- Board tests against staging on the tailnet. If issues are found, agents fix → new patch → redeploy.
