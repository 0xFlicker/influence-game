# Agent Guide

## HIGHEST PRIORITY — STORAGE AND GAME CONTINUITY GUARDRAILS

**Use databases as databases. Use object storage as storage. These are mandatory design and review rules.**

- PostgreSQL owns relational records, indexed metadata, permissions, transactions, ownership, canonical coordinates, and small operational state. Buckets own binaries and large immutable documents: images, source assets, generated media, raw provider evidence, frozen context inputs, and derived export/render documents. Store object keys, hashes, lengths, versions and access metadata in PostgreSQL; do not embed these bodies in BYTEA, JSONB, TEXT, base64, or data URLs.
- Reuse the existing private/public bucket clients and access boundaries. Verify durable object upload and content hash before committing a reference. Preserve atomic game acceptance, immutable evidence, privacy and recovery; handle orphan objects explicitly. Do not replace a real storage design with a guessed payload-size ceiling.
- Every storage refactor MUST migrate **all existing binaries** and the affected existing document payloads, including local development, staging and production. A new-writes-only change is incomplete. Inventory, resumable copy, hash/length verification, reference cutover, read/recovery proof and removal of database bodies are required. Preserve accepted game history and hashes; never regenerate historical content to move it.
- **NEVER fail, suspend, cancel or mark a game repair-required solely because context input is large or exceeds an estimated byte/token budget.** Adapt context using supported summarization/compaction or provider routing while preserving canonical authority and durable continuity. Genuine provider context-limit responses also need context adaptation, not an endless retry of the same oversized request.
- Tests must prove large valid contexts continue and retain their required meaning. Tests asserting size-only game failure are defects to replace, not requirements to preserve. This does not permit accepting malformed model output, corrupt hashes, invalid identities, or fabricated game facts. Output schemas and authorization/upload/read-page limits remain distinct from game-context limits.
- The whole-storage migration uses one coordinated stopped-writer cutover per environment, including **all existing data**. Follow [the cutover runbook](docs/deployment/private-payload-storage-cutover.md). The former retrospective-only inline-storage exception is closed by this migration. New body fields must use `payloadColumn`, explicit storage writers/readers, integrity checks and the migration inventory; test adapters must never become production fallbacks.


## Current Operating Context

- This repo is maintained with Codex-oriented workflows. Paperclip references in older docs are historical and should not be treated as active process requirements.
- Prefer Compound Engineering skills for planning, implementation, review, and PR work. Speckit may be used only if its workflow/tooling is explicitly available and selected for the task.
- Old `INF-###` identifiers are not authoritative anymore. Use GitHub, git history, and current repo docs as the source of truth unless the user provides extra context.
- Keep docs current while working. If behavior, model policy, deployment flow, or validation expectations change, update or extend docs in the same branch.
- `docs/solutions/` contains documented solution learnings organized by category with YAML frontmatter (`module`, `tags`, `problem_type`); relevant when implementing or debugging in documented areas.
- `CONCEPTS.md` contains shared domain vocabulary for Influence concepts, agent decision artifacts, and game-state terms; relevant when orienting to the codebase or discussing domain behavior.

## Product Direction

- The House is the venue; Influence and Werewolf are separate games. `games.gameKind` selects the game, while Influence's `classic` / `format` kernels remain Influence-only.
- Current Werewolf v9 discussion is sequential: publish each original contribution before the next speaker acts. It uses one shared byte allowance, permits silence and directed conversation, then proceeds to one public sequential vote. Preserve optional cues as production notes; do not reintroduce House rewriting or a separate should-speak call.
- Discussion passes and scheduler metadata are private to execution/debugging. Contestant history and reply references count spoken contributions only. Playback always skips discussion passes, including when Show thinking is enabled. Preserve canonical pass events and their thinking for debugging. Ballot abstentions remain public.
- Preserve the seeded opening ring, opener/respondent/answer behavior, and sealed checkpoints as historical v7/v8 semantics only. Replays use the frozen version-specific reducer. Never infer scheduling or facts from prose.
- Werewolf rules, private observations, faction outcomes, and spectator projections live in `packages/engine/src/werewolf/`. See `docs/werewolf.md`. Do not route Werewolf through Influence elimination, jury, scoring, narration, or transcript parsing.
- Agent Profiles share character identity and visuals. `strategyStyle` is Influence-only; `werewolfStrategyStyle` is Werewolf-only. Never substitute one game's notes for the other.
- The immediate audience is the user and friends, so the bar is an enjoyable-to-watch game with legible strategy rather than a fully public-scale product.
- Influence playback returns to the canonical winner and standings after `retrospective.completed`. Keep that completion boundary in presentation-only replay frames; unfinished retrospectives must not trigger the closing results screen.
- Agent quality matters: agents need help exhibiting real strategy, remembering commitments, and making watchable social decisions.
- The active `feat/inf-228-mingle-hardening` branch is an unfinished Mingle/open-room experiment intended for eventual merge to `main`. The UI mostly works, but it needs more testing and tuning before merge.

## Influence open conversations

- Non-visual Lobby playback uses the same circular portrait room as Mingle, with the living cast at that replay point. Historical classic games without frames use the existing elimination display rules on the transcript prefix, never the final roster status. Studio thinking shots retain the room label. Introductions retain individual portrait staging.
- Lobby (including Reckoning/Tribunal), ordinary Mingle, and selected alliance huddles use bounded sequential speech/pass decisions. Defaults are 320 UTF-8 bytes per speech and 400 bytes per participant; two ordinary Mingle conversation rounds have one simultaneous movement boundary. Freeze these values in new-game configuration.
- Give every contribution its own durable provider slot and commit before preparing the next context. Event sequence alone cannot identify successive conversation calls. Preserve feedback-informed length retries, accepted thinking, available native reasoning, and every sanitized provider attempt.
- Passes are always skipped in playback, including Show thinking; their thinking stays saved for debugging. Private offers, passes, queue state, foreign budgets, and gaps in reference numbering never enter another contestant's prompt.
- Huddles are private House-selected conversations, without new tactical fact atoms or House-generated outcomes. Frozen session participants retain attended dialogue after membership changes; outsiders learn no session existence or scheduling details. A spoken disclosure is a claim, not permission to read the session.
- Spectator huddles show accepted speech and its saved thinking when Show thinking is enabled, just like other speaking turns, chronologically after Mingle with an exact-cast room scene or portraits. Passes remain skipped. Spectator visibility never widens contestant/API-owner recall. Historical completed outcomes remain readable.

## Known Risks

- Current API Influence games execute as atomic durable logical turns. A normal process reload adopts the committed XState cursor and continues the same game; planned provider calls replay accepted values and uncommitted scratch effects are discarded. Werewolf adopts its own validated event cursor and frozen action/observation plans under the same owner-epoch and provider journal fences. Do not extend these claims to corrupt durable rows or historical runs without that authority.
- Staging is real QA infrastructure. `influence-staging` updates from `main`; `influence-production` requires manual approval.

## Event authority

- Influence is an event-driven game. Canonical events and projections are the only authority for accepted game state, decisions, tallies, eligibility, phase transitions, results, and replay choreography.
- Transcript prose may be rendered, searched, filtered, styled, quoted, and used as dialogue or observability. It must never be parsed or reverse-engineered into authoritative game facts, decisions, tallies, phase changes, or replay state.
- The only grandfathered exception is the existing classic presentation parser at `packages/web/src/app/games/[slug]/components/message-parsing.ts` and its current consumers/tests. It is frozen compatibility debt: do not add parser patterns, do not extend it for format-kernel behavior, and do not route format games through it.

## Model-output structure

- Any model turn whose output affects control flow, game state, continuity, producer evidence, or later model context must use a provider-native exact strict JSON schema response. A schema that merely accepts any object is not a structured contract.
- Validate the decoded semantic value inside the provider-attempt boundary. Non-empty text, parseable `{}`, missing required fields filled with defaults, fenced JSON, or a JSON object extracted from surrounding prose must never count as a successful structured turn.
- Structured-output failure must remain typed: retry it under the shared provider policy, apply an explicit rules-legal fallback at the owning phase boundary, or fail clearly. Do not silently reinterpret malformed structured output as dialogue or other agent-authored prose.
- Prose fields are presentation, even when returned inside a tool call. Do not infer claims, participants, decisions, addressees, phase, history, or simulation state by applying regexes or string conventions to model prose. When downstream code needs those values, return and validate them as separate structured fields or derive them from canonical events/projections, then render prose from that structure.
- Provider adapters may decode the provider's exact native structured payload into the shared model outcome. They must not introduce permissive compatibility parsing that weakens the invocation's schema or semantic validation.
- Keep focused malformed-output coverage for every structured turn, including non-JSON text, embedded/fenced JSON, `{}`, missing required fields, extra fields, and exhausted retries. Tests must prove malformed output cannot mutate continuity or masquerade as accepted speech.

## Local Models

- Paid simulations run **over the localhost API**, meaning through the API, not file-only execution. Preserve API game IDs so replay, Studio and MCP inspect the actual tested games.
- Always retain simulation data: structured thinking, available native reasoning/summaries/encrypted payloads, complete sanitized provider requests/responses, usage, retries and failures. Never discard successful evidence, overwrite run artifacts, or continue spending after local evidence persistence fails. Keep private evidence out of contestant observations and public exports.

- Local LM Studio is a best-effort experimental lane, not a production qualification target. Use the OpenAI-compatible provider env vars documented in `docs/local-model-evaluation.md`.
- Simulation outputs should be stored locally, usually under `packages/engine/docs/simulations/`, unless a task says to publish or attach them elsewhere.
- `--chatty` mode + the reasoning / transcript observability layer (`docs/reasoning-transcript-observability.md`) is now the expected way to inspect agent decision quality (Mingle turns, votes, power actions, council votes). The surfaced `thinking` and native `reasoningContext` on system transcript entries are first-class artifacts for local model work.

## Validation

- Use Bun only; do not use npm or pnpm.
- Fast provider-free baseline: `bun run test` (classification plus automatic engine/web/protocol discovery).
- Saved source snapshots under `docs/simulations/` are debugging evidence, excluded from test discovery; preserve them rather than deleting them to make a test run pass.
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

- Werewolf v9 requires a strict majority of all living players in its single public vote; abstention is legal and a miss means no elimination. v7/v8 used thread checkpoints and a final plurality ballot. Only canonical `werewolf.day_vote_resolved` establishes the result; never carry votes forward. A typed provider failure records a marked unavailable abstention rather than fabricating a target.

- Werewolf v9 public ballots are serial: commit and publish each accepted choice before dispatching the next voter. Earlier v7/v8 sealed batches retain their historical journal replay and one canonical reveal. Never leak future ballots or inject spectator progress into contestant observations or historical cursor reads.
