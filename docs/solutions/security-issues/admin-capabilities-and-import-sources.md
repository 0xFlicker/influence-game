---
module: admin
problem_type: security
tags: [rbac, ssrf, cli, imports, invites]
---

# Separate panel visibility from administrative capabilities

Admin read access previously guarded invite mutations, redeemable invite-code reads, and direct/remote game imports. Both remote paths accepted caller-controlled destinations and redirects. A legacy CLI route also promoted a producer MCP grant to a session based on the caller-controlled Host header.

Use `manage_invites` and `manage_game_imports` at the remaining API boundaries, and gate invite navigation on `manage_invites`. Test real database grants and revocation rather than relying on JWT permission claims. A code-list read is sensitive because the returned code is itself a redeemable capability.

Remote browsing and import were removed entirely, including the panel, API routes, outbound fetch, and source settings. Direct export-payload import remains permission-gated. Removal of the unused token exchange preserves the browser CLI handoff and scoped asset grants.

See [deployment notes](../../deployment/admin-security-boundaries.md). Regression coverage lives in `packages/api/src/__tests__/admin-security.test.ts`, `auth.test.ts`, and the admin navigation tests. Use a fresh disposable database when a shared test database's migration ledger does not match its actual tables; do not repair that discrepancy by changing application migrations.
