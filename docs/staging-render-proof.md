# Isolated staging render proof

The ordinary API entrypoint and checked-in renderer policies remain unchanged.
`dist/staging-render-proof-api.js` is an explicitly selected, provider-free API
entrypoint for one completed, frozen trailer fixture. It registers renderer
control/claim/lease/upload/finalization, public media playback, and two authenticated
proof endpoints. It never starts game recovery, game workers, image/visual repair,
provider health, free-game queues, editorial work, or ordinary scheduler routes.

This source does not activate AWS, create cloud credentials, publish an image,
modify the tailnet, change the live staging database, or launch a render. A live
proof still requires the operator's separately reviewed release and handoff.

## Publication without ordinary deployment

First land the publication tooling while the main policy remains local. Create a
single commit on `proof/staging-render-<run>` from that trusted main revision,
changing only `deployment/render-execution.json`: staging local to remote, with
production still local and canonical tailnet origin unchanged. Keep that policy
commit out of main. Its PR receives normal credential-free checks.

After those checks pass, the owner may manually dispatch `ci.yml` on the exact
proof branch with `proof_publication=true`. The trusted-main verifier requires
one policy-only commit whose parent is on main. All normal check/provider-free/
PostgreSQL gates still apply. The three images use unique full-SHA/run/attempt
proof tags; no `:staging` tag moves, source-map upload or staging dispatch occurs.
The existing exact three-image release manifest format is preserved. This is an
image publication, not deployment, admission or proof execution.

The main-only staging ECR mirror accepts this successful owner-dispatched proof
run only after independently reading its commit, main ancestry and exact policy
diff from GitHub. It preserves the renderer digest and existing retention/storage
admission checks. Refresh native lifecycle previews and protect both retained and
incoming digests before copying; no unsafe expiry is authorized. Ordinary main
release and production evidence rules remain unchanged. Actual handoff must use
the isolated proof route, never the ordinary staging deploy workflow.

## Fresh database and fixture

Use the exact candidate's migration bundle. The CLI runs with Bun from
`packages/api` (or the corresponding immutable API image). Its inputs and outputs
are owned private regular files, with no symlinks or group/world permissions.
Database URLs never appear in command arguments or receipts.

1. Export one completed, public, visible, ready fixture from `influence_staging`:

   ```sh
   bun src/scripts/staging-render-proof.ts export --url-file /private/staging-read-url \
     --game-id APPROVED_COMPLETED_GAME_ID --output /private/render-fixture.json
   ```

   The source transaction is read-only. Export copies only the minimal completed
   game row and frozen snapshot provenance. It does not copy transcripts, players,
   upstream work, provider journals, repair requests, users, or storage keys. Old
   manifests unsupported by this renderer fail closed; select a ready fixture
   with a currently supported manifest rather than rebuilding it with models.

2. Prepare a private approval JSON with `runId` (8–32 lowercase letters/digits/
   underscores), exact 40-character `candidateSha`, `sourceRepository` equal to
   `0xFlicker/linode-iac`, positive `workflowRunId`/`workflowRunAttempt`, the exact
   staging `wakeUrl`, and these queue identities:
   `arn:aws:sqs:us-west-1:978355607658:house-render-staging-wakes` and
   `arn:aws:sqs:us-west-1:978355607658:house-render-staging-dead-letters` as
   `wakeQueueArn` and `deadLetterQueueArn`.

   ```sh
   bun src/scripts/staging-render-proof.ts prepare --url-file /private/approved-admin-url \
     --fixture /private/render-fixture.json --approval /private/proof-approval.json \
     --confirm CREATE_FRESH_PROOF_DATABASE --output /private/proof-identity.json
   ```

   Preparation refuses existing databases or principals. It creates
   `influence_render_proof_RUN_ID` and a separately owned, restricted `_api` role
   with **NOLOGIN**. Human secure login/password entry is separate. It never
   fabricates credentials. A partially failed preparation is retained for
   diagnosis; do not rerun with the same ID, force-drop, or reset it automatically.
   The administration URL must connect to `influence_staging`, with separately
   approved CREATEDB/CREATEROLE authority. Only the loopback PostgreSQL test
   service on port 54320 permits `postgres` for disposable local tests.

3. After approved secure credential entry, verify using the restricted URL file:

   ```sh
   bun src/scripts/staging-render-proof.ts verify --url-file /private/proof-runtime-url \
     --run-id RUN_ID --output /private/proof-database-verification.json
   ```

   Verification checks the exact database/principal, role flags/memberships,
   database/schema creation rights, table write grants, accessible security-definer
   functions, candidate migration fingerprint, immutable fixture, and the durable
   non-expiring switching admission fence. Every unrelated operational table must
   be empty. Unknown populated tables fail closed. This isolates granted objects;
   it does not rewrite PUBLIC privileges on other databases or claim that
   PostgreSQL forbids connecting to all databases with default PUBLIC CONNECT.

## Proof API and the single wake

The dedicated private environment selects `NODE_ENV=staging`,
`INFLUENCE_DEPLOYMENT_ENVIRONMENT=staging`, `INFLUENCE_RENDER_PROOF_RUN_ID`, the
restricted `DATABASE_URL`, exact image/commit identity, staging S3 configuration,
and separately entered worker/control/wake credentials. The image's renderer
configuration must use the canonical staging tailnet HTTPS origin. Remote mode
also requires the exact approved `POSTGAME_MEDIA_WAKE_URL`.

`GET /api/internal/render-proof/receipt` requires the API control bearer and returns
safe whole-database evidence. `POST /api/internal/render-proof/queue` requires that
bearer and exactly `{runId, confirmation:"QUEUE_ONE_FROZEN_FIXTURE"}`. It requires
remote admission, increments the imported render version, assigns a fresh artifact
namespace and commits one durable enqueue. A second enqueue is rejected.

An admission-only wake is suppressed while the fixture is unqueued, then replaced
inside the fresh proof DB by the single job wake. No shared SQS queue is purged.
The proof dispatcher retries that durable wake and disables synthesis of periodic
new wake IDs while a cold task is starting. Ordinary dispatch defaults retain
their existing repair behavior. The existing generation/lease/heartbeat/stale
fences and presigned upload contract remain authoritative. There is no automatic
provider generation or postgame coordination in this entrypoint.

Isolation is rechecked every five seconds and before enqueue/receipt reads. Drift
makes the API unhealthy and stops claims and wake delivery. Wake transport errors
retain the durable wake for retry. The host harness must additionally verify
ordinary workers are stopped, exclusive queues, remote cleanup and restoration;
database checks alone cannot prove external process ownership.

## Cleanup after verified restoration

The host harness produces a private restore receipt only after the ordinary exact
local staging release/database is restored, proof processes are stopped, the cloud
generation is drained, queues are empty, and task/tailnet cleanup is confirmed.
This is point-in-time operator evidence; keep the release held against concurrent
deployments until cleanup finishes.

```sh
bun src/scripts/staging-render-proof.ts cleanup --url-file /private/approved-admin-url \
  --run-id RUN_ID --approval /private/proof-restored.json \
  --confirm DROP_EXACT_RESTORED_PROOF_DATABASE
```

Cleanup checks the receipt against the database's immutable guard, refuses connected
sessions and nonterminal render work, and drops only the exact proof DB/principal.
It never terminates sessions, uses FORCE/CASCADE, resets cloud state, purges queues,
deletes assets, or creates a fresh renderer generation. Retain proof artifacts and
receipts for review. Failed checks preserve state for explicit operator recovery.
