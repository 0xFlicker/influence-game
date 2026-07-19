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
