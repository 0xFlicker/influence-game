# Staging image publication and routine retention

The five-image target counts tagged release roots. An OCI index, platform image and
attestation are one release tree, not three independently retained releases.
Publication reports physical objects and compressed unique bytes; it has no root,
object or storage admission cap. The metadata traversal bound applies to each
individual image graph, not the repository's accumulated release count.

The routine policy keeps five tagged roots, preserves exact current/running/rollback
references at higher priority, and expires unreferenced untagged objects after one
day. ECR will not expire a child while an index still references it; expiration is
asynchronous and can take 24 hours after eligibility. Temporary overlap is expected.
Publisher roles cannot delete images or edit lifecycle policy.

The host release workflow verifies the exact successful worker publication, refreshes
retention protection for its incoming digest, then performs the fenced handoff.
Scheduled maintenance and deployment preparation share the staging deployment
concurrency group. Protection rotation runs under a separate main-only retention
role and validates fresh host history, live tasks, queued Batch definitions,
CloudFormation images, dependency closure and native previews. It does not copy
historical pins into each new policy. No extra game or provider call is needed.

During migration, the mirror accepts the existing additive exact-pin policy as well
as this routine policy. Logical-policy installation and the dedicated role are
separate verified setup operations; code publication alone does not enable them.
The old `max_manifests` workflow input is compatibility syntax, not a publication cap.
See linode-iac's ECR retention runbook for setup and rotation receipts.
