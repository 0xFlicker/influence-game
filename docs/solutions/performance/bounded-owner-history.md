---
module: player-history
tags: [performance, pagination, postgres]
problem_type: performance
---

# Owner history on demand

The dashboard requests an owner-scoped page of three entries and requests
another page only when selected. Previous navigation reuses the cursor for the
earlier page; the API does not supply a total page count. The game-kind filter applies before the cursor,
including multiple owned Werewolf seats in one game. Lifetime totals are removed
until they can be calculated without traversing the complete history. The legacy
array endpoint remains unchanged for existing clients.

Candidate keys are sorted by completion instant, with invalid timestamps last
and bytewise game and player ID tie-breaks. Each request uses a separate
repeatable-read snapshot; ownership, visibility or historical changes can alter
later pages. A newly completed game ahead of the cursor appears on refresh.
Selected Werewolf openings with duplicate/invalid player IDs or more than 1,000
seats fail closed with a generic 503 before replay, rather than expanding a page
beyond its limit or silently skipping duplicate cursor keys.

The page bounds selected results and canonical replay work, not candidate
discovery: PostgreSQL still scans and sorts participation records and expands
Werewolf openings. An individual selected event can also be large. History no
longer enumerates every game in a season merely to derive an episode number it
does not display; it reuses the already-read episode for Werewolf results.

`bash scripts/benchmark-history-page.sh` creates and removes a disposable
PostgreSQL 16 container, seeds synthetic Influence and Werewolf games, shows the
candidate plan, and compares a 20-row Influence page with the legacy unbounded
read. The fixture does not contain realistic replay bodies, media, network or
concurrent writes. These measurements do not establish production latency or
the cause of an observed gateway failure.

A normalized indexed participation model, transactional ownership/visibility
updates, bounded backfill, continuity controls, validation and rollback remain
follow-up work. The current implementation is a limited mitigation, not a
solution to unbounded candidate growth. Do not fetch every page automatically
to emulate the legacy endpoint or restore lifetime totals.
