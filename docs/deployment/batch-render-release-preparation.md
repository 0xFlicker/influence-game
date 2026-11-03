# Batch rendering release preparation

Updated 2026-11-02. Localhost evaluation is complete, the port-3003 render process
was cleaned up, and the capability and companion PRs are merged. This release
prepares staging Studio-export activation. The checked-in policy selects Batch
for Studio exports; the live target changes only after the normal release
deploys and verifies the Batch runtime. Production activation remains separate.

## Coordinated implementation PRs

| Repository / branch | Review scope | Landing dependency |
| --- | --- | --- |
| `0xFlicker/linode-iac` / `codex/batch-renderer-target-policy` | Strict workload target policy, staging Batch runtime preflight, release/rollback guidance | Land before any application policy selects Batch |
| `falsefloor/infra` / `codex/shared-batch-rendering` | Two protected Batch lanes, signed submitter/ledger, staging network broker/cleanup, dedicated staging IAM/deploy roles and automatic release admission | Review source and IAM before provisioning; app release invokes admission after exact worker publication |
| `0xFlicker/linode-iac` / `codex/automatic-batch-release` | Independently verify infra admission before host access; persist submission route and derive worker digest from the verified release | Follow-up to merged #78; land before updated app release wiring |
| `0xFlicker/influence-game` / `codex/shared-batch-rendering` | Durable jobs and object storage, worker, Studio/MCP order/status/download, global monitor, local worker and migrations | Finish localhost evaluation and required checks before capability release |

Merged prerequisites: [application #278](https://github.com/0xFlicker/influence-game/pull/278),
[infrastructure #23](https://github.com/falsefloor/infra/pull/23),
[host #78](https://github.com/0xFlicker/linode-iac/pull/78),
[host #79](https://github.com/0xFlicker/linode-iac/pull/79), and
[host #80](https://github.com/0xFlicker/linode-iac/pull/80). The last connects the
dedicated App chosen during bootstrap. No companion source PR is required for
this Studio-only target selection.

The application capability release kept the target policy unchanged.
The resolved merge preserves main's presentation parity guidance and CLI
`REPLAY_BROWSER_EXECUTABLE`, and passes the worker's browser explicitly through
replay preparation and encoding. Native source identity changes with revisions;
new orders use the reviewed current source instead of silently changing old jobs.

Cleanup exposed a real finalization gap: the native runtime had not started the
shared reconciliation loop. That startup wiring is fixed; accepted verification
is now owned durably by the server and survives worker exit/lease expiry while
remaining fenced against cancel/retry. The original uploaded movie recovered to
verified success without re-encoding. See the
[recovery evidence](../solutions/infrastructure/2026-11-02-native-render-finalization-recovery.md).

## Staging Studio activation

The policy in this release is:

| Environment | Studio exports | Trailers |
| --- | --- | --- |
| Staging | AWS Batch | Legacy trailer controller (`existing`) |
| Production | Unchanged; Studio cloud rendering unavailable | Unchanged |

The `existing` label refers to trailer routing; it is not an operational Studio
renderer. Native development and CLI rendering remain available.

Merging this PR starts ordinary main CI. Successful release CI builds the exact
API/web/worker family, mirrors the worker to staging ECR, invokes the private
infra workflow to provision/update and admit `HouseRenderBatch-staging`, then
dispatches the host deployment. Failed Batch admission prevents host dispatch.
Both Batch lanes are provisioned, but only Studio exports route to Batch in this
release. No manual Batch workflow dispatch or per-image secret edit is needed.
Production still requires its separate approval; this PR does not select Batch
there. The raw shared policy digest changes, so all three images must come from
this release even though production's selected settings are unchanged.

After deployment:

1. Record the main CI, worker mirror, infra admission and host deployment run
   identities. Confirm API health reports this candidate and its policy digest,
   and staging OAuth discovery advertises `producer:render`.
2. Reconnect the staging MCP client with `producer producer:render` and use a
   producer browser session. Registration/consent may precede activation once
   the capability release is deployed; it does not grant authority retroactively.
3. Order a small previously accepted cut in Studio, follow its job at
   `/admin/production/renders`, and look up the same ID through MCP. Inspect
   worker claim/heartbeat, upload, verification and verified success; obtain a
   fresh producer download and compare its length/hash with the accepted output.
4. Prove a second small order through MCP, covering the other game. Retain the
   source selection, job/execution IDs, AWS logs, output integrity and task/
   tailnet cleanup evidence. No game/model/image/TTS generation is needed.

The initial export lane admits one execution. A task reserves 4 vCPU / 8 GiB
including its sidecar; provisioned queues do not by themselves run render tasks.
The bootstrap observed an 8-vCPU regional Fargate ceiling shared with other
workloads. Placement, failures/cancellation, uploads and long-runtime behavior
still need live staging proof; a short render does not establish six-hour
readiness. Trailer migration, reserved-lane contention tests and the explicit
legacy-production-renderer cleanup PR remain subsequent milestones below.

For rollback after activation, stop ordering new exports and inspect/cancel any
active test execution, verifying task exit and tailnet cleanup. Revert this
release's staging `targets` addition through the normal policy release. This
disables new Studio cloud orders; it does not redirect them to another worker
or automatically terminate an in-flight task. Keep accepted output objects and
job evidence, and retain the Batch stack/definitions through the rollback window.

## Staging operator sequence

1. Finish localhost evaluation; resolve its findings and rerun affected checks.
   Review the three PRs and the IAM proposal/template artifacts. Do not infer
   Fargate/IAM/tailnet readiness from local checks or small fixture renders.
2. Land the host capability before any target switch. Land reviewed infrastructure
   source and, through its separate operator authority, provision the retained
   `HouseRenderBatchIam-staging` boundary/deployment roles. Its CI role cannot
   bootstrap IAM, install secrets or create the Batch service-linked role.
3. Release API/web/renderer from the reviewed application revision and apply
   migrations `0143_render_jobs` and `0144_producer_render_scope` through the
   normal staging release. Record all three immutable image references, raw
   policy digest and the digest-preserving renderer ECR mirror receipt.
4. Provision distinct staging Batch submission/execution Standard SecureStrings
   at `/house/render/staging/batch-submit` and `batch-worker`; each needs at least
   32 random characters. Reuse the reviewed staging-only Tailscale OAuth
   parameter and exact staging ECR sidecar. No secret values belong in PRs,
   artifacts, journals or workflow inputs.
5. The one-time bootstrap is installed; see the
   [staging bootstrap receipt](2026-11-02-staging-batch-bootstrap.md).
   The dedicated **The House Render Releases** App has Actions write/Contents
   read and no webhook. App and host conditional Batch steps use
   `HOUSE_RENDER_APP_CLIENT_ID` / `HOUSE_RENDER_APP_PRIVATE_KEY`; their existing
   `GH_APP_*` consumers stay unchanged. Infra's `GH_APP_*` values identify the
   dedicated App and its source reader requests read only. Infra variable
   `HOUSE_RENDER_STAGING_TAILNET_IMAGE` pins the verified deployed sidecar.
   Review stack IAM, quotas, subnet capacity and cleanup behavior before activation.
6. Install only the distinct staging keys in Doppler as
   `RENDER_JOB_DISPATCH_SECRET` and `RENDER_JOB_SECRET`, matching the two SSM
   parameters. New worker digests and submission URLs are release-owned values:
   no Doppler edit or manual Batch deployment is required for each release.
7. Configure the existing private bucket for recording PUTs from the exact
   staging Studio origin. The packaged API helper is
   `dist/ensure-private-content-bucket.js --render-cors-origin https://influence-staging.tail8a79ed.ts.net`;
   run it with staging-only storage credentials through the existing owner. It
   preserves unrelated rules. Public trailer GET/HEAD CORS is separate.
8. Reconnect/register the staging MCP client with `producer producer:render` and
   authenticate a current producer browser session. Existing producer grants do
   not gain render authority through deployment or token refresh.
9. Publish a separate explicit policy release with staging targets
   `{"trailer":"existing","studio-export":"aws-batch"}`. Preserve the canonical
   network/origin and production entry. The new image family, Batch definitions
   and admitted worker digest must agree for each activation release. Reuse a
   previously accepted cut; do not generate game/model/image/TTS content.
    The normal release automatically performs CI selection → digest-preserving
    mirror → infra Batch deployment/admission → host deployment. Infra accepts
    only source/mirror run identities and receipt hashes, independently verifies
    ordinary successful main CI, raw target policy and the completed mirror job,
    and derives fixed staging parameters. It retains its own main-only AWS role.
    The app waits for the exact dispatch-returned infra run, verifies its artifact,
    and forwards only admission provenance to the host. The host rechecks that
    receipt before Tailscale/SSH access, binds it to both extracted image policies,
    journals the route, and derives the runtime worker digest from the release.
    Missing, failed, timed-out or mismatched admission blocks host dispatch.
    Existing-target releases skip Batch; production automation is unchanged.
10. Prove browser order and global status at `/admin/production/renders`, MCP
    job-ID lookup, worker claim/heartbeat/upload, object verification, producer
    download, hash/length integrity, task exit and tailnet identity removal.
    Inspect both Influence and Werewolf exports. Exercise cancellation, explicit
    retry and lost-submission recovery.
11. Drain the old trailer target and reconcile active/uncertain tasks and leases
    before a later staging policy release selects trailer `aws-batch`. Reuse
    existing canonical trailer inputs. Prove public publication/playback for both
    games and trailer startup while the export lane is occupied.
12. Complete representative long-runtime/full-size upload proof and rollback
    rehearsal. Preserve pinned definitions for accepted jobs and retain the old
    renderer through the agreed rollback window.

Production provisioning/activation is a later environment rollout. The mandatory
legacy production renderer cleanup follows acceptance of both workloads in both
environments and rollback-window closure; retain native local/CLI rendering.
The cleanup remains tracked under W13 and the shared render plan.

## Automatic-release follow-up validation

The host target-policy PR #78 is merged. Host #79 and updated infra #23 have green
credential-free CI. Local checks cover 17 app Python release/admission cases,
49 infra Python cases, 79 infra Bun cases, nine sidecar cases, six host admission/
readiness cases, six host handoff cases and the existing host deploy/storage/
secret/network contracts. The actual helper roundtrip passed from source CI and
mirror evidence through deployed-stack receipt construction to independent app
and host verification. Workflow lint passed; current official token-action
metadata confirms `client-id`, which the linter's bundled catalog predates.
The Batch runtime assembly synthesizes and its handlers import without AWS access.

One existing app workflow assertion expected dispatch immediately after mirroring.
It now evaluates the actual guard for Batch admission success/failure/skip, mirror
failure, existing-target bypass and cancellation. The fresh full baseline passed:
3,304 tests, five existing skips, zero failures. Typecheck/lint and MCP schema
freshness also passed. Earlier app CI reported Format viewer and Werewolf
browser-story failures; current-head CI remains the authority for release checks.
These local/offline checks do not establish deployed Batch or staging acceptance.

## Evidence to attach before activation

Preparation validation on the current application revision (before the held main
merge): typecheck/lint and MCP schema freshness passed; provider-free baseline
passed 3,275 tests with five existing skips. The initial sandboxed baseline could
not bind ephemeral server ports; the complete rerun outside the sandbox passed.
The PostgreSQL baseline passed all 2,336 tests across 214 files on a fresh
disposable database at port 54320, which was removed afterward. The shared test
database had a stale render-job schema and was not used as the release proof.
The development database and running render services are unchanged.

Companion local checks passed: 79 infrastructure Bun tests, 42 Python source/
deployment tests, nine sidecar tests, handler checks, runtime/IAM synthesis and
packaging of the actual synthesized staging assembly; host configuration,
staging/production handoff, deployment and secret/network contracts also passed.
Both companion PR checks are green:
[infra check](https://github.com/falsefloor/infra/actions/runs/41513688079) and
[host Secretless Validate](https://github.com/0xFlicker/linode-iac/actions/runs/41513480258).
Post-merge candidate checks and fresh browser/encoded proof are recorded below
before review readiness. These checks do not establish cloud/staging acceptance.

### Post-merge review evidence

- Current-main merge is resolved in all three affected files. The standalone CLI
  keeps its browser override; assigned workers pass their configured browser
  through the same layout prepass and final encode.
- Provider-free baseline: 3,304 passed, five existing skips. Typecheck, lint,
  frozen-lockfile installation and MCP schema freshness passed.
- Render finalization regressions: 12 passed, including worker lease expiry,
  cancellation during verification and an older integrity failure racing a retry.
- Affected real-browser stories: three passed (Studio order recovery, monitor
  navigation/filter/actions and producer revocation), with disposable DB cleanup.
- Fresh native/browser/MCP proof:
  `.renders/order-proof-1793654994286/proof.json`. Both games rendered successfully
  through the ordinary shared reconciler; private downloads matched SHA-256 and
  byte length in both API/MCP and browser paths. The disposable DB was removed.
- Fresh viewer/Studio-export proof:
  `.renders/batch-review-parity-us8ykY/comparison.json`. Forty sampled comparisons
  at 1280×720 and 640×360 matched exactly, including reverse-order sampling. Two
  new H.264 videos were decoded and checked; encoded-frame mean differences were
  1.88–3.03 on the 0–255 channel scale. Images were inspected. This is the existing
  deterministic fixture matrix, not a new full-game or six-hour cloud proof.
- Full PostgreSQL baseline and exact-head CI results are recorded in application
  PR #278. The later verification-fence change is API-only; it does not change
  the rendered picture or require replacing the saved browser/encode evidence.

- Exact app/host/infra revisions and PRs, immutable image family, mirror receipt,
  raw policy digest, synthesized templates and reviewed IAM proposal hashes.
- Required application baselines plus host/infra contract checks and successful
  packaging of the synthesized staging Batch assembly without AWS credentials.
- Localhost user evaluation outcome, separately from automated fixture evidence.
- Cloud stack outputs and actual browser/MCP/Fargate/storage/capacity/long-runtime
  evidence only after those steps execute. Leave these pending during preparation.

The detailed [staging runbook](batch-render-staging.md) defines the job protocol,
consent, private output access, failure cases and acceptance gates.
