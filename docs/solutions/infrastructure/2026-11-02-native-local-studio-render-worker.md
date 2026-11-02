---
module: Render execution
tags: [studio, mcp, local-worker, private-storage, native]
problem_type: integration
date: 2026-11-02
---

# Native localhost Studio export worker

The ordinary local render poller now handles Studio exports as well as trailers.
Use `bun run dev:render-worker` alongside the API and web, then choose
**Selected cut → Export → Render video**. The export remains visible at
`/admin/production/renders`, including orders placed over MCP with
`producer:render` consent. No render container, new queue or local scheduler is
introduced.

Each existing isolated attempt first checks ready trailers, then checks for a
Studio export. Local discovery requires the development/local/direct policy, a
loopback API hostname and the existing worker credential. It returns one
execution-scoped capability, without reserving the row. The same assigned-worker
claim used by Batch atomically starts the execution; competing discoveries cannot
render the same execution twice. A process lost between discovery and claim leaves
the job queued. Existing leases, failure reporting, explicit retries, private
uploads, asynchronous verification and producer download grants remain shared.

The local build digest covers the revision and changed renderer source/assets,
including untracked source, while excluding tests. It is a native source identity,
not a container-image admission claim. Queued exports for an obsolete build fail
with `renderer_unavailable`; they require a new order instead of silently changing
the renderer. Active local development is not an immutable container environment.
The API derives a domain-separated local execution key from its session secret;
workers receive only the exact job capability. Deployed policies never expose
local discovery or implicitly enable Studio exports.

Private production media uses the job-scoped endpoint. Public uploaded portraits
continue through their ordinary unauthenticated URL, without receiving the job
credential. A regression covers public/private/external routing. Worktrees sharing
the development database must share its existing filesystem-upload directory;
this session restored that API configuration without copying or regenerating
assets. Two older queued trailers (`zero-lilac-jade`, `jade-violet-crane`) failed
before the directory was restored; their recorded failures remain available for
explicit game-owned retry. Subsequent queued trailers completed normally.

## Verification

Repeat the isolated proof with local PostgreSQL/MinIO credentials and installed
Chrome/Chromium plus ffmpeg:

```sh
bun --env-file=<local-private-storage-env> scripts/verify-render-order-local.ts --native --browser
```

The final proof is `.renders/order-proof-1793642853028/proof.json`. Both Influence
and Werewolf cuts were ordered through real HTTP MCP, discovered by the native
worker, prepared, encoded, uploaded to MinIO, verified and downloaded through the
real Next dev monitor. Browser downloads matched SHA-256 and length (119,368 and
111,424 bytes). The database and owned harness processes were removed; selections,
videos, screenshots and logs remain. The persistent localhost poller remains
running for operator testing. The separate long-running export on port 3003 was
left untouched.

Checks passed: 3,275 provider-free tests (five existing skips), 39 focused policy/
worker/media tests, 40 final focused PostgreSQL tests, three browser tests,
all-package typecheck/lint, classification and MCP schema freshness.

The broad PostgreSQL command used the disposable service on port 54329: 2,326
tests passed, and the staging-proof suite rejected that port during setup because
its guard explicitly requires port 54320. All eight tests in that suite then
passed separately on the required service using their own disposable database and
principal. This is split baseline coverage, not a claim that the original single
command exited successfully. Logs are `/tmp/local-render-worker-*.log`.

Linux packaging, actual Batch placement/capacity, IAM, tailnet lifecycle and
long-runtime acceptance remain Docker/staging checks. No deployment, AWS job,
provider generation or production target change occurred.
