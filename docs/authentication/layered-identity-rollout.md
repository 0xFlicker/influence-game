# Layered identity rollout

This runbook covers the Privy identity inventory that must finish before
managed email/password authentication is made public. Privy remains a
first-class login and signup path. The inventory adds durable provider
credentials and verified-email claims; it does not rewrite `users.id`, merge
accounts by `users.email`, or create missing Influence accounts.

## Secrets and private checkpoint storage

Run the job with deployment-scoped secrets:

- `DATABASE_URL`
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `AUTH_IDENTITY_INVENTORY_HMAC_KEY` (at least 16 characters; use an
  independently generated production secret)
- `AUTH_IDENTITY_INVENTORY_CHECKPOINT_KEY` (at least 16 characters; use an
  independently generated production secret)
- `AUTH_IDENTITY_INVENTORY_CHECKPOINT_PATH`

Place the checkpoint in a deployment-private directory owned by the API job
identity, mode `0700`, on encrypted persistent storage. Do not use a shared
workspace, image layer, log volume, or public object-store prefix. The job
writes the encrypted file with mode `0600` and replaces it atomically.

The authenticated-encryption payload contains only an opaque Privy cursor,
format version, batch/completion metadata, and counts. It contains no provider
subject, email, wallet, access token, or app secret. The CLI output is similarly
restricted to counts, fixed reason codes, and versioned keyed-HMAC references.
References are useful only while the environment-scoped HMAC key is retained.

## Commands

Builds include `dist/preflight-auth-identities.js`. From a source checkout, run:

```sh
cd packages/api
bun run auth:identity-inventory -- --mode dry-run
bun run auth:identity-inventory -- --mode write
bun run auth:identity-inventory -- --mode final-delta
```

An explicit mode is mandatory. Each command exits nonzero when readiness is
blocked or the provider request fails.

- `dry-run` reads Privy and the database but writes neither identity tables nor
  a checkpoint.
- `write` commits one provider page per database transaction. It advances the
  encrypted checkpoint only after that transaction commits. Rerun the same
  command after a rate limit or interruption to resume without duplicate
  credentials or claims.
- `final-delta` re-reads Privy from the beginning, performs no database writes,
  compares the completed write checkpoint's counts, and verifies that every
  current Privy identity already has an active credential. A new direct Privy
  signup is acceptable only if the login path already dual-wrote its durable
  account and credential; an unbound identity or ordinary account blocks.

The REST inventory uses Privy's documented `GET /v1/users` pagination with
Basic app authentication, the `privy-app-id` header, cursors, and page sizes no
larger than 100. Rate-limit and transient-server retries are bounded. Repeated
or malformed pagination cursors fail closed without advancing the checkpoint.

## Mapping and stop conditions

Mapping authority is limited to:

- an existing active `(privy, provider_subject)` credential;
- an exact legacy `users.id` subject match during the transitional inventory;
- an exact verified external-owner or embedded-product-wallet match.

All matches must resolve to the same durable user. `users.email` is inspected
only for a mismatch signal and is never a merge key. Verified duplicate email
ownership across durable accounts becomes one `conflict` claim with no chosen
user. An imported synthetic account is excluded only when
`isImportedSyntheticPlayer` positively identifies its `imported-` wallet
marker.

Stop and reconcile before cutover if any result is `blocked`, including:

- an unclassified or unmapped Privy identity;
- subject/wallet facts resolving to different users;
- a retired or conflicting credential;
- a verified email disagreeing with the mapped user's email metadata;
- an ordinary non-synthetic user without an active credential;
- incomplete/repeated pagination, exhausted retries, or final-delta drift.

Never put a raw identity into tickets or chat. Use the result's reason code and
`identity-ref:v1:...` value. Reconciliation must use a restricted,
audited operator tool inside the same secret boundary.

## Cutover

Use one all-at-once rollout:

1. Run `dry-run` and resolve every stop condition.
2. Run `write` to completion. Retain its privacy-safe output and encrypted
   checkpoint.
3. Keep normal Privy login/signup live and verify its direct account-creation
   path creates both the durable user and Privy credential in one transaction.
4. Run `final-delta`. It must return `status: "ready"`, complete pagination,
   zero inferred writes, zero ordinary users without credentials, and no
   issues.
5. Set `PRIVY_COMPATIBILITY_BRIDGE_ENABLED=false` and restart the API. This
   disables only legacy subject/wallet adoption. It does not disable Privy
   login or new Privy signup. A credentialless legacy row now gets
   `ACCOUNT_SUPPORT_REQUIRED` instead of being inferred or duplicated.
6. Enable the separately gated managed-auth mode and perform its real-provider
   acceptance checks.

Do not disable the bridge before a zero final delta. Do not expose managed
signup while any stop condition remains.

## Signed rollout record

Retain only the following privacy-safe evidence:

- date, environment, deployed git SHA, and operator/change approval;
- inventory result version and mode;
- complete/status fields and count object;
- fixed issue codes and keyed references, if any;
- confirmation that direct Privy creation dual-wrote a credential;
- final-delta result;
- API restart/deployment identifier with the bridge set to `false`;
- managed-auth smoke result and rollback owner.

After the signed record is complete and the rollback window closes, securely
delete the encrypted checkpoint and retire its encryption/HMAC secrets. The
checkpoint is operational state, not a customer-identity archive.

## Rollback

If cutover fails:

1. Disable managed-auth public entry using its rollout mode.
2. Restore `PRIVY_COMPATIBILITY_BRIDGE_ENABLED=true` only if legacy adoption is
   required during rollback.
3. Keep Privy login/signup available and leave durable credential/claim rows in
   place; do not reverse IDs or delete successful bindings.
4. Rerun `dry-run`, then `write`/`final-delta` as appropriate before attempting
   cutover again.

This slice does not add server-side session revocation. Password changes do not
invalidate Privy sessions, and there are currently no wallet actions whose
authorization depends on a managed-auth password change.

## Managed-auth deployment handoff

The application implementation does not own staging or production deployment
configuration. The owning infrastructure repository must supply separate
development, staging, and production Clerk values described in
[`managed-provider-selection.md`](managed-provider-selection.md), set the same
`MANAGED_AUTH_MODE` on the API and web services, and deploy the database
migrations before enabling either `existing-only` or `full`.

Do not copy deployment secrets into this repository, image build arguments,
CI output, screenshots, or the signed rollout record. Record only the secret
version/change identifier and the operator who approved it.

## Automated acceptance lanes

Run the deterministic provider-adapter lane against local Docker Postgres:

```sh
bun run db:bootstrap
bun run test:e2e:layered-auth
```

This Playwright project starts isolated API and web processes, drives the
visible unified authentication wrapper, and proves managed signup, later
login, existing-Privy email linking, wallet reauthentication after expired
proof, reverse Privy collision linking, provider outage fallback, Influence
session expiry, and OAuth consent. Its Clerk and Privy provider assertions are
injected test adapters; they do not prove a real Clerk project.

Run the separate Clerk development-instance lane only with a disposable
Influence database and the required Clerk development credentials:

```sh
CLERK_E2E_DISPOSABLE_ENVIRONMENT=1 \
CLERK_PUBLISHABLE_KEY=<development-publishable-key> \
CLERK_SECRET_KEY=<development-secret-key> \
CLERK_JWT_KEY=<development-jwt-key> \
PLAYWRIGHT_BASE_URL=<development-web-origin> \
bun run test:e2e:layered-auth:clerk
```

The test uses a unique address containing `+clerk_test`, Clerk's `424242`
development verification code, password signup, logout/login, reset, and
backend teardown. Never point it at production. A skipped lane is not a pass;
record it as unverified until the real credentials and disposable environment
are available.

## Staging go/no-go record

Before the one public cutover, record every item below with timestamp, deployed
SHA, operator, result, and a privacy-safe evidence link:

- `dry-run`, completed `write`, and `final-delta` inventory summaries;
- zero unmapped authenticatable accounts, zero unclassified synthetic rows,
  zero unclassified owners, and every duplicate verified email represented by
  a conflict claim without a selected winner;
- direct Privy signup dual-writing its credential and the final delta remaining
  zero afterward;
- the compatibility bridge disabled only after the zero final delta;
- real Clerk signup, email verification, logout/password login, reset, existing
  Privy-email link, wallet-owner link with forced expiry/retry, and reverse
  Privy collision;
- clean-browser password login with no Privy or Clerk cookies;
- `full`, `existing-only`, and `disabled` mode behavior from the deployed web
  and API, with API/web mode agreement;
- malformed, unknown-field, oversized, and burst managed-auth requests rejected
  without account-existence disclosure;
- OAuth authorization reached from both Privy and password login, with the
  original authorization request still mounted and the stable Influence user
  ID used as `sub`.

Any nonzero inventory delta, ambiguous ownership, real-provider failure, or
mode disagreement is a stop. Repair forward; do not merge, delete, or re-key
customer accounts to make the checklist green.

## Gateway, handler, and provider-call verification

The deployed gateway and the application handler are separate controls. Verify
both:

- Configure the ingress request-body ceiling for `/api/auth/managed/*` at or
  below the application's 16 KiB managed-auth ceiling without lowering limits
  for unrelated upload routes. Send a request over the ingress limit and prove
  the gateway rejects it before the API handler or Clerk is reached.
- Bypass only the gateway in a restricted staging check and prove the handler
  rejects bodies over 16 KiB with `413`, tokens over 8 KiB with `400`, unknown
  fields with `400`, and missing explicit confirmation on create/link with
  `400`.
- The Clerk adapter bounds each token-authentication and profile lookup call to
  four seconds and performs no automatic retry. Induce a timeout and prove the
  route returns the generic `AUTH_PROVIDER_UNAVAILABLE` response without a
  second provider call.
- Pre-verification throttling defaults to 30 attempts per 60 seconds in a
  privacy-preserving HMAC source bucket; post-verification throttling defaults
  to 20 attempts per 60 seconds in a provider-subject/account bucket. Prove a
  `429` response contains integer `Retry-After` and the generic
  `AUTH_RATE_LIMITED` body without email, subject, wallet, or account state.
- Because application buckets are process-local, verify aggregate burst
  protection at ingress for the deployed replica count. Retry clients must
  honor `Retry-After`; neither the gateway nor application may immediately
  replay provider calls and create a retry storm.

Retain request counts, status codes, response headers, provider-call counts,
and correlation IDs. Do not retain submitted tokens or identifiers.

## Provider exit and support gates

Production enablement requires the archived written Clerk support response
requested in [`managed-provider-selection.md`](managed-provider-selection.md).
It must confirm the documented stable identity/export and replacement-provider
mapping posture. If the response is missing or contradicts that contract,
managed auth remains disabled.

Collision support is also currently blocked: the UI points to
`/privacy#contact`, but that section does not name a concrete support
destination. Before `full` cutover, supply an approved public support channel,
link it from the collision screen, and verify an unauthenticated user can reach
it. Do not invent an address. Until then, `ACCOUNT_SUPPORT_REQUIRED` remains a
safe technical stop but not an operationally complete customer journey.

## OpenAI reviewer acceptance and cleanup

Create the reviewer through ordinary production password signup—never by
inserting a special account or adding reviewer-only product behavior. Give it
ordinary owned-agent and accessible-game data sufficient for the submitted
tools. Do not grant the `producer` role or `producer` OAuth scope.

Deliver a unique high-entropy password just in time through an approved secret
sharing channel. Keep it out of email threads, tickets, chat, screenshots,
deployment logs, and this rollout record.

From a clean browser:

1. Sign in using only the reviewer email/password.
2. Start the deployed ChatGPT app connection and complete authorization-code
   exchange with ordinary scopes.
3. Reconnect or rescan the hosted app if its cached descriptor requires it.
4. Verify optional refresh, introspection, and stable Influence `sub`.
5. Invoke at least one owned-agent read, one supported agent write or
   pre-match enrollment action, and one accessible game read.

Record the hosted environment, date, app/version identifier, selected scopes,
tool names, success/failure, and privacy-safe correlation IDs. Local requests
or a self-hosted client are not substitutes for this hosted proof.

After review:

1. Reset the delivered password and prove the old password fails.
2. Revoke the reviewer refresh token at
   `POST /api/oauth/mcp/revoke`; refresh-token revocation invalidates its MCP
   family and related access tokens. Prove old access and refresh tokens fail.
3. Record the latest possible expiry of any previously issued Influence
   browser JWT. Password reset does not revoke that JWT in this slice; the
   current maximum lifetime is seven days.
4. After that timestamp, verify the old browser session is rejected and close
   the review record without recording any credential or token value.

## Post-first-account rollback

Once any password account exists, rollback means `existing-only`, not
Privy-only:

1. Set API and web `MANAGED_AUTH_MODE=existing-only` and deploy them together.
2. Prove existing password-only and linked-password users can still sign in.
3. Prove direct Privy login/signup remains available.
4. Prove managed create and link mutations return the disabled-mode response
   and their UI entry points are unavailable.
5. Preserve every credential, verified-email claim, account, ownership
   foreign key, and provider record.

Use the Privy-only dual-write build only before the first password account
exists, or during an explicitly declared emergency that records the
password-only lockout impact and repair owner. There is no destructive
rollback: no credential deletion, account merge, ID rewrite, or ownership
transfer.
