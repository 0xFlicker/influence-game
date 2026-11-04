# Prevent scheduled free games between seasons

The singleton queue already supports sequential seasons: enrollment requires an
accepting active season, and closeout clears standing entries. Draw previously
allowed stale entries to create an unrated free game after admission stopped.

New draws now check the accepting season under the same transaction lock as
join/closeout, then bind using that exact admission timestamp. Existing draw
receipts and waiting-game recovery remain idempotent. The scheduler start route
requires an assigned season, preserving start/recovery for games admitted before
closure while closing the legacy-unassigned-lobby bypass. Custom routes are
unchanged.

Coverage includes missing, closing, final, future and expired admission, stale
queue rows, exact retry after closeout, starting an already-admitted closing
season game, and concurrent draw/closeout. Tests use an isolated database.

Verification: 61 focused PostgreSQL tests passed (285 assertions), covering the
free queue, season lifecycle and queue enrollment. Typecheck/lint passed.
Production was inspected read-only: Season 0 remained active with 22 queue entries.
Local Season 0 was already final with an empty queue. No live closure or code
deployment was performed; production-target confirmation remained pending.
