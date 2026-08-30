# LOCAL WORKER CUTOVER CHECKLIST

This is a **source-process rehearsal** of gateway/worker roles, durable leases,
and drain acknowledgement against the existing local development database. It
is not Docker, image, staging, production, or deployment evidence. Validate
container images and the colored worker lifecycle in the Linode IaC checklist.

> **Hard stop:** every command below uses Doppler
> `social-strategy-agent/dev`, whose documented database is loopback
> `127.0.0.1:54320/influence_dev`. The helper prints only project/config and
> database host/port/name—never credentials. It refuses any other Doppler
> selection or database. It never creates, drops, migrates, truncates, or
> terminates database connections.

> **No unrelated work:** preflight fails if it finds any waiting, in-progress,
> suspended, or actively owned game that is not the selected fixture. Do not
> bypass that failure. This prevents the rehearsal worker from adopting or
> mutating an existing development game.

## Prerequisites

- Doppler is authenticated for `social-strategy-agent/dev`; do not export or
  copy `JWT_SECRET`, `ADMIN_ADDRESS`, Privy credentials, or a database URL.
  The configured development secrets are injected by `bun run rehearsal`.
- Local PostgreSQL is listening on `127.0.0.1:54320`.
- Use three terminals: gateway (A), worker (B), and commands/evidence (C). A
  fourth terminal is needed for replacement-worker recovery.

`ADMIN_ADDRESS` remains required by API startup and RBAC seeding. The helper's
`readRehearsalAdminAddress` reads that non-displayed value from Doppler dev; it
does not invent or print a rehearsal wallet.

## Checklist

### 1. Inventory the selected development environment

In terminal C:

```bash
bun run rehearsal -- preflight
```

Expected: JSON identifies `social-strategy-agent`, `dev`, and
`127.0.0.1:54320/influence_dev`, then exits successfully only when the runnable
inventory is empty. If it lists a game or active owner, stop. The developer
database already contains unrelated work and this rehearsal must not run.

- [ ] Doppler/dev and loopback database identity recorded.
- [ ] Runnable-game and active-owner inventory is empty.

### 2. Start the non-claiming gateway and create one marked fixture

In terminal A:

```bash
bun run dev:gateway
```

In terminal C:

```bash
bun run rehearsal -- health:gateway
export REHEARSAL_FIXTURE_GAME_ID="$(bun run rehearsal -- fixture)"
```

Expected: gateway health reports `runtimeRole: "gateway"`. Fixture creation
reruns the empty-inventory guard, creates a unique
`local-worker-rehearsal-<uuid>` user marker, and returns only the new game ID
on stdout. Copy the emitted `fixtureMarker` value from stderr into terminal C:

```bash
export REHEARSAL_FIXTURE_MARKER='local-worker-rehearsal-<uuid-from-fixture-output>'
```

It uses the normal development provider/runtime configuration—no mock runner is
silently enabled. Treat this as an intentional development-data write and
record both the marker and `REHEARSAL_FIXTURE_GAME_ID`.

- [ ] Gateway role and the unique fixture identity recorded.
- [ ] Fixture start is accepted with no worker claim.

### 3. Prove fixture isolation and start the worker

In terminal C, rerun preflight with the selected fixture:

```bash
bun run rehearsal -- preflight
```

In terminal B:

```bash
REHEARSAL_FIXTURE_GAME_ID="$REHEARSAL_FIXTURE_GAME_ID" \
REHEARSAL_FIXTURE_MARKER="$REHEARSAL_FIXTURE_MARKER" \
bun run dev:game-worker
```

The worker repeats the inventory immediately before startup. It exits if any
other runnable game or active owner appeared after preflight, if the fixture ID
is absent, if any runnable row does not belong to the recorded fixture, or if
the fixture's recorded creator does not exactly match
`REHEARSAL_FIXTURE_MARKER`. It never has a switch or acknowledgement that
permits adopting pre-existing work.

In terminal C:

```bash
bun run rehearsal -- health:worker
bun run rehearsal -- contention
```

Expected: worker health reports `runtimeRole: "game-worker"`; the fixture
advances; and contention returns `game_owned` without replacing the healthy
owner epoch.

- [ ] Fixture-only worker preflight recorded.
- [ ] Healthy-owner contention rejection recorded.

### 4. Acquire drain and record the authenticated receipt

In terminal C:

```bash
bun run rehearsal -- drain:acquire
export REHEARSAL_LEASE_ID='replace-with-lease-id-from-output'
export REHEARSAL_FENCE='replace-with-fencing-token-from-output'
bun run rehearsal -- drain:status
```

Expected: the receipt has top-level `state: "drained"`, matching
`observedLease.id` and `observedLease.fencingToken`, a non-empty
`claimsStoppedAt`, and `ownedGameCount: 0`. Keep the old worker alive while
polling. Do not use SIGTERM to trigger drain: source shutdown removes the HTTP
surface before a controller can record the receipt.

### 5. Stop the old worker, release admission, and start the replacement

After recording the drained receipt, stop the foreground worker in terminal B
with Ctrl-C. Then in terminal C:

```bash
bun run rehearsal -- drain:release
```

In terminal D:

```bash
REHEARSAL_WORKER_PORT=3102 \
REHEARSAL_FIXTURE_GAME_ID="$REHEARSAL_FIXTURE_GAME_ID" \
REHEARSAL_FIXTURE_MARKER="$REHEARSAL_FIXTURE_MARKER" \
bun run dev:game-worker
```

In terminal C:

```bash
REHEARSAL_WORKER_PORT=3102 bun run rehearsal -- health:worker
bun run rehearsal -- recovery
```

Expected: only the selected fixture moves to a new owner epoch. The helper
rechecks the isolation inventory before release and recovery.

### 6. Validate and retain evidence

Run the focused provider-free checks:

```bash
bun test scripts/local-game-worker-rehearsal.test.ts
bun test packages/web/src/__tests__/format-presentation-director.test.ts
```

Record the preflight JSON, fixture marker and ID, owner epochs, lease fence,
drain receipt, contention result, recovery result, and test output. Stop the
gateway and replacement worker with Ctrl-C.

There is deliberately **no database cleanup command**. Fixture records remain
in `influence_dev`; deleting them safely requires an explicit, referentially
complete cleanup procedure and is out of scope for this rehearsal.

## Release order

Do not merge Influence PR #129 until the worker-aware colored-flow PR is green,
reviewed, and merged to `linode-iac/main` without deploying. Then merge this
app PR, validate staging through the updated IaC, and seek explicit operator
approval before production.
