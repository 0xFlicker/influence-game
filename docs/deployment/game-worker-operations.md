# Game Worker Operations

Influence runs the API in two explicit roles:

- `gateway` serves HTTP and WebSocket traffic and never claims durable games.
- `game-worker` claims, resumes, and advances durable games without receiving public traffic.

Render workers remain a separate service with their existing media-job lease.

## Local development

Run each process in its own terminal:

```bash
bun run dev:api
bun run dev:game-worker
bun run dev:render-worker
```

`bun run dev:game-worker` directly starts the ordinary game-worker runtime on
port 3002 against the Doppler `dev` database. It has no acknowledgement flag,
fixture registry, or companion shutdown command. Stop it with Ctrl-C. To run a
second worker on the same machine, choose another port:

```bash
PORT=3003 bun run dev:game-worker
```

Two workers may run at once. Each durable game has one renewable, fenced
`game_run_owners` lease, so only the current owner may commit progress. The
command can process any runnable game in the configured development database;
do not point it at staging or production data.

## Release ordering

Merge the worker-aware `linode-iac` PR before this application PR. The API image
defaults to the non-claiming gateway role, so the dedicated worker plane must
exist before that image reaches staging.

The release controller owns the cutover:

1. Start the candidate gateway without a render or game worker.
2. Acquire the existing deployment-admission lease. Gateways reject new game
   starts and workers stop claiming new games.
3. Poll every running old game worker's authenticated
   `/api/internal/deployment-control/game-worker-drain-status` endpoint. Each
   response must contain the current lease ID and fencing token, a non-empty
   `claimsStoppedAt`, and `ownedGameCount: 0`.
4. Stop the old game-worker unit and confirm no old worker remains running.
5. Fully stop the old render worker before starting its replacement, then
   retire the old application color.
6. Start the replacement game worker from the qualified API digest and verify
   its replica count, image, role, health, token isolation, and private network.
7. Reopen admission only after the replacement worker is verified.

Drain responses are process-local coordination data. The controller discards
them after validation; they are not receipts, hashes, or accepted-release
evidence. The production journal records only the idempotent
`game_worker_stopped` and `game_worker_started` checkpoints.

Staging uses the same runtime split but keeps its existing linear deploy: stop
the old dedicated worker, restart the gateway/web/render stack, then start and
verify the replacement worker.
