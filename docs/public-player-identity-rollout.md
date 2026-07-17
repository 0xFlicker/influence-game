# Public Player Identity Rollout

This runbook controls the privacy-sensitive rollout of public player identity, anonymous profiles, contextual player links, and agent previews. The data migration is additive, but the public contract cutover is intentionally breaking: public consumers must stop receiving or interpreting internal account IDs.

## Public and Private Boundary

Public player facts are limited to the immutable public UUID, optional mutable unique handle, safe display name, anonymously shareable profile, current saved agent roster, and deterministic facts already derived from existing season, career, result, and agent records.

Wallet and email addresses, Privy or other authentication subjects, internal `users.id`, agent prompts and backstory, strategy configuration, revision history, reasoning and cognitive artifacts, provider data, administrator artifacts, and private dashboard, account, and agent-editing controls remain private. This rollout adds no persisted metric, summary, analytics record, or identity state beyond the public UUID and handle.

### Authenticated Email API Boundary

A user's email address may be serialized only to that same authenticated user or to an authenticated caller whose wallet currently carries the named `sysop`, `admin`, or `producer` role. Permissions such as `view_admin` and `manage_roles` do not independently grant email access, and stale role claims in an existing session do not preserve email access after revocation.

The allowed response paths are:

- `POST /api/auth/login`, `POST /api/auth/local-cli-session`, `GET /api/auth/me`, and `GET/PATCH /api/profile`, where the response subject is the authenticated user.
- `GET /api/admin/users` and `GET /api/admin/agents`, where email fields are returned for the subject user or a caller with a privileged email role. The route's existing permission gate still applies; the email role does not grant endpoint access by itself.

All other REST, MCP, WebSocket, replay, leaderboard, queue, season, and public-player responses must omit email values, including an email copied or embedded in a legacy display-name field. Administrative labels such as invite-code owners use the same display-name redaction even though they never expose an email field. Public identity queries may load email internally only to reject email-derived display names. The generic authenticated request context deliberately omits email so serializing `c.get("user")` cannot expose it.

## Contract Matrix

| Surface | Rollout contract |
|---|---|
| Anonymous player profile REST | New version 1 |
| MCP `read_player_profile` | New version 1; handle or public UUID; `games:read` or `producer`; no mutation |
| Season dashboard | Version 1 to 2 |
| Season game receipts | Version 1 to 2 |
| HTTP game watch state | Version 3 to 4 |
| WebSocket `watch_state` | Version 3 to 4 |
| Replay frame | Version 1 to 2 |
| Public leaderboards | Unversioned intentional field break |
| Outer game detail | Unversioned intentional field break |
| `list_seasons` | Remains version 1 |
| Private owner and producer contracts | Unchanged |

The versioned changes add public player references or current agent-preview projections while removing internal owner identifiers. The unversioned breaks require coordinated deployment and explicit mixed-version proof.

## Four Rollout Gates

Do not combine these gates into one deployment. Each gate has a stop condition and must have recorded evidence before the next begins.

### Gate 1: Additive Migration and Preflight

1. Apply the public UUID and nullable handle migration without changing existing `users.id` primary or foreign-key relationships.
2. Verify every user has one non-null, unique public UUID, no public UUID equals its internal `users.id`, and future inserts receive a public UUID.
3. Verify the public UUID immutability guard and canonical, case-insensitive handle uniqueness rules.
4. Run the strict `users.createdAt` preflight. Every row must be an accepted offset-bearing timestamp and classifiable against the launch cutoff; zero malformed or timezone-free values are allowed.
5. Record row counts, UUID completeness and uniqueness, migration duration, and observed lock behavior.

Stop if any row cannot be classified, any UUID assertion fails, row or ownership counts drift, or migration lock behavior exceeds the accepted window.

### Gate 2: Tolerant Consumers

Deploy consumers before the breaking producer:

- Ignore legacy `userId` and `ownerId` fields on public payloads. Never turn them into links or display values.
- Accept missing public identity references and current agent previews.
- Render unresolved, House-controlled, imported, synthetic, or temporarily missing owners as plain text or unavailable state.
- Accept the old and new versioned shapes needed during the rolling deploy.

Prove the tolerant web build against the old API first. Retain this compatibility path through the complete old-producer drain; it is not temporary code to remove during the producer deployment.

### Gate 3: New Producers and Frozen Cutoff

1. Choose one future UTC instant and set `PUBLIC_IDENTITY_LAUNCH_CUTOFF` explicitly to that exact value on every API instance, worker, and other account-producing process. Do not rely on per-instance clocks, locale parsing, or independently chosen values.
2. Deploy every new API/MCP, authentication, season, game, watch, WebSocket, and replay producer before that instant.
3. Verify new producer responses use the contract matrix above, contain public references where available, and contain no internal account or authentication identifier.
4. Keep required onboarding inactive by time: accounts created before the frozen cutoff remain deferrable when incomplete, while accounts at or after it become required.

An old producer can create or authenticate an account without returning or enforcing the identity step. While any old producer remains, a player can temporarily enter without claiming a handle; if an old producer survives past the cutoff, it can also violate the required-new-player experience for that session. This is a rollout risk, not an accepted compatibility mode.

After a successful required or deferrable identity save, that browser session carries an account-scoped, one-shot handoff into standing Daily agent onboarding. The existing queue and agent reads still complete before the “Play for Free” dialog opens, but this handoff skips its ordinary three-second presentation delay. The handoff survives only the prompt's bounded retry sequence and is consumed by an eligible result, queue ineligibility, or exhausted retries. Dismissal, returning complete identities, generic identity updates, profile edits, and reloads keep the ordinary delayed behavior.

### Gate 4: Drain Proof and Activation

Before the frozen cutoff:

1. Prove every old producer is drained using deployment revision inventory plus request logs or metrics that identify the serving revision. A successful new deployment alone is not drain proof.
2. Re-run mixed-version and forbidden-key checks against the fully new producer fleet and tolerant consumer.
3. Attach the anonymous endpoint gateway evidence described below.

At and after the cutoff, verify an exact-boundary new account receives required identity onboarding and a pre-cutoff incomplete account remains deferrable. Verify handle and public-UUID profile parity, handle changes, contextual links, and plain-text synthetic fallbacks.

The tolerant consumer stays in place through a post-cutover observation window. Remove its legacy-shape compatibility only after old-producer drain and new-version traffic are both proven.

## Anonymous Profile Rate-Limit Gate

`GET /api/players/:identifier` bounds identifier length and returns `Cache-Control: no-store`, but the application does not implement an in-process rate limiter. Production acceptance of the anonymous route therefore requires gateway evidence for all of the following:

- Per-source burst and sustained limits on the anonymous player-profile route.
- Correct client-source attribution through only trusted proxies, with IPv6 behavior tested and documented.
- `429 Too Many Requests` responses with a valid `Retry-After` value.
- Logs and metrics that distinguish allowed, throttled, and failed requests without recording private identifiers or high-cardinality secrets.
- Intentional health-check and static-asset bypasses that do not accidentally bypass the player-profile rule.

This is an open deployment gate until the actual gateway configuration and observed staging evidence are attached to the release handoff. Application tests or bounded identifiers are not substitutes, and this rollout must not add persistence merely to imitate a durable edge control.

## Rollback Boundary

Before public UUIDs are exposed, a failed rollout may stop after an additive gate and repair forward. After any public UUID is shared, identity data is forward-only:

- Never drop, regenerate, or recycle public UUIDs.
- Preserve UUID defaults, uniqueness, immutability guards, claimed handles, and internal/public ID separation.
- Roll application code back only to a privacy-safe tolerant build that understands public references and does not re-expose internal IDs.
- If no such build is available, disable the affected public surface or repair forward; do not restore an internal-ID producer.

Handle changes remain mutable and do not create redirect or alias history. The immutable public UUID is the recovery route.

## Release Evidence Checklist

- Local identity browser story: `bun run test:e2e:identity` executes all seven
  scenarios against the isolated PostgreSQL/API/web harness. A fully skipped
  suite is not passing evidence.
- Gate 1 migration and strict timestamp-preflight output.
- Old API to tolerant web mixed-version proof.
- Exact frozen `PUBLIC_IDENTITY_LAUNCH_CUTOFF` recorded for every producer environment.
- Producer revision inventory and old-revision drain evidence before the cutoff.
- Recursive forbidden-key and schema-version results for REST, MCP, watch, WebSocket, replay, leaderboards, and game detail.
- Gateway configuration plus observed burst, sustained, `429`/`Retry-After`, trusted-proxy, IPv6, logging, metrics, health, and static-bypass evidence.
- Exact-cutoff onboarding proof and post-cutover observation results.
- Confirmation that the compatibility shim was retained through drain, or a dated follow-up for its later removal.
