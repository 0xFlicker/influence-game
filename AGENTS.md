# Agent Guide

## Current Operating Context

- This repo is maintained with Codex-oriented workflows. Paperclip references in older docs are historical and should not be treated as active process requirements.
- Prefer Compound Engineering skills for planning, implementation, review, and PR work. Speckit may be used only if its workflow/tooling is explicitly available and selected for the task.
- Old `INF-###` identifiers are not authoritative anymore. Use GitHub, git history, and current repo docs as the source of truth unless the user provides extra context.
- Keep docs current while working. If behavior, model policy, deployment flow, or validation expectations change, update or extend docs in the same branch.

## Product Direction

- Influence is the final product name.
- The immediate audience is the user and friends, so the bar is an enjoyable-to-watch game with legible strategy rather than a fully public-scale product.
- Agent quality matters: agents need help exhibiting real strategy, remembering commitments, and making watchable social decisions.
- The active `feat/inf-228-mingle-hardening` branch is an unfinished Mingle/open-room experiment intended for eventual merge to `main`. The UI mostly works, but it needs more testing and tuning before merge.

## Known Risks

- Statefulness is the major operational risk. If the server resets in the middle of a game run, the active game can be corrupted. Do not describe active game execution as crash-safe until checkpoint/resume work lands.
- Staging is real QA infrastructure. `influence-staging` updates from `main`; `influence-production` requires manual approval.

## Local Models

- Local LM Studio experiments are a first-class development lane. Use the OpenAI-compatible provider env vars documented in `docs/local-model-evaluation.md`.
- Simulation outputs should be stored locally, usually under `packages/engine/docs/simulations/`, unless a task says to publish or attach them elsewhere.
- `--chatty` mode + the reasoning / transcript observability layer (`docs/reasoning-transcript-observability.md`) is now the expected way to inspect agent decision quality (Mingle turns, votes, power actions, council votes). The surfaced `thinking` and native `reasoningContext` on system transcript entries are first-class artifacts for local model work.

## Validation

- Use Bun only; do not use npm or pnpm.
- Fast baseline: `bun run test`.
- Broader local baseline: `bun run check`.
- For code-backed work that will merge, run the repo's required checks and report real results.
- When changing agent decision surfaces, transcript logging, or simulation output formatting, also update `docs/reasoning-transcript-observability.md`, the relevant usage examples in `docs/local-model-evaluation.md` / `DEVELOPMENT.md` / `README.md`, and the JSDoc in `packages/engine/src/simulate.ts`. Keep the "no `as any`" and direct-House-call disciplines visible in docs and code.
