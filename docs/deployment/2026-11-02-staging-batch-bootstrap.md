# Staging Batch bootstrap receipt

Executed 2026-11-02 America/Denver (2026-11-03 UTC), with explicit operator
authorization. This installs prerequisites; it does not select Batch, deploy the
Batch runtime stack, submit a render, or change production.

## AWS

- Account `978355607658`, region `us-west-1`, verified through the
  `falsefloor-agents` SSO administrator profile before mutation.
- Merged infra source: `0717c20f188cfe6990410b015531f43290e57747`; IAM files match
  reviewed implementation `50fbd76a83269cde4c1a6afb2d3e10c1714f4cd5`.
- Stack `HouseRenderBatchIam-staging`: `CREATE_COMPLETE`. Its reviewed template
  SHA-256 is `af2423ea473d454e71fab8f59a75da522a040f4aef374ccfaf7dc159c2e0cf87`.
  Only three retained IAM resources and CDK metadata were added.
- Boundary:
  `arn:aws:iam::978355607658:policy/house/render/staging/protected/HouseRenderBatchStagingRuntimeBoundary`.
- Roles under `/house/render/staging/protected/`:
  `HouseRenderBatchStagingGitHubDeploy` and
  `HouseRenderBatchStagingCloudFormationExecution`.
- Live boundary, role policies and trust readbacks exactly match the reviewed
  synthesized IAM template.
- GitHub trust uses immutable subject
  `repo:falsefloor@334422757/infra@1405952636:ref:refs/heads/main`, matching the
  repository's live OIDC configuration. The existing Batch service-linked role,
  OIDC provider and staging foundation are reused.
- `/house/render/staging/batch-submit` and `/house/render/staging/batch-worker`
  are distinct Standard SecureStrings using `alias/aws/ssm`, version 1. Their
  values match staging Doppler `RENDER_JOB_DISPATCH_SECRET` and `RENDER_JOB_SECRET`;
  equality was verified in memory. No secret values or secret hashes are recorded.
- Infra variable `HOUSE_RENDER_STAGING_TAILNET_IMAGE` pins
  `978355607658.dkr.ecr.us-west-1.amazonaws.com/house-render-staging-tailnet@sha256:bbbfe4fb8dc44a57f8fbfa8b9d4e148d73d5b815bbc8bc860547154cf537e53c`,
  verified against deployed staging task definition `house-render-staging:27`.
- Regional Fargate On-Demand quota is 8 vCPU. Two planned 4-vCPU jobs consume that
  ceiling together; other regional Fargate workloads share it. Both imported
  public subnets had 251 available addresses at inspection. This is capacity
  metadata, not a placement or sustained-concurrency proof.

## Dedicated GitHub App

**The House Render Releases** (`the-house-render-releases`, App ID `5590366`,
Client ID `Iv23liPc2CEexEs73Abw`) has only Actions write, Contents read and mandatory
Metadata read. It has no webhook/events, OAuth redirect or user authorization flow.
Its registration permits cross-account installation; the existing **Flick AI Dev**
registration remains private and its permissions/installations are unchanged.

Only these repositories are selected:

| Account | Installation | Repository |
| --- | --- | --- |
| `falsefloor` | `178069245` | `falsefloor/infra` (`1405952636`) |
| `0xFlicker` | `178070086` | `0xFlicker/influence-game` (`1183905474`) |

An infra-only Actions-write/Contents-read token and a source-only
Actions-read/Contents-read token were minted and their exact repository visibility
verified. The latter successfully verified the ordinary main CI attempt
`41514497893/1`, its manifest archive/body hash and source policy for candidate
`35ac2336d6b6050edcd240ed37839e67ddd963e3`. The private infra workflow is readable.
The host's infra-only Actions-read/Contents-read token was separately minted and
verified against private workflow-run metadata with exactly one visible repository.

The captured key matched GitHub's fingerprint. The two earlier keys whose
downloads failed were explicitly revoked; one usable key remains. Its backup
lives in deployment-only Doppler `linode-iac/stg`, outside the app runtime config.
After that encrypted backup and the GitHub secret writes were verified, the
captured plaintext download was removed. Existing app/host `GH_APP_CLIENT_ID`
readbacks still match Flick AI Dev.

| Consumer | Client ID variable | Private key secret |
| --- | --- | --- |
| App Batch admission job | `HOUSE_RENDER_APP_CLIENT_ID` | `HOUSE_RENDER_APP_PRIVATE_KEY` |
| Host Batch evidence reader | `HOUSE_RENDER_APP_CLIENT_ID` | `HOUSE_RENDER_APP_PRIVATE_KEY` |
| Infra source-evidence reader | `GH_APP_CLIENT_ID` | `GH_APP_PRIVATE_KEY` |

Infra's bootstrap `GH_APP_*` values now identify the dedicated App. Existing
app/host `GH_APP_*` values continue to identify Flick AI Dev for their established
release consumers. Only the conditional Batch token steps use the new credential.

## Storage and activation boundary

The staging private bucket `influence-transcript-events-stg` at
`https://us-iad-10.linodeobjects.com` is distinct from both public media and the
production private bucket. Its `house-studio-recording-uploads` CORS rule permits
PUT from exactly `https://influence-staging.tail8a79ed.ts.net`, with the reviewed
content/checksum/conditional headers and 300-second preflight caching. Readback
matched the requested rule. A real anonymous OPTIONS request with that origin and
the upload headers returned HTTP 200 and the exact expected CORS allow headers.
No unrelated rules existed; no object was uploaded,
replaced or deleted. Local object-store TLS was unavailable, so this helper ran
inside the confirmed staging API container using its existing bucket credentials.

Staging still serves candidate `35ac2336d6b6050edcd240ed37839e67ddd963e3` with the
existing remote renderer. Live OAuth discovery does not yet advertise
`producer:render`; producer consent/reconnection must follow app capability
deployment. It cannot be pre-granted on the old deployed server.

Before activation, land [host credential wiring #80](https://github.com/0xFlicker/linode-iac/pull/80)
and the app capability,
verify the new scope in staging discovery, reconnect the producer MCP/browser
session, and publish the explicit staging Studio-only Batch target policy. That
normal release then deploys/verifies the Batch runtime automatically. Browser/MCP
render, real OIDC assumption, task placement, uploaded MP4 verification, lifecycle
cleanup and long-duration acceptance remain staging test outcomes.

## Source validation

The dedicated credential wiring passed app typecheck/lint, 3,304 provider-free
tests (five existing skips), six release-workflow guard tests and 17 Python
release/admission tests. Host admission, mirror, handoff, E2E/render-worker
contracts and workflow lint passed. These checks accompany the live readbacks
above; they do not replace the later Batch activation/render acceptance.
