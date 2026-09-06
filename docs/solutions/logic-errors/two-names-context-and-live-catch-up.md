---
title: Keep Two Names prompts and live playback on authoritative current state
date: 2026-09-06
module: Two Names and match watch
problem_type: logic_error
component: prompts and live presentation
severity: high
tags: [two-names, prompts, replay, websocket, hydration]
---

# Two Names context and live catch-up

Two independent defects made a valid recorded game confusing to watch. Mingle
prompts lacked the current nominee pair, and historical WebSocket dialogue was
queued after the latest hydrated format cue. Synthetic historical decision frames
also borrowed the current surviving roster, which can invalidate an earlier round.

The agent current-board contract now derives Two Names facts from the canonical
round projection. Only the Empowered initial nomination decision may have no pair.
Replacement requests distinguish pending choices from committed facts. The active
board ends at resolution/endgame; private ballots are not exposed.

Live publication envelopes retain their identity. Catch-up waits for the snapshot's
publication boundary and a contiguous suffix, then delivers historical dialogue
without fresh-event effects. The director reconciles the complete ordered timeline,
preserving its active cue and paused state. Historical introductions remain available
when navigating backward but cannot restart live playback. Format decisions notify
a coalesced authoritative-frame fetch; they no longer construct synthetic frames
using the current roster. The visible round and phase follow the presentation cursor.
Mingle displays `Turn N`; partial transcript batches do not define a turn total.

## Regression coverage

- Actual outgoing prompts for initial nomination, ordinary/Empowered Mingle,
  Override decline, pending replacement, accepted replacement, and resolved endgame.
- Publication/snapshot arrival orders, duplicate delivery, gaps, and reconnect before
  catch-up completes.
- History inserted before a live cursor, paused hydration with a buffered new cue,
  and stable identity when scene indexes change.
- Deterministic browser catch-up with immediate and delayed authoritative frames.
- Existing compiler tests continue rejecting genuinely inconsistent aggregates.

## Release blocker

The exact aggregate-error message reported during `fast-khaki-void` was not retained.
Its captured authoritative history passes the compiler. A separate live roster
validation failure was reproduced, but it is not proof of the reported message's
cause. PR #129 remains blocked on reproducing and verifying the aggregate failure;
these fixes alone do not clear that gate. Existing dialogue remains evidence of the
old prompts and must not be rewritten or used as proof of new agent awareness.
