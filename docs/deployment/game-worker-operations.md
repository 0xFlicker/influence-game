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
