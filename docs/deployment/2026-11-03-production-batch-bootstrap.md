# Production Batch bootstrap receipt

Executed 2026-11-03 with explicit operator approval for IAM, secrets and CORS.
This installs prerequisites. It does not deploy the production Batch runtime,
select a new renderer target, restart the application or submit a render.

## Approved source and IAM

- AWS account `978355607658`, region `us-west-1`, verified with the
  `falsefloor-agents` SSO administrator profile before mutation.
- Merged infra PR #25 source:
  `df6c6b9fe6d1ba2968674c8b6d5236c62e3fbf09`. Both IAM templates were synthesized
  from an isolated archive of that exact commit, without credentials or lookups.
- The synthesized boundary and inline policy documents exactly matched the
  merged review proposals before application. Change sets were inspected before
  execution; no runtime resources were included.

| Stack | Completed state | Template SHA-256 |
| --- | --- | --- |
| `HouseRenderBatchIam-prod` | `CREATE_COMPLETE` | `7a11ea1ffc192010896b81246787194b57c17dfa0b17ebb819f0619b3b5be57d` |
| `HouseRenderBatchIam-staging` | `UPDATE_COMPLETE` | `d8f019c38e5b1b9537136a8e5d7625ad0b06cb7c84a0b4d8a34d502be2c51fe6` |

Production adds the retained `HouseRenderBatchProdRuntimeBoundary` managed policy
and retained `HouseRenderBatchProdGitHubDeploy` /
`HouseRenderBatchProdCloudFormationExecution` roles, all under
`/house/render/prod/protected/`. Staging adds the region-bound
`batch:DescribeJobDefinitions` boundary permission; its execution-policy change
only reorders existing role resource lists. No IAM resource was replaced.

Live boundaries, role paths, trust documents and inline policies matched the
exact synthesized templates after completion. The existing GitHub OIDC subject
remains `repo:falsefloor@334422757/infra@1405952636:ref:refs/heads/main`.
The host and infra client-ID readbacks still identify the dedicated **The House
Render Releases** App, and the host's existing private-key secret is present.
No new GitHub App or installation was needed.

## Production secrets

| SSM parameter | Production Doppler secret |
| --- | --- |
| `/house/render/prod/batch-submit` | `RENDER_JOB_DISPATCH_SECRET` |
| `/house/render/prod/batch-worker` | `RENDER_JOB_SECRET` |

Both parameters are version 1, Standard `SecureString`, encrypted with
`alias/aws/ssm`. Doppler destination is `social-strategy-agent/prd`. The two new
values were generated in memory, are distinct from each other and from staging,
and matched across SSM and Doppler on private readback. No secret values or
secret hashes are recorded. Existing secrets were not rotated.

No plaintext secret file or secret-bearing process argument was used.

## Recording upload CORS

The existing private bucket `influence-transcript-events-prd` at
`https://us-iad-10.linodeobjects.com` was confirmed before mutation. Its previous
CORS rules were empty. The reviewed `ensure-private-content-bucket` helper was
bundled and run through stdin in the existing production API container, using
its existing storage credentials. Credentials remained inside the container.

The `house-studio-recording-uploads` rule now allows:

- Exactly `https://thehouse.game`.
- Method `PUT` only.
- Headers `content-type`, `content-length`, `if-none-match` and
  `x-amz-checksum-sha256`, with 300-second preflight caching.

Readback matched the rule and confirmed unrelated rules were preserved. A real
anonymous OPTIONS request for the production origin returned HTTP 200 with the
expected origin, PUT method and requested upload headers. The same request with
an unapproved origin returned HTTP 403 without an allow-origin header. No object
was uploaded, replaced or deleted; private download/public trailer rules were
not changed.

## Capacity and remaining release steps

Both staging render compute environments remain `DISABLED` / `VALID`. Regional
ECS inventory found zero active Fargate tasks at the final bootstrap inspection.
The applied regional On-Demand quota remains 8 vCPU; the request for 16
(`8422c2249f5b412da0f7d10cdc1464b2GQGmBpKD`) remains `CASE_OPENED`.
The planned two production lanes need 4 vCPU total. Recheck usage before release.

The existing production API remained healthy at commit
`6c89c00190409ee37238934dbc0123b10edd9adb`, with its existing remote/direct policy.
No production Batch runtime was deployed during this bootstrap.

At completion, host PR [#81](https://github.com/0xFlicker/linode-iac/pull/81) and
application PR [#286](https://github.com/0xFlicker/influence-game/pull/286) were
still open. Merge the host capability before the application policy. The normal
exact-candidate production approval and the production acceptance checks in
[the release runbook](batch-render-production.md) remain required. Staging
rendering stays paused; no additional staging render order is required here.
