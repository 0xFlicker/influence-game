# House Highlights Render Worker

The production image is `ghcr.io/0xflicker/influence-render-worker`. Main builds publish a short commit SHA and `staging`; ephemeral PR builds publish `pr-N`.

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
REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
```

`POSTGAME_MEDIA_LEASE_MS` is owned by the API, not this container. Store the worker token as a deployment secret, redact it from logs, and rotate it using the API's current-plus-previous token support. The worker receives API-issued upload targets and has no object-storage credentials, bucket keys, or other `LINODE_OBJ_*` secrets.

The image ships Chromium, ffmpeg, CA certificates, fontconfig/Liberation/Noto fonts, web public visual assets, and the 24 prepared tracks at `/app/music/house-highlights-variants`. It sets `REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium`, so Remotion uses the installed browser rather than downloading one at render time.

`POSTGAME_MEDIA_HTTP_TIMEOUT_MS` defaults to 15,000 ms and bounds worker API and health requests. `POSTGAME_MEDIA_UPLOAD_TIMEOUT_MS` defaults to 300,000 ms so a normal 1080p trailer can upload on a slower object-storage connection without disabling API timeouts. Errors are categorized without logging response bodies or signed upload URLs.

`POSTGAME_MEDIA_TEMP_DIR` defaults to `/tmp/influence-render-worker`. `POSTGAME_MEDIA_MIN_FREE_BYTES` is an explicit, tunable preflight floor and defaults to 2 GiB (`2147483648` bytes). Mount or provision at least that much writable local disk for this directory, or raise the value when expected render size warrants it; the worker checks free space before claiming work and removes claim output after each attempt. Deploy one worker process with concurrency 1.

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

Queue a completed game from **Admin -> Game History -> Trailer -> Backfill**.
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
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -show_entries format=duration -of json /tmp/house-highlights-smoke.mp4
find /tmp/influence-render-worker-smoke -mindepth 1 -print
```

The probe must show H.264 video, AAC audio, 1920x1080 dimensions, and a nonzero
duration matching the public read model. The final `find` must print nothing when
the worker temp directory is bind-mounted for inspection.

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

Add a third service beside `api` and `web`, pinned to the same promoted short-SHA
release family:

```yaml
render-worker:
  image: ghcr.io/0xflicker/influence-render-worker:${INFLUENCE_IMAGE_TAG}
  restart: unless-stopped
  depends_on:
    api:
      condition: service_healthy
  environment:
    POSTGAME_MEDIA_API_URL: http://api:3001
    POSTGAME_MEDIA_WORKER_TOKEN: ${POSTGAME_MEDIA_WORKER_TOKEN}
    POSTGAME_MEDIA_POLL_INTERVAL_MS: "5000"
    POSTGAME_MEDIA_HTTP_TIMEOUT_MS: "15000"
    POSTGAME_MEDIA_UPLOAD_TIMEOUT_MS: "300000"
    POSTGAME_MEDIA_TEMP_DIR: /tmp/influence-render-worker
    POSTGAME_MEDIA_MIN_FREE_BYTES: "2147483648"
    REMOTION_BROWSER_EXECUTABLE: /usr/bin/chromium
  volumes:
    - /var/lib/influence/render-worker-tmp:/tmp/influence-render-worker
  stop_grace_period: 30s
```

Also add the current worker token to the API service, provision at least 2 GiB
free on the temp mount, and keep one replica. Do not add public ports or object-
storage credentials to the worker. The image's Docker healthcheck runs `--health`;
deployment validation must use the existing admin backfill path with an approved
disposable completed game, then confirm public player playback and the `ffprobe`
checks above in staging before promoting the same immutable SHA to production.

CI publishes:

- `ghcr.io/0xflicker/influence-render-worker:<short-sha>` and `:staging` from `main`;
- `ghcr.io/0xflicker/influence-render-worker:pr-<number>` for ephemeral PR builds.

The `linode-iac` deployment should pin the same selected immutable SHA for API,
web, and worker. Moving `staging` and `latest` tags may remain discovery aliases,
but are never runtime deployment inputs. Rollback restores the prior immutable
three-image release; queued/leased jobs remain API-owned and can be reclaimed
after their lease expires.
