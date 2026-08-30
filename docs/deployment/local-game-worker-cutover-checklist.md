# LOCAL WORKER CUTOVER CHECKLIST

Use this short checklist for a **local-only** rehearsal of the gateway and
dedicated game-worker cutover. The fuller background and troubleshooting guide
is [game-worker operations](game-worker-operations.md).

> **Hard stop:** use only `127.0.0.1:54320` databases named
> `influence_rehearsal_*`. Never use Doppler, shared development, staging, or
> production credentials, databases, deployment tokens, hosts, or cloud
> controls. This checklist does not authorize a merge or deployment.

## Prerequisites

- Bun dependencies are installed and local PostgreSQL is listening on
  `127.0.0.1:54320`.
- Use three terminals whose shells retain the variables below: gateway (A), old
  worker (B), and commands/evidence (C). Use a fourth terminal for the
  replacement worker.
- Pick a unique, lowercase database suffix if another rehearsal is running.

## Checklist

### 1. Create isolated databases

In terminal C, set throwaway local-only values and create the isolated
databases. Repeat these exports in every terminal that starts a gateway or
worker (or source the same local-only shell setup there):

```bash
export REHEARSAL_URL=postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_manual
export REHEARSAL_TEST_URL=postgresql://influence:influence@127.0.0.1:54320/influence_rehearsal_manual_tests
export JWT_SECRET=rehearsal-jwt-secret
export ADMIN_ADDRESS=0x1234567890123456789012345678901234567890
export PRIVY_APP_ID=rehearsal PRIVY_APP_SECRET=rehearsal
export MANAGED_AUTH_MODE=disabled INFLUENCE_API_TEST_MOCK_RUNNER=true
export INFLUENCE_STORAGE_BACKEND=disabled POSTGAME_MEDIA_WORKER_TOKEN=rehearsal-worker
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts setup
```

Expected: setup creates and migrates only the two named `influence_rehearsal_*`
databases. Stop if the URL or database name differs.

- [ ] Isolated setup succeeded.

### 2. Prove the old gateway accepts but never claims

In terminal A:

```bash
DATABASE_URL="$REHEARSAL_URL" bun run dev:gateway
```

In terminal C:

```bash
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts health:gateway
export REHEARSAL_GAME_ID="$(bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts fixture)"
```

Expected: health returns HTTP 200 with `runtimeRole: "gateway"`; fixture prints a
game ID and the gateway reports the game in progress. Before any worker starts,
there is no worker adoption/claim log for that game.

- [ ] Gateway role proved and fixture game ID recorded.
- [ ] Start was accepted without a worker claim.

### 3. Start the old worker, advance, and prove healthy-owner exclusion

In terminal B:

```bash
export REHEARSAL_API_IMAGE_DIGEST="sha256:replace-with-the-exact-old-worker-digest"
INFLUENCE_API_IMAGE_DIGEST="$REHEARSAL_API_IMAGE_DIGEST" DATABASE_URL="$REHEARSAL_URL" bun run dev:game-worker
```

In terminal C:

```bash
export REHEARSAL_API_IMAGE_DIGEST="sha256:replace-with-the-exact-old-worker-digest"
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts health:worker
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts contention
```

Expected: worker health returns HTTP 200 with `runtimeRole: "game-worker"` and
the exact `releaseControl.imageDigest` exported above; terminal B shows the game
being adopted and committed work advancing. `contention`
reports a rejected contender with `code: "game_owned"` (HTTP 409), without
replacing the healthy owner epoch.

- [ ] Old worker role, adoption, and advancement recorded.
- [ ] Healthy-owner contention rejection recorded.

### 4. Acquire local drain and capture the old-worker receipt

In terminal C:

```bash
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts drain:acquire
export REHEARSAL_LEASE_ID='replace-with-lease-id-from-output'
export REHEARSAL_FENCE='replace-with-fencing-token-from-output'
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts drain:status
```

Expected: the authenticated worker receipt reports top-level `state: "drained"`,
the same `observedLease.id` and `observedLease.fencingToken`, a non-empty
`claimsStoppedAt`, and `ownedGameCount: 0`. A global active-game count alone is
not sufficient. Replace each quoted placeholder above before running the
status command. Keep the old worker serving this authenticated receipt while
the normal two-second worker scan observes the global lease and drains it.
Do not send SIGTERM (or run the worker down command) to trigger drain: SIGTERM
starts API shutdown and ends the time in which the receipt can be polled.

- [ ] Lease ID and fencing token recorded.
- [ ] Old-worker drained receipt with the matching fence recorded.

### 5. Stop old worker, release admission, and start replacement

Only after the matching drained receipt is recorded, stop the worker that
terminal B started. The required order is: acquire admission -> poll every old
worker's authenticated receipt -> stop old worker -> release admission ->
start replacement. Never reverse the receipt and stop steps.

```bash
bun run dev:game-worker:down
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts drain:release
```

`dev:game-worker:down` signals only the PID tracked by the companion local
launcher; Ctrl-C in terminal B is also valid. Do not use `pkill`, port-kill
commands, or any broad process command.

In terminal D, start the replacement on a different local port:

```bash
export REHEARSAL_API_IMAGE_DIGEST="sha256:replace-with-the-exact-accepted-candidate-digest"
GAME_WORKER_PORT=3102 INFLUENCE_API_IMAGE_DIGEST="$REHEARSAL_API_IMAGE_DIGEST" DATABASE_URL="$REHEARSAL_URL" bun run dev:game-worker
```

In terminal C:

```bash
export REHEARSAL_API_IMAGE_DIGEST="sha256:replace-with-the-exact-accepted-candidate-digest"
export REHEARSAL_WORKER_PORT=3102
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts health:worker
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts recovery
```

Expected: the replacement health receipt proves `runtimeRole: "game-worker"`
and the exact accepted candidate digest before recovery. It then adopts only
released or expired work, has a new `process_id` and owner epoch, and recovery
reports a successful reconciliation. It must not steal a healthy owner.

- [ ] Old worker stopped only through its local lifecycle control.
- [ ] Admission released and replacement recovery recorded.
- [ ] New owner identity/epoch and healthy-owner fence recorded.

### 6. Check paused/rewound viewer reconnect retention

Run the focused existing playback check in terminal C:

```bash
bun test packages/web/src/__tests__/format-presentation-director.test.ts
```

Expected: the test passes, proving a paused/rewound viewer retains its cue
when reconnect adds a newer tail.

- [ ] Viewer reconnect result recorded.

### 7. Collect evidence and clean up safely

Record the game ID, old and replacement `process_id`/owner epoch, lease ID,
fencing token, drained receipt JSON, contention result, recovery result, and
viewer-test output with the PR or local rehearsal notes. These are local
contract evidence only.

Stop terminal A with Ctrl-C, then stop the tracked replacement worker and drop
only the exact rehearsal databases:

```bash
bun run dev:game-worker:down
bun run --cwd packages/api src/scripts/local-game-worker-rehearsal.ts cleanup
```

Expected: the guarded cleanup removes only the two `influence_rehearsal_*`
databases named in step 1. If the guard rejects a URL, leave it rejected and
inspect the value; never bypass it.

- [ ] Gateway and replacement worker stopped.
- [ ] Guarded cleanup succeeded.
