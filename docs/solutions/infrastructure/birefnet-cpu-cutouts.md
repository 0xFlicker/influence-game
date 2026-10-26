---
module: character-cutouts
problem_type: performance
status: validated-locally
tags: [birefnet, docker, aws-batch, fargate, images, private-payloads]
---

# Keep optional background removal off the application node

The nine current example-model full-body images need transparent derivatives without
blocking games. BiRefNet preserved the fine character edges better than the smaller
local models, but its memory use does not fit the application host.

A Linux ARM64 Docker run capped at 2 CPU / 16 GiB with no swap completed all nine
1024×1536 sources. Median inference was 20.74 seconds. A single reused session peaked
at 13.64 GiB cgroup memory; the first image was 8.83 GiB. This supports one image per
Batch Fargate job, keeping idle compute at zero and preventing session memory growth
across images. Local wall time is not an AWS performance guarantee.

Store source/result bodies using the existing private payload store, deduplicate by
source hash plus recipe, and use expiring per-job capabilities for binary API input
and output. Atomic claim plus token replacement fences duplicate or late workers.
Only verified, durably stored RGBA PNGs enter playback. Missing derivatives retain the
original reference; no game outcome or execution state depends on them.

Pin completion timestamps for exports: a cutout arriving after a publication cutoff
must not change the old render source. Explicit visual refresh can adopt it. Staging
is disabled for this independent lane; render-worker Tailscale remains required there.
See the [runbook](../../deployment/character-cutouts.md) for commands and deployment.
