# Batch rendering release preparation

Prepared 2026-11-02. The localhost render completed and its port-3003 child was
cleaned up at the user's request. The application now incorporates current main
and the three conflict resolutions. This packet prepares source review and a
staging release; cloud provisioning and target activation remain separate steps.
Keep current renderer targets until the corresponding acceptance/activation step.

## Three implementation PRs

| Repository / branch | Review scope | Landing dependency |
| --- | --- | --- |
| `0xFlicker/linode-iac` / `codex/batch-renderer-target-policy` | Strict workload target policy, staging Batch runtime preflight, release/rollback guidance | Land before any application policy selects Batch |
| `falsefloor/infra` / `codex/shared-batch-rendering` | Two protected Batch lanes, signed submitter/ledger, staging network broker/cleanup, dedicated staging IAM/deploy roles and manual packaging/deployment workflow | Review source and IAM before provisioning; deploy after the exact candidate worker is mirrored |
| `0xFlicker/influence-game` / `codex/shared-batch-rendering` | Durable jobs and object storage, worker, Studio/MCP order/status/download, global monitor, local worker and migrations | Finish localhost evaluation and required checks before capability release |

PRs: [application #278](https://github.com/0xFlicker/influence-game/pull/278),
[infrastructure #23](https://github.com/falsefloor/infra/pull/23), and
[host #78](https://github.com/0xFlicker/linode-iac/pull/78).

The application capability release keeps the checked-in target policy unchanged.
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
5. Dispatch infrastructure workflow `house-render-batch-staging-deploy.yml` on
   reviewed main using the exact mirrored worker/sidecar references, canonical
   `https://influence-staging.tail8a79ed.ts.net`, three SSM parameter ARNs and the
   Batch runtime boundary ARN. Review its exact stack, IAM, quotas, subnet
   capacity and cleanup behavior. Record the resulting `SubmitUrl` and admitted
   definition revisions.
6. Install staging Doppler values `RENDER_JOB_DISPATCH_URL`,
   `RENDER_JOB_DISPATCH_SECRET`, `RENDER_JOB_SECRET`, and
   `RENDER_JOB_WORKER_DIGEST`. Their URL, secrets and digest must match the
   provisioned stack and candidate renderer. The host preflight checks local
   configuration; operator proof establishes live equality and reachability.
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

- Exact app/host/infra revisions and PRs, immutable image family, mirror receipt,
  raw policy digest, synthesized templates and reviewed IAM proposal hashes.
- Required application baselines plus host/infra contract checks and successful
  packaging of the synthesized staging Batch assembly without AWS credentials.
- Localhost user evaluation outcome, separately from automated fixture evidence.
- Cloud stack outputs and actual browser/MCP/Fargate/storage/capacity/long-runtime
  evidence only after those steps execute. Leave these pending during preparation.

The detailed [staging runbook](batch-render-staging.md) defines the job protocol,
consent, private output access, failure cases and acceptance gates.
