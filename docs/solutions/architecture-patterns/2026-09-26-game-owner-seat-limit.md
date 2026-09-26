---
module: Game admission
date: 2026-09-26
problem_type: security_issue
component: backend
symptoms:
  - Ordinary accounts could add several owned agents to an unrated game
root_cause: missing_authorization
resolution_type: code_fix
tags: [rbac, roster, admission, mcp, concurrency]
---

# Role-restricted additional game seats

`admitOwnedSeatInTransaction` admits the first owned agent for any authenticated
account. An additional owned seat requires a current `admin`, `sysop`, or
`producer` role assignment in the database. Roles supplied in a request or
retained in a stale session do not grant this exception. Rated games retain
their stricter one-owned-seat-per-account invariant for every role.

Resolve this policy after locking the game and loading its roster, before
projecting a new effective agent revision or inserting a seat. The game lock
serializes concurrent requests for different agents by the same owner. The
existing same-agent replay precedes the limit, allowing safe retries without
adding another seat, including after a game starts or a role is revoked.

REST returns HTTP 403 with `code: owner_seat_limit` and a readable explanation.
Open-game queue enrollment uses the same authority for MCP and returns the same
typed rejection. Daily Free already selects one standing entry per account;
House-owned seats do not consume an account's owned-seat allowance.

PostgreSQL tests cover unassigned/player/gamer/moderator accounts, all three
privileged roles, stale privileged sessions after role revocation, same-agent
retries, separate games, concurrent different-agent requests, rated roster
protection, and REST/MCP parity. Fixture tests that intentionally cast several
agents for one owner explicitly grant that owner the producer role.
