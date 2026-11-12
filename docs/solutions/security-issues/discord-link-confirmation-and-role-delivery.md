---
module: Discord verification
tags: [discord, oauth, account-linking, rbac, durable-delivery]
problem_type: integration_issue
---

# Confirm Discord identity separately from server role delivery

## Decision

House login remains the account authority. Discord OAuth proves the other identity;
it never signs someone into House or supplies a House role. Bind each ten-minute
OAuth attempt to the account, browser nonce, application, redirect and guild, then
show both identities before a separate confirmation transaction. Hash state and
nonce at rest, use the nonce for PKCE, and never persist OAuth tokens.

The private unique connection row also owns the role delivery revision and lease.
This makes a confirmed link durable before Discord REST is available. A worker
reads current RBAC, removes obsolete managed roles before granting current ones,
and checks the lease/revision before each external mutation and acknowledgement.
External Discord writes cannot be atomic with PostgreSQL; a changed revision
must remain pending for corrective delivery. Never acknowledge stale work. The
in-flight-grant race test disconnects after the last check but before Discord
applies a grant, then proves the next cleanup removes it before releasing the
identity. Permission/hierarchy failures retain cleanup until an operator repairs
bot access; dropping the link early would leave untracked access behind.

V0 deliberately requires manual refresh after House role changes. Describe the
last requested update as complete, not the current live roles as synchronized.

Disconnect removes trusted bot authority immediately but reserves both identities
until role removal succeeds. Only Discord's explicit Unknown Member error (`10007`) proves absent-member
cleanup. A generic HTTP 404 can mean Unknown Guild after bot removal and must
retain the link and cleanup work.
Unsafe Administrator grants are rejected; removing an old Administrator grant
must still work. Discord roles never substitute for fresh controller authorization.

## Browser integration finding

The isolated callback document initially saved `error: null` beside `code`, `state`
and `issuer`. Spreading that browser object into the strict exchange API caused a
400 even on a successful callback. Build the exact exchange DTO explicitly; local
storage bookkeeping is not the API contract. The browser regression test traverses
the callback document and proves no association exists before confirmation.

## Evidence and limits

Provider-free callback and Ed25519 interaction tests, PostgreSQL tests of binding,
uniqueness, authority, leases and delivery, and the isolated mobile browser journey
cover this implementation. Discord boundaries are synthetic. Actual portal OAuth,
bot hierarchy, membership screening and role grants still require a consented live
proof after deployment. See [the runbook](../../discord-house-setup.md).
