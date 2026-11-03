# Production Batch rendering release

Prepared 2026-11-03. This change selects AWS Batch for both production trailers
and Studio exports. The activation follows the existing human-approved production
release; preparing or merging infrastructure source does not run production jobs.

## Release sequence

1. Merge the `falsefloor/infra` production Batch capability and the `linode-iac`
   production admission/host integration before the application policy release.
   Keep the application PR unmerged until the operator bootstrap below is done.
2. Review and apply `HouseRenderBatchIam-prod` from the exact merged infra revision.
   It provisions the production Batch runtime boundary and dedicated GitHub deploy
   and CloudFormation execution roles. Refresh `HouseRenderBatchIam-staging` too:
   retained-version lookup adds the region-bound `batch:DescribeJobDefinitions`
   read permission. Runtime CI cannot provision either IAM stack.
3. Install distinct, random production submission and execution HMACs (at least
   32 characters) as standard SecureStrings encrypted with `aws/ssm`:
   `/house/render/prod/batch-submit` and `/house/render/prod/batch-worker`.
   Install the same respective values in production Doppler as
   `RENDER_JOB_DISPATCH_SECRET` and `RENDER_JOB_SECRET`. Compare equality privately;
   never print either value or put it in a PR, workflow input or receipt.
4. Verify existing production ECR publication and network foundations. The live
   audit found `HOUSE_PROD_RENDER_IMAGES_ENABLED=true`, `HouseRenderProdImages`,
   the production VPC/subnet/security-group exports and the legacy control stack.
   Reuse them. The dedicated House Render Releases App credentials already used
   by the host's staging consumer are also used for production Batch admission;
   no broader App installation or new human approval workflow is needed.
5. Obtain regional quota headroom before activation. The audited Fargate
   On-Demand quota was 8 vCPU; request
   `8422c2249f5b412da0f7d10cdc1464b2GQGmBpKD` asks for 16 and was pending at
   preparation time. Staging render compute environments were explicitly paused
   (`DISABLED`, `VALID`) with no nonterminal jobs on 2026-11-03; the infrastructure
   proposal preserves that pause. Idle staging now consumes zero Fargate vCPU.
   Both production lanes reserve 4 vCPU total, with other Fargate workloads sharing
   the quota. Recheck actual usage/headroom before activation. Re-enabling both
   staging lanes would require another 8 vCPU; separate queues cannot reserve
   regional quota against unrelated tasks.
6. Merge the application policy PR. Ordinary main CI publishes the exact
   API/web/worker family, performs staging admission/deployment and staging E2E,
   and mirrors the same worker digest to production ECR. Additional staging render
   orders are deferred while its compute environments remain paused. The existing
   staging acceptance evidence remains available; verify the retained-definition
   path with the production canary and release-overlap checks below.
7. Review the resulting exact-candidate production approval request. After the
   existing public `production` environment approval is consumed, the private
   host workflow automatically dispatches infra's production Batch workflow.
   Infra independently verifies that approval, successful main CI, the policy,
   completed ECR publication and exact image family before AWS credentials.
   The host then verifies the returned, attempt-bound admission before connecting
   to production. There is no additional manual Batch deployment job.
8. The host refreshes its private runtime source, rejects missing/mismatched
   admission or keys before service drain, and persists the accepted Batch URL
   and worker digest in its release journal and configured API color. Recovery
   reuses that admission; same-release restarts can read the accepted receipt.
   Doppler owns keys, not per-release routing or image identity.

Production uses `https://thehouse.game` directly, with no Tailscale sidecar,
OAuth broker or network credential in the worker. `HouseRenderBatch-prod` has
one trailer task and one Studio-export task, each 2 vCPU / 4 GiB with 50 GiB
scratch. Trailer timeout is one hour; export timeout is eight hours. These are
initial bounds, not proof that every six-hour/full-resolution export will fit.

## Storage, browser and MCP acceptance

Before the switch, inventory production's ready, failed, waiting, queued and
claimed trailer rows, current-ready versions, input hashes, leases, tasks and
uncertain uploads. Let the normal fenced handoff drain existing claims. Never
bulk-rerender ready trailers or automatically retry failed/waiting inputs.

The production bucket owner must add the PUT-only recording CORS rule for the
exact origin `https://thehouse.game`, preserving unrelated rules, with the
application's `ensure-private-content-bucket` helper. Reuse the private bucket;
it remains separate from public trailer media. Private export downloads require
current producer authority and expire. Public trailers publish only after the
existing four-object verification; old versions remain immutable and remain
playback authority while replacement work is pending.

After the approved deployment:

- Confirm canonical health, policy digest, accepted renderer generation and
  admitted worker all match the candidate. Test the direct AWS-to-production
  callback path; a successful Linode-side probe is not that proof.
- Order one bounded existing cut through Studio and one through MCP with
  `producer producer:render`. Reconnect the production client if its old grant
  lacks `producer:render`; refresh never adds it automatically. Save job IDs and
  prove later status lookup and fresh producer downloads with matching hashes.
- Use the existing per-game rerender action once for an Influence trailer and
  once for Werewolf. Keep accepted content/music; generate no game/model/media
  inputs. Compare frozen input hashes and current-ready versions, then verify
  video, poster, captions and manifest, public range/CORS and browser playback.
- Prove trailer startup during an export, worker/task exit, cancellation and
  explicit retry, then representative long-runtime/full-size upload behavior.
  Follow jobs at `/admin/production/renders`.
- During a release, keep an old-image job awaiting first submission. It must
  resolve only an ACTIVE retained definition with that exact image, environment
  and workload; it must never be retargeted to the new image. Already reserved
  executions keep their recorded definition. New definitions use AWS's
  `SkipDeregisterOnUpdate` setting so old admissions remain usable.

Image retention also includes every nonterminal shared job's worker digest,
read inside the API container without exporting database credentials. Old job
definitions alone do not prevent ECR image expiry.

The staging migration already proved real Influence (44.8 s) and Werewolf (9 s)
trailers, an export with 79.549 seconds of overlapping Batch RUNNING time,
hash/length checks, public playback and worker/network cleanup. That evidence
does not replace the production or long-runtime acceptance above.

## Rollback and explicit cleanup PR

Inspect and reconcile active/queued jobs and uncertain uploads before a target
rollback. Release a reviewed policy restoring the previous trailer target and
disabling new Studio cloud orders through the same host fence. Preserve frozen
inputs, verified outputs, job evidence and old ACTIVE definitions through the
rollback window. Existing private MP4s and public versions are not deleted.

After both workloads pass in staging and production and the rollback window
closes, land an explicit follow-up PR: **Remove the legacy single-concurrency
production Fargate renderer**. Remove its application wake/claim/control paths,
host adapter and obsolete ECS/controller/IAM resources and credentials. Preserve
the shared network/ECR/storage foundations and the local development/CLI
renderer. This cleanup remains tracked by W13 in `docs/refactor-queue.md`.
