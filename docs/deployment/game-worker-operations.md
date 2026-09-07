# Game Worker Operations

The `gateway` role serves HTTP/WebSocket commands and reads. It never claims,
resumes, or advances a game. The private `game-worker` role uses the **same API
image digest** and owns execution through renewable, per-game `game_run_owners`
leases. Render workers remain a separate image/service.

## Drain contract

Authenticated `GET /api/internal/deployment-control/game-worker-drain-status`
returns exactly these top-level fields on a game worker:

```json
{
  "version": 1,
  "state": "drained",
  "observedLease": { "id": "<active lease UUID>", "fencingToken": 7 },
  "claimsStoppedAt": "2026-09-06T16:00:00.000Z",
  "ownedGameCount": 0
}
```

- `version` is exactly `1`.
- `state` is `claiming`, `draining`, or `drained`.
- `observedLease` is null while claiming; otherwise it has exactly `id` and
  `fencingToken`, matching the active deployment lease.
- `claimsStoppedAt` is null while claiming, otherwise an ISO timestamp.
- `ownedGameCount` is null before a successful ownership read, a nonnegative
  integer after that read, and exactly zero before `drained` is reported.

During any active admission-lease phase, workers stop claiming new games. The
claim transaction checks admission, so a scan that started before closure cannot
claim afterward. The next scan (normally within two seconds) acknowledges the
lease. Already owned games continue and heartbeat until their normal terminal
state; release drain never aborts or relinquishes them. A failed ownership read
cannot certify a drain. Admission reopening clears the acknowledgement.

An authenticated gateway call returns HTTP 409 exactly:

```json
{
  "error": "This API runtime is not an active game worker",
  "code": "game_worker_not_running",
  "retryable": false
}
```

Unauthenticated requests return 401. Drain responses are observations, not stored
receipts or release authority. IaC checks every actual worker against this V1
contract before stopping the retiring generation.

The authenticated `/api/internal/deployment-control/status` also reports
`activeGameOwnerCount`. This counts active owner rows, including an owner whose
lease has expired but has not yet been reconciled. `activeGameCount` still counts
all `in_progress` games. An admitted, unclaimed game survives a release as queued
work; it must not hold up a dedicated-worker drain. The switching transaction
requires zero active owner rows. First conversion from a combined API still
requires the old process's global game drain and stop before any new worker.

## Local operator checklist: existing Doppler dev database

**API startup applies migrations to the configured database.** Use your existing
populated `social-strategy-agent` / `dev` database and review its normal backup
before starting this branch. No isolated dev database or fabricated administrator
is required. The commands below can process any runnable game in that database;
choose disposable games and use your real signed-in account. Real model calls
incur the configured provider costs. Automated suites use their own test database.

Run from the clean application worktree. Ordinary lifecycle commands already wrap
`doppler run --project social-strategy-agent --config dev --`; do not wrap them a
second time. Each process stays in its own terminal and stops with Ctrl-C.

1. Start the gateway and web **with no game worker**:

   ```bash
   bun run dev:gateway
   # In another terminal:
   bun run dev:web
   ```

   Open `http://127.0.0.1:3001`, sign in normally, create a disposable game with
   at least eight players, and select only **Two Names** in the format rotation.
   Request Start. Record the real game ID from the game page/network request.

2. Prove the gateway does not execute it. Observe no new canonical game events
   and no active owner over several scan intervals. This read-only query accepts
   your actual game ID (export `GAME_ID` first):

   ```bash
   doppler run --project social-strategy-agent --config dev -- \
     sh -c 'psql "$DATABASE_URL" -v game_id="$GAME_ID"' <<'SQL'
   SELECT game_id, process_id, owner_epoch, status, expires_at
   FROM game_run_owners WHERE game_id = :'game_id';
   SQL
   ```

   The game may already be `in_progress`; that is an admitted request, not proof
   of execution. The gateway's worker-status endpoint must return authenticated
   `409 game_worker_not_running`:

   ```bash
   doppler run --project social-strategy-agent --config dev -- \
     bun scripts/game-worker-control.ts worker-status
   ```

3. Start a worker and verify it creates an active owner row and advances the
   game's canonical event sequence:

   ```bash
   bun run dev:game-worker
   ```

   Let the Two Names game finish. Inspect both Mingle windows, Override or pass,
   final pair, pleas, locked-target ballot, elimination, and terminal result.
   Verify the owner closes. Template/provider-free tests are separate evidence
   from this live-provider operator run.

4. Prove concurrent workers and fencing. With worker A running on 3002, start a
   second disposable game and wait for A to own it. Start B on 3003, then Ctrl-C
   A and watch B resume the same game from its committed cursor with a new owner
   epoch. Restart A on 3002 and request another disposable game. Check that the
   original healthy owner is unchanged and the two processes can own different
   games. Do not assume which worker wins a fresh claim; repeat a disposable
   start if necessary. Per-game concurrent-claim regression tests below prove
   that only one owner wins a race.

   ```bash
   PORT=3003 bun run dev:game-worker
   ```

5. Keep an actively owned disposable game running. Gather real local audit
   provenance (use an actual IaC workflow run and its actual attempt):

   ```bash
   gh api user --jq .login
   gh api 'repos/0xFlicker/linode-iac/actions/runs?per_page=5' --jq '.workflow_runs[] | {id, run_attempt}'
   git rev-parse HEAD
   ```

   Pass those returned values to acquire; this is the existing scoped service
   identity, signed in memory from Doppler dev, not a user/admin impersonation:

   ```bash
   doppler run --project social-strategy-agent --config dev -- \
     bun scripts/game-worker-control.ts acquire \
     --candidate "$CANDIDATE_SHA" --actor "$ACTOR" \
     --run-id "$WORKFLOW_RUN_ID" --run-attempt "$WORKFLOW_RUN_ATTEMPT"
   ```

   Copy the returned lease ID and fencing token to `LEASE_ID` and `FENCE`. In a
   separate terminal, keep the lease alive:

   ```bash
   doppler run --project social-strategy-agent --config dev -- \
     bun scripts/game-worker-control.ts heartbeat --lease-id "$LEASE_ID" --fence "$FENCE"
   ```

6. Poll each running worker; the active game must keep advancing under the same
   owner while new game starts/claims are blocked:

   ```bash
   doppler run --project social-strategy-agent --config dev -- \
     bun scripts/game-worker-control.ts worker-status --url http://127.0.0.1:3002
   # Repeat for http://127.0.0.1:3003 if B is running.
   ```

   Require the matching fence, `draining` with positive ownership, then normal
   terminal completion followed by `drained` and `ownedGameCount: 0`.

7. Ctrl-C **all old workers after each is drained**, confirm their terminals
   exited, then start the replacement with `bun run dev:game-worker`. Leave
   admission closed until the replacement is up. Stop the heartbeat loop and
   explicitly release the same lease:

   ```bash
   doppler run --project social-strategy-agent --config dev -- \
     bun scripts/game-worker-control.ts release --lease-id "$LEASE_ID" --fence "$FENCE"
   ```

   Request another disposable start and prove replacement claiming resumes.
   If a rehearsal fails, stop the heartbeat and release its pre-switch lease;
   do not edit owner rows to manufacture a successful drain.

8. In the viewer, pause and rewind to an earlier cue. Disconnect/reconnect the
   browser network while the game continues. The selected cue must remain in
   place until you explicitly choose live playback. Repeat in a completed game.

9. Run the actual suites from the clean app checkout:

   ```bash
   bun run test
   bun run test:postgres
   bun run check
   bun run test:browser:api
   bun run test:e2e:identity
   bun run test:e2e:layered-auth
   bun run test:e2e:format-viewer
   docker build -f Dockerfile.render-worker -t influence-render-worker:local-check .
   docker run --rm --entrypoint sh influence-render-worker:local-check -ec 'ffmpeg -version >/dev/null; chromium --version >/dev/null; test "$(find /app/music/house-highlights-variants -name "*.m4a" | wc -l)" -ge 24'
   ```

   Run the IaC shell/controller/OpenTofu and Compose checks in its
   `docs/worker-aware-release-local-checklist.md`. Bun-process tests are not
   Docker runtime or Linux/systemd handoff proof.

## Release sequence

Merge the worker-aware IaC change before the app change so the non-claiming API
image has a dedicated worker when it reaches staging. This document does not
perform or authorize a merge or deployment.

Staging closes and heartbeats admission, drains the old worker generation (or
legacy combined runner), drains and stops the old render worker, stops the old
application stack, starts the new gateway/web/render stack, starts and verifies
private game workers, and reopens admission. The existing staging receipt remains.

Production keeps the existing colored ingress and qualification/approval flow.
A failed clean-switch qualification fails closed; an explicit break-glass action
is separate. Under closed admission, old games finish, old game workers prove
zero ownership and stop, and the old render worker drains/stops before any worker
replacement starts. The controller switches API/web colors, verifies replacements
using the exact API/render digests, and reopens admission. After the retiring
color is irreversibly retired, recovery finishes the candidate rather than
reviving an old combined runner beside a new worker. No old/new game or render
worker generations overlap. Real qualified-image Linux/systemd rehearsal remains
separate from local source, test, and Compose-parser checks.
