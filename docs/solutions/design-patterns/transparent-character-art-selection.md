---
module: character-cutouts
problem_type: ui_bug
status: resolved
tags: [cutouts, playback, character-art, influence]
---

# Transparency preserves character revisions

The original selection path depended on per-game cutout associations and publication
timing. Generic image errors also treated network/decode failures as missing images.
These are inspection findings; the original production incident was not conclusively
reproduced.

A revision chooses the source image. The existing source asset may have a verified
transparent derivative. Publishing it never changes profiles, revisions, or game
rosters. New Influence seats pin content revision IDs; Werewolf already does. Prepared
cast artifacts also identify their exact source bytes. Historical Influence seats
without either coordinate retain their original art: historical reconstruction was
explicitly waived in favor of simplicity.

The rejected current-profile design would have back-propagated later revisions into
old games. Its profile joins, profile write protection, Werewolf participant trigger,
association locks, and historical participant conversion were removed. Original
source evidence remains immutable; only derivative metadata is writable.

Failed publication retries finished bytes through the existing dispatcher, with fair
persisted attempt ordering. Playback reads no jobs or demands. Only a confirmed 404
permits fallback. Studio verification excludes derivative URLs but preserves frozen
revision and gameplay facts. Old-export compatibility is outside the agreed scope.

## Local verification — 2026-10-31

- `bun run test`: 3,217 passed, 5 skipped, zero failures.
- `bun run check`: typecheck and lint passed.
- `bun run test:postgres`: 2,284 passed, 3 failed across 206 files. The failures
  were test assertions: Werewolf metadata now selects the derivative URL; new
  Influence seats include their content revision ID; Drizzle wraps the immutable
  evidence rejection in `cause`. All three assertions were corrected.
- Final rerun of all eight affected suites: 95 passed, zero failures. This covers
  the three baseline failures plus both game types' revision isolation, unchanged
  Studio hashes after derivative publication, retained render framing, finished-byte
  retries/fairness, and job-independent playback.
- Conversion CLI build and `git diff --check` passed. The full PostgreSQL command
  was not repeated after the assertion corrections; the final focused rerun is
  separate evidence, not a claim that the earlier full command passed.

No development, staging, or production conversion or deployment was performed.
Only disposable local test databases and fixture images were used. Historical
Influence games without a pinned image identity may keep opaque art. Transient
image errors may leave an image temporarily blank, but cannot select opaque art.
