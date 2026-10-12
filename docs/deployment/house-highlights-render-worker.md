# House Highlights Render Worker

The production image is `ghcr.io/0xflicker/influence-render-worker`. Main builds publish immutable digest evidence plus short-SHA and `staging` discovery aliases; ephemeral PR builds publish `pr-N`. Staging and production runtime deployment always use the exact digest selected by the release manifest.

The image starts the single-concurrency poller by default:

```sh
bun run render-worker:poll
```

It is a worker only. It does not start a Next.js request server. The one-shot commands are:

```sh
bun run render-worker:once
bun run render-worker:health
bun run render-worker:smoke
```

`health` is non-mutating: it validates worker configuration, ffmpeg, the configured Chromium executable, all 24 required prepared music variants, temp space, and `GET /api/health`. Extra producer-staged `.m4a` files do not make the worker unhealthy. `smoke` runs the same claim/render/upload/finalize path as the poller and exits nonzero unless it completes a queued completed-game job. Run smoke only against a disposable or intentionally queued local job, then inspect the finalized MP4 with `ffprobe`.

## Runtime Contract

Required runtime environment:

```text
POSTGAME_MEDIA_API_URL=https://api.example.com
POSTGAME_MEDIA_WORKER_TOKEN=rotatable-worker-token
```

Optional runtime environment:

```text
POSTGAME_MEDIA_POLL_INTERVAL_MS=5000
POSTGAME_MEDIA_HTTP_TIMEOUT_MS=15000
POSTGAME_MEDIA_UPLOAD_TIMEOUT_MS=300000
POSTGAME_MEDIA_TEMP_DIR=/tmp/influence-render-worker
POSTGAME_MEDIA_MIN_FREE_BYTES=2147483648
POSTGAME_MEDIA_REMOTION_CONCURRENCY=1
REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
```

`POSTGAME_MEDIA_LEASE_MS` is owned by the API, not this container. Store the worker token as a deployment secret, redact it from logs, and rotate it using the API's current-plus-previous token support. The worker receives API-issued upload targets and has no object-storage credentials, bucket keys, or other `LINODE_OBJ_*` secrets.

The image ships Chromium, ffmpeg, CA certificates, fontconfig/Liberation/Noto fonts, web public visual assets, and the 24 prepared tracks at `/app/music/house-highlights-variants`. It sets `REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium`, so Remotion uses the installed browser rather than downloading one at render time.

`POSTGAME_MEDIA_HTTP_TIMEOUT_MS` defaults to 15,000 ms and bounds worker API and health requests. `POSTGAME_MEDIA_UPLOAD_TIMEOUT_MS` defaults to 300,000 ms so a normal 1080p trailer can upload on a slower object-storage connection without disabling API timeouts. Errors are categorized without logging response bodies or signed upload URLs.

`POSTGAME_MEDIA_TEMP_DIR` defaults to `/tmp/influence-render-worker`. `POSTGAME_MEDIA_MIN_FREE_BYTES` is an explicit, tunable disk-space preflight floor and defaults to 2 GiB (`2147483648` bytes); it is not a RAM setting. Mount or provision at least that much writable local disk for this directory, or raise the value when expected render size warrants it. The worker checks free space before claiming work and removes claim output after each attempt.

`POSTGAME_MEDIA_REMOTION_CONCURRENCY` defaults to `1` and must be a positive integer. Each claim renders the visual trailer, then the lossless poster still, then the music mux. Remotion's parallel encoding is disabled, so the worker does not create a second opportunistic encoding lane. Keep one worker process and the default render concurrency unless measured production capacity supports a larger value.

## API Contract

The API container must receive:

```text
POSTGAME_MEDIA_WORKER_TOKEN=<same current token as worker>
POSTGAME_MEDIA_WORKER_TOKEN_PREVIOUS=<optional previous token during rotation>
POSTGAME_MEDIA_LEASE_MS=300000
POSTGAME_MEDIA_PUBLIC_BASE_URL=https://api.example.com
```

The worker claims one job at a time. Claims carry a lease and an opaque artifact
version. `POSTGAME_MEDIA_PUBLIC_BASE_URL` is the browser-reachable API origin;
it keeps local-storage media URLs public even when the worker calls the API by
an internal Compose hostname. Heartbeats extend active work; an expired claim can be reclaimed with a
fresh artifact version, so a stale upload target cannot publish over the new
attempt. The API verifies all four uploaded objects, content types, byte lengths,
SHA-256 hashes, object-key prefix, and safe playback metadata before changing the
public read model to `ready`.

Rotate the worker token without downtime:

1. Set the API current token to the new secret and previous token to the old secret.
2. Restart the API, then restart the worker with the new current token.
3. Confirm worker health and one successful claim or smoke render.
4. Remove the previous token from the API and restart it.

Never log either token or place it in a command checked into the repository.

## Public Storage Contract

No new Linode bucket is required. The API reuses the existing public
`LINODE_OBJ_BUCKET` and writes immutable objects under:

```text
postgame-media/house-highlights-trailers/<game-id>/<opaque-artifact-version>/
```

Each ready bundle contains `trailer.mp4`, `poster.png`, `captions.vtt`, and
`metadata.json`. Object writes use create-only semantics and
`Cache-Control: public, max-age=31536000, immutable`. The bucket/CDN must allow
public `GET` and `HEAD`, byte-range MP4 reads, and cross-origin player reads. Its
CORS response must expose `Accept-Ranges`, `Content-Length`, `Content-Range`, and
`ETag`. The local filesystem adapter implements the same GET/HEAD/range/CORS
contract through the API.

For the S3-compatible backend, every constrained presigned PUT also carries
`x-amz-acl: public-read`. The API includes that ACL in the `PutObject` command,
keeps `x-amz-acl` in the URL's signed-header list, and returns the same header in
the upload target. The credential-free worker forwards all issued upload headers
unchanged. Bucket-level anonymous-read policy does not replace this per-object
ACL; omitting it can produce a successful PUT followed by public playback `403`s.

The API container keeps `LINODE_OBJ_ENDPOINT`, `LINODE_OBJ_ACCESS_KEY`,
`LINODE_OBJ_SECRET_KEY`, and `LINODE_OBJ_BUCKET`. The worker receives lease-bound,
single-use upload targets only. Failed-attempt intermediates are removed from the
worker temp directory; successfully published versions have no expiration.

## Build And Local Smoke

Build the same image CI publishes:

```sh
docker build -f Dockerfile.render-worker -t influence-render-worker:local .
```

For normal local development, start the API and native worker in separate
terminals. The root scripts share the local worker token, public API origin, and
`packages/api/.local-uploads` storage automatically:

```sh
bun run dev:api
bun run dev:render-worker
```

The dev service supplies `.renders/render-worker/drain-ack.json` in the checkout
for local drain control (including Ctrl-C). `POSTGAME_MEDIA_DRAIN_ACK_FILE` can
override it. Run one dev render worker per checkout; simultaneous workers need
separate control directories. The deployed poll command still requires an
explicit control path; its handoff contract is unchanged.

Queue a completed game from **Admin -> Game History -> Trailer -> Backfill**.
Werewolf game workspaces also expose **Production -> Trailer & poster** using
the same diagnostics and actions. Failed jobs show **Retry trailer**; restarting
the worker does not requeue terminal failures. Repair the missing assets, enter
a reason, then retry.
The authenticated API equivalent is:

```sh
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"local worker smoke","confirmation":"BACKFILL"}' \
  http://127.0.0.1:3000/api/admin/games/vast-plum-bay/postgame/media/backfill
```

Run the container health check, then consume exactly one queued job:

```sh
mkdir -p /tmp/influence-render-worker-smoke
chmod 0777 /tmp/influence-render-worker-smoke

docker run --rm \
  -v /tmp/influence-render-worker-smoke:/tmp/influence-render-worker \
  -e POSTGAME_MEDIA_API_URL=http://host.docker.internal:3000 \
  -e POSTGAME_MEDIA_WORKER_TOKEN=local-render-worker \
  influence-render-worker:local \
  bun run /app/packages/web/src/scripts/render-house-highlights-media-worker.ts --health

docker run --rm \
  -v /tmp/influence-render-worker-smoke:/tmp/influence-render-worker \
  -e POSTGAME_MEDIA_API_URL=http://host.docker.internal:3000 \
  -e POSTGAME_MEDIA_WORKER_TOKEN=local-render-worker \
  influence-render-worker:local \
  bun run /app/packages/web/src/scripts/render-house-highlights-media-worker.ts --smoke
```

`--smoke` exits nonzero for idle, waiting-music, render failure, upload failure,
or finalize failure. After success, fetch the ready read model and inspect the
actual published MP4:

```sh
curl -fsS http://127.0.0.1:3000/api/games/vast-plum-bay/postgame/media > /tmp/postgame-media.json
jq -r '.video.url' /tmp/postgame-media.json | xargs curl -fsSL -o /tmp/house-highlights-smoke.mp4
VIDEO_URL="$(jq -r '.video.url' /tmp/postgame-media.json)"
curl -fsSI "$VIDEO_URL"
curl -fsS -H 'Range: bytes=0-1023' -D - -o /dev/null "$VIDEO_URL"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -show_entries format=duration -of json /tmp/house-highlights-smoke.mp4
find /tmp/influence-render-worker-smoke -mindepth 1 -print
```

The anonymous `HEAD` must succeed and the range request must return `206`. The
probe must show H.264 video, AAC audio, 1920x1080 dimensions, and a nonzero
duration matching the public read model. The final `find` must print nothing when
the worker temp directory is bind-mounted for inspection. Repeat anonymous reads
for the poster, captions, and metadata URLs before declaring staging ready.

## Admin Operations

The completed-game admin table exposes a Trailer panel. Admin/sysop users with
`manage_postgame_media` can:

- inspect status, attempt, render and artifact versions, duration, cue markers,
  music/renderer/timing provenance, object summaries, and safe failure details;
- backfill games that have no public render;
- rerender a previously published game after an explicit confirmation.

Active claimed/rendering/composing/uploading attempts disable duplicate actions.
The public `/games/<slug>` player never exposes these diagnostics, cue IDs,
music filenames, worker state, object keys, or repair controls.

## `linode-iac` Handoff

Run a third service beside `api` and `web`, pinned to the same exact-digest
Release family. The steady-state production color contract is:

```yaml
render-worker:
  profiles: ["worker"]
  image: ${WORKER_IMAGE_REF:?WORKER_IMAGE_REF is required}
  restart: "on-failure:5"
  env_file: ${WORKER_ENV_FILE:?WORKER_ENV_FILE is required}
  depends_on:
    api:
      condition: service_healthy
  environment:
    POSTGAME_MEDIA_API_URL: http://influence-${COLOR:?COLOR is required}-api:3001
    POSTGAME_MEDIA_POLL_INTERVAL_MS: "5000"
    POSTGAME_MEDIA_HTTP_TIMEOUT_MS: "15000"
    POSTGAME_MEDIA_UPLOAD_TIMEOUT_MS: "300000"
    POSTGAME_MEDIA_TEMP_DIR: /tmp/influence-render-worker
    POSTGAME_MEDIA_MIN_FREE_BYTES: "2147483648"
    POSTGAME_MEDIA_DRAIN_ACK_FILE: /var/run/influence-worker/drain-ack.json
    POSTGAME_MEDIA_STARTUP_MODE: ${WORKER_STARTUP_MODE:?WORKER_STARTUP_MODE is required}
    REMOTION_BROWSER_EXECUTABLE: /usr/bin/chromium
  volumes:
    - /var/lib/influence/render-worker-tmp:/tmp/influence-render-worker
    - /var/lib/influence/worker-control/${COLOR:?COLOR is required}:/var/run/influence-worker
  stop_grace_period: 25m
```

Provision at least 2 GiB free on the temp mount and keep one worker replica per
active deployment shape. Do not add public ports or object-
storage credentials to the worker. The image's Docker healthcheck runs `--health`;
deployment validation must use the existing admin backfill path with an approved
disposable completed game, then confirm public player playback and the `ffprobe`
checks above in staging before promoting the same immutable SHA to production.

CI publishes:

- `ghcr.io/0xflicker/influence-render-worker:<short-sha>` and `:staging` from `main`;
- `ghcr.io/0xflicker/influence-render-worker:pr-<number>` for ephemeral PR builds.

The `linode-iac` deployment pins API, web, and worker to the exact digests in one
Release family. Moving short-SHA, `staging`, and `latest` tags remain discovery
aliases only. Rollback restores the prior immutable three-image family;
queued/leased jobs remain API-owned and can be reclaimed after their lease
expires. Production handoff additionally binds drain intent and acknowledgement
to the current worker generation before enabling candidate claims.

## On-demand remote execution (opt-in)

`deployment/render-execution.json` is packaged at the same path in API and
renderer images and selects policy per environment. **Both prod and staging stay
local in this first landing.** After the separately approved staging infrastructure,
credential and tailnet setup, activation is a small reviewed commit changing only
staging's `mode` to `remote`; this config path triggers the complete immutable
three-image release. No Doppler rollout switch is used. The host binds
`INFLUENCE_DEPLOYMENT_ENVIRONMENT` to the deployment and verifies the raw-file
SHA256 extracted from the exact candidate API and renderer image digests.
Production can also verify the validating candidate's `/api/health` before draining
its active renderer. Staging uses immutable image checks and the available baseline
API preflight before stopping the old slot; it verifies the new API's health policy
after startup and before admitting the new renderer. Health exposes only non-secret
release policy; ordinary local deployments need no new control credential. Remote
operations use the separately authenticated release endpoint. Existing
hosts may derive an environment from `NODE_ENV` for local releases only; remote
execution requires the explicit updated-host binding. Conflicting bindings fail
closed. `POSTGAME_MEDIA_EXECUTION_MODE` no longer selects execution.

Remote workers select a finite, single-concurrency batch and require
an HTTPS `POSTGAME_MEDIA_API_URL` without URL credentials and:

```text
POSTGAME_MEDIA_RENDER_GENERATION=<fresh opaque release epoch>
POSTGAME_MEDIA_WORKER_DIGEST=sha256:<exact image digest>
POSTGAME_MEDIA_WORKER_INSTANCE_ID=<persisted launch identity>
POSTGAME_MEDIA_MAX_JOBS=4
POSTGAME_MEDIA_QUIET_INTERVAL_MS=30000
```

A worker checks `/api/internal/postgame-media/control` before each claim. Control
and claim carry `x-render-generation`, `x-render-worker-digest` and
`x-render-worker-instance`. Only the accepted, undrained generation and exact
image digest can claim. Draining leaves existing lease heartbeats, constrained
uploads and finalization available, then the worker exits before another claim.
Remote polling needs no Compose host acknowledgement file. Child-process render
isolation remains in place; the child reports a typed attempt outcome to its
parent so an empty claim is distinguishable from completed/failed work.

The API owns a PostgreSQL release singleton plus permanent used-epoch records.
`GET /api/internal/postgame-media/release` returns
`{generation,workerDigest,draining,activeLeases}`. `POST` accepts
`{operation:"accept"|"drain",generation,workerDigest,previousGeneration}` using a
separate `POSTGAME_MEDIA_CONTROL_TOKEN`. `previousGeneration` is a compare-and-swap
fence (null for the first acceptance). Drain must name the current generation and
digest. Exact active acceptance replay is idempotent; retired epochs cannot be
readmitted, including rollback. Rollback selects the prior digest with a fresh
release epoch. The renderer bearer has no release-control authority.

PostgreSQL remains job authority. A migration trigger inserts a wake outbox row
in the same transaction as every queued enqueue/requeue, including older writers
during a rolling release. It never creates a second job in SQS. The active game
worker runtime dispatches at most ten notices per sweep and retries failures with
the same durable request ID. Configure on the API only:

```text
POSTGAME_MEDIA_WAKE_URL=https://<wake-function-url>/
POSTGAME_MEDIA_WAKE_SECRET=<dedicated wake signing secret>
POSTGAME_MEDIA_WAKE_ENVIRONMENT=prod
```

Environment accepts `prod` or `staging`. The exact JSON payload is
`{schemaVersion:1,operation:"wake",environment,requestId}`. `X-Render-Timestamp`
is epoch seconds; `X-Render-Signature` is the hexadecimal HMAC-SHA256 of timestamp,
newline, then exact body, with a five-minute receiver skew limit. No wake may
select a task image or release generation. Store the wake secret separately from
release-control credentials. Delivered outbox receipts expire after seven days;
undelivered notifications and used-generation tombstones retain their authority.

Every 30 seconds the active runtime repairs missing wakes for queued jobs or
expired leases. This covers bounded-batch leftovers, enqueue concurrent with
quiet exit, failed task launch and missed STOPPED notifications. Failed and
waiting-music jobs retain their current explicit retry behavior. Validation
candidates cannot dispatch before runtime acceptance. AWS must independently
retain one occupied task slot until ECS confirms STOPPED and reconcile uncertain
launches with a stable `RunTask` client token. With no work, there are no render
tasks; an approximately one-to-two-minute cold start is acceptable, not a latency
guarantee.

This application change does not configure secrets, expose staging networking,
provision AWS, switch release transport or disable the local production worker.
The separate [falsefloor/infra](https://github.com/falsefloor/infra) renderer stack
and generation-aware `linode-iac` host release adapter are required
before remote cutover. Live AWS state and a disposable real render remain unverified.

## W5 shared Werewolf delivery

Render input schema is now **2**, with required `kind: influence | werewolf`. Influence retains its existing cue timing and prepared music matrix. The Werewolf branch consumes an approved, strictly allowlisted opening-only teaser snapshot and hash-verified full Suno score. The shared coordinator queues completed visible Werewolf games after Mystery Cuts settle; empty/failed editorial work permits a cast-only teaser. The operator approved the sample, policy and score on 2026-10-05. `Dockerfile.render-worker` packages `music/werewolf/trailer-v1.wav`; worker health checks and renders verify its hash. No separate Werewolf worker or queue.

Deploy API snapshot producers and workers together. Old active schema-1 input snapshots are rejected by the new parser and require an explicit rerender; no permissive migration/fallback is provided. Already-published immutable bundles remain readable without parsing old input manifests. A local MP4 does not prove claim/upload/finalize or deployed playback.

Local review command (from repository root):

```sh
bun scripts/preview-werewolf-trailer.ts --game hazy-ruby-sand \
  --output .renders/werewolf-trailer/w5-v1 \
  --music-dir .renders/werewolf-music/suno-picks-v1
```

`--snapshot-only` freezes read-only canonical/publication input. `--from-snapshot FILE` renders that exact story without reloading the game. `--portrait-dir DIR` explicitly serves only the snapshot's named local portraits when the application API is stopped; it neither restores nor copies profile files. Local receipts pin source/policy/publication/music hashes. These commands do not create media jobs, upload or publish.


Both games use the same media endpoint, public player, share metadata and existing admin backfill/rerender actions. Automatic startup reconciliation includes both kinds; the Cuts worker also reconciles after Mystery publication or terminal failure. Per-game transaction locks serialize automatic/operator enqueue requests. A failed replacement retains the prior ready bundle. Hidden games cannot claim/publish new media, and the media endpoint independently checks visibility before returning any URLs. Existing immutable public objects cannot be revoked by hiding a game; this is the existing storage boundary, not private storage.

Old schema-1 jobs become an actionable `render_input` failure at claim rather than being silently skipped. Request a fresh render from the existing producer/admin control after deploying the coordinated API/web/worker release. `waiting_music` similarly uses the existing rerender recovery once the exact score is installed. Do not copy a `.renders` path into worker configuration.

Local W5 proof and remaining deployment boundaries are recorded in the [focused plan](../plans/2026-10-05-001-feat-werewolf-trailers-release-assets.md). No external upload or deployed-image smoke is implied by local tests.

Trailer captions are available through the native CC menu but are off by default in both the completed-game player and episode previews.


### Staging tailnet proof and mode changes

Staging keeps the existing canonical HTTPS origin
`https://influence-staging.tail8a79ed.ts.net`. AWS uses a userspace Tailscale sidecar
with task-scoped, single-use ephemeral identities (the lifecycle and approval
packet live in `falsefloor/infra`). A renderer starts only after sidecar health
proves the exact HTTPS origin. It requires the loopback HTTP proxy
`POSTGAME_MEDIA_HTTP_PROXY=http://127.0.0.1:1055` for remote tailnet policy. Bun API,
health and presigned upload requests use the explicit proxy and reject redirects;
Chromium uses the packaged wrapper for remote asset fetches while bypassing its
local Remotion bundle server. TLS hostname verification stays enabled. No bearer
header is supplied to asset requests or arbitrary upload origins.

The authenticated release endpoint exposes both effective database `mode` and
release-owned `execution` (environment, desired mode, network, origin and
`configDigest`). Every release mutation must present that exact config digest;
acceptance must match the desired mode. Local claims also lock the durable release
row, so a stale local-config API cannot bypass an accepted remote epoch. Drain
permits existing lease heartbeat/upload/finalization. `accept-local` reserves a
fresh generation and requires completed drain plus zero active leases when
changing ownership; retired generations never become reusable. The host separately
retains the last cloud generation for later re-enablement and fresh-epoch rollback.

For proof, use staging's separate database, controller state and credentials, a
completed visible fixture with its canonical story/editorial snapshot already
frozen, and the exact API/web/renderer manifest. Rendering itself performs no image
generation and calls no paid model API: it parses that stored snapshot, validates
packaged music, runs Chromium/Remotion and ffmpeg, and uploads/finalizes artifacts.
Preparing a new game, visual assets or House Cuts can invoke paid upstream workers;
reuse settled inputs instead. Fargate, networking and storage still incur cost.
The active game-worker owns durable wake delivery, so keep its API runtime available
without introducing new upstream generation. Verify enabled wake binding, one
completed render and playback, clean task exit, zero idle tasks, stale-epoch fencing
and fresh-epoch restoration before reviewing production's separate config change.
