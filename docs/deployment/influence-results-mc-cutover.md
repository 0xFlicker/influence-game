# Influence results MC deployment

This is a drained deployment, not a rolling prompt update. It changes the existing House summary author to `results-mc-v1` and new Studio composition snapshots to version 6.

1. Close new-game admissions using the environment's deployment controls. Keep old workers running.
2. Let **every in-progress game** finish. Include suspended and recoverable games: recover them on the old version and finish them before proceeding. Waiting games must not start until the new release is active.
3. Verify there are no unfinished games, logical turns, or provider calls that can resume under the new release. Keep admission closed throughout the worker replacement. Do not equate zero currently executing requests with a drained game inventory.
4. Deploy the matching API, game worker, viewer, and render worker release. Reopen admissions only after health and release checks pass.
5. Verify a completed game's replay still uses its original speech and recordings, a frozen Studio cut retains its original composition, and a fresh cut uses version 6 with scenery and reading holds.

The current provider journal does not retain a recoverable prepared request body before dispatch. Therefore interrupted old-version requests cannot safely cross this prompt change. This implementation intentionally adds no prepared-request persistence layer. Same-version accepted-value recovery remains unchanged.

Rollback after starting new-version games requires the same drain discipline. Never resume a new-version unfinished call on an older prompt implementation.

No historical content migration or speech regeneration is required. Existing games receive scenery, cast treatment, readable timing, and exact result association where durable evidence supports it. Missing or ambiguous associations retain speech at its original position over the phase room. Frozen cuts are never silently upgraded; prepare a fresh snapshot for the improved export.

The compact Empower follow-up adds an `empower_runoff` House call inside the vote phase and composition version 7 for fresh exports. Apply the same drained-game prerequisite before deploying this cadence change. Old games get compact playback without generating new historical summaries or audio; pinned composition versions 3–6 are unchanged.
