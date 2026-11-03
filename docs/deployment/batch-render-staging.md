# Batch renderer staging iteration

Studio now orders directly from the browser or MCP. The API freezes the selected descriptor, complete permitted source metadata and existing audio publication into the private input document. The assigned worker prepares the bundle with the shared source binder/compiler and renders it. Local CLI preparation remains supported. Trailer jobs use the same execution service with the existing trailer renderer and publication verifier. No game, image, speech or music generation is needed for these tests.

The checked-in staging policy selects `aws-batch` for both `studio-export` and
`trailer`. The normal release drains the prior trailer controller and API leases
before admitting the new image family. Both workloads then use shared render
jobs with separate Batch queues and execution slots. Production's policy is unchanged.
Preparing this source does not deploy the Batch runtime or submit a job. See the
[activation and acceptance steps](batch-render-release-preparation.md#staging-studio-activation).

## Local commands and evidence

For ordinary localhost development, the existing native poller handles trailers
and Studio exports: run `bun run dev:render-worker` alongside the API/web and use
Studio's **Render video** action. It uses the shared assigned execution code and
private MinIO path without a render container. See [development setup](../../DEVELOPMENT.md).

To repeat the isolated native-worker/browser proof:

```sh
bun --env-file=<local-private-storage-env> scripts/verify-render-order-local.ts --native --browser
```

This exercises local discovery, atomic execution claim, native preparation and
encoding, verification, monitor status and checksum-matched browser downloads.
Native source identity is distinct from cloud image admission. The passed proof
is `.renders/order-proof-1793642853028/proof.json`; both games completed and the
disposable database was removed. Linux image and AWS admission still use the
Docker and staging checks below.

Install locked dependencies with Bun. Use local PostgreSQL and the private MinIO bootstrap described in `private-payload-storage-cutover.md`. The private bucket must differ from the public media bucket.

Build the worker with explicit provenance:

```sh
docker build -f Dockerfile.render-worker \
  --build-arg GIT_SHA=<source-commit> --build-arg SOURCE_DIRTY=1 \
  -t influence-render-batch:local .

bun --env-file=<local-private-storage-env> scripts/verify-render-batch-local.ts \
  /absolute/path/to/existing.bundle
```

Use `SOURCE_DIRTY=0` only for an image built from its exact clean source revision. The proof script requires localhost PostgreSQL/object storage, creates and drops its own database, proxies only the local API and bucket origin, and renders a two-second range. Its default test administration URL is `postgresql://influence:influence@127.0.0.1:54329/postgres`; `RENDER_PROOF_DATABASE_URL` can select another localhost service. It retains private input/video/logs under `.renders/batch-proof-*`. This is a transport and encoding smoke, not a complete game-history import or full-length visual acceptance test.

The 2026-11-02 Docker proofs completed claim, hashed input download, Remotion/ffmpeg, private upload, durable receipt, asynchronous verification and checksum-matched download. `.renders/batch-proof-1793609261898` used native ARM64; `.renders/batch-proof-1793610686780` used the staging x86_64 image under local Docker emulation. Both rendered two seconds. These use synthetic execution-admission digests for the local harness; staging must prove its published immutable digest and network/IAM admission. See [the implementation evidence](../solutions/infrastructure/2026-11-02-batch-render-local-proof.md).

To repeat the staging-architecture smoke locally, build with `--platform linux/amd64 -t influence-render-batch:staging-local` and set `RENDER_PROOF_IMAGE=influence-render-batch:staging-local` on the proof command. This selects only a local Docker image and does not submit an AWS job.

The subsequent browser/MCP implementation has its own proof:

```sh
bun --env-file=<local-private-storage-env> scripts/verify-render-order-local.ts
```

This seeds its own database, orders short Influence and Werewolf cuts over real
HTTP MCP, runs the Docker worker's preparation/encoding path, then fetches both
verified movies through producer-only MCP downloads. It retains private evidence
under `.renders/order-proof-*` and removes the database and worker credentials.
Native ARM64 and emulated staging x86_64 runs passed; see [browser/MCP evidence](../solutions/infrastructure/2026-11-02-studio-browser-mcp-orders.md).

Add `--browser` to exercise the real localhost Next dev monitor and private browser
downloads in the same proof:

```sh
bun --env-file=<local-private-storage-env> scripts/verify-render-order-local.ts --browser
```

The harness observes queued/completed jobs at `/admin/production/renders`, clicks
**Download video** for each actual output and verifies its downloaded length and
SHA-256 against the accepted output. It owns and stops its API, proxy, Next child
and Chromium, drops its isolated database, removes temporary worker credentials,
and retains screenshots, selections, movies and logs. The passed combined proof
is `.renders/order-proof-1793638838872/proof.json`; both Influence and Werewolf
browser downloads passed. This runs Docker directly with synthetic admission
digests, so AWS scheduling, reserved lanes and tailnet admission still require
staging. Short cuts do not establish six-hour readiness.

## Ordering a Studio output

In Studio, review **Selected cut**, open **Export**, choose geometry/FPS, then
**Render video**. The returned job appears in **Render jobs** and remains
available after navigation. Cancellation revokes completion authority; retry
uses the inspected execution ID so a repeated request cannot order a second
attempt after a lost response. Imported recordings upload first; **Resume exact
cloud render order** retains the descriptor and idempotency key if a response or
upload is interrupted. Keep the recording files selected until uploading ends.

Use **Production → Render jobs** to monitor shared jobs across games, including
orders placed by MCP. Filters are shareable URLs; each row links back to Studio.
Current Producer/Sysop authority protects the list, counts, details and actions.
New or explicitly queued staging trailer versions appear there through shared
jobs. Existing published trailers remain available; migration does not enqueue
or re-encode every ready trailer. Per-game backfill/rerender tools still own
explicit recovery, and failed/waiting-input/waiting-music rows stay explicit.

For MCP, grant `producer producer:render` through normal OAuth consent after the
new server is deployed. Existing `producer` and `producer:edit` grants do not
authorize rendering. Existing dynamic clients whose registered scope envelope
omits `producer:render` need a fresh registration/reconnect; refresh tokens never
silently gain it. Use the same staging MCP resource/issuer as ordinary Studio
tools, not a separate render-only server.

Read/preview the actual moments, then call `order_production_render` with the
returned source `snapshot`, exact ordered `momentIds`, game/audience/thinking,
explicit `settings`, `copy` and a stable `requestKey`. Settings include width,
height, fps, reducedMotion, music, volume and the timing profile. This freezes
existing verified recordings; it generates none. Save `job.id`, poll
`get_production_render`, then call `get_production_render_download` for a fresh
private URL. `cancel_production_render` accepts `jobId`;
`retry_production_render` requires both `jobId` and the inspected `executionId`.
All calls recheck current producer authority. Retry consumes compute only once
for that inspected execution and requires the current Batch target/digest.

Browser recording uploads require private-bucket CORS for the exact Studio origin.
The bucket owner can merge the dedicated PUT-only rule with the reviewed private
credentials using:

```sh
bun --env-file=<private-storage-env> packages/api/src/scripts/ensure-private-content-bucket.ts \
  --render-cors-origin https://influence-staging.tail8a79ed.ts.net
```

This preserves unrelated CORS rules and grants no public reads. Staging
credentials and this CORS rule were installed and verified during the
[one-time bootstrap](2026-11-02-staging-batch-bootstrap.md).

For the existing CLI flow:

Download the exact selection in Studio. Prepare and order from the repository root:

```sh
bun run replay:export -- --selection ./episode-selection.json \
  --api-base-url https://influence-staging.tail8a79ed.ts.net \
  --web-base-url https://influence-staging.tail8a79ed.ts.net \
  --output .renders/episode.mp4 --cloud --request-key staging-export-001
```

The command uses the ordinary Producer/Sysop CLI authorization. Preparation freezes the current selected assets; it does not generate missing media. Imported recordings still use the existing `--speech-manifest` path. The prepared bundle remains local for an exact retry:

```sh
bun run replay:export -- --bundle .renders/episode.bundle \
  --selection ./episode-selection.json \
  --api-base-url https://influence-staging.tail8a79ed.ts.net \
  --web-base-url https://influence-staging.tail8a79ed.ts.net \
  --output .renders/episode.mp4 --cloud --request-key staging-export-001
```

Exact request replay returns the same job. A different bundle/settings under that key conflicts. Save the returned job ID. Studio's Export dialog lists game-scoped jobs after reopening; MCP `get_production_render` and `get_production_render_download` recheck current producer authority. Download URLs expire after 15 minutes. API paths are `/api/admin/renders/:id` and `POST /api/admin/renders/:id/download`; the latter is unavailable before verified success. Cancellation and explicit Studio retry use the corresponding `/cancel` and `/retry` POST operations. A retry fences the previous execution and keeps the frozen input bytes.

Browser/MCP ordering now includes frozen-source preparation in the worker. Resumable multipart transfers, automatic transient retries and six-hour acceptance remain later milestones in the parent plan. Cancellation fences output authority immediately; stopping an already-running worker currently follows its lease watchdog rather than proactively calling Batch TerminateJob. The first staging run uses a small existing cut and existing trailer inputs.

## Companion source and credential contract

`falsefloor/infra` owns `HouseRenderBatch-staging`, the signed submitter, execution ledger, two Batch queues/compute environments/slot resources and task-scoped tailnet broker. The companion working checkout is `/Users/user/Development/house-render-infra`, branch `codex/shared-batch-rendering`. `linode-iac` branch `codex/batch-renderer-target-policy` adds strict host parsing for workload targets; it does not switch a live host.

The initial staging stack allows one trailer and one Studio execution. Each task currently reserves 4 vCPU / 8 GiB total, split between renderer and sidecar, with 50 GiB scratch. This deliberately conservative staging shape needs measurement before selecting production sizing. The lanes use separate compute environments and slot resources, so an export cannot use the trailer allowance. Validate account quota and subnet addresses for both jobs together.

| Value | Destination and authority |
| --- | --- |
| Dedicated Batch submission HMAC | API `RENDER_JOB_DISPATCH_SECRET`; SSM `/house/render/staging/batch-submit` read only by the submitter. Distinct from the old wake/control keys. |
| Dedicated execution HMAC | API `RENDER_JOB_SECRET`; SSM `/house/render/staging/batch-worker` read only by the submitter. At least 32 characters. A task receives only its execution-derived bearer. |
| Submitter URL | API `RENDER_JOB_DISPATCH_URL`, from the new stack's `SubmitUrl`. |
| Exact worker digest | API `RENDER_JOB_WORKER_DIGEST`, derived from the verified release by staging host readiness; must equal the admitted Batch definition. |
| Tailscale OAuth | Existing staging-only SSM parameter, broker-only. Worker and sidecar do not receive OAuth. |
| Runtime permissions boundary | New reviewed `HouseRenderBatch...RuntimeBoundary` under the staging protected policy path; supplied by ARN, never created by the runtime stack. |

The separately authorized staging IAM/bootstrap is installed and verified; see
the [bootstrap receipt](2026-11-02-staging-batch-bootstrap.md). Companion source
`house-render-batch-iam.ts` defines the retained runtime boundary and dedicated
`HouseRenderBatchStagingGitHubDeploy` / `HouseRenderBatchStagingCloudFormationExecution`
roles. Their live policies/trust match the reviewed synthesized template. The old
direct-ECS deploy role does not authorize this stack. Runtime deployment must use
the dedicated role, protected asset prefix `house-render/staging/batch/`, imported
staging network and exact staging ECR images. The Batch service-linked role already
exists. The Batch runtime stack and render target remain unactivated.

The app staging release automatically invokes `house-render-batch-staging-deploy.yml`
after verified ECR publication when the exact candidate policy selects a Batch
lane. The infra-owned workflow accepts only source/mirror run identities and
receipt hashes, independently derives the worker image and fixed staging
parameters, and packages/verifies `HouseRenderBatch-staging` before assuming its
dedicated main-only deploy role. A one-time repo variable pins the sidecar image.
The dedicated **The House Render Releases** App and keys are installed; see the
[bootstrap receipt](2026-11-02-staging-batch-bootstrap.md). App/host Batch steps
use `HOUSE_RENDER_APP_*`; infra's source reader uses its dedicated `GH_APP_*`.
No secret values
enter workflow inputs. `scripts/render-deploy.py --environment staging --renderer batch`
rejects old-renderer/production replay, foreign asset destinations, changed
checksums and an unprotected runtime role. The existing renderer workflow remains
available during migration. App and host independently verify the exact deployed
admission receipt. The staging host journals its submission URL, derives the worker
digest from the immutable release, and checks secrets before draining services.
Routine releases need no manual job or per-digest Doppler edit. The merged
capability release did not enable Studio cloud rendering; this policy release
activated its staging Batch target after successful admission. This release also
selects Batch for trailers; the legacy claim endpoints and wake dispatcher stop
accepting trailer work when that policy is active.

See [release preparation](batch-render-release-preparation.md) for the merged
three-repository prerequisites, staging activation and the live acceptance steps.

Credential-free companion checks:

```sh
bun run check
bun run test
bun build render/batch-aws.mjs --target=node --format=esm \
  --outfile=dist/house-render-batch/batch-aws.mjs
bunx cdk synth --app 'bun infra/house-render-batch-staging-app.ts' \
  --lookups false --output cdk.out-render-batch
```

## Staging sequence

1. Finish the local candidate checks and review the companion IAM/template changes. Publish API/web/worker from one reviewed immutable source family; copy the worker to the existing staging ECR repository without changing its digest. Verify the sidecar pin too.
2. Provision the reviewed Batch/IAM resources and install only staging credentials through their existing owners. Confirm the old renderer remains the selected target while checking stack readiness. Do not change production.
3. Publish an explicit staging policy containing `targets: {"trailer":"existing","studio-export":"aws-batch"}` inside its existing environment entry. Keep its `mode`, `network` and canonical API origin. The host and both packaged images must agree on the exact raw policy digest.
4. Order a small frozen Studio cut. Verify queued/claim/render/upload/verifying/succeeded, fresh producer download, log/receipt integrity, process exit and authoritative tailnet cleanup. AWS exit status alone is not success.
5. This release selects staging `trailer: aws-batch`. Use the normal old-target drain and reconcile its occupied task, all old leases and uncertain uploads. The Batch reconciler assigns existing queued canonical trailer versions without regenerating input. Automatic future enqueues use the same service. Keep waiting-music/failed recovery explicit. Follow the [trailer migration procedure](batch-render-release-preparation.md#staging-trailer-migration).
6. Complete one existing Influence and Werewolf trailer through claim/upload/finalize and public playback. Saturate the export lane and show a trailer can still start. Test duplicate notices, a lost submission receipt, cancellation/finalization fencing, worker loss, failed sidecar startup and missed terminal cleanup.
7. Rehearse explicit target rollback and retain old infrastructure through the agreed rollback window. The separate cleanup PR removes the direct-ECS singleton only after both workloads are proven on Batch in staging and production. Local rendering remains supported.

Do not call the short smokes a six-hour proof. Keep long-runtime, large-upload recovery, live staging browser/MCP acceptance and production activation as explicit acceptance work.
