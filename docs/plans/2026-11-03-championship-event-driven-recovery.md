# Championship scheduling and game retry

This revision supersedes the earlier periodic championship reconciliation recommendation.

## Agreed behavior

Eight frozen finalists; sixteen daily Werewolf matches and the same eight in an Influence finale on day 17. Midnight UTC remains the chosen calendar default, not a requirement to dispatch within an exact second or to reject a delayed invocation. No recurring championship scheduling poll, no monetary stop conditions, no live activation implied by implementation.

A failed gameplay attempt can be retried by an operator: preserve its history, revoke its execution ownership, cancel it, hide it from ordinary public lists, and create one replacement with the same admitted competitive inputs. Championship replacements retain their match identity, frozen builds/artwork, model routing and roles. Only the current completed attempt scores. A completed outcome awaiting settlement must use settlement recovery rather than rerolling gameplay. Hidden is a listing property, not deletion or a privacy boundary.

## Implemented application boundary

`POST /api/admin/games/:id/retry` requires start, stop and hide permissions. The database transaction accepts one replacement per original game using `game_retries`, locks the original game, revokes its owner and preserves canonical history. Repeated requests resolve to that same replacement, including after a failed launch acknowledgement. Ordinary Influence copies admitted seats/configuration and rating snapshots, without reading mutable profiles; ordinary Werewolf reconstructs its canonical opening with its frozen config, seed, cast and verified role allocation. Finalized-season rated games require a separate season correction; retry cannot silently amend closed standings.

The admin game list and championship match list expose Retry game. Errors stay inline. Existing Retry settlement remains a separate operation.

`launchExactGameLocally` invokes exact-game ownership/adoption and execution directly; it does not wait for the discovery scan and does not start a server. Production launch uses a configured external HTTPS endpoint (`INFLUENCE_GAME_LAUNCH_URL` and `INFLUENCE_GAME_LAUNCH_TOKEN`). It receives `{gameId}` with `Idempotency-Key: game:<id>` and must return `{accepted:true,gameId}` only after durable acceptance. Missing production configuration rejects the operation before replacement creation. Local development uses the current application process; this is a local integration adapter, not the future Fargate runtime.

Existing legacy worker scans outside championship scheduling remain unchanged. An exact-game Fargate runtime must omit those scans and unrelated background workers. A task must acquire the same durable owner lease before running.

## One-shot scheduling lifecycle

1. Activation's external controller durably registers one schedule for each remaining match. Persist registration intent before AWS calls; stable names and matching request tokens recover partial registration. Do not report schedules installed merely because event status changed.
2. Each one-shot schedule contains event ID, match ID, ordinal, result revision and scheduled time. The dedicated Lambda calls `/api/internal/championships/:id/matches/:ordinal/dispatch` using service authority scoped to `dispatch_championship`. The API validates the persisted identity and current event state and launches only the returned game.
3. Duplicate/delayed deliveries reuse the existing match game. No voluntary-queue roster selection, newest-waiting lookup, precise-midnight gate, or recurring heartbeat.
4. Configure AWS `ActionAfterCompletion=DELETE`. Finished target invocation does not establish game completion. Keep match/result/audit history in PostgreSQL.
5. Pause disables/deletes future schedules and current event-state checks reject late wakeups. Resume registers remaining matches; correction revision changes invalidate older schedule payloads. Already accepted games continue. Finalization removes remaining obsolete external schedules.
6. Game completion calls exact championship settlement and award allocation. A future authenticated exact-game completion callback will allow durable redelivery without launching games. Canonical state, not callback assertions, establishes completion.

Scheduling remains plan-only: the existing 30-second championship loop is unchanged in this retry patch. The proposed descriptor service, exact scheduled wake endpoint, schedule registration and removal of that loop are not implemented. Retry completion now also settles championship results directly; its failure retains canonical results for reconciliation.

## External implementation dependencies — not complete

The inspected `feat/on-demand-worker-migration` checkout at `71cd3c0` contains a plan only, with no exact-game launcher API/runtime. Coordination with the storage migration task confirmed no overlapping changes to championship, startup adoption or ownership code.

The dedicated Lambda is planned, not implemented. Existing free-game handlers are untouched. Scheduling descriptors and a Lambda draft were briefly created before scope was clarified, then removed; no scheduler changes remain.

Still required in False Floor infrastructure / the worker migration:

- Durable activation/pause/final cleanup controller consuming the schedule intents. Application activation alone currently does NOT install AWS schedules.
- Dedicated Lambda definition/artifact publisher entries, narrowly scoped invocation and SSM permissions, Scheduler group/role, retries and dead-letter destination. No existing free-queue role is broadened by this work.
- A durable launch controller that accepts exact game IDs, invokes Fargate with a stable RunTask token and pinned task definition, and maps task state-change events to completion/recovery.
- Explicit retry of uncertain delivery and crash windows, including death after game acceptance but before task submission, and after canonical completion but before awards callback. This must be event-driven; do not substitute a DB outbox polling loop. A durable workflow or event-backed delivery queue is appropriate.
- Actual Fargate game entrypoint, networking/secrets, graceful stop and no unrelated startup sweep. Existing renderer infrastructure is not that implementation.

Until those pieces are wired, AWS scheduling and production on-demand execution are not ready. Local retry can be tested through its explicit action. Existing championship dispatch still uses its current worker-adoption path; this patch does not convert that path to event-driven execution. No infrastructure, schedule or production game has been created.

## Verification

Use a disposable fixture database, never the running development data or another test process's database. Exercise authenticated retry -> replacement -> exact launch -> canonical completion -> standings using supported provider-free agents. Verify concurrent clicks, lost delivery, revoked ownership, immutable original transcript, frozen identity/roles after owner edits, ordinary games, settlement protection, and the proposed duplicate/delayed/stale scheduled payloads when scheduling is implemented. UI tests cover retry errors, repeated delivery and mounted page controls. AWS deployment verification remains pending and must not be represented by mocked HTTP tests.

Scope clarification during implementation: only failed-game retry is authorized for code changes. Scheduling remains a plan. Its temporary descriptor/Lambda drafts were removed before any commit or deployment. The existing scheduling runtime remains untouched. Exact-game launch and completion handling in this patch serve the retry flow.

Local execution also participates in normal process shutdown: cleanup waits for games owned by this process even when the process is a development gateway. This changes no server start/stop commands. The eventual Fargate adapter still owns its own task lifecycle and durable completion delivery.

### Scheduling draft inventory after clarification

Before scope was clarified, drafts existed for `championship-schedules.ts`, exact scheduled-dispatch and completion HTTP endpoints in `routes/championships.ts`, timer removal in `index.ts`, and `github-apps-championship/src/crons/championship-match.js` with a mocked HTTP test. These were removed/restored after the first clarification, before the subsequent request to retain drafts for review. They were never committed, deployed or activated. The sibling cron checkout is clean and the existing championship routes/timer have no scheduling diff.

Retained retry-required changes: an atomic match-preparation helper, exact-game local adoption, the external launch acknowledgement boundary, completion-to-championship settlement callbacks, and normal cleanup of locally launched games. These neither register schedules nor dispatch other matches. Further scheduling implementation awaits explicit direction.

## Verified local results (2026-11-04)

- Provider-free baseline: 3,328 passed, 5 skipped, 0 failed across 353 files.
- Full PostgreSQL baseline: 2,394 passed and 3 failed across 224 files. All three failures were stale public-profile fixture expectations from earlier badge/profile work; those fixtures were corrected.
- Final focused PostgreSQL rerun: 91 passed, 0 failed, 1,358 assertions across retry, launcher, startup adoption, postgame highlights and production MCP server tests. This includes all three corrected failures and the final launch ownership regressions. The entire PostgreSQL baseline was not repeated after those focused corrections.
- Earlier championship execution/retry rehearsal: 9 passed, 0 failed, 1,739 assertions, including all sixteen Werewolf fixture games and the Influence finale.
- Focused UI: 7 passed, 0 failed, 41 assertions. Existing localhost browser fixture verified keyboard retry, inline delivery failure, repeated original ID, replacement navigation and mobile layout; API responses were intercepted and no live game was retried.
- Final typecheck, lint, test classification and diff whitespace checks passed.

Only disposable fixture databases were explicitly migrated for this verification. No development-server start/stop commands, manual development-data changes, paid provider calls, AWS resources or production changes were performed. The running development app's watch/restart behavior was not managed by this task. Production launch receiver/Fargate integration and one-shot scheduling remain unimplemented as described above.
