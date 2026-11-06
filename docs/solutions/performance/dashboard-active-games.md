---
module: dashboard
tags: [performance, games, api]
problem_type: performance
---

# Fetch only relevant dashboard games

The dashboard preview, open/live counts, and primary action need only Influence
games in `waiting` or `in_progress` status. The dashboard requests those two
statuses instead of downloading and enriching all public Influence games on
every refresh. A direct `joinGameId` link retains the unfiltered request so a
stale target continues to follow the existing join flow. Responses from a
previous link state are ignored after that state changes or the page unmounts.

This changes neither the history request nor lifetime result statistics. The
status-filtered endpoint can still return an unbounded number of open/live
games; purpose-built bounded feeds and history pagination remain in
[#302](https://github.com/0xFlicker/influence-game/issues/302).
