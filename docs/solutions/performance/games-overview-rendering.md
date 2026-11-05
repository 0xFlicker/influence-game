---
module: games-library
tags: [performance, rendering, games]
problem_type: performance
---

# Bound the default games overview shelves

The default, unfiltered Games overview shows at most eight completed or
cancelled cards per season or game-type shelf. Open, live, and suspended
games remain visible, and the existing View all links lead to their collection
pages. Selecting a filter or searching shows all matching rows already
returned by the APIs; collection and compact views are unchanged.

This bounds card and image element creation for the default overview. It does
not paginate the APIs, reduce the current ten-second polling response, or
make filtered and collection pages bounded. The existing Werewolf API returns
at most 100 games without a continuation, so View all is still subject to
that existing limit. Backend cursors, server-side filtering, SSR, image
resizing, cache invalidation, and production measurements are tracked in
[#302](https://github.com/0xFlicker/influence-game/issues/302).

One anonymous production observation before this change contained 116 game
cards and 691 image elements. These counts are not network transfers or a
Core Web Vitals measurement; measure cold and warm browser loads after
deployment before claiming a latency improvement.
