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

## Testing

### Test Tiers

Tests are organized into three tiers with different requirements:

| Tier | Command | Needs DB? | Needs Doppler? | When to run |
|------|---------|-----------|----------------|-------------|
| **Unit (mock)** | `bun run test` | No | No | Every commit (pre-commit check) |
| **DB integration** | `bun run test:db` | Yes (PostgreSQL) | No | Before merging API changes |
| **Full LLM** | `doppler run -- bun test:engine:full` | No | Yes (OPENAI_API_KEY) | Before releasing engine changes |

### Running Tests

```bash
# From repo root — runs ALL unit tests across all packages (engine + api + web)
bun run test

# API integration tests (requires PostgreSQL on port 54320)
bun run test:db

# Engine unit tests only
bun run test:engine

# Engine full tests with real LLM calls (requires Doppler)
doppler run -- bun run test:engine:full

# E2E smoke tests (requires running API server)
cd packages/api && bun run test:e2e
```

**Important:** Always use `bun run test` (the script), not `bun test` (the raw runner). Running `bun test` from the repo root bypasses the workspace filter and picks up all test files, including integration tests that require PostgreSQL.

### What each package's `test:mock` runs

- **engine**: `game-engine.test.ts` (48 tests — core game mechanics), `stream-listener.test.ts` (5 tests — GameRunner stream events with MockAgent)
- **api**: `websocket.test.ts` (10 tests — WS manager), `viewer-event-pacer.test.ts` (12 tests — event pacing)
- **web**: `api-utils.test.ts` (7 tests), `constants.test.ts` (17 tests), `message-parsing.test.ts` (30 tests) — frontend utilities

The remaining API tests (`db.test.ts`, `auth.test.ts`, `games-api.test.ts`, `agent-profiles.test.ts`, `game-lifecycle.test.ts`) are integration tests that require a running PostgreSQL instance. Run them with `bun run test:db`.

### E2E Tests

E2E tests live in two places and require more infrastructure:

| Test | Runner | Dependencies | Command |
|------|--------|--------------|---------|
| `e2e/smoke.spec.ts` | Playwright | Running staging server | `bun run test:e2e` |
| `packages/api/src/e2e/e2e-smoke.test.ts` | Bun + Puppeteer | PostgreSQL | `cd packages/api && bun test src/e2e/e2e-smoke.test.ts` |
| `packages/api/src/e2e/game-flow.e2e.test.ts` | Bun + Puppeteer | PostgreSQL + Doppler | `cd packages/api && doppler run -- bun test src/e2e/game-flow.e2e.test.ts` |

The full game-flow E2E test spins up an API server, creates a real 6-player LLM game, and watches it via Puppeteer (up to 11 minute timeout). Run it sparingly.

### Full Test Audit

See `docs/test-audit.md` for a comprehensive inventory of all 280 tests: what they cover, their dependencies, timing, and cost.

### Testing Contract

Rules:
- New game mechanics require new unit tests in `game-engine.test.ts`.
- New personas require a mock-game smoke test or a note in the PR explaining why one wasn't added.
- Never merge code that breaks `bun run test`.
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

## Definition of Done

For code-backed work, "done" means the change is ready for board review in a pull request. Branch-only work is not a finished deliverable.

Required delivery sequence:

1. Run the required checks and record the real result:
   - `bun install --frozen-lockfile`
   - `bun run typecheck`
   - `bun run lint`
   - `bun run test`
2. Fix failures before moving on.
3. Commit the change.
4. Push the branch.
5. Open a reviewable PR.
6. Close out the task with the PR link plus an honest summary of what passed, what was not run, and any remaining risk.

Use this closeout format in the Paperclip task comment:

```md
## Ready for Review

- PR: <url>
- Branch: <branch-name>
- Verification:
  - `bun install --frozen-lockfile` — passed / failed / not run
  - `bun run typecheck` — passed / failed / not run
  - `bun run lint` — passed / failed / not run
  - `bun run test` — passed / failed / not run
- Not run: none / <why>
- Remaining risk: none / <details>
```

Closeout rules:

- Feature work is not done until there is a reviewable PR link for board review.
- Draft PRs count as progress for `in_progress` or `in_review`, not as `done`.
- If work is intentionally partial, leave the task open and state exactly what remains.
- If work is blocked, mark the task `blocked` with the blocker, impact, and owner needed to unblock it.
- Documentation-only or non-code tasks may close without a PR only when no repository change is required. The closeout must say why a PR is not applicable.

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
| `dev` | Active development | PostgreSQL (`influence_dev` on port 54320) | 3000 | 3001 | localhost |
| `stg` | Board testing, release validation | PostgreSQL (`influence_dev` via staging config) | 4000 | 4001 | Tailnet only (100.100.251.4) |
| `prd` | Future production | PostgreSQL (dedicated instance) | TBD | TBD | Public |

**Agents always use the `dev` config** for local development. Staging is deployed from tagged releases only — agents never run against staging directly.

### Staging Deployment

Staging deploys are automated via the CI/CD pipeline:

1. Push to `main` → CI passes (typecheck, lint, test)
2. Docker images built and pushed to GHCR (`ghcr.io/0xflicker/influence-{api,web}`)
3. Cross-repo trigger fires `deploy-staging.yml` in the `linode-iac` repo
4. Docker Compose deploys to the staging host

To manually trigger a staging deploy, use the `deploy-staging` skill or trigger the `deploy-staging.yml` workflow in linode-iac.

**Board access URL:** `https://influencer-staging.tail8a79ed.ts.net/`

### Port Allocation

| Service | Dev | Staging |
|---------|-----|---------|
| API (Hono) | 3000 | 4000 |
| Web (Next.js) | 3001 | 4001 |

The API respects `PORT` and `HOST` env vars (set in Doppler per environment). In dev, `HOST` defaults to `0.0.0.0`. In staging, `HOST=100.100.251.4` restricts access to the tailnet.

### Database Strategy

**Current:** PostgreSQL 16 via Drizzle ORM + `postgres.js` driver. The database runs in a Docker container on port 54320.

**Dev database:** `influence_dev` on `127.0.0.1:54320`, owned by the `influence` user. Default connection string: `postgresql://influence:influence@127.0.0.1:54320/influence_dev`. Override with `DATABASE_URL` env var.

**Test database:** `influence_test` on the same instance, same credentials. Used by test suites to avoid polluting dev data.

**Staging database:** Uses the same PostgreSQL instance with staging-specific config via Doppler. Migrations run automatically during deployment.

**Critical:** The `influence` user is isolated and cannot connect to the `paperclip` database. Never create tables in or connect to the `paperclip` database — it belongs to the Paperclip platform.

## Pre-Commit Checklist

Before EVERY commit, agents MUST run:

```bash
bun install --frozen-lockfile  # Lockfile must be in sync with package.json
bun run typecheck              # Must pass
bun run lint                   # Must pass
bun run test                   # All unit/mock tests must pass (0 failures)
```

**Use `bun run test`, not `bun test`.** The raw `bun test` command picks up integration tests that require PostgreSQL and will fail without a database.

If any check fails, fix it before committing. No exceptions.

## Pre-Release Checklist

Before creating a version tag:

1. All pre-commit checks pass
2. Full test suite passes: `doppler run -- bun test`
3. All package.json `version` fields are synced to the new version
4. Commit message: `release: vX.Y.Z`
5. Annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z: <summary>"`
6. Push: `git push origin main --tags`
7. Deploy to staging: push triggers automated deploy via CI/CD pipeline
8. Comment on Paperclip issue with release notes

## Release Cadence

Releases are cut when a meaningful set of changes lands — not on a fixed schedule. The process:

```
Development → Tests Pass → Version Bump → Tag → Push → Deploy Staging → Board Tests
```

- **MINOR** releases (0.7.0): new features, mechanic changes, interface changes
- **PATCH** releases (0.6.1): bug fixes, personality tuning, config tweaks
- Board tests against staging on the tailnet. If issues are found, agents fix → new patch → redeploy.