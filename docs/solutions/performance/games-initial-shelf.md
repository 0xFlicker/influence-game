---
module: games-library
tags: [performance, server-rendering, pagination]
problem_type: performance
---

# Public games initial shelf

`/games` server-renders the first Open shelf, up to eight public Influence and
Werewolf games. The other overview shelves fetch up to eight games each, and
collection pages render an initial page of up to 20. Further pages load only
on request. The API applies visibility and selected status, type, season and
category filters before a status/time/ID cursor; invalid timestamps sort last
within their status. Browse requests omit credentials and use `no-store`.

Search keeps the existing public-summary matching fields and runs the expensive
full-list fallback only while a query is active. Both Influence and Werewolf
search include older public games. Clearing a query aborts pending search work
and returns to paged browsing; there is no separate search-continuation control.
The existing `/api/games` and capped `/api/werewolf` response contracts remain
unchanged. Search can become slow as the library grows; a search index is
follow-up work.

Pages are current reads rather than a sealed snapshot. Game changes between
requests can change traversal; Refresh reloads the current list. A page limits
returned candidates and enrichment, but sparse filters may still examine more
rows in PostgreSQL, and a selected game's cast or other media can be large.

The ordinary migration creates the lookup functions; the browse indexes need a
separate concurrent build and release gate. See
[public game browse indexes](../../deployment/public-game-browse-indexes.md).
Staging qualification and production approval are required before release.
Synthetic timings are not production latency or Core Web Vitals measurements;
measure browser rendering, transferred media and API plans after deployment.
