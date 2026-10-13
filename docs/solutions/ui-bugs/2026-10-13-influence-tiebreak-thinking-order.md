---
title: Show empowered tie-break thinking immediately before the tie-break
module: Influence production moment catalog
problem_type: ui_bug
date: 2026-10-13
tags: [influence, thinking, canonical-events, replay, production, tie-break]
---

## Problem

The production source catalog placed captured thinking before the first voter presentation matching its reveal event and actor. Regular ballots and the later empowered tie-break share a `format.resolved` reveal event. If the empowered player also voted, their tie-break thinking appeared during the regular ballot roll call. If they did not vote, it appeared after the result.

## Solution

Identify tie-break thinking from its accepted canonical `format.resolved` event and matching `tiebreakerId`. Anchor it immediately before that event’s `format_tiebreak` presentation. Keep accepted sealed ballot thinking attached to its own voter presentation. Studio preview and export both consume this shared ordering; no transcript parsing or model call is involved.

The live/replay player also distinguishes the exact captured tie-break action from other thinking sharing that event/player. It loads the empowered actor’s thought only at the tie-break cue. The nominee scene uses the existing solo thinking shot while the director holds its content clock, then returns to the unselected pool before the deciding-vote cue. Tally summaries and deciding-vote cues do not repeat the thought.

## Validation

Provider-free catalog and presentation-binding regressions cover Majority Elimination, Even Votes, Safety Bounce and Two Names. They check aggregate → thinking → tie-break → deciding vote order, the empowered actor, separate earlier ballot thinking, thinking-off selection, unresolved prefixes, and contiguous compiled timing. These are local fixture checks; live production and encoded media verification are separate.

Live-player fixture tests cover the same four formats, rejecting another actor or event and excluding tie-break thinking from the roll call. A DOM regression checks the thought shot and return to unselected nominees without a fabricated speech bubble.
