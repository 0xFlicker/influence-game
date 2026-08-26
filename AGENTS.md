# Agent Guide

## Current Operating Context

- This repo is maintained with Codex-oriented workflows. Paperclip references in older docs are historical and should not be treated as active process requirements.
- Prefer Compound Engineering skills for planning, implementation, review, and PR work. Speckit may be used only if its workflow/tooling is explicitly available and selected for the task.
- Old `INF-###` identifiers are not authoritative anymore. Use GitHub, git history, and current repo docs as the source of truth unless the user provides extra context.
- Keep docs current while working. If behavior, model policy, deployment flow, or validation expectations change, update or extend docs in the same branch.
- `docs/solutions/` contains documented solution learnings organized by category with YAML frontmatter (`module`, `tags`, `problem_type`); relevant when implementing or debugging in documented areas.
- `CONCEPTS.md` contains shared domain vocabulary for Influence concepts, agent decision artifacts, and game-state terms; relevant when orienting to the codebase or discussing domain behavior.

## Product Direction

- Influence is the final product name.
- The immediate audience is the user and friends, so the bar is an enjoyable-to-watch game with legible strategy rather than a fully public-scale product.
- Agent quality matters: agents need help exhibiting real strategy, remembering commitments, and making watchable social decisions.
- The active `feat/inf-228-mingle-hardening` branch is an unfinished Mingle/open-room experiment intended for eventual merge to `main`. The UI mostly works, but it needs more testing and tuning before merge.

## Known Risks

- Statefulness is the major operational risk. If the server resets in the middle of a game run, the active game can be corrupted. Do not describe active game execution as crash-safe until checkpoint/resume work lands.
- Staging is real QA infrastructure. `influence-staging` updates from `main`; `influence-production` requires manual approval.

## Event authority

- Influence is an event-driven game. Canonical events and projections are the only authority for accepted game state, decisions, tallies, eligibility, phase transitions, results, and replay choreography.
- Transcript prose may be rendered, searched, filtered, styled, quoted, and used as dialogue or observability. It must never be parsed or reverse-engineered into authoritative game facts, decisions, tallies, phase changes, or replay state.
- The only grandfathered exception is the existing classic presentation parser at `packages/web/src/app/games/[slug]/components/message-parsing.ts` and its current consumers/tests. It is frozen compatibility debt: do not add parser patterns, do not extend it for format-kernel behavior, and do not route format games through it.

## Model-output structure

- Any model turn whose output affects control flow, game state, continuity, producer evidence, or later model context must use a provider-native tool or an exact strict JSON schema. A schema that merely accepts any object is not a structured contract.
- Validate the decoded semantic value inside the provider-attempt boundary. Non-empty text, parseable `{}`, missing required fields filled with defaults, fenced JSON, or a JSON object extracted from surrounding prose must never count as a successful structured turn.
- Structured-output failure must remain typed: retry it under the shared provider policy, apply an explicit rules-legal fallback at the owning phase boundary, or fail clearly. Do not silently reinterpret malformed structured output as dialogue or other agent-authored prose.
- Prose fields are presentation, even when returned inside a tool call. Do not infer claims, participants, decisions, addressees, phase, history, or simulation state by applying regexes or string conventions to model prose. When downstream code needs those values, return and validate them as separate structured fields or derive them from canonical events/projections, then render prose from that structure.
- Provider adapters may decode the provider's exact native structured payload into the shared model outcome. They must not introduce permissive compatibility parsing that weakens the invocation's schema or semantic validation.
- Keep focused malformed-output coverage for every structured turn, including non-JSON text, embedded/fenced JSON, `{}`, missing required fields, extra fields, and exhausted retries. Tests must prove malformed output cannot mutate continuity or masquerade as accepted speech.

## Local Models

- Local LM Studio experiments are a first-class development lane. Use the OpenAI-compatible provider env vars documented in `docs/local-model-evaluation.md`.
- Simulation outputs should be stored locally, usually under `packages/engine/docs/simulations/`, unless a task says to publish or attach them elsewhere.
- `--chatty` mode + the reasoning / transcript observability layer (`docs/reasoning-transcript-observability.md`) is now the expected way to inspect agent decision quality (Mingle turns, votes, power actions, council votes). The surfaced `thinking` and native `reasoningContext` on system transcript entries are first-class artifacts for local model work.

## Validation

- Use Bun only; do not use npm or pnpm.
- Fast provider-free baseline: `bun run test` (classification plus automatic engine/web/protocol discovery).
- Required API baseline: `bun run test:postgres` against local PostgreSQL. The CI job runs this as one Bun process with `--max-concurrency 1`.
- Broader local baseline: `bun run check`.
- Test ownership is structural: ordinary engine/web/protocol tests are provider-free; ordinary non-E2E API tests are PostgreSQL-owned; deterministic API browser tests use `*.e2e.test.ts`; paid/provider and external-write tests use `*.live-provider.test.ts` and `*.external-smoke.test.ts`. Root Playwright specs must be explicitly classified by `scripts/check-test-classification.ts`.
- Live providers, external writes, real Clerk, staging, and paid simulations are opt-in only. Required CI must never receive their credentials.
- Local Postgres runs in Docker on `127.0.0.1:54320`; sandboxed Codex commands usually need elevated sandbox access for DB-backed tests or local API DB reads. If a sandboxed command reports `ECONNREFUSED`, rerun with elevated access before saying the database is not running.
- Every shared-Postgres test must call `setupTestDB()` before database mutation. The helper holds a process-lifetime PostgreSQL advisory lock, so independent Bun processes wait instead of truncating the shared test database underneath one another. Do not use `test.concurrent` or `describe.concurrent` for tests that share this database; the process lock does not serialize tests inside one process.
- Browser harnesses use per-process databases and must drop them plus terminate API/web children in cleanup; they never truncate the shared test database.
- For code-backed work that will merge, run the repo's required checks and report real results.
- When changing agent decision surfaces, transcript logging, or simulation output formatting, also update `docs/reasoning-transcript-observability.md`, the relevant usage examples in `docs/local-model-evaluation.md` / `DEVELOPMENT.md` / `README.md`, and the JSDoc in `packages/engine/src/simulate.ts`. Keep the "no `as any`" and direct-House-call disciplines visible in docs and code.

## DB
- Local Postgres on `127.0.0.1:54320`; sandboxed DB failures may need elevated access before declaring the DB down.
- Shared test-database isolation is enforced across Bun processes by `setupTestDB()`'s session advisory lock. New DB-backed tests must use that helper and remain sequential within their process.
- Prefer Compound Engineering skills for plan/implement/review/PR flows when available.
- Update `docs/solutions/`, `CONCEPTS.md`, and ops docs when behavior changes.
