# Event-driven championship scheduling

Implemented source, not a deployed AWS service. The championship's 30-second match-discovery timer has been removed. Artwork preparation remains its existing separate pre-competition process.

## Authority and lifecycle

Activation persists the running event and its exact 17-match ledger, then requests scheduling. This ledger is the durable intent; no database outbox poll is required. Production sends an authenticated request to the dedicated controller ingress. It acknowledges only after SQS accepts the event identity. Registration is asynchronous: `accepted` does not mean all AWS schedules already exist. If the API dies between commit and queue acceptance, repeat the idempotent activation or use the existing Reconcile this event action. The UI retains failed operations for retry.

The dedicated controller fetches the current authenticated manifest, creates deterministic one-shot EventBridge Scheduler registrations, and removes obsolete registrations for that event. Each delivery contains the event ID, match ID, ordinal, result revision, original scheduled time and manifest version. EventBridge sends to a dedicated durable SQS queue, whose Lambda calls the exact dispatch API. There is no recurring schedule or worker game-discovery dependency. The queue is an event source, not an application polling loop.

A due-time wake atomically verifies identity against the locked event/match ledger, prepares the frozen game once, and explicitly launches that game. Duplicates and uncertain acknowledgements reuse its game ID. Early delivery retries; late delivery catches up. Midnight UTC remains the calendar default, not a narrow acceptance window. A paused, corrected or obsolete wake cannot create a new attempt. Crashed gameplay is not rerolled by the scheduler; the existing Retry game action remains explicit.

Pause immediately fences future starts in PostgreSQL, then asks the controller to remove future registrations. Already accepted games continue. Resume reinstalls remaining work. Match correction changes the manifest identity and requests fresh reconciliation. Completed matches are omitted; final completion removes remaining registrations. `ActionAfterCompletion=DELETE` removes the AWS one-shot after target delivery, not after the game finishes.

Completion settles the canonical result and awards inline and, when configured, sends an exact-game completion message to the same durable ingress for redelivery. The completion endpoint never starts games. A process death before completion notification still requires canonical recovery/operator reconciliation today; future ECS task-stop events must wake that exact-game reconciliation independently. No claim of a completed Fargate lifecycle is made here.

## Today's runtime and future Fargate boundary

`INFLUENCE_GAME_LAUNCH_URL` / `INFLUENCE_GAME_LAUNCH_TOKEN` choose the exact-game launcher. Today's game-worker API exposes `POST /api/internal/championships/games/launch` with `{gameId}`. It uses normal durable ownership/adoption. Production gateway processes reject that local execution endpoint; configure the existing game-worker receiver, or the future durable Fargate launcher. The external receiver must acknowledge `{accepted:true,gameId}` only after accepting that exact execution. It never chooses a waiting game.

A future Fargate launcher can keep this contract, durably submit one task for the game and acquire the same owner fence. Its task entrypoint must omit broad startup adoption and legacy worker scans. Task-stop/completion delivery, task definitions, network and secrets remain part of that separate migration.

## Localhost

Without external scheduler credentials, development activation uses one API-owned timer per exact match. Local adapters are limited to NODE_ENV=development/test or an unlabelled environment with a loopback DATABASE_URL; explicit staging, production and unknown environments cannot fall back locally. Deployed gateways cannot execute the launch endpoint even with a valid service token. It records `local_scheduler_enabled` in the existing audit ledger before arming timers. Gateway startup restores only explicitly registered local events once; it does not activate legacy events. Long delays are bounded by the platform timer limit and rearmed for the same future timestamp. Failed delivery rearms only that exact delivery. Pause clears that event's pending timers.

This adapter needs the normal API to be running, but no always-on game-worker process for championship dispatch. It exercises the same frozen admission, exact launch and settlement. It is not proof that AWS Scheduler has been deployed. Production cannot silently fall back to local timers.

## API and credentials

Migration `0152_championship_service.sql` additively permits the `championship` service-principal purpose; it preserves existing free-queue principals. The operator-only `createChampionshipServiceToken` helper requires an enabled championship principal and an explicit future expiry covering the event and recovery window. It issues only `dispatch_championship`, with no human roles. Provisioning credentials remains an operator step; implementation does not create a live principal or token.

Internal routes authenticate the service and permission explicitly:

- GET `/api/internal/championships/:eventId/schedules`
- POST `/api/internal/championships/:eventId/matches/:ordinal/dispatch`
- POST `/api/internal/championships/games/launch`
- POST `/api/internal/championships/games/:gameId/complete`

Production controller ingress uses `CHAMPIONSHIP_SCHEDULER_URL` and `CHAMPIONSHIP_SCHEDULER_TOKEN`. The latter is a separate bearer secret, not the API service token. Redirects are rejected and HTTP deadlines are bounded. Roles, builds, provider secrets and future lineup order are absent from scheduling messages.

## Infrastructure and rollout

Source lives in the separate `falsefloor/infra` championship worktree (`championship/`, `infra/house-championship-*`). It follows the current House CDK target, account 978355607658 / us-west-1, rather than modifying the legacy us-east-1 free-game crons. Resources: isolated schedule group, ingress/controller Lambdas, FIFO delivery queue, delivery DLQ, standard Scheduler DLQ, alarms and dedicated IAM. Mutations are scoped to the group's `champ-*` schedules; PassRole is restricted to its Scheduler role. ListSchedules alone requires wildcard resource scope. No free-game IAM or handler is repurposed.

Deployment and new IAM provisioning require the separate operator review under infra/AGENTS.md. No AWS resource was created by implementation. Staging's private tailnet API needs an approved reachable controller network path before deployment; the stack does not pretend a public Lambda can reach it. Configure API/service/ingress credentials and an actual reachable exact-game launcher, then test one disposable event. Do not activate production as a deployment smoke test.

Recovery: inspect controller/Scheduler DLQs and alarms, repair the underlying failure, then redrive the saved message. Repeating event synchronization reads current state, so old pause/activate notifications cannot reverse a newer decision. Inspect real AWS registration and delivery logs in staging before claiming cloud scheduling verified.

## Local verification (2026-11-04)

A disposable, unpublished local event with eight explicitly marked fixture agents used the real activation API and one-shot timer. Its first match was accepted seven milliseconds after its scheduled timestamp. The test paused the event after acceptance; none of the other sixteen matches started. The live provider run exposed a provider-journal/owner lock inversion, fixed separately in `29b5c481` with a deterministic failing-before/passing-after PostgreSQL regression.

The replacement then completed through the actual API/runtime: 94 canonical events, eight unique championship results tied only to the current attempt, unchanged frozen roles, no season rating, and a closed healthy owner. All 80 provider attempts were terminal. The anonymous game page displayed Completed and replay/results links. Failed attempts and provider evidence remain retained; test records are clearly marked and existing user competitions were not altered. Local evidence is retained under `artifacts/championship/scheduler-live/verified.json`.

This verifies the development one-shot adapter and shared admission/launch/settlement path. AWS controller tests and credential-free CDK synthesis verify source wiring, not a deployed EventBridge delivery. A real cloud delivery remains pending the rollout prerequisites above.

Final validation: 2,409 PostgreSQL tests passed (226 files, 34,271 assertions); 3,328 provider-free tests passed with 5 skipped; 95 focused runtime/ownership tests passed; 32 focused championship tests passed; and 7 focused UI tests passed. Infra baseline: 86 passed; dedicated controller/stack tests: 7 passed. Both repositories' checks, the Lambda bundle, credential-free synthesis, and whitespace checks passed. The first sandboxed provider-free attempt could not open loopback listeners; the permitted rerun passed.
