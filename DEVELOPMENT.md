# Development Guide

This document covers development practices for the Influence game prototype and how the Founding Engineer and Lead Game Designer collaborate concurrently.

## Before Starting Work

Every code or documentation change starts from current upstream state. Do this before editing files, branching, or continuing feature work:

1. Inspect the current branch and worktree:
   ```bash
   git status --short --branch
   ```
2. Fetch upstream state:
   ```bash
   git fetch origin --prune
   ```
3. Update local `main` from remote:
   ```bash
   git switch main
   git pull --ff-only origin main
   ```
4. Start new work from the refreshed `main`:
   ```bash
   git switch -c <type>/<issue>-<short-description>
   ```

When continuing an existing feature branch, still update local `main` first. If any relevant PR has merged since the branch was created or last touched, reconcile the branch with latest `main` before proceeding:

```bash
git switch <feature-branch>
git merge main
```

Use `git rebase main` only when the branch is private and rewriting its history will not disrupt another agent. Do not start from stale local state after a PR merge.

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
3. When in doubt, coordinate in GitHub or in the relevant planning/design doc before editing.

If `types.ts` needs new fields, the FE makes those changes. LGD should never edit `types.ts` directly — instead open an issue describing what new data you need in `PhaseContext` or elsewhere.

## Change Proposal Process

### For LGD proposing game mechanic changes:
1. Run at least one simulation with the existing code to establish a baseline.
2. Document the finding in `docs/simulations/YYYY-MM-DD-analysis.md`.
3. Open a GitHub issue or planning doc describing the proposed change, attach the analysis.
4. **Changes to the core game loop require board approval** before shipping. The FE will not implement core-loop changes without an approved issue.
5. Personality prompt changes (in `agent.ts`) and simulation parameter tuning do not require board approval — the LGD can PR those directly.

### For FE making engine changes:
1. Check `docs/simulations/` for any recent LGD analyses that might be affected.
2. If a change alters `PhaseContext`, `IAgent` interface, or `GameConfig` shape, note it in the active issue/PR or update the relevant docs so simulations can be adjusted.
3. Unit tests in `game-engine.test.ts` must pass before any merge.

## Testing

### Test lanes

The file location and suffix own each test. `bun run test:classification` fails when a new test has no lane.

| Lane | Ownership | Command | Automatic CI? |
|------|-----------|---------|---------------|
| Provider-free | ordinary engine, web, protocol, and root-script tests | `bun run test` | Required |
| API / PostgreSQL | every ordinary non-E2E API test | `bun run test:postgres` | Required |
| Browser Coverage | `packages/api/src/e2e/*.e2e.test.ts` plus explicitly classified deterministic Playwright specs | commands below | Visible, non-required |
| Live provider | `*.live-provider.test.ts` | `doppler run -- bun run test:live-provider` or explicitly configured local provider | Never automatic |
| External smoke | `*.external-smoke.test.ts` | `bun run test:external-smoke` with explicit service configuration | Never automatic |
| Real Clerk / staging | explicitly selected Playwright project or staging workflow | commands below | Opt-in / release-only |

Required jobs do not receive provider, Clerk, staging, or external-service credentials. A missing credential is not a passing live-provider test: opt-in suites fail closed when invoked without their configuration.

### Context evaluation levels

Choose the smallest evaluation that can reject the product decision:

- deterministic Recall Plan and prompt-scenario fixtures for budgets, authorization, stable rendering, and replay mechanics;
- the private [real-thread context evaluator](docs/prompt-thread-context-evaluation.md) for one authorized durable situation, isolated context-policy revisions, provider/cache accounting, and blind human preference;
- a bounded full-game simulation for cross-phase integration, strategy, pacing, and watchability.

These are cumulative evidence, not substitutes. Real-thread source validation, tests, status, and report assembly make no provider calls. Curator and panel dispatch require separate immutable approvals; implementation agents must not spend either budget without explicit operator approval.

The evaluator's `strategic-probe` also makes zero provider calls. It compares selection direction for the two real Mingle-intent contexts only and includes content-free rank, score, current-round/target-speaker, serialized-cost, and terminal-reason diagnostics; it does not prove that a model uses the selected evidence or changes behavior. See [the full evaluator contract](docs/prompt-thread-context-evaluation.md).

### Running Tests

```bash
# Classification plus all automatically discovered provider-free tests
bun run test

# All automatically discovered API tests (requires PostgreSQL on port 54320)
bun run db:bootstrap
bun run test:postgres

# Deterministic Browser Coverage lanes (isolated databases and child processes)
bun run test:e2e:identity
bun run test:e2e:layered-auth
bun run test:e2e:format-viewer
bun run test:browser:api

# Manual suites; configure the named dependency before invoking
doppler run -- bun run test:live-provider
bun run test:external-smoke
bun run test:e2e:layered-auth:clerk
```

**Important:** use the repository scripts, not raw root `bun test`. The scripts select the correct Bun config and ensure paid/external suites cannot be discovered by a required lane.

### E2E Tests

E2E tests live in two places and require more infrastructure:

| Test | Runner | Dependencies | Command |
|------|--------|--------------|---------|
| `e2e/smoke.spec.ts` | Playwright | Qualified staging candidate | `bun run test:e2e:staging` (workflow only) |
| `e2e/layered-authentication.spec.ts` (deterministic) | Playwright | Docker PostgreSQL; starts isolated API/web; injected provider adapters | `bun run test:e2e:layered-auth` |
| `e2e/layered-authentication.spec.ts` (real Clerk) | Playwright + `@clerk/testing` | Disposable DB, Clerk development instance credentials, configured development web/API | `bun run test:e2e:layered-auth:clerk` |
| `e2e/public-player-identity.spec.ts` | Playwright | PostgreSQL; isolated API/web | `bun run test:e2e:identity` |
| `e2e/format-aware-game-viewer.spec.ts` | Playwright | PostgreSQL; seeded canonical fixtures; isolated API/web | `bun run test:e2e:format-viewer` |
| `packages/api/src/e2e/*.e2e.test.ts` | Bun + Puppeteer | PostgreSQL; one isolated DB per file | `bun run test:browser:api` |
| `packages/api/src/e2e/game-flow.live-provider.test.ts` | Bun + Puppeteer | PostgreSQL + configured provider | `doppler run -- bun run test:live-provider` |

Browser Coverage runs with zero retries. API/web output is drained into bounded logs and CI uploads Playwright/Puppeteer evidence only on failure. Every harness owns a uniquely named database, terminates its child processes, and drops that database in cleanup.

### Staging release E2E contract

The `E2E Staging Tests` workflow receives the immutable deployed image tag, resolves it to the exact source commit while keeping the release-gate test code on current `main`, and requires `/api/health` to report that same full commit SHA before and after every serial smoke test. It navigates the homepage at `https://influence-staging.tail8a79ed.ts.net` with normal browser headers, keeps the title assertion, and fails closed on an identity mismatch, non-HTML response, or blank/missing title.

On failure, the workflow uploads Playwright traces, screenshots, and a bounded `homepage-failure-evidence.json` file containing final URL, status, redacted response headers, title, and a SHA-256 body fingerprint. Staging traces exclude DOM snapshots and source files, and the workflow never uploads the raw page body. A passing staging deploy is not a release certificate until the deployment workflow has separately adopted the E2E result after the required stability proof.

The deterministic layered-auth project drives the visible unified wrapper plus
the real Influence API/session coordinator, but its Clerk and Privy assertions
are injected. The real Clerk project requires `+clerk_test` addresses, the
development verification code `424242`, backend teardown, and
`CLERK_E2E_DISPOSABLE_ENVIRONMENT=1`. A skipped real-provider project is
unverified, not green. The complete cutover and hosted reviewer gates live in
[`docs/authentication/layered-identity-rollout.md`](docs/authentication/layered-identity-rollout.md).

### Full Test Audit

See `docs/test-audit.md` for the current ownership and CI matrix.

### Testing Contract

Rules:
- New game mechanics require new unit tests in `game-engine.test.ts`.
- New personas require a mock-game smoke test or a note in the PR explaining why one wasn't added.
- Never merge code that breaks `bun run test`.
- Provider-free integration tests such as `full-game.test.ts` are deterministic and must not be treated as flaky. Only manual `*.live-provider.test.ts` outcomes may vary with provider behavior, and those suites are never required CI.

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
   - `bun run test:postgres`
2. Fix failures before moving on.
3. Commit the change.
4. Push the branch.
5. Open a reviewable PR.
6. Close out the task with the PR link plus an honest summary of what passed, what was not run, and any remaining risk.

Use this closeout format in the PR description or final task summary:

```md
## Ready for Review

- PR: <url>
- Branch: <branch-name>
- Verification:
  - `bun install --frozen-lockfile` — passed / failed / not run
  - `bun run typecheck` — passed / failed / not run
  - `bun run lint` — passed / failed / not run
  - `bun run test` — passed / failed / not run
  - `bun run test:postgres` — passed / failed / not run
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

- **Founding Engineer** works in the active project checkout (on `main` or feature branches)
- **Lead Game Designer** tests in a separate sibling worktree at a tagged release

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
7. Post release notes:
   - Always record notes in the relevant PR, GitHub issue, or release handoff:
   ```markdown
   ## Released v0.X.Y
   - Change 1
   - Change 2
   ```
   - **If the ship is player-visible or builder-visible** (rules feel, watch UX, seasons, MCP/agent contracts, or other public product surfaces), also add a public **Updates** post under `packages/web/content/updates/`:
     - One markdown file per post: `YYYY-MM-DD-short-slug.md`
     - Frontmatter: `title`, `date` (ISO `YYYY-MM-DD`), `summary`, `tags` (string array)
     - Recommended tags (soft set): `watch`, `play`, `rules`, `mcp`, `seasons`, `product`
     - Free markdown body; public-safe only (no producer-only diagnostics)
     - Optional `draft: true` keeps a post out of the public list until ready
     - Notes go live with the **web** deploy that includes the content (not API-only deploys)
   - Pure internal refactors may omit a public Updates post

### Picking Up a Release (Lead Game Designer)

To test a specific release:

1. From the active project checkout, create a worktree at the tag:
   ```bash
   git fetch --tags
   git worktree add ../influence-game-test v0.X.Y
   ```
2. Install dependencies in the worktree:
   ```bash
   cd ../influence-game-test && bun install
   ```
3. Run the deterministic suites:
   ```bash
   bun run test
   bun run test:postgres
   ```
4. Write analysis referencing the version in the filename:
   ```
   docs/simulations/v0.X.Y-<topic>.md
   ```
5. Record the test report in the relevant PR, GitHub issue, or simulation analysis:
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

Release and test communication should reference specific versions:

- **Releases**: "Released v0.2.0" with bullet points of changes
- **Test reports**: "Tested v0.2.0" with findings and recommendations
- **Bug reports**: "Found in v0.2.0: description"
- **Fix references**: "Fixed in v0.2.1: description"

### Future: QA Integration

When a QA agent is added:

- QA gets a dedicated sibling worktree for release-candidate testing
- Release candidates use `-rc` suffix: `v0.3.0-rc.1`
- QA tests release candidates and signs off before the final tag
- Flow: Engineer tags `rc` → QA tests → QA approves → Engineer tags final release

## Environment

Hosted-provider secrets are injected via Doppler. Local LM Studio experiments can run through the OpenAI-compatible provider settings in `docs/local-model-evaluation.md`. Never hardcode API keys.

### OPERATOR-ONLY Format-Kernel Proof

Real-model format proof is a post-handoff operator gate. **Implementing agents must not run or wait on these commands.** Start from the reported branch and HEAD with a clean worktree, choose one recipe, and keep every run capped at two rounds.

Hosted OpenAI requires Doppler access to `social-strategy-agent/dev`. The dev config may contain an LM Studio base URL; `--model-catalog openai:gpt-5-mini` forces the hosted provider path.

```bash
cd packages/engine
doppler run --project social-strategy-agent --config dev -- \
  bun run simulate -- \
  --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
  --model-catalog openai:gpt-5-mini --flex --llm-timeout-sec 900
```

Hosted OpenAI game runs use Flex by default, including durable API-backed
games. Use `--standard` or `--no-flex` for the normal auto lane. Non-OpenAI
providers are unaffected. The simulator retries Flex
resource-unavailable 429s with exponential backoff and switches the retry to
`service_tier: "auto"` after the third 429 for that request; the next request
probes Flex again. Use a longer LLM request timeout because Flex responses can
take longer. Flex summaries include the tier-aware run estimate (Flex responses
at Flex rates, visible auto/default fallbacks at standard rates) followed by
one familiar all-model comparison table. Flex-supported OpenAI rows use Flex
rates; unsupported OpenAI rows and Grok retain standard rates. A 429
resource-unavailable retry is not charged.

For local proof, load the chosen model in LM Studio and serve its OpenAI-compatible endpoint on `127.0.0.1:1234`.

```bash
cd packages/engine
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- \
  --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
  --model <lm-studio-model-id> --llm-timeout-sec 300
```

Inspect the new `packages/engine/docs/simulations/batch-*/summary.md`, `game-1.txt`, and `game-1-turns.jsonl`. New games omit the optional manifest by default and freeze all six formats: Save-or-Eliminate, Vote Bomb, Safety Bounce, Majority Elimination, Even Votes, and Restricted History. Record provider/model, batch path, and pass/fail for: `FORMAT MENU` → `FORMAT LOCKED` → `FORMAT RESOLVE` on two-card rounds; no standard-round Power/Council elimination; exercised `format-pick`, `format-ballot`, `bounce-pointer`, and `format-tiebreak` records have useful thinking and `decisionSource: "llm"`; each eliminated player has exactly one post-commit `elimination-message` turn whose sealed-format disclosure contains counts without voter names; no exercised action has `decisionSource: "fallback"`; agents apply the locked rules; and at least two formats produce distinct coalition scripts. Vote Bomb must preserve zero-safe/fewest-positive reasoning; Majority Elimination must use highest-total reasoning; Even Votes must reason about parity, zero-as-even, and the all-odd empowered fallback; Restricted History must exclude prior elimination targets, preserve prior SAVE targets, and remain unavailable in rounds 1–2. For Safety Bounce, explicitly confirm that every SAFE actor understands its target becomes VULNERABLE and every VULNERABLE actor understands its target becomes SAFE; contradictory reasoning fails the check even when `response.classification` is canonically correct. Random two-card rounds do not prove catalog coverage: append `--formats <id>` for a separate bounded one-format run when a round-1-eligible card needs proof. That run must emit `format.selected` without `format.menu_offered`, a `format-pick` turn, or an empowered pick model call. Restricted History requires a round-3 bounded run with at least one round-1-eligible companion format; a Restricted-History-only manifest is invalid. Two or more currently available ids retain the normal two-card menu. A fallback fails proof: inspect `fallbackReason` and the matching `agent_turn`. If hosted traffic reaches LM Studio, retain the explicit OpenAI catalog or clear base-URL variables for that process. Whole-game timeout is off by default.

The fuller checklist and triage live in `docs/local-model-evaluation.md`.

```bash
# Simulator validation uses repo scripts, which inject Doppler dev secrets explicitly:
bun run simulate -- --games 1 --players 6 --model gpt-5.6-luna

# Local LM Studio validation bypasses Doppler:
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 6 --model <lm-studio-model-id>

# Durable API-backed local model validation creates/fills/starts a real API game:
bun run simulate:api -- --provider lm-studio --model <lm-studio-model-id> --players 6
bun run simulate:api -- --provider katana --model deepseek-v4-flash --players 6
# Defaults to a short player-scaled smoke cap (6 players -> 7 rounds); pass --max-rounds to override.
# Each alliance window makes one House proposer-selection call for ceil(alive / 4) access seats,
# preferring players underrepresented in active alliances. Only the engine-finalized seats receive
# proposer calls; invitee response/counter calls remain demand-driven. Agents choose only legal actions
# for their opportunity, while the engine owns proposal/version IDs and maps amendment handles.
# Ordinary strategyDelta is exceptional: use it only for a material actionable carry-forward change.
# Strict schemas use JSON null, never the string "null"; the engine normalizes that exact string to null if returned.

# Chatty mode (live colored transcript with agent thinking + native reasoningContext / labeled provider summaries on Mingle turns, alliance actions, huddle turns, votes, format picks/ballots/pointers/tiebreaks, legacy classic actions, and endgame decisions):
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --chatty --game-timeout-sec 7200 --llm-timeout-sec 300

# House summaries only (live House MC summaries without chatty reasoning output):
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --game-timeout-sec 7200 --llm-timeout-sec 300
    # (operator action feed + House MC are on by default; add --chatty for thinking/reasoning)

# Strategy-observability validation uses the paid diary calls for replacement/refinement:
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --chatty --diary --game-timeout-sec 7200 --llm-timeout-sec 300

# Rich producer validation adds House Strategy Bible packets, long-form summaries,
# diary producer briefs, format-resolution diaries, and legacy Council compatibility:
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --chatty --rich-producer --game-timeout-sec 7200 --llm-timeout-sec 300
```

Simulation batches are written under `packages/engine/docs/simulations/`. Use `game-N-turns.jsonl` for structured per-agent-turn analysis, `game-N-events.jsonl` for canonical accepted domain events that replay into a projection, `game-N-progress.jsonl` for lightweight live progress, `game-N.json` for the full transcript/result bundle (producer artifact; not a safe Recall Plan promotion input), `game-N.txt` for human-readable transcript review, `game-N-prompt-reuse.json` for structural prompt-prefix reuse (hashes/counts only), and `game-N-recall-plan.json` for the **safe structural Recall Plan receipt aggregate** used to evaluate selective context recall (prompt-class counts, protected/hot/history token estimates, lane/source-class counts, actor-authorized event boundary — never dialogue, names, entry IDs, prompts, thinking, or reasoning). Simulator event JSONL uses the same canonical event envelope that API-backed games persist in Postgres, but pure CLI simulations remain local artifacts and do not write API database rows. Live standard rounds use one House room-assignment call, one private `alliance-proposer-selection` House call/turn per alliance window, and no per-player Mingle-intent calls. The proposer-selection artifact records the exact `ceil(alive / 4)` access set, underrepresentation preference, rationale, and deterministic repair notes; it is producer evidence, not a canonical alliance event. Only finalized players receive proposer calls, while invited responses and counters are created on demand through the unchanged consent/activation transaction. Decision-relevant Mingle rooms with a trusted or official ally carry a proposal/commitment receipt or a concrete no-proposal reason. Named huddle turns persist member target/action/commitment/contingency/confidence/dissent facts, and the later outcome preserves those facts beside House summary prose. House prose is not canonical plan evidence. Eligible decision turns carry compact strategy candidate/result metadata; format decisions also carry `decisionSource` and nullable `fallbackReason`. Ordinary `strategyDelta` values should be exceptional actionable changes; null, the exact string `"null"`, and omitted candidates leave state unchanged. For a validation run, report non-null, accepted, rejected, and no-change counts plus output tokens by action family, then review usefulness without treating alliance prose as obligation. Reasoning and strategy prose are diagnostic evidence, never canonical fact. Legacy/classic `candidate-selection`, `power-action`, and Council records remain readable when that historical lane is deliberately exercised, but are not expected standard-round actions.

House MC summaries run at meaningful actor-coordinate phase cadence. Each beat starts from a bounded canonical/projection/public-dialogue frontier plus compact narrative continuity; transcript prose never becomes game-state authority. Simulation `houseSummaryCadence` instrumentation reports eligible/emitted/preflight-skipped/model-skipped/failed boundaries, provider/fact calls, returned bytes, selected-source counts, per-coordinate totals, and call/token reconciliation. `--no-house-summaries` disables the whole cadence. For the provider-free tests, opt-in current-meta comparison, exact limits, and the currently unmet full-game runtime gate (`1.360086x` cost, 69.57% emission, 60.87% specificity), see [House summary cadence evaluation](docs/local-model-evaluation.md#house-summary-cadence-evaluation).

Format ballot visibility has three deliberately separate lanes. Sanitized operator transports (`filter_events` and `read_round_facts.format.acceptedBallots`) expose accepted voter-to-target mappings immediately after durable record. Participating-agent prompt context remains restricted to the knowledge allowed by the active format rules and must not ingest that operator ledger. The browser may buffer the same sanitized mappings until resolution, then present `ballotPresentation.rollCall` through Tally → Roll Call choreography; this is presentation pacing, not a second authority or confidentiality boundary.

Agent prompts are compiled from a server-owned **Recall Plan** (protected Board Contract + compact strategy + authorized compact huddle outcomes; hot active-room speech; historical public/actor-owned Mingle only for `strategic_decision`). Ordinary speech has no historical archive lane. A protected overflow retains a bounded 1,200-character strategic archive reserve without truncating protected truth. Ranking rejects zero-overlap dialogue, then applies bounded preference for the current round and living speakers named by compact strategy; the latest current-round statement from that speaker wins. Historical Mingle eligibility is fail-closed on modern `speakerPlayerId`/`audiencePlayerIds` (legacy display-name-only rows do not upgrade into private recall). Official huddle outcomes authorize via immutable `participantPlayerIds` (recoverable on hydrate only from matching completed-session speakers). The ≥50% late-game input-context reduction gate, including relevant-history survival under protected overflow, is proven offline by `packages/engine/src/__tests__/context-recall-evaluation.test.ts` and `packages/engine/src/__tests__/context-recall-plan.test.ts` against a frozen corpus — no paid LLM simulation is required. Responses calls use a stable hashed game-and-actor cache key; GPT-5.6+ uses the current 30-minute cache policy and older models keep their provider default. Provider cache rates are optimization telemetry, not recall proof. See `docs/reasoning-transcript-observability.md` § Selective Context Recall and `CONCEPTS.md` (Recall Plan).

For local MCP queries across past and current simulations, run `cd packages/engine && bun run mcp:game -- docs/simulations`. The MCP is read-only, scans the corpus on demand, and requires `sessionId + gameNumber` for game-specific projection/timeline queries. Tool results include MCP `resourceUri` values for full artifacts; use `resources/read` with those URIs for events, turns, progress, transcript, or game JSON instead of treating `sourcePath` as repo-root-relative. Use `search_logs` over `sources: ["turns"]` for `mingle-room-assignment`, `mingle-turn`, `alliance-proposer-selection`, alliance records, `format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`, `decisionSource`, `fallbackReason`, `strategyCandidate`, `strategyResult`, or movement receipts. Search `mingle-intent`, `candidate-selection`, `power-action`, and `shieldPullUp` only for isolated, legacy, or classic batches. Use canonical events rather than reasoning prose for accepted game facts.

For OAuth-gated local simulation MCP validation, first give the signed-in wallet the `mcp` role and set the same high-entropy `INFLUENCE_MCP_INTROSPECTION_SECRET` for the API and local bridge. With the API on `http://127.0.0.1:3000` and web on `http://localhost:3001`, run `cd packages/engine && bun run mcp:game:login`, approve `scope=mcp` in the browser, then launch the bridge with `bun run mcp:game:oauth -- docs/simulations`. The helper saves the one-hour token to `~/.influence-game/mcp-token.json` with user-only file permissions; override with `INFLUENCE_MCP_TOKEN_FILE` for connected MCP clients. The bridge reads `INFLUENCE_MCP_TOKEN` first and then the saved token file. The token has no refresh token; rerun the helper and restart the MCP client/bridge after expiry. `scope=mcp` is global access to wired MCP surfaces. Do not describe it as per-user private-trace, per-agent, or per-game authorization.

The current Streamable HTTP MCP is documented in `docs/game-mcp-production-oauth.md`. `/mcp` is one eligibility-filtered, scope-enforced resource: `games:read` covers accessible game and public season reads plus owner match tools (`read_match_manifest`, `read_match_transcript`, `read_owned_match_cognition`, `read_owned_match_narrative`); `agents:read` covers owned-agent, owner season-analysis, and export reads; `agents:write` adds pre-match agent/queue mutations; `producer` adds global private traces, hidden competition diagnostics, and `read_producer_match_narrative`. Owner match tools stay on `games:read` only (no producer-role silent widen of private lanes), use owner-unified Mingle/huddle visibility for participating seats, and keep owned cognition/narrative on explicit `subject_owner` policy. Producer narrative is a separate tool under `producer` with full product dialogue + all seats’ thinking/strategy — never a silent widen of the owner tool. Eligible descriptors may be listed before the current token holds their scopes so a host can request incremental consent, but every invocation still requires the actual grant, active client envelope, current role, ownership, and domain authorization. Player-safe tools must not expose `mu`, `sigma`, opponent distributions, expected outcomes, revision magnitude, or recalibration evidence. Account free-track ELO remains player-level and separately labeled; Agent/Architect standings derive only from public competition receipts.

### Dual Crown rollout and operations

Season tables are additive and existing completed games remain career history only. Do not fabricate historical receipts or hidden rating history. Before creating the first season in each environment:

1. Stop API/game execution, apply migrations, and run `bun run dist/backfill-agent-revisions.js` in the deployed API container with that environment's `DATABASE_URL` (use `bun run packages/api/src/scripts/backfill-agent-revisions.ts` from a source checkout).
2. Create a season through the `manage_seasons` admin surface. Creation makes it active immediately.
3. Use producer diagnostics to inspect assigned games, unsettled owned seats, pregame rating snapshots, rating events, revision evidence, and scoring evidence when needed.
4. Closing stops new admission but already-assigned games keep their season. Finalization fails while assigned games are non-terminal or owned seats lack receipts.

To stop new games from entering a season, close admission. Season scoring remains experimental and may change while Season 0 is running; producer evidence records what happened without turning the current scoring code into a player-facing promise.

For completed API-backed games, `read_game_brief` is the first MCP call to try. Its v2 postgame payload starts with a deterministic `executiveSummary`, includes round `headline` values, rule-based `highlightedEliminations`, enriched `derivedVoteCohorts`, sparse `gameMomentum`, jury narrative/supporter splits, and player `overallGameShape`. These fields are deterministic projections over canonical events and completed result rows; do not backfill them from transcript prose, cognitive artifacts, private traces, or hidden reasoning. If the canonical facts are missing or ambiguous, return an empty list, `null`, low confidence, or diagnostics instead of inferring a story.

For API-backed durable runs, use `./scripts/run-trace-mcp-local.sh` from a trusted local environment. This local Trace MCP reads Postgres durable-run state and private trace manifests, then opens raw trace content only through the explicit `read_content` tool. The wrapper bootstraps local Postgres and local private content S3, sources `.env.private-trace.local`, runs API migrations, sends setup logs to stderr, and then starts the stdio MCP server. It relies on the same local DB/private-storage env as the API (`DATABASE_URL`, `LINODE_PRIVATE_CONTENT_ENDPOINT`, `LINODE_PRIVATE_CONTENT_ACCESS_KEY`, `LINODE_PRIVATE_CONTENT_SECRET_KEY`, `LINODE_PRIVATE_CONTENT_BUCKET`) and persists a dedicated `INFLUENCE_TRACE_MCP_CURSOR_SECRET` in the ignored local env file so an unexpired manifest cursor survives a server reconnect. The cursor secret is local tooling state, not a production JWT secret. The Trace MCP is deliberately not a production/admin MCP surface. Use `bun run trace:local:smoke` for a one-command local Postgres + private content S3 writer/read/search validation. Local Postgres runs in Docker; sandboxed agents usually need elevated sandbox access for DB-backed commands against `127.0.0.1:54320`. Keep browser login, releasable packaging, cross-run trace search, and web UI affordances out until those are designed as their own slice.

Accepted-action correlation is forward-only for API-backed runs. Direct model-authored alliance, vote/revote, format, Safety Bounce, Power, Council, endgame, and jury actions may carry the fresh receipt returned by that exact call; accepted writers do not use `getLastPrivateDecisionId()`. Speech, reflection, intent, pass, rejection, timeout, unavailable-method, House fallback, materially repaired, derived, and legacy records remain intentionally unlinked. The API stamps relational trace/cognition/prompt-reuse sidecars only after durable append assigns the final sequence, never rewrites raw trace objects, and never rolls back a valid game action because observability degraded.

For production-style diagnosis, use `inspect_durable_run` first, then `list_trace_manifests`, `read_producer_match_narrative`, and producer `filter_events` to reconcile the trusted sequence and minimal citation. Read bounded raw content last with `read_trace_content({ manifestId, gameId, maxBytes })`. Prompt-reuse totals and first-break math are unchanged: the watermark advances through linked accepted sequences, while `coverage: "partial"` remains honest when expected unlinked calls exist. Canonical events remain board authority; private traces explain decisions, owner citations are cognition-gated `{seq,type}`, and public/player/watch/transcript/results responses never expose decision IDs or source pointers. See `docs/reasoning-transcript-observability.md` for the full action inventory and linkage-count semantics.

Provider failures use a separate private evidence type. Admin and sysop can open **Provider failures** from the affected game in Admin history; the panel distinguishes recovered, terminal, degraded, and aggregate rate-limit states and lazy-loads exact sanitized non-429 evidence in bounded chunks. Producer MCP callers use `list_trace_manifests({ gameIdOrSlug, evidenceType: "provider_attempt_failure" })`, then `read_trace_content({ manifestId, gameId, evidenceType: "provider_attempt_failure", offsetBytes, maxBytes })`. Both reads require producer OAuth scope plus current producer role; raw responses are untrusted data, audited, no-store, and unavailable to public/player/owner-only surfaces. Provider Health is a separate Admin control: a successful **Test provider and resume** probe may close a current breaker; MCP exposes health read-only and has no mutation tool.

`InfluenceAgent` uses provider profiles selected from the per-game model catalog. Hosted OpenAI uses `OPENAI_API_KEY`; local OpenAI-compatible servers use `INFLUENCE_LLM_BASE_URL` with LM Studio; Katana / IMGNAI uses `API_KAT_IMGNAI_KEY` plus `API_KAT_IMGNAI_SECRET` only when a game or simulator run explicitly selects a Katana catalog entry. API game start preflights the selected provider/model before claiming the durable run owner; set `INFLUENCE_LLM_PREFLIGHT=off` only for local OpenAI-compatible servers that can generate normally but do not implement model metadata retrieval. Hosted OpenAI agent prompts request Responses API reasoning summaries by default with `INFLUENCE_OPENAI_REASONING_SUMMARY=auto`; accepted values are `auto`, `concise`, `detailed`, and `off`, with `INFLUENCE_LLM_REASONING_SUMMARY` accepted as an alias. Local base URLs stay on Chat Completions compatibility paths and do not request hosted OpenAI reasoning summaries.

New games seal an ordered `providerManifest`. Each entry uses `catalogId` plus `reasoningPolicy` (`low`, `medium`, `high`, or engine `action-policy`, labeled **Adaptive** in the UI); fallback entries also require a bounded `maxCallsPerGame`. GPT-5.6 Luna (`openai:gpt-5.6-luna`) remains the primary product baseline. Current game-ready entries are `openai:gpt-5-nano`, `openai:gpt-5-mini`, `openai:gpt-5.4-nano`, `openai:gpt-5.4-mini`, `openai:gpt-5.6-luna`, `katana:grok-4-3`, `katana:grok-4-5`, and `katana:glm-5-2`. The unattended Daily default is Luna → Grok 4.5 (12 calls) → GLM 5.2 (24 calls); live Katana qualification for both fallbacks is recorded in `docs/local-model-evaluation.md`. `katana:grok-4-20-multi-agent` remains an evaluation candidate, and `katana:q-naifu-a3b` remains disabled after repeated semantic decision failures. Existing OpenAI and Katana catalog access remains available for explicit manual/test manifests.

Create an API-backed simulation with the same ordered fallback shape using data-only CLI arguments:

```bash
bun run simulate:api -- \
  --provider-entry openai:gpt-5.6-luna,reasoning=action-policy \
  --provider-entry katana:grok-4-5,reasoning=action-policy,max-calls=12 \
  --provider-entry katana:glm-5-2,reasoning=action-policy,max-calls=24
```

The manifest is frozen at creation and checkpoint recovery uses that exact order. A request-specific refusal may advance to the next entry; the next logical call begins at primary again unless its durable health state or remaining budget disallows it.

The operational outcomes are intentionally distinct:

- An `invalid_prompt` response keeps its exact sanitized request/response evidence, advances to the next permitted manifest entry for that call, and starts the following logical call at primary again.
- If every permitted entry is exhausted or disallowed, optional speech is omitted and required actions use the phase's deterministic legal fallback. The engine never emits synthetic `[No response]` dialogue.
- A systemic authentication/configuration failure, or a threshold of service/transport failures, opens durable provider health and pauses new Daily claims; running games continue through their permitted manifest or engine behavior. Rate limits do not open the V1 breaker.
- After correcting the provider, an admin or sysop uses **Test provider and resume**. One fenced live probe runs; success closes the current breaker revision and resumes eligible Daily admission, while failure leaves it open with new private evidence. Producer MCP can inspect this state but cannot mutate it.
- If the process crashes after a remote dispatch whose result was not durably accepted, recovery retries with a new attempt ordinal. This can repeat a billable inference; owner, budget, accepted-result, and canonical-event fences still allow only one gameplay effect. The system does not claim exactly-once remote inference.

Structured decision calls use Responses API JSON Schema output for hosted OpenAI when reasoning summaries are enabled; otherwise hosted OpenAI defaults to named tool forcing. Local base URLs default to `INFLUENCE_LLM_TOOL_CHOICE_MODE=required`, which sends the LM Studio-compatible string `tool_choice` and keeps emitted `thinking` in decision schemas. Structured decisions use a global 8192-token completion floor so reasoning models have enough room to produce tool arguments. House Mingle room assignment and House alliance proposer selection also use strict JSON Schema output with that structured token floor before deterministic fallback/repair. Public messages use a global 4096-token completion floor and retry once with a doubled budget when visible content is empty. They request visible speech in `message.content` and preserve native local reasoning metadata such as `reasoning_content` separately as `reasoningContext`. If a local server supports JSON schema better than tools, set `INFLUENCE_LLM_TOOL_CHOICE_MODE=json_schema`.

### Environment Strategy

Three Doppler configs exist under the `social-strategy-agent` project:

| Config | Purpose | Database | API Port | Web Port | Network |
|--------|---------|----------|----------|----------|---------|
| `dev` | Active development | PostgreSQL (`influence_dev` on port 54320) | 3000 | 3001 | localhost |
| `stg` | Staging QA, updates from `main` | PostgreSQL (`influence_dev` via staging config) | 4000 | 4001 | Tailnet only (100.100.251.4) |
| `prd` | Production, manual approval | PostgreSQL (dedicated instance) | TBD | TBD | Public |

**Agents use the `dev` config** for local hosted-provider development. Staging receives updates from `main`; production requires manual approval. Do not run experiments directly against staging unless the task explicitly asks for staging QA.

The root `simulate` script passes `--project social-strategy-agent --config dev` to Doppler so hosted-provider validation does not depend on a per-checkout Doppler setup file. Hosted-provider tests are excluded from every required test command; when a task explicitly requires paid validation, run `doppler run -- bun run test:live-provider` from a trusted environment. Run hosted simulator batches from the repo root with:

```bash
bun run simulate -- --games 2 --players 8 --personas Atlas,Vera,Finn,Mira,Rex,Lyra,Kael,Echo --model gpt-5.6-luna
```

Run the Katana Grok smoke through the catalog/provider path with:

```bash
bun run simulate:katana:grok:smoke
```

Run the local browser stack with explicit Doppler dev config:

```bash
bun run s3:bootstrap
bun run dev:api
bun run dev:web
bun run dev:render-worker
```

Run those three `dev:*` commands in separate terminals. They wrap Doppler's
`social-strategy-agent/dev` config themselves and share the local trailer token,
API origin, and filesystem upload directory. The worker has no listening port;
it polls the API and is required for admin trailer jobs to advance beyond
`Queued`. Use the corresponding `*:service` scripts only when the shell or
container already supplies its environment.

The private trace env has to be loaded into the API process before a game starts. If the API was already running, restart it after sourcing `.env.private-trace.local`; the trace writer is best-effort and gameplay can complete without private trace manifests when these vars are missing.

The web command is Doppler-wrapped because runtime config such as Privy, admin address, API URL, and websocket URL may come from the shared dev config. The API URL uses `127.0.0.1` rather than `localhost` so Chrome does not resolve the API to IPv6 `[::1]` and accidentally hit another local dev server.

### Local Upload Storage

Profile-picture uploads use Linode Object Storage when `LINODE_OBJ_ENDPOINT`, `LINODE_OBJ_ACCESS_KEY`, `LINODE_OBJ_SECRET_KEY`, and `LINODE_OBJ_BUCKET` are present. In local dev, if those vars are absent, the API automatically uses a filesystem-backed upload endpoint instead and writes files under `packages/api/.local-uploads/` by default. Local upload and read URLs are returned as absolute API-origin URLs so the browser does not resolve them against the separate web dev server origin.

Useful overrides:

```bash
INFLUENCE_STORAGE_BACKEND=local      # force local filesystem uploads
INFLUENCE_STORAGE_BACKEND=s3         # require Linode/S3 vars
INFLUENCE_STORAGE_BACKEND=disabled   # disable uploads
INFLUENCE_LOCAL_UPLOAD_DIR=/tmp/influence-uploads
```

### Local Private Content S3

Raw private decision traces do not use the filesystem upload fallback. Local validation needs an S3-compatible private content bucket so the same writer/read model path can exercise `PutObject`, `HeadObject`, and `GetObject`.

```bash
bun run s3:bootstrap
set -a
source .env.private-trace.local
set +a
```

Defaults:

```bash
LINODE_PRIVATE_CONTENT_ENDPOINT=http://127.0.0.1:19000
LINODE_PRIVATE_CONTENT_ACCESS_KEY=influence
LINODE_PRIVATE_CONTENT_SECRET_KEY=influence-private
LINODE_PRIVATE_CONTENT_BUCKET=influence-private-content-local
```

The script starts a Docker MinIO container, creates the private bucket, and writes `.env.private-trace.local`. Restarting Docker does not usually require updating that file if the same MinIO container, ports, bucket, and credentials are still present. If the container was recreated, credentials changed, or trace manifests are missing after a run, rerun `bun run s3:bootstrap`, restart the API with the env sourced, and run `bun run trace:local:smoke` to verify write/read/search through the real storage adapter. Keep `LINODE_PRIVATE_CONTENT_BUCKET` separate from `LINODE_OBJ_BUCKET`; the writer rejects the public/profile bucket for raw trace content. Staging/production must set `LINODE_PRIVATE_CONTENT_ENDPOINT`, `LINODE_PRIVATE_CONTENT_ACCESS_KEY`, `LINODE_PRIVATE_CONTENT_SECRET_KEY`, and `LINODE_PRIVATE_CONTENT_BUCKET`; the private content key should be scoped to that bucket rather than reusing the profile-picture upload key.

For Codex or another MCP client, configure the command as the wrapper script directly so setup output stays on stderr and the MCP JSON-RPC stream stays clean:

```json
{
  "command": "/Users/user/Development/influence-game/scripts/run-trace-mcp-local.sh"
}
```

### Staging Deployment

Staging deploys are automated via the CI/CD pipeline:

1. Push to `main` → CI passes (typecheck, lint, test)
2. Docker images built and pushed to GHCR (`ghcr.io/0xflicker/influence-{api,web,render-worker}`)
3. Cross-repo trigger fires `deploy-staging.yml` in the `linode-iac` repo
4. Docker Compose deploys to the staging host

To manually trigger a staging deploy, use the `deploy-staging` skill or trigger the `deploy-staging.yml` workflow in linode-iac.

House Highlights postgame media adds a third, single-concurrency service. The API owns jobs, leases, storage credentials, and publication state; the render worker owns Remotion/Chromium/ffmpeg work only. Build, local smoke, health, temp-space, object-delivery, admin backfill, and concrete Compose handoff instructions are in `docs/deployment/house-highlights-render-worker.md`. Do not place `LINODE_OBJ_*` credentials in the worker container.

**Board access URL:** `https://influence-staging.tail8a79ed.ts.net/`

### Port Allocation

| Service | Dev | Staging |
|---------|-----|---------|
| API (Hono) | 3000 | 4000 |
| Web (Next.js) | 3001 | 4001 |
| Render worker | No port | No port |

The API respects `PORT` and `HOST` env vars (set in Doppler per environment). In dev, `HOST` defaults to `0.0.0.0`. In staging, `HOST=100.100.251.4` restricts access to the tailnet.

### Database Strategy

**Current:** PostgreSQL 16 via Drizzle ORM + `postgres.js` driver. The database runs in a Docker container on port 54320; sandboxed agents usually need elevated sandbox access for DB-backed commands against `127.0.0.1:54320`.

**Dev database:** `influence_dev` on `127.0.0.1:54320`, owned by the `influence` user. Default connection string: `postgresql://influence:influence@127.0.0.1:54320/influence_dev`. Override with `DATABASE_URL` env var. If a sandboxed command reports `ECONNREFUSED`, rerun with elevated sandbox access before assuming the Docker database is down.

**Test database:** `influence_test` on the same instance, same credentials. Used by test suites to avoid polluting dev data.

**Staging database:** Uses the same PostgreSQL instance with staging-specific config via Doppler. Migrations run automatically during deployment.

**Watch-state summary backfill:** The `game_watch_state_summaries` migration runs during deploy, but existing-game summary population is an explicit one-off command. After an API image containing the bundled backfill script has deployed, run it from the target host so it uses that environment's Compose env file:

```bash
ssh root@influence-staging 'cd /opt/influence && docker compose run --rm --no-deps api bun run dist/backfill-game-watch-state-summaries.js'
ssh root@influence-prod 'cd /opt/influence && docker compose run --rm --no-deps api bun run dist/backfill-game-watch-state-summaries.js'
```

Use `--force` at the end of the same command only for a full repair refresh.

**Critical:** Use only the Influence database/schema for this app. If an old `paperclip` database exists on a shared local PostgreSQL instance, treat it as historical external data and do not create Influence tables there.

### Statefulness Risk

Active game execution is partially crash-recoverable, not generally crash-safe. If the API server restarts while a game is in progress, the replacement process has no in-memory runner, so startup marks old `in_progress` rows as suspended and attempts supported phase-boundary recovery. A suspended game can resume only when the newest event-head checkpoint has implemented runner hydration, complete resume inputs (including versioned private player continuity capsules and the sealed House-continuity requirement), and a supported actor coordinate. Treat `docs/statefulness-plan.md` as the reference for the exact supported boundaries and do not claim mid-phase, arbitrary endgame, or multi-worker resume support.

The admin durable-run read model reports a hydration passport for checkpoint summaries. The passport is status-only readiness metadata: it can say whether event/projection replay, boundary certificate, Runtime Snapshot v1 evidence, transcript/token cursors, private player/House continuity, owner epoch proof, and privacy validation pass, but it must not expose raw continuity capsules, prompts/responses, storage pointers, `thinking`, or `reasoningContext`. Runtime Snapshot v1 validators fail closed: missing expected active-player evidence, boundaryless token cursors, malformed runtime subobjects, or non-empty accumulators without a v1 capture contract block candidacy. A `hydration_candidate` verdict is not by itself a resume API; `resumeAvailable` is true only when the implemented startup recovery selector can actually run that checkpoint.

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
2. Both required test lanes pass: `bun run test` and `bun run test:postgres`
3. All package.json `version` fields are synced to the new version
4. Commit message: `release: vX.Y.Z`
5. Annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z: <summary>"`
6. Push: `git push origin main --tags`
7. Deploy to staging: push triggers automated deploy via CI/CD pipeline
8. Record release notes in the relevant PR, issue, or release handoff; if the ship is player- or builder-visible, also add a public Updates post under `packages/web/content/updates/` (see Release Process step 7)

## Release Cadence

Releases are cut when a meaningful set of changes lands — not on a fixed schedule. The process:

```
Development → Tests Pass → Version Bump → Tag → Push → Deploy Staging → Board Tests
```

- **MINOR** releases (0.7.0): new features, mechanic changes, interface changes
- **PATCH** releases (0.6.1): bug fixes, personality tuning, config tweaks
- Board tests against staging on the tailnet. If issues are found, agents fix → new patch → redeploy.
