---
title: Preserve completed huddles and paginate the winner scene
module: Influence replay and presentation
problem_type: ui_bug
tags: [replay, huddles, publication, winner, studio, export]
---

# Historical huddle replay and winner pages

The completed `open-scarlet-moon` replay's presentation endpoint returned 500
because 26 committed, spectator-eligible huddle speech rows had no publication
slots. They were accepted before huddle speech acquired public slots. Canonical
history and the completion record remained intact. The error was not evidence
that the game itself needed repair or that the publication ledger should be
rewritten.

For a completed game only, the presentation reader admits these specific
spectator-eligible huddle rows when their turns are committed and the entire
final canonical prefix and publication ledger are due. It holds earlier phases
instead of exposing them prematurely. Missing publications on other dialogue and
all live delivery retain the existing integrity check. A focused PostgreSQL
regression exercises the live rejection, held final publication and completed
replay; it does not modify historical rows.

The Influence winner tableau previously put additional cast inside an
`overflow-y: auto` strip. It now displays the winner and pages the other
finalists, jury and remaining cast in pairs on the sampled presentation clock.
The cue reserves at least five seconds per cast page, including export timing
overrides. The last page remains visible at the held ending. Viewer and export
use the same picture geometry without a permanent fullscreen controls inset;
temporary player controls remain chrome. Existing selections can rebuild fresh
bundles from their frozen sources; old bundles and encoded MP4s retain their
old layout and timing and must be rebuilt or rendered again.
