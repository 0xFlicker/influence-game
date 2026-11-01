---
module: character-cutouts
problem_type: ui_bug
status: in_progress
tags: [cutouts, playback, character-art, influence]
---

# Character artwork is mutable presentation

The original selection path required per-game cutout association and publication timing. A finished transparent image could exist while playback selected an opaque source. A generic image-error fallback also treated network/decode failures as missing images. These are inspection findings; the original production incident was not reproduced conclusively.

Store verified transparent art on its owner. Owned participants join to their profile; unowned participants own their art in their relational participant record. Werewolf needs a game-scoped external player coordinate because its event IDs are not globally unique. Canonical events continue to own gameplay facts.

Do not propagate artwork into content revisions, owned seats or production artifacts. Do not reconstruct historical art during playback. Failed saves retry the finished image, not generation. Persist the last save-attempt timestamp and order the existing dispatcher by least-recent attempt, so a batch of failing jobs cannot starve later finished images. Only a confirmed HTTP 404 permits image replacement.

Current gameplay verification excludes mutable full-body art. Compatibility with pre-change export descriptors is explicitly out of scope. New snapshot hashes remain valid after artwork changes. See the character-cutout deployment runbook for the explicit pre-cutover conversion. Tests are not evidence of environment conversion or deployment.

## Local verification — 2026-10-31

- Reproduced save starvation before the fix: sixteen persistently failing ready jobs prevented the following valid image from saving across three dispatcher passes. The regression now proves that image saves, generation attempts do not increase, and failed saves remain recoverable.
- Focused artwork, profile/moderation and source tests: 62 passed. Studio route and backfill suites after corrections: 28 passed, including both current-format export descriptors remaining valid after art replacement and rejecting changed accepted facts.
- `bun run test`: 3,213 passed, 5 skipped, zero failures with localhost listeners permitted. The preceding sandbox run had 27 local-server startup failures; it was not a passing run or evidence of product defects.
- `bun run test:postgres`: 2,289 passed, one failed across 206 files. The failure expected staging to record no demand. The final test instead verifies that a reusable demand is retained while disabled generation creates no inference job. Its whole file passed in the 28-test rerun above. The complete PostgreSQL command was not rerun after this test-only correction.
- `bun run check`, `git diff --check`, and building the conversion CLI passed.

Only disposable local test databases and fixture images were converted. No development, staging or production environment was converted or deployed. Real reader cutover remains contingent on the explicit conversion and verification in the deployment runbook. Transient image errors can temporarily leave an image blank; they do not authorize an opaque fallback.
