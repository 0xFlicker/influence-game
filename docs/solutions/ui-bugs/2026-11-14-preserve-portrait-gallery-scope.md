---
module: Room presentation
problem_type: ui_bug
tags: [portraits, full-body, replay, studio, presentation, scope]
---

# Restrict full-body room changes to complete frozen casts

The full-body compositor was intended only for games whose entire frozen cast has
full-body artwork. A review fix instead made every Lobby with more than eight
participants use the compact cast list and extended its timing, including
portrait-only games. That removed the established headshot ring and thinking
close-up, producing a large, sparsely filled text panel beside tiny portrait rows.

Restore the circular renderer's original selection, focus and timing rules.
Artwork-dependent Lobby cue holds must be conditional on complete **game-roster**
artwork in both browser and export compilation. Room-only completeness is not
enough: a huddle cannot switch a mixed-art game into full-body composition.

Fetch the frozen-game media snapshot before compiling artwork-dependent cues;
retain per-beat media freezing separately so background refreshes do not replace
visible scene art. Preserve the existing portrait Mingle/huddle pagination rules.
The separately requested brighter bubble outlines apply to both renderers.

Parity alone did not catch this regression: viewer, Studio and export agreed on
the same wrong output. Proof must assert intended structure as well as matching
pixels: a twelve-player portrait-only Lobby retains its circular cast and original
thinking focus, while complete-art games use the compositor. Test missing artwork
on an attendee outside the selected huddle as well as completely portrait-only
games. Retain speech, thinking, isolated cuts and fresh encoded clips.

Existing selections and pinned sources can rebuild fresh bundles; old movies
require re-encoding. Never rewrite accepted gameplay or substitute current profile
art to repair presentation.
