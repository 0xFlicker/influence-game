---
module: games-library
tags: [performance, server-rendering, caching]
problem_type: performance
---

# Public games initial shelf

`/games` streams its shell while a server component requests at most six recent
public Influence games. Until the complete client browser finishes loading, it
shows those games as a labelled preview, not as the complete searchable library.
If the preview fails or times out, the ordinary client browser still loads; if
the full browser fails after a successful preview, the preview and a retry
remain available. Existing complete-data search and filters are unchanged.

The initial request omits credentials, and both the server fetch and API response
use `no-store`. There is no shared shelf cache to invalidate: a new request reads
current public visibility and metadata. Existing open pages refresh the complete
browser every ten seconds; the polling request is skipped while another request
is in flight, and a newer manual refresh fences older responses. A visibility
change cannot retract content already delivered to an open browser; the next
successful refresh updates it. Do not cache this response at a CDN or pass
personalized/authenticated data into it without defining and testing cache keys,
revocation, freshness and invalidation across all write paths.

The optional API limit is applied after public visibility and status filters,
before enrichment. It orders valid creation timestamps by instant, interprets
timezone-less values as UTC, places invalid values last and breaks ties by ID.
The unlimited API stays compatible with older callers. PostgreSQL still scans
and sorts candidates, and the full browser still downloads the unbounded lists;
public shelf and collection cursor endpoints remain future work.

`bash scripts/benchmark-public-shelf.sh` creates and removes a disposable
PostgreSQL 16 container, inserts 1,000 synthetic Influence games with eight
synthetic seats each, prints plans, then compares the bounded and full APIs.
One local run returned six rows in 50/12 ms and 13,430 bytes versus 1,004 rows in
71/78 ms and 2,240,573 bytes. Candidate plans took 1.6 ms and 0.6 ms respectively
and both scanned games; fixture games do not have realistic events, images or
network costs. These single-host observations are not production latency, LCP,
or proof of a user-visible improvement. Measure streamed HTML, hydration,
transferred image bytes and mobile/desktop Core Web Vitals after deployment is
separately approved.
