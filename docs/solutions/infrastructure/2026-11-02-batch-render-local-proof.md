---
module: Render execution
tags: [batch, fargate, studio, private-storage, docker, streaming]
problem_type: integration
date: 2026-11-02
---

# First local Batch execution proof

The initial Studio cloud execution slice retained local preparation. A selected bundle is uploaded into the private bucket,
then a worker claims one durable execution, verifies every downloaded file,
encodes through the shared Remotion renderer and submits its receipt. Output
verification is a durable `verifying` stage outside the finalize HTTP request;
the worker continues renewing its lease until verified success.

The Docker proof uses an isolated database and local MinIO, an existing frozen
game bundle, and a two-second frame range. It makes no model/provider calls and
does not run Batch or change staging. Both native ARM64 and emulated x86_64 Docker
images completed this flow. The harness uses a synthetic execution-admission
digest; staging must prove its actual published immutable-image admission.

The native ARM64 artifact is `.renders/batch-proof-1793609261898/proof.json` with
job `7f381b22-5503-41b0-b959-b2d4fe095c2f`. Its downloaded MP4 is 1,094,958 bytes,
SHA-256 `4c79fb94ac57ebb6af25e207bc84e59be9968f7e5e62fbf9118aa0649616948a`.
The x86_64 staging-image artifact is `.renders/batch-proof-1793610686780/proof.json`,
job `d9899de9-3dc3-4f3a-a83d-fc295505c96e`, 1,103,644 bytes, SHA-256
`037de4b9e80f64db67df0cb7e285cbcd4af8cb5f6fb21d60f9112b6bcb2fcc7d`.
Both disposable databases were removed. Private bundle/video/log evidence is retained
locally. The local bucket retains test objects under each recorded job's
`renders/v1/<job-id>/` prefix and content-addressed input/receipt documents;
they are retained test evidence, not public assets. Do not delete shared
content-addressed payload objects without checking references.

Two portability issues were resolved during proof:

- The floating Bun base image hit a native `bufferutil` build failure without
  Python/compiler tools. The renderer now pins repository Bun 1.3.14 and installs
  build tools in the dependency stage.
- Under the local HTTP proxy, `Bun.write(path, response)` stalled on the first
  download while reading the same response into an array buffer completed. A
  Node streaming pipeline completed the transfer and avoided allocating the
  whole media object. This observation is specific to the tested runtime/proxy;
  it is not a claim about all Bun response writes.

The movie hash also streams from disk. Packaged provenance uses an explicit
source revision and dirty marker instead of requiring `.git` inside the image.

Validation retained in `/tmp/batch-*.log`:

- Provider-free baseline: 3,269 passed, five existing skips. Two focused render
  input/target policy tests passed afterward.
- PostgreSQL baseline: 2,312 passed on an isolated memory-backed Docker database,
  excluding the fixed-port staging-proof file. That file passed its eight tests
  separately on the documented port 54320.
- Final focused API tests: 100 passed across job, MCP, storage and Studio suites;
  seven final lifecycle tests passed after trailer-failure reconciliation was
  added. The subsequent assigned-trailer and lifecycle run passed all 30 tests,
  including scoped bridge credentials, cancellation, and exact-version publication
  repair after a lost completion response. A Batch trailer lease allows more
  assignments while an old-controller lease blocks cutover, avoiding a new
  single-concurrency admission bottleneck.
- Repository typecheck/lint and MCP schema freshness checks passed. Lint ran with
  Bun's runtime (`bun --bun run check`) after Node's dependency loader failed in
  `brace-expansion` before analyzing source.
- Companion infrastructure: 78 tests, typecheck, handler build, Batch synthesis
  and boundary synthesis passed without cloud credentials. Host target-policy
  parser: five tests passed.

Grok reviewed both repositories. Follow-up changes addressed durable output
verification, CLI replay, trailer assignment and failure repair, retained image
admission, task-scoped bearer injection, sidecar readiness, terminal identity
cleanup, exact staging origin/image pins, runtime boundaries and deploy-permission
artifacts. These source reviews do not establish live IAM acceptance or tailnet
connectivity.

The first staging test still needs the separately reviewed IAM installation,
staging-only credentials, image publication and explicit workload target selection
in the release-owned policy. See [the staging runbook](../../deployment/batch-render-staging.md).
Browser/MCP ordering was subsequently implemented and verified in [the continuation](2026-11-02-studio-browser-mcp-orders.md). Multipart transfer recovery, automatic retries,
proactive Batch task termination on cancel and six-hour acceptance remain parent
plan milestones. The legacy production singleton is retained until the explicit
post-migration cleanup PR; local development rendering remains supported.
