# Optional character cutouts

The fourteen default House full-body assets are preprocessed, transparent bundled
references. New rosters pin their versioned URLs and content hashes. Playback and
inventory recognize these references and skip redundant cutout jobs, including
private scene-artifact copies of bundled bodies. Custom Agent Profile sources
continue through the existing demand, worker and publication-cutoff workflow.

## Design

BiRefNet runs outside the application host. Public playback records demand for its
frozen full-body references; it continues displaying the original while work is
missing, pending or failed. Current Agent Profile edits never select historical
game art. Studio and export snapshots pin the completed cutout or original available
at their publication cutoff; later arrivals require an explicit visual refresh.
Werewolf live windows also pin character bytes to their publication cutoff. Their
character URLs resolve ready derivatives by frozen source hash, so asynchronous
demand association cannot change an existing moment or briefly hide an already
ready cutout. A new publication cutoff adopts newly completed derivatives; the
viewer retains its strict committed-moment equality check.

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
`INFLUENCE_DEPLOYMENT_ENVIRONMENT=staging` or `NODE_ENV=staging` always disables new
demand and worker dispatch. Existing ready cutouts remain readable through their
normal authorization and publication-cutoff checks, including frozen exports.
AWS mode requires the explicit
`prod` binding and a public HTTPS `CUTOUT_API_URL`. Local mode accepts loopback API
origins and Docker's `host.docker.internal`. Render-worker Tailscale policy is separate
and unchanged.

Production also requires `CUTOUT_BATCH_QUEUE`, `CUTOUT_BATCH_JOB_DEFINITION`,
`AWS_REGION`, and AWS credentials scoped to SubmitJob on those two resources.
No worker service is kept warm. The Fargate queue has bounded CPU capacity.

## Inventory and operator CLI

Run from the repository root. Commands require `--env local|production`. Staging
is rejected before opening a database, regardless of other settings. `inventory`,
`status`, and `--dry-run` never write demands, upload images, expire leases or submit
work. Production reads require an explicit `DATABASE_URL` and
`INFLUENCE_DEPLOYMENT_ENVIRONMENT=prod`; production writes additionally require the
complete `aws-batch` configuration described above. A production command only
prepares durable demands/jobs. The existing game-worker dispatcher submits Batch
jobs; the CLI never starts an AWS dispatcher or runs production inference.

Selections are `--agent ID`, `--game ID`, or `--scope example-models`. The cohort is
an explicit list of nine profile IDs in `character-cutout-backfill.ts`, not a name
search. Inventory reports absent cohort profiles. It covers current reusable agent
body images plus the full cast of every associated game. Influence membership comes
from `game_players`; Werewolf membership comes from the canonical started roster,
not mutable lobby seats. Game sources match playback: frozen Influence personas and
prepared cast artifacts, or immutable Werewolf content revisions. Current profile
art is never substituted into a game. Portrait fallbacks are excluded. No historical
assets are regenerated. Missing frozen images remain originals/fallbacks in playback.

Agent images have agent-owned durable demands; game images retain game/player-owned
demands. Normal character creation/editing records an optional demand against the
already-captured body hash. Image work cannot reject the character submission. Both
inventory paths converge on the existing SHA-256 + recipe job uniqueness constraint.
A ready/active shared job can need a new demand association for another game; linking
that association does not run inference again.

`run` requires `--limit 1..100`, measured in **source references**, including new
associations to existing jobs. Stable cohort/game/player order and durable associations
make repeated bounded runs resumable. Ready/active associated jobs are skipped;
failed jobs and failed source preparations remain failed until explicitly retried.
Expired leases recover using the existing three-attempt policy (the local runner
expires only selected jobs; the production dispatcher owns its regular expiry loop).
An unexpired lease is never stolen. Failed references are reported but do not starve
later inventory. Completion applies to the selected bounded batch; `remaining` tells
you whether another batch is needed. For a single agent/game, `selectionIncomplete`
and exit 2 prevent a too-small limit from reporting whole-selection completion.

Output is JSON Lines: inventory counts, source/demand/job IDs, source errors,
attempts, Batch job IDs, lease deadlines, then completion. No worker capabilities
are printed. `status --job ID,ID` or `--demand ID,ID` accepts at most 100 distinct IDs.
`retry` requires these explicit IDs and rejects mixed ready/active/unknown selections
atomically. A demand retry repairs source preparation only; a resulting failed job
still requires its own explicit job retry. Correct the underlying cause first.

`--wait 1..3600` optionally polls completion with a deadline after preparation.
Production without wait returns after durable enqueueing. Local mode runs one Docker
worker at a time; without wait it waits for its selected workers. Timeout or interruption
stops the local container but retains the lease; resume after expiry. Exit codes:
0 = read-only success, queued production work, or completion; 1 = failure;
2 = incomplete bounded selection or wait timeout; 130 = interruption. Always inspect
`complete` when consuming JSON, especially a production enqueue without wait.

## Production rollout and exact commands

The API runtime image includes `dist/backfill-character-cutouts.js`. Run it with
the same arguments below using the accepted image and its scoped production runtime
environment. Source-tree paths are only for a repository checkout; production images
do not contain `packages/api/src`. The operator command does not start the API server.

Production was activated on 2026-10-25 (2026-10-26 UTC), AWS account 978355607658,
region `us-west-1`, through the protected runtime refresh
[40263004523](https://github.com/0xFlicker/linode-iac/actions/runs/40263004523).
The corrected worker definition was activated through protected refresh
[40264158849](https://github.com/0xFlicker/linode-iac/actions/runs/40264158849).
API and game-worker remain on accepted application SHA
`8d08fc383c0c81bbeedfbb82997e73e847185ae8`. Both loaded `aws-batch` mode and the
public API remained healthy after activation. Staging is disabled; render-worker
networking and Tailscale policy are unchanged.

Infrastructure is managed by `falsefloor/infra`
[PR #4](https://github.com/falsefloor/infra/pull/4):

- Stacks: `HouseCutoutsAssets-prod`, `HouseCutouts-prod`.
- Queue: `arn:aws:batch:us-west-1:978355607658:job-queue/house-character-cutouts-prod`.
- Definition: `arn:aws:batch:us-west-1:978355607658:job-definition/house-character-cutouts-prod:2`.
- Worker digest: `sha256:689ae102993a30222512a2b6369bf482b7871c5e8243225a4f6203c63cff150b`
  (worker source `6e26c8e1`), Linux ARM64, 2 vCPU / 16 GiB, maximum queue capacity
  4 vCPU. No warm service or NAT gateway.
- Dedicated submitter `house-cutouts-prod-submitter` can submit only to this queue
  and definition. Its access key lives in production Doppler, never CloudFormation
  outputs or repository files. Workers receive per-job capabilities only.
- Logs: `/house/cutouts/prod`.

The initial production canary exposed Cloudflare error 1010 for the default Python
user-agent, before the worker claimed any source. Revision 2 identifies callbacks
as `HouseCharacterCutouts/1.0`; the edge configuration is unchanged. Dummy-capability
checks reached claim/source/result while retaining application capability rejection.
Its complete local HTTP flow at 2 CPU / 16 GiB produced the exact previous GPT Sol
PNG hash, with 31.1 seconds processing/upload and 9.85 GB peak cgroup memory.
Model weights and recipe identity did not change.

The revision-2 production canary for Vesper Kane
(`0d8e0048-a56d-4566-804b-0875269c8be4`) completed on its first attempt:
Batch `3a430bf3-c002-4551-b8e1-9a20b63b43a3` reported `SUCCEEDED`, exit 0, and
cutout `f11d1f09-bbe9-40a0-a2e3-c44c7e6a1f66` became ready at
`2026-10-26T03:33:38.119Z`. Readback from private storage verified a 581,586-byte,
1024×1536 RGBA PNG with alpha spanning 0–255 and SHA-256
`e6989b396235e51e21e63434ee447a1e8b4933d150e10cfa3289fb45f9390ca4`.
Processing plus upload took 38.6 seconds; peak RSS was 9.61 GB. This proves the
production submit/claim/source/inference/upload/storage path. Repeating the same
single-agent backfill selected zero new sources and returned the same ready job,
attempt count and Batch ID. It does not claim a
new-game or browser playback test; the selected production profile had no game
sources in inventory.

The first Huntingford job (`a2fbc8de-54ca-44d8-84da-16be213e7460`) failed before
claim under revision 1. Its durable lease was preserved, with automatic expiry
at `2026-10-26T04:17:28.125Z`; the normal dispatcher can retry using revision 2.
Never clear an unexpired lease just to accelerate a smoke test.

For subsequent deployments:

1. Review and deploy the dedicated cutout infrastructure from `falsefloor/infra`;
   preserve render-worker/Tailscale configuration. Provision the worker ECR image,
   pin its digest and recipe, and configure Fargate at 2 vCPU / 16 GiB with bounded
   queue capacity. Verify networking to the production HTTPS API.
2. Apply application migrations through **0138** using the normal release process.
   0138 only extends demand ownership; it changes no image bodies or game identities.
   Verify the shared private payload bucket is available with integrity checks.
3. Deploy matching API and game-worker code. Configure queue/job-definition ARNs,
   AWS region and scoped SubmitJob credentials. Verify the dispatcher is healthy and
   the capability-protected claim/source/result endpoints are reachable from Batch.
4. Set up a secure operator env file with the production database and private bucket
   bindings. Preview inventory before separately approved activation. Only after
   activation, process one selection, inspect completion/playback, then bounded batches.

The following commands are for the operator after these prerequisites. Env files contain existing secure
bindings; do not paste secrets into command lines. The production env file must also
bind `INFLUENCE_DEPLOYMENT_ENVIRONMENT=prod`, `CHARACTER_CUTOUT_MODE=aws-batch`,
`CUTOUT_API_URL`, `CUTOUT_BATCH_QUEUE`, `CUTOUT_BATCH_JOB_DEFINITION`, and `AWS_REGION`.

```sh
cd /Users/user/Development/influence-game
export CUTOUT_ENV_FILE=/etc/influence/cutouts.production.env
export AGENT_ID=0d8e0048-a56d-4566-804b-0875269c8be4 # Verified production Vesper Kane canary
# Preview the entire cohort and inspect its game IDs, warnings and failures.
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts inventory --env production --scope example-models
# Preview exactly the first bounded mutation batch.
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts run --env production --scope example-models --limit 16 --dry-run
# One explicitly selected agent, with bounded completion observation.
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts run --env production --agent "$AGENT_ID" --limit 1 --wait 900
# Set GAME_ID to an exact game ID from inventory, then process its full cast.
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts run --env production --game "$GAME_ID" --limit 100 --wait 900
# Process remaining inventory in bounded batches; repeat until remaining=false.
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts run --env production --scope example-models --limit 16 --wait 900
# Check the cohort or exact durable IDs printed by a previous command.
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts status --env production --scope example-models
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts status --env production --job "$JOB_IDS"
# After fixing the cause, preview and retry exact comma-separated failed IDs.
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts retry --env production --job "$JOB_IDS" --dry-run
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts retry --env production --job "$JOB_IDS" --wait 900
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts retry --env production --demand "$DEMAND_IDS" --wait 900
```

The nine `example-models` profile IDs are present locally but were all absent from
production at activation. Cohort inventory correctly reports these warnings and
zero sources; it does not match unrelated agents by name. Select an existing
production agent/game explicitly until the intended example profiles are published
and the cohort is updated deliberately.

The accepted `8d08fc38` API image predates packaging the operator bundle. During
activation, the command was built from that released source and mounted read-only
into an isolated Compose container using the accepted API image and its runtime env.
Later images include the bundle directly. Use Compose for the deployed runtime env
file: its multiline quoted values are not compatible with `docker run --env-file`.

Keep mode disabled to stop new demand and dispatch; existing derivatives, originals
and accepted game state remain available. Do not truncate jobs, reset active leases, or rewrite frozen
references to recover a failed derivative.

## Local Docker validation

```sh
cd /Users/user/Development/influence-game
docker build -t house-character-cutouts:local workers/character-cutouts
export CUTOUT_ENV_FILE="$PWD/.env.private-trace.local"
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts inventory --env local --scope example-models
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts run --env local --agent 525f84a1-e1d2-472a-ba4e-ad3f9a9d2a53 --limit 1 --wait 900
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts run --env local --game "$GAME_ID" --limit 100 --wait 900
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts run --env local --scope example-models --limit 16 --wait 900
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts status --env local --job "$JOB_IDS"
bun --env-file="$CUTOUT_ENV_FILE" packages/api/src/scripts/backfill-character-cutouts.ts retry --env local --demand "$DEMAND_IDS" --wait 900
```

Local mode requires a loopback database (default `influence_dev` on port 54320) and
the existing private bucket. It binds the callback listener on port 3018 only when
launching a worker; override `CUTOUT_BACKFILL_PORT` if needed. Every worker request
requires its one-job capability. Local uploads default to `packages/api/.local-uploads`
independent of cwd; set `INFLUENCE_LOCAL_UPLOAD_DIR` for a different existing store.
`CUTOUT_DOCKER_IMAGE` selects a locally built worker. Containers always use
`--cpus=2 --memory=16g --memory-swap=16g`. The standalone worker still supports
`--input /inputs --output /outputs` with read-only input mounts and a fresh output
directory; the operator CLI accepts server-selected IDs rather than file/URL manifests.

For localhost playback set `CHARACTER_CUTOUT_MODE=local` and
`CUTOUT_API_URL=http://host.docker.internal:3018` on API/game-worker processes. No paid
image generation or game simulations are needed. See the
[backfill validation record](../solutions/infrastructure/character-cutout-backfill.md)
for local evidence and the exact limits of the production verification.

## Local Linux benchmark, 2026-10-24

Nine latest model-agent images (1024×1536) all produced RGBA PNGs with nonempty opaque
foreground and transparent background. Visual review on split light/dark backgrounds
retained hands, boots, hair and Sonnet's coat. Linux ARM64, cgroup `cpu.max=200000 100000`,
`memory.max=17179869184`, no swap: median 20.74 s/image, range 18.33–23.04 s, 2.61 s
model load. A reused nine-image session peaked at 13.64 GiB cgroup memory; the first
image peaked at 8.83 GiB cgroup / 8.92 GiB RSS. Production starts a fresh process for
each image. These are Docker Desktop measurements, not an AWS latency guarantee.
Exact dependencies are in `workers/character-cutouts/requirements.lock`.
Worker diagnostics support cgroup v2 (Docker Desktop) and cgroup v1 (Fargate).
Unexposed diagnostic counters are reported as null; missing metrics files must not
prevent inference or turn an accepted upload into a failed job. Verify both layouts
with `python3 -m unittest discover -s workers/character-cutouts -p 'test_*.py'`.
