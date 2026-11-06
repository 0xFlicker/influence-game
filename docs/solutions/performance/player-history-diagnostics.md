---
module: player-history
tags: [performance, privacy, postgres, pagination]
problem_type: performance
---

# Player history diagnostics and pagination constraints

`GET /api/player/games` returns all visible completed participation for the
authenticated user. In one read-only snapshot it selects Influence seats and
Werewolf opening events, builds episode presentations, then reconstructs each
distinct game's canonical result sequentially. A single malformed saved
persona can fail the entire request. That is a reproducible failure mode, not
proof of any particular production incident.

The route now marks authenticated responses `private, no-store`. A failed read
returns the existing 500 status with a generic message and random diagnostic
ID, and logs the same ID, elapsed time and an allowlisted error category. It
does not log the exception, SQL arguments, user, game, persona, or response
body. Successful reads slower than two seconds log only elapsed time. A proxy
timeout or failed authentication can happen outside this handler and will not
necessarily produce one of these records. No success response shape changes.

## Synthetic query-plan fixture

Run `bash scripts/benchmark-history-fixture.sh` with Docker and Bun. The runner
starts a new PostgreSQL 16 container with an OS-assigned loopback port, migrates
and truncates only that temporary database, loads synthetic data, records plans
and timings, and removes only its own container. It does not use `DATABASE_URL`
or touch the normal development, staging, or production databases.

The fixture has 1,000 completed Influence games with 12 seats each and one
owned seat, plus 1,000 Werewolf opening events with 12 synthetic seats each and
one owned seat. It is not a production data sample. The two `EXPLAIN ANALYZE`
queries approximate candidate-selection projections; they do not include all
service enrichment. The Influence service comparison contains **no canonical
event bodies**, so it understates actual result reconstruction. Werewolf
openings are for candidate-query measurement only, not valid complete games.

One local run selected 1,000 Influence seats in 7.5 ms and 1,000 Werewolf
openings in 3.8 ms. The Influence plan performed the seat-count subquery 1,000
times; the Werewolf plan expanded JSON 1,000 times. The Influence service read
took 70 ms for 20 rows, 161 ms for 100, and 1,427 ms for 1,000 unbounded rows.
These are single warm local measurements and establish neither production
latency nor the cause of a production failure.

## Safe next step

Do not switch the dashboard to a limited history array: its lifetime Influence
games, wins and win rate are computed from the complete results, including
multiple owned seats, and would become misleading. Build an additive owner-bound
cursor endpoint with a stable `(completion, game, player)` ordering and apply
ownership and visibility before the page boundary. Werewolf participants must
be expanded before limiting, including multiple owned agents in one game.
The existing completion field is text, and the existing JS and database sorts
are not a demonstrated shared chronological ordering; resolve timestamp and
collation semantics before issuing cursors.

Preserve separately computed exact lifetime aggregates using validated canonical
outcomes, including historical backfill and a safe treatment for unavailable or
corrected results. A normalized owner/participant read model and indexes may be
needed to avoid scanning every Werewolf event on each page; validate plans and
privacy against representative data before migration. Retain the old endpoint
until clients migrate, and test hidden/unlisted games, timestamp ties, multiple
seats, concurrent completions, ownership changes and invalid cursors. See
[#302](https://github.com/0xFlicker/influence-game/issues/302).
