# Optional character cutouts

## Design

BiRefNet runs outside the application host. Public playback records demand for its
frozen full-body references; it continues displaying the original while work is
missing, pending or failed. Current Agent Profile edits never select historical
game art. Studio and export snapshots pin the completed cutout or original available
at their publication cutoff; later arrivals require an explicit visual refresh.

PostgreSQL owns demand, leases, retries and source-to-result relationships. The
existing private payload bucket owns source bytes and finished PNGs. Jobs deduplicate
by source SHA-256 and recipe (model digest, dependency version and processing).
Dimensions are preserved so existing head coordinates remain valid.

The API dispatcher submits AWS Batch Fargate jobs with 2 vCPU / 16 GiB. Each submission
gets a fresh random capability, stored only as a hash in PostgreSQL. A worker must
atomically claim that capability before reading source bytes or uploading a result.
Expired capabilities cannot publish; duplicate submissions cannot both claim.
Three attempts are allowed. There is no game execution dependency on these jobs.

The worker downloads source bytes from the authenticated API, verifies the source
digest, and uploads PNG bytes through the same API. It has no database, object-store
or broad application credentials. The API checks format, dimensions and real alpha,
then durably stores the bytes before committing a ready reference. Content-addressed
uploads left by interrupted transactions are safe to reuse and are retained. The
payload inventory includes both new body columns. No eager orphan deletion runs;
an operator must prove an object is unreferenced before any later pruning.

## Environments

`CHARACTER_CUTOUT_MODE=local|aws-batch|disabled` defaults to disabled.
`INFLUENCE_DEPLOYMENT_ENVIRONMENT=staging` or `NODE_ENV=staging` always disables it,
including serving previously generated cutouts. AWS mode requires the explicit
`prod` binding and a public HTTPS `CUTOUT_API_URL`. Local mode accepts loopback API
origins and Docker's `host.docker.internal`. Render-worker Tailscale policy is separate
and unchanged.

Production also requires `CUTOUT_BATCH_QUEUE`, `CUTOUT_BATCH_JOB_DEFINITION`,
`AWS_REGION`, and AWS credentials scoped to SubmitJob on those two resources.
No worker service is kept warm. The Fargate queue has bounded CPU capacity.

## Local proof and backfill

Build `docker build -t house-character-cutouts:local workers/character-cutouts`.
Use `docker run --rm --cpus=2 --memory=16g --memory-swap=16g` for all inference tests.
The worker supports `--input /inputs --output /outputs` for a directory of images;
it records hashes, per-image timings, cgroup limits and peak memory in metrics.json.
Mount input read-only and preserve each output run in a new directory.

API-backed backfill uses the same demand, claim and result contracts as production.
It starts a temporary capability-protected callback server on port 3018 (override
with `CUTOUT_BACKFILL_PORT`), runs one Docker container at a time, and stops its server
when finished. It requires the localhost database and its existing private bucket:

```sh
bun --env-file=/absolute/path/.env.private-trace.local packages/api/src/scripts/backfill-character-cutouts.ts --manifest /absolute/path/sources.json
bun --env-file=/absolute/path/.env.private-trace.local packages/api/src/scripts/backfill-character-cutouts.ts --game GAME_UUID
```

The manifest is an array of `{ "sourcePath": "/absolute/path/image.webp" }`. A rerun
reuses ready hashes. Failed/leased jobs are reported, never silently reset. After
fixing a failure, `--retry-failed` explicitly resets only failed jobs in this selection;
it never steals an unexpired worker lease. For live
localhost playback set `CHARACTER_CUTOUT_MODE=local` and
`CUTOUT_API_URL=http://host.docker.internal:3018` on API/game-worker processes. The
game-worker prepares demand automatically; the backfill command executes Docker.
`--game` prepares demand itself, so it also works with the game-worker stopped.
No staging rollout is planned.

## Deployment and recovery

Deploy the dedicated production cutout stack from `falsefloor/infra`; do not change
the render stacks. Pin the worker image by digest. Apply app migrations and deploy
the API before enabling the dispatcher. Verify one example-model game, then backfill
the remaining example-model games. Keep the mode disabled to roll back; originals
remain available and accepted game state is unchanged. Inspect failed rows and retry
explicitly after correcting the cause; viewers do not reset retry limits.

Migrations 0133 (jobs) and 0134 (completion timestamps) follow the baseline TTS branch's
0132 audio work. Integrate all journal entries in timestamp order before the combined
release. A database already advanced past 0132 must be inventoried before applying the
combined branch; do not rewrite migration bookkeeping to force a missing migration.

## Local Linux benchmark, 2026-10-24

Nine latest model-agent images (1024×1536) all produced RGBA PNGs with nonempty opaque
foreground and transparent background. Visual review on split light/dark backgrounds
retained hands, boots, hair and Sonnet's coat. Linux ARM64, cgroup `cpu.max=200000 100000`,
`memory.max=17179869184`, no swap: median 20.74 s/image, range 18.33–23.04 s, 2.61 s
model load. A reused nine-image session peaked at 13.64 GiB cgroup memory; the first
image peaked at 8.83 GiB cgroup / 8.92 GiB RSS. Production starts a fresh process for
each image. These are Docker Desktop measurements, not an AWS latency guarantee.
Exact dependencies are in `workers/character-cutouts/requirements.lock`.
