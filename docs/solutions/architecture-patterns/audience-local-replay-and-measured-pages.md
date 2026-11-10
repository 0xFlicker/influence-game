---
title: Map replay audiences and advance measured pages on one clock
date: 2026-11-09
module: House replay and Werewolf watch
problem_type: architecture_pattern
category: architecture-patterns
tags: [werewolf, replay, spectator-privacy, pagination, director, presentation-parity]
---

# Audience-local replay and measured pages

Werewolf's Mystery and Omniscient cursors count different visible entries. Equal cursor numbers and total playback percentages do not identify the same source moment. Resolve a validated audience-local cue against the same authorized, audio-ready accepted history as watch, join the audiences by canonical event internally, and return only the destination's permitted cursor and cue. A private-only cue lands on the preceding playable Mystery moment. A silent live hold maps its accepted boundary separately from the last playable cue. The viewer discards stale requests and audience-specific windows before restoring the shared director's local content position.

Long speech and thinking are laid out at the actual picture geometry. The layout supplies the director with the measured page boundaries and the clock mapping used by the renderer. Manual advance seeks that clock to the next page; it does not maintain a second page counter or read the DOM. Automatic timing remains complete and the final page retains the existing exit behavior. Duration-only recordings use their existing progress mapping, not invented word timestamps.

Keep the viewer, Studio Source, Studio Selected cut and fresh export on their shared presentation contract. Verify direct and reverse sampling, recording offsets and omitted neighboring moments as well as interactive advance. Existing movies remain unchanged; rebuild affected bundles from their frozen selection and source before preparing new movies.
