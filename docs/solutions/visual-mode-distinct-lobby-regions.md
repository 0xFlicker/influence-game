---
module: Visual Mode
problem_type: performance_issue
tags: [visual-mode, image-generation, lobby, identity-verification]
---

# Large lobbies: populate distinct room regions

The old renderer supplied the same whole-room background to every character group, assembled a contact sheet, then generated and verified another full-cast composition. This encouraged repeated architecture and consumed the shared 180-second scene deadline after the source panels had already passed. The default focal presentation also compressed the panels into overlapping views.

New rendering normalizes one empty background to 3072×1536 and splits it before adding contestants. Stable groups contain at most four character references; nine through twelve contestants require three regions. Each edit receives only its own region and identities. Verified views are accepted without an automatic harmonization call, and playback defaults to separate full-width views. Explicit producer harmonization remains a separate operation.

Do not weaken identity verification to accommodate large casts. Paid experiments with a single full-cast image, including higher quality and a staged reference guide, failed strict identity checks. Those rejected attempts remain evidence. Cropping the empty background first kept the identity problem bounded while preserving distinct architecture.

## Local render evidence

Seven retained scene-only probes used local PostgreSQL and object storage, with sanitized requests, responses, images, receipts and failures exported privately under `packages/engine/docs/simulations/visual-panorama-2026-10-31/`. Total known provider cost was $3.461879 against the authorized $15 ceiling. No contestant turns or production writes were performed.

- 10 contestants: `db08778e-645d-4bc4-a043-273a18edfdd6`, three verified views, 130 seconds.
- 12 contestants: `493d26f0-8fea-4d2e-af6a-9f5d4e613fcc`, three verified views, 134 seconds.
- Final backdrop-preserving prompt, 9 contestants: `2802a6db-4c57-421d-b3bc-a0afad3a509f`, three verified views, 131 seconds.
- Final prompt plus newly generated room, 12 contestants: `58f370d5-127d-4db8-ab70-42a2ccd3eeb1`, three verified views, 144 seconds for scene rendering (background preparation precedes that timer).

These samples prove the path works at the reported boundary; they are not a statistical reliability estimate. Regression coverage checks unique input pixels, complete cast coverage, durable resume without repeated paid calls, rejected identities, repair workflows and separate-view presentation.

Final validation: `bun run check` passed; `bun run test` passed (3,222 passed, five skipped). The required PostgreSQL suite ran across four isolated local databases: 2,291 passed and two 30-second timeouts (ordinary game reload and staging-proof cleanup). Both affected files passed independently with the same timeout (14 and eight tests respectively). Logs remain beside the private render evidence. Temporary shard databases were removed; paid probe games and artifacts remain retained.

## Review triage

- **P2, fixed — partial candidate recheck:** a failed regional render leaves its last region as the candidate. Rechecking it with the full-cast plan would incur a verification call that cannot succeed. Both media read models now identify partial candidates, the UI points to Continue/Correct images, and the control endpoint rejects whole-cast recheck before dispatch. Regression tests cover the API rejection, paginated metadata, continued reuse, and UI affordance.
- **Not a regression — explicit harmonization failures:** producer-requested harmonization remains separate and preserves saved views on identity rejection; transport failures remain visible and recoverable. Tests cover saved-panel retention, restart and continuation.
- **Retained requirement — historical review grouping:** `section:v2` grouping is used only to inspect immutable existing evidence; new rendering uses the distinct-region grouping. Removing it would mislabel accepted historical artifacts.

Review-fix validation: focused API suite 56 passed; recovery/read-model rerun 33 passed; viewer/repair UI suite 49 passed; `bun run check` passed. No additional paid renders were needed.

## CI startup diagnostics

The initial browser run timed out starting the Studio test web server before its
assertions ran. Its logs were written outside the uploaded artifact directory,
so the failure did not establish a product regression or an infrastructure cause.
The harness now retains startup stdout/stderr under `test-results`, reports the
child exit status and bounded log tails, and fails immediately if the child exits.
The existing 60-second deadline and browser assertions remain unchanged.
