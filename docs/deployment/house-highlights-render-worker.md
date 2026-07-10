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

`health` is non-mutating: it validates worker configuration, ffmpeg, the configured Chromium executable, the 24-file prepared music matrix, temp space, and `GET /api/health`. `smoke` runs the same claim/render/upload/finalize path as the poller and exits nonzero unless it completes a queued completed-game job. Run smoke only against a disposable or intentionally queued local job, then inspect the finalized MP4 with `ffprobe`.

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
POSTGAME_MEDIA_TEMP_DIR=/tmp/influence-render-worker
POSTGAME_MEDIA_MIN_FREE_BYTES=2147483648
REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
```

`POSTGAME_MEDIA_LEASE_MS` is owned by the API, not this container. Store the worker token as a deployment secret, redact it from logs, and rotate it using the API's current-plus-previous token support. The worker receives API-issued upload targets and has no object-storage credentials, bucket keys, or other `LINODE_OBJ_*` secrets.

The image ships Chromium, ffmpeg, CA certificates, fontconfig/Liberation/Noto fonts, web public visual assets, and the 24 prepared tracks at `/app/music/house-highlights-variants`. It sets `REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium`, so Remotion uses the installed browser rather than downloading one at render time.

`POSTGAME_MEDIA_HTTP_TIMEOUT_MS` defaults to 15,000 ms and bounds worker API, health, and API-issued upload requests. This keeps the poller from hanging indefinitely when the API or an upload target stops responding; errors are categorized without logging response bodies or signed upload URLs.

`POSTGAME_MEDIA_TEMP_DIR` defaults to `/tmp/influence-render-worker`. `POSTGAME_MEDIA_MIN_FREE_BYTES` is an explicit, tunable preflight floor and defaults to 2 GiB (`2147483648` bytes). Mount or provision at least that much writable local disk for this directory, or raise the value when expected render size warrants it; the worker checks free space before claiming work and removes claim output after each attempt. Deploy one worker process with concurrency 1. A later deployment handoff can add the concrete Linode service, volumes, and monitoring wiring.
