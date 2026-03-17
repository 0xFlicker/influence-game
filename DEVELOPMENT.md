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

## Environment

Secrets are injected via Doppler. Never hardcode API keys.

```bash
# Always prefix LLM-calling commands with:
doppler run -- bun test
```

The `OPENAI_API_KEY` env var is consumed by `InfluenceAgent`. `gpt-4o-mini` is the default model — cheap and fast for simulations. Only upgrade the model when quality is demonstrably insufficient.
