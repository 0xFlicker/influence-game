# Account-based roles

Approved scope: local implementation and documentation; no live grants or deployment.

1. Add account role grants and migrate matching wallet grants, preserving unmatched grants for review.
2. Switch role assignment API/UI and every authorization consumer to account IDs. Resolve current grants for session requests, including optional authentication.
3. Serialize role mutations and protect the final sysop; preserve audit information and bootstrap behavior without resurrecting revoked grants.
4. Add PostgreSQL and UI regression coverage; run provider-free, PostgreSQL, type/lint and web build checks.

Keep existing role permissions unchanged. Authentication providers remain credentials, not role owners. Production uses the existing blue/green handoff. A migration fence rejects old wallet-role writes during overlap; authorization rollback to old binaries remains unsafe after account grant changes.

Implemented and verified locally:

- Account grants, current authorization, account assignment UI/API, one-time
  bootstrap and queue-only service principals are complete.
- `bun run test`: 2,056 pass, 5 skip, 0 fail.
- `bun run test:postgres`: 1,777 pass, 0 fail.
- `bun run check`: all workspace typechecks and lint pass.
- Web build passes with a local placeholder public Privy app ID; no deployed
  configuration or credentials were read or changed.
- Migration release policy accepts `0103_account_roles.sql`.

Publication and a fresh PR dev environment were subsequently authorized.
Production/staging rollout and live role assignment remain separate steps.
