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

The retention target is five release images, with current, running and rollback
images preserved. OCI indexes, platform manifests and attestations are dependencies
of a release image; their physical object count is reported, not a pre-publication
limit. Publication must not wait for asynchronous lifecycle expiration. The legacy
`max_manifests` input remains accepted for workflow compatibility and has no admission
effect. Compressed unique bytes and the former storage target remain visible in the
receipt so storage growth can be monitored without blocking a valid release.

The mirror still verifies the exact source and destination digest, publisher identity,
immutable destination repository, and lifecycle protection of retained/incoming roots.
It never deletes images. The existing policy pins previously reviewed digests; those
pins do not rotate themselves. Until automated reference rotation is installed,
additive protection can admit a new release without deleting an old one. This is a
safe transition, not a claim that routine unused-image cleanup is complete.


## Ordinary staging release ordering

The original image-producing CI attempt must complete successfully before the
`Publish and deploy exact staging release` workflow selects its immutable manifest.
Tooling-only CI has no manifest and does not redeploy. The privileged workflow runs
trusted main code, accepts only this repository's successful ordinary main CI, and
preserves the original build run ID and attempt throughout publication and dispatch.

For remote staging, the reusable ECR mirror verifies and copies that exact worker
digest before dispatching the host release. An attempt-bound `mirror-receipt.json`
artifact records the verified destination. The host independently verifies its hash,
source attempt, manifest hash, destination and image identity before Tailscale/SSH
access. Publication failure prevents handoff. Manual measurements and proof branch
builds never trigger ordinary staging. Production's approval and three-image release
identity remain unchanged.
