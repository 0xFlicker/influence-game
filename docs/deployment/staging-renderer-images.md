# Staging renderer ECR mirrors

Staging Fargate pulls from private ECR using its ECS execution role, following
the existing character-cutout worker pattern. It receives no GHCR pull token,
registry secret or AWS image-pull credential. Production/Linode image delivery
and the canonical API/web/render-worker release manifest are unchanged.

The manual **Mirror staging renderer to ECR manually** workflow accepts the
successful main CI `source_run_id`. It verifies the source repository, workflow,
branch, commit and run attempt, downloads the exact three-image release manifest,
and selects its renderer digest. Its default `publish=false` measures compressed
image content only, using this repository's existing `GITHUB_TOKEN` package access.
It assumes no AWS role and copies no image in that mode.

After separate action-time IAM and publication confirmation, `publish=true`
assumes `HouseRenderStagingWorkerImagePublisher` for 900 seconds in account
`978355607658`, region `us-west-1`. Its only repository is
`978355607658.dkr.ecr.us-west-1.amazonaws.com/house-render-staging-worker`.
The role trusts the existing main-only subject
`repo:0xFlicker/influence-game:ref:refs/heads/main`, audience `sts.amazonaws.com`.
This repository currently uses the default name-based OIDC subject; no OIDC
customization is changed. A future immutable-subject switch needs separate review.

The mirror uses `skopeo copy --all --preserve-digests`, verifies the resulting
digest and independently reads it back from ECR. It never rebuilds an image or
substitutes a platform-child digest for the accepted index digest. The exact
original renderer digest continues through API release acceptance, fencing,
worker identity and rollback. Retain accepted/current and rollback digests.

The public `scripts/staging-ecr-mirror.py` helper also supports the separately
published sidecar receipt; FalseFloor infra pins this helper by commit for its
own main-only workflow and uses its own package token. Neither workflow needs
cross-repository GHCR access or a permanent registry credential. Temporary
registry auth files are private and removed; errors suppress credential-bearing
tool diagnostics. Nothing runs on PRs except credential-free helper tests.

Each private repository admits at most two deployment digest tags. Before copy,
the helper walks all source/destination manifest metadata and deduplicates
compressed layers/configs/manifests. Worker repository admission is capped at
3 GiB; sidecar admission is 512 MiB. The combined conservative storage allowance
is about $0.376/month at $0.10 per decimal GB-month, before credits/tax. Actual
bytes are recorded in measurement and publication receipts. The helper stops
before a third retained release or budget overflow; publisher roles cannot
delete images. Operator-approved, release-aware cleanup must preserve current
and rollback references. No age-based lifecycle can silently delete them.
These are admission limits, not AWS billing caps: failed uploads/concurrent
administrator writes can leave additional transient storage requiring review.

Repository/role creation, the staging execution boundary update, tailnet policy,
OAuth/SSM credential installation and paid proof remain separate action-time
confirmations. Four standard SecureString parameters use `alias/aws/ssm`; no
registry Secrets Manager entry is needed. No subscription or company-tailnet
migration is part of this setup. See the companion FalseFloor infra approval
packet and the linode-iac isolated proof runbook before activation.
