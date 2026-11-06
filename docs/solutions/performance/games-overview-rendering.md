---
module: games-library
tags: [performance, rendering, games]
problem_type: performance
---

# Bound the games overview shelves

Each overview shelf initially renders at most eight games; further games load
on request. Collection pages initially load up to 20. The API applies public
visibility, status, game-type and collection filters before the cursor, so the
browser does not download complete lists for ordinary browsing. Cards keep the
existing live, join and replay actions. The initial Open shelf is server-rendered.

Search remains the existing full-summary fallback for public games and runs
only while a query is active. It includes older Werewolf games through a separate
search-only read; the legacy capped list endpoint is unchanged. The search
fallback is intentionally not indexed and can be expensive. Pending requests
are aborted when search is cleared or the component unmounts.

These limits reduce initial response and card counts but do not bound physical
database work for every sparse filter or bytes for every selected game. They
are not a production Core Web Vitals result. See
[public games initial shelf](games-initial-shelf.md) and the
[index rollout plan](../../deployment/public-game-browse-indexes.md).
