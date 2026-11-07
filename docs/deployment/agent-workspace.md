# Agent workspace deployment

This is a coordinated API, game-worker and web release. The implementation does not deploy itself. Production approval remains a separate action.

1. Back up and apply migrations 0156–0165 using the normal release migration owner. They add account drafts, private draft media ownership, artwork jobs, voice samples, pending learning publication, entry destinations and submission audit metadata, typed artwork error codes, and image execution leases/activity indexes. Existing reservation identities and provider charge evidence remain intact; expired execution slots are recovered independently of billing. Existing asset rows retain their historical public status. There is no binary migration or historical regeneration.
2. Configure OpenAI image access to `gpt-image-2.6-flare` and `gpt-image-2.6-sunburst`. Quality is medium. Keep xAI availability fallback credentials and the existing cutout worker/dispatcher configuration. Grok returns a retained source that must finish background removal before a transparent candidate is ready. Staging's existing cutout hard-disable means an opaque fallback there remains visibly failed until an environment with an authorized removal lane prepares it.
3. Prepare the shared voice cache once per environment with its normal private bucket credentials:

   ```sh
   bun run --cwd packages/api voices:prepare-samples --apply
   ```

   This is an explicit paid operation for the 27 player voices. Ready entries are reused. A preexisting running/failed entry requires reconciliation, preventing accidental duplicate spend. Samples use the gameplay recipe and versioned URLs; changing the recipe requires a new version. Helios remains House-only. Development's 27 entries were prepared and checked during this implementation; staging/production have not been prepared by this task.

4. Start workers only behind the normal active deployment admission fence. The game-worker owns artwork jobs, screening/reconciliation and the existing cutout dispatcher. A gateway status read never starts work. Verify private object upload/hash reads before enabling writes.
5. In the target environment, exercise new account → Guided → model/voice audition → artwork selection/head confirmation → Review → Create → Reviewing → Accepted → Continue to the pinned game/season. Also exercise Held, a pending edit retaining its accepted public profile, reload during image preparation, response-loss retry, a full/closed destination, stale draft conflict and archive.
6. Inventory existing artwork with the existing scoped cutout CLI. Reuse ready source-hash derivatives. Repair only missing associations, failed final storage or a genuine retained-source gap. Do not regenerate old images or bulk-remove backgrounds that are already verified. The development audit was limited by missing local upload fixtures and cannot establish production completeness.

Required local gates: `bun run test`, sequential `bun run test:postgres`, `bun run check`, `bun run mcp:schemas:check` and the agent-workspace browser harness. Live provider qualification stays opt-in (`INFLUENCE_LIVE_IMAGE_PROBE=1`); ordinary CI receives no provider credentials.

## Recovery

Use the exact creation/submission/job identity after response loss. A successful image plus a later failure retries removal/localization/storage, never generation. Unknown provider charges remain fenced for inspection. A failed publication keeps its immutable draft and accepted public version; resolve the roster/human restriction before retrying publication. Draft writes/deletes require their last observed version.

Pre-migration image journals retain their original input hash, source and allowance identity. Matching retained images are reused without another provider request or allowance debit; historical opaque sources go through the existing explicit preparation lane when needed. A completed provider image that fails local file checks still retains its receipt, bytes and debit. Retrying that failed candidate is an explicit new generation.

Do not roll back only the web or only the worker to old immediate-publication behavior while new submissions are pending. Drain writers, retain object references/evidence, and use a coordinated forward repair or fully reviewed release rollback. Existing game snapshots, accepted images and MP4s remain unchanged. New movies must prepare a fresh bundle to use newly accepted assets; never mutate an old frozen bundle.

## Recorded qualification

The opt-in exact API probe created one transparent full-body image with Flare and edited it with Sunburst at medium. Both source images passed real alpha validation. The stored receipts estimated $0.034295 and $0.046603 from reported token usage (9.472s and 19.470s respectively); these are two observations, not latency targets or final invoice totals. Artifacts are under `.renders/image-provider-migration/`.

The provider-free owner Chromium journeys cover creation and editing in both Guided and Advanced modes, voice selection, generated artwork preparation, leave/resume, explicit selection and head confirmation. Provider transport is mocked for the real artwork worker, journal and storage; Guided text responses are mocked at the browser API boundary. A responsive layout journey records 1440, 1280, 768 and 390 pixel widths. Screenshots are under `.renders/agent-workspace/`. A fresh parity run using the exact new transparent image produced 12 viewer/export comparisons, matching Studio Source/Selected cut frames, reverse-order checks and two encoded clips at 1280×720, 640×360 and 390×700; see `.renders/agent-workspace/image-parity/comparison.json`. Deterministic tests cover Grok-style opaque-source preparation and retry using the existing cutout contract; a live Grok outage/failover has not been induced. Staging/production deployment and their usability verification are not claimed by local proof.

Pending-generation and cancellation contract: [agent generations](../agent-generations.md).
