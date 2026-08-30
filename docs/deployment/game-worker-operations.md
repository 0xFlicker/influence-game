# Game Worker Operations

Influence has three distinct runtime roles:

- **Gateway**: serves HTTP reads and commands plus WebSocket delivery. It is
  non-claiming and must run with `INFLUENCE_API_ROLE=gateway` (the image
  default).
- **Game worker**: runs the same API image with
  `INFLUENCE_API_ROLE=game-worker`. It is the only role that may adopt, resume,
  or advance durable games.
- **Render worker**: uses the separate render-worker image and its existing
  postgame-media claim/heartbeat protocol. It never acquires game-run leases.

## Durable execution contract

Game workers are interchangeable. A worker identity is process-local, but
execution authority is a renewable, fenced `game_run_owners` lease for one
game. Multiple game workers may therefore advance different games at once. A
worker may claim only a game with no active owner, a released owner, or an
expired owner. It must not displace a healthy owner.

The gateway accepts a start command only after ordinary readiness checks and
records the game as ready for a game worker. It does not acquire an execution
lease or run a turn. This makes an accidental local gateway or an additional
API replica safe against durable-game takeover.

`INFLUENCE_API_ROLE` is deliberately closed: use `gateway` or `game-worker`.
An invalid value fails process startup. The API image defaults to `gateway`;
production configuration must opt in explicitly for each game-worker replica.

## Local development

```bash
# Safe, non-claiming API gateway
bun run dev:api

# Explicit durable executor on a different local port
INFLUENCE_GAME_WORKER=1 bun run dev:game-worker

# Independent postgame renderer
bun run dev:render-worker
```

The game-worker helper exits unless `INFLUENCE_GAME_WORKER=1` is supplied.
Use a local database only. Starting an explicit worker against a shared
environment is an operational deployment decision, not a local debug shortcut.

Tests normally execute routes/services without starting a runtime role. Any
runtime-start integration test must name its role: gateway tests prove no
adoption, and game-worker tests prove claim/recovery behavior against a
dedicated test database.

## End-to-end local game-worker rehearsal

Use this runbook to rehearse the gateway/worker boundary on one machine. It is
intentionally local-only: it uses a new PostgreSQL database, loopback ports,
mock game agents, and locally minted test tokens. It is **not** a deployment
procedure or evidence that staging or production is safe.

> **Hard stop:** never point `DATABASE_URL` or `TEST_DATABASE_URL` below at a
> shared development, staging, or production database. Do not use Doppler,
> a shared service URL, a real provider credential, or a deployment controller
> token. Do not reuse the normal `influence_test` database. If a value does
> not explicitly name the rehearsal database and `127.0.0.1:54320`, stop.

### 1. Create isolated resources

Set two explicitly local URLs, then run the guarded setup script from
`packages/api`. Choose a unique suffix if another rehearsal is already in
progress.

```bash
export REHEARSAL_URL=postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_manual
export REHEARSAL_TEST_URL=postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_manual_tests
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts setup
```

Use a mock runner so this is a provider-free rehearsal. The following shell
values are deliberately throwaway and must not be copied into a deployment
environment:

```bash
export JWT_SECRET=rehearsal-jwt-secret
export ADMIN_ADDRESS=0x1234567890123456789012345678901234567890
export PRIVY_APP_ID=rehearsal PRIVY_APP_SECRET=rehearsal
export MANAGED_AUTH_MODE=disabled INFLUENCE_API_TEST_MOCK_RUNNER=true
export INFLUENCE_STORAGE_BACKEND=disabled
export POSTGAME_MEDIA_WORKER_TOKEN=rehearsal-worker
```

### 2. Start one gateway and prove its role

In terminal A, start only a loopback gateway:

```bash
DATABASE_URL="$REHEARSAL_URL" bun run dev:gateway
# In another terminal:
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts health:gateway
```

Expected evidence: HTTP 200 and a health payload whose runtime role is
`gateway`. There must be no game worker startup/adoption log line.

Seed a disposable admin and mint a local session token:

```bash
export REHEARSAL_GAME_ID="$(bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts fixture)"
```

The fixture script creates, fills, and starts a Two Names-capable game with a
legal companion format. Its output is the game ID.

Expected evidence: the start response is `in_progress`, while the local
`game_run_owners` query for `REHEARSAL_GAME_ID` has zero active rows. A gateway
accepts the command but never claims execution.

### 3. Claim, advance, and exclude a second worker

In terminal B, start the dedicated worker on a different loopback port:

```bash
DATABASE_URL="$REHEARSAL_URL" bun run dev:game-worker
# In another terminal:
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts health:worker
```

Expected evidence: HTTP 200 with role `game-worker`; startup reports one
adopted in-progress game; `game_run_owners` has one `active` row with a
worker `process_id`; and `game_execution_states.committed_turn_sequence` is
greater than zero. Attempt a claim using a second worker identity while that
row is healthy. It must fail with `code: "game_owned"` / HTTP 409; it must
not replace the owner epoch.

```bash
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts contention
```

### 4. Drain the worker and capture the per-worker receipt

Mint a local deployment-control token, then acquire a synthetic local lease
through the gateway. The provenance below is test data only; it is not a
release request.

```bash
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts drain:acquire
# Save the returned lease id/fencing token as REHEARSAL_LEASE_ID/REHEARSAL_FENCE.
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts drain:status
```

Poll the final GET until it returns top-level `state: "drained"`, matching
`observedLease.id` and `observedLease.fencingToken`, a non-empty
`claimsStoppedAt`, and `ownedGameCount: 0`. Also confirm the prior active game
owner is `expired` or released. `activeGameCount: 0` alone is insufficient:
the authenticated receipt from *this worker* is the admission proof.

### 5. Replacement recovery after release

Stop terminal B after the receipt is drained, then release the synthetic lease
through terminal A:

```bash
bun run dev:game-worker:down
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts drain:release
REHEARSAL_WORKER_PORT=3102 DATABASE_URL="$REHEARSAL_URL" bun run dev:game-worker
```

Expected evidence: the replacement has a different `process_id` and new owner
epoch; it adopts only the released/expired in-progress game, never a healthy
one; and the deployment recovery reconciliation records one successful
attempt. Do not restart the drained worker before this check, or it can become
the valid replacement claimant after admission reopens.

```bash
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts recovery
```

### 6. Viewer reconnect and validation checklist

The playback director is deterministic and can be checked without a browser
server:

```bash
bun test packages/web/src/__tests__/format-presentation-director.test.ts
TEST_DATABASE_URL="$REHEARSAL_TEST_URL" bun run test:postgres
bun run check
```

Manually confirm every item before treating the rehearsal as passed:

- [ ] Gateway health proves `gateway`; worker health proves `game-worker`.
- [ ] Gateway start leaves zero active game-owner rows.
- [ ] Worker claims and advances a committed durable cursor.
- [ ] A healthy owner rejects the second worker with `game_owned`.
- [ ] Drain receipt is authenticated, current-fence matched, and reports
  `claimsStoppedAt` plus `ownedGameCount: 0`.
- [ ] Replacement recovery follows lease release/expiry and uses a new epoch.
- [ ] Paused, rewound playback retains its cue when reconnect adds a newer tail.
- [ ] Focused tests, full PostgreSQL tests, and `bun run check` pass.

### 7. Mandatory cleanup

Stop every local process on ports 3100–3102. Then drop only the exact
databases created in step 1. Never use a wildcard or a broad database name.
The gateway is foreground-only: stop it with Ctrl-C in its own terminal. The
worker can be stopped with Ctrl-C or `bun run dev:game-worker:down`; that
command signals only the PID recorded by the companion worker launcher.

```bash
bun run dev:game-worker:down
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts cleanup
```

Record the exact game ID, initial and replacement owner epochs, lease ID and
fencing token, drain JSON, reconciliation result, and test output with the PR.
Those local artifacts demonstrate the contract only; they never authorize a
merge, deployment, or host/cloud mutation.

## Staging and production rolling cutover

The repository supplies the runtime behavior; the release controller in
`linode-iac` owns orchestration, image selection, migration execution, and
process lifecycle. A safe game-worker release is:

1. Build and validate the API image and migrations. Keep gateways on the
   default `INFLUENCE_API_ROLE=gateway`; do not route public traffic to a game
   worker.
2. Start the new game-worker replica(s) with the exact accepted image,
   `INFLUENCE_API_ROLE=game-worker`, the current durable-contract
   configuration, and no public listener/routing requirement. They can become
   ready while old workers remain healthy.
3. Acquire the existing deployment-admission lease and enter `draining`.
   Gateways reject new game starts and game workers stop claiming new work. Do
   not force-expire healthy game owners.
4. Give old game workers their configured graceful-stop window. On shutdown a
   worker stops scans, aborts at a committed-turn boundary, and releases its
   own leases. It must not strand a game behind a healthy-owner takeover.
5. Query each old game worker's authenticated
   `GET /api/internal/deployment-control/game-worker-drain-status` endpoint.
   Proceed only when that specific worker reports `state: "drained"`, the
   current deployment lease as `observedLease`, `claimsStoppedAt`, and
   `ownedGameCount: 0`. This is distinct from the global
   deployment-admission `activeGameCount`: zero global games alone does not
   prove that a worker observed the drain or stopped claiming. Advance the
   validation/switch phases and complete the lease only after those worker
   acknowledgements. New workers then scan and claim only unowned, released,
   or genuinely expired games. A previous worker that was killed or
   partitioned remains fenced by its owner epoch.
6. Roll gateways independently; they remain non-claiming throughout. Replace
   render workers through their separate media-worker procedure, not this
   game-worker drain.

The external controller must enforce an orderly signal/termination grace that
is long enough for an in-flight provider attempt to reach its durable boundary,
wait for the deployment-admission drain proof, and pass the exact image and
migration identity to runtime activation. Application code cannot make a
hard-killed process release its lease, cannot provision worker replicas, and
cannot prevent a database outage; the lease expiry/fencing path covers those
failure cases without healthy-owner eviction.

## Hosting constraints

Gateways can be deployed independently of game workers, including in a
serverless or horizontally scaled topology, provided every gateway reaches the
same Postgres database and WebSocket clients reconnect to a gateway that reads
the durable publication stream. Game workers need a long-running process,
database connectivity, graceful signals, and a stable interval for lease
renewal/recovery scans. They should not be deployed as short-lived request
handlers. Render workers have their own long-running Chromium/ffmpeg resource
requirements and remain a separate capacity concern.
