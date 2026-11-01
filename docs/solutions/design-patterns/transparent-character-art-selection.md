---
module: character-cutouts
problem_type: ui_bug
status: in_progress
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

Validation of this corrected design is in progress. Earlier owner-based test counts
are not evidence for this replacement. No development, staging, or production
conversion or deployment has been performed.
