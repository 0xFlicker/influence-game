---
module: Render execution
tags: [studio, mcp, oauth, batch, private-storage, docker]
problem_type: integration
date: 2026-11-02
---

# Browser and MCP render orders

The initial cloud slice required CLI bundle preparation. Browser and agent orders
now freeze the descriptor and complete permitted source metadata through the API,
store that input in the existing private payload bucket, and let the assigned
worker run the shared source binder, audio checks, presentation compiler and
Remotion renderer. No producer session token reaches the worker.

The worker downloads its integrity-checked frozen input document and uses its
execution capability for only the exact media URLs retained in that source.
Those reads require a current execution lease and the same game. Cancellation
and retry fence old capabilities; general API/source browsing is unavailable.
The prepared-bundle CLI contract remains available and cannot inject a server
preparation payload through its upload route.

`producer:render` is a separate opt-in OAuth scope. Ordering, cancellation and
retry require that scope and current Producer/Sysop authority. Read/download
remain `producer` operations. The scope migration preserves every previously
valid grant and updates all four canonical constraints without upgrading any
existing token. Existing dynamic client registrations may need reconnecting if
their scope envelope omits the new scope.

Orders use a stable request key and exact input identity. Browser unknown-outcome
retries keep their original descriptor even after presentation settings change.
Retry requires the inspected execution ID: replaying that request after the new
attempt fails cannot silently spend on another execution. Missing input objects
prevent a retry from starting compute.

Local evidence on 2026-11-02:

- A real Chromium Studio test ordered a cut, lost the accepted response, changed
  FPS, retried the same body/key, and found exactly one job after navigation.
  It then cancelled and retried through the browser controls. The retained
  screenshot is `studio-cloud-render-order.png` in the platform temporary
  directory; the isolated DB was dropped.
- HTTP MCP tests cover separate consent, existing tag grants, exact replay,
  cancellation, role revocation and request/response schemas. Frozen media tests
  cover scenes, portraits, full-body art, another game's denial and cancellation.
- `.renders/order-proof-1793632979776/proof.json` records native ARM64 Docker
  renders ordered over HTTP MCP for Influence and Werewolf. Both output checksums
  match the movies downloaded through producer-authorized MCP.
- `.renders/order-proof-1793633407689/proof.json` records the same complete flow
  using the staging x86_64 image under local emulation. Output sizes are 111,489
  and 104,472 bytes. Both disposable databases were removed; private selections,
  movies and logs are retained. Temporary worker credentials were removed.
- These local harnesses use synthetic admission digests. They do not prove AWS
  admission, deployed OAuth grants, tailnet lifetime, actual Batch placement or
  six-hour behavior. No staging/production activation occurred.

Regression checks passed: the provider-free baseline (3,270 tests, five skips),
the added credential-redaction test, PostgreSQL baseline (2,319 tests on the
disposable Docker service plus eight fixed-port proof tests on port 54320),
14 focused final job/order/scope checks and a final three-test order recovery run.
Typecheck, lint, MCP schema freshness and test classification passed. Results are
retained in `/tmp/render-browser-mcp-*.log`. Browser tests restore their generated
Next route configuration and drop their own database; the task's extra Docker
PostgreSQL service is removed after validation.

The Docker proof exposed a missing `fullBodies` map in the capability's media
allowlist. Adding that structured map fixed the failed download; API coverage now
checks the retained body and portrait references as well as scene imagery.
Worker error diagnostics preserve paths while stripping task bearers and signed
URL query credentials.

Browser imports use checksum-bound private PUT grants. The bucket owner's explicit
CORS command merges a PUT-only rule for named HTTPS/localhost origins while
preserving unrelated rules. It has not been applied to staging. Staging IAM,
credentials, immutable image publication, OAuth re-consent and explicit workload
target selection remain the operator steps in [the runbook](../../deployment/batch-render-staging.md).

Multipart resumption, automatic transient retries, proactive Batch termination on
cancel and long-runtime acceptance remain later milestones. The explicit follow-up
PR still removes the production singleton after both workloads pass Batch
acceptance and the rollback window closes; local rendering remains supported.

## Global render monitor and combined localhost proof

`/admin/production/renders` now provides the Producer/Sysop monitor across games
and both shared workloads. It has active-first ordering, complete-result counts,
bounded keyset history, URL filters, execution details and the existing fenced
cancel/retry/private-download controls. It polls while visible, including when
empty, so new MCP orders appear. Current-role denial hides cached rows and counts.
The list and cancellation use relational metadata without reading object bodies;
retry still checks the frozen input objects before starting another execution.

The real Next dev browser proof in
`.renders/order-proof-1793638838872/proof.json` completed HTTP MCP orders for both
games, Docker source preparation/encoding, private MinIO upload and verification,
monitor status and actual browser downloads. The accepted/downloaded files are
111,716 and 104,379 bytes, with matching SHA-256 values. The proof's database was
removed and its owned services stopped. Run it with:

```sh
bun --env-file=<local-private-storage-env> scripts/verify-render-order-local.ts --browser
```

The screenshot `global-render-monitor-verified.png` in that directory shows the
two actual completed renders. `.renders/global-render-monitor-ux/` retains desktop,
expanded-failure and 390px mobile screenshots using synthetic presentation rows.
These UI fixtures are never dispatched and are distinct from encoded evidence.
Existing-controller trailers remain in their game-owned tools until migration.

Final monitor validation passed: **3,272 provider-free tests** (five existing
skips), **2,324 PostgreSQL tests** plus eight isolated fixed-port proof tests,
**38 final focused API tests**, and **three real browser tests** covering the
monitor, current-role revocation/non-producer denial and Studio order recovery.
All-package typecheck/lint, test classification and MCP schema freshness passed.
Logs are `/tmp/global-render-monitor-*.log`; the completed provider-free rerun is
`/tmp/global-render-monitor-provider-free-final2.log`. The temporary Docker
PostgreSQL service is removed after validation; existing local services remain.
AWS scheduling, reserved lanes, deployed OAuth/tailnet behavior and long-runtime
acceptance remain staging work. No staging or production activation occurred.
