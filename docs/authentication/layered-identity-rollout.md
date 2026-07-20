# Layered identity rollout

This is the solo-operator runbook for adding Clerk email/password
authentication without replacing Privy or changing any Influence account ID.

## Rules that do not change

- Privy email and wallet login remain first-class signup and login paths.
- `users.id` remains the durable Influence account ID.
- The rollout adds credential and verified-email records. It does not merge
  accounts by email, rewrite IDs, transfer ownership, or delete users.
- Set `MANAGED_AUTH_MODE` to the same value on the API and web service.
- Apply the additive database migration before enabling managed auth.
- Do not disable the Privy compatibility bridge until the identity inventory
  and final delta both pass.

Clerk setup and environment variables are documented in
[`managed-provider-selection.md`](managed-provider-selection.md).

## What to do in each environment

| Environment | Purpose | Data |
| --- | --- | --- |
| Development | Run automated tests and learn the Clerk configuration | Disposable local database and disposable Clerk development users |
| Staging | Rehearse the exact production order with real Privy and Clerk | Staging-only database and provider instances |
| Production | Inventory existing identities, cut over once, and verify both login paths | Production database and production provider instances |

## Development

1. Configure the Clerk development instance and
   `social-strategy-agent/dev` as described in the provider setup document.
2. Keep `MANAGED_AUTH_MODE=disabled` while applying migrations:

   ```sh
   bun run db:bootstrap
   ```

3. Run the deterministic layered-auth browser suite:

   ```sh
   bun run test:e2e:layered-auth
   ```

4. Start the normal local API and web services against a disposable database
   in separate terminals:

   ```sh
   bun run dev:api
   bun run dev:web
   ```

5. Set both services to `MANAGED_AUTH_MODE=full`.
6. Run the real Clerk lane:

   ```sh
   CLERK_E2E_DISPOSABLE_ENVIRONMENT=1 \
   CLERK_PUBLISHABLE_KEY=<development-publishable-key> \
   CLERK_SECRET_KEY=<development-secret-key> \
   CLERK_JWT_KEY=<development-jwt-key> \
   PLAYWRIGHT_BASE_URL=<development-web-origin> \
   bun run test:e2e:layered-auth:clerk
   ```

7. Manually confirm direct Privy email and wallet login still work.
8. Switch both services to `existing-only` and confirm existing password users
   can sign in while password signup and linking are blocked. Switch back to
   `disabled` and confirm Clerk disappears while Privy remains available.

The real Clerk test uses `+clerk_test` addresses, Clerk's development
verification code, and backend cleanup. Never point it at staging or
production. A skipped test is unverified, not a pass.

## Identity inventory

The inventory creates Privy credential mappings for existing accounts before
managed auth becomes public. It reads Privy as the source of authentication
facts and maps only to an existing durable `users.id`.

Run it from `packages/api` with:

- `DATABASE_URL`
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `AUTH_IDENTITY_INVENTORY_HMAC_KEY` containing at least 16 random characters
- `AUTH_IDENTITY_INVENTORY_CHECKPOINT_KEY` containing at least 16 different
  random characters
- `AUTH_IDENTITY_INVENTORY_CHECKPOINT_PATH`

Generate the HMAC and checkpoint keys independently. For example, run
`openssl rand -base64 32` twice and put the two results only in that
environment's Doppler config.

The checkpoint is the inventory job's encrypted resume file. Put it on
persistent storage that only the API job can read, not in the repository,
container image, logs, or a public object-store path. Create its parent
directory with mode `0700`; the job writes the file with mode `0600` and
replaces it atomically. Keep it only until the environment's cutover and
rollback window are complete.

This is an ordinary local file, not another service or a customer-data backup.
It lets an interrupted `write` resume at the last committed Privy page and lets
`final-delta` compare against the completed run. Use a private path on the
machine or persistent volume where you run the command, such as
`/var/lib/influence-auth-inventory/stg.enc`.

Run:

```sh
cd packages/api
bun run auth:identity-inventory -- --mode dry-run
bun run auth:identity-inventory -- --mode write
bun run auth:identity-inventory -- --mode final-delta
```

- `dry-run` reads Privy and the database without writing either.
- `write` stores one provider page per transaction and advances the checkpoint
  only after commit. Rerun it after interruption to resume.
- `final-delta` rereads Privy without writing and confirms every Privy identity
  that overlaps an Influence account already has an active credential. Privy
  identities that have never created an Influence account do not need one.

Proceed only when `final-delta` reports `status: "ready"`, complete pagination,
no issues, no inferred writes, and no ordinary users without credentials.

The inventory may map by an existing Privy credential, an exact legacy
`users.id` subject match during this transition, or an exact verified owner or
embedded-wallet match. It never merges by `users.email`.

`providerOnlyIdentities` counts valid Privy identities with no credential,
durable user, wallet match, email metadata match, or verified-email claim in
Influence. They are not Influence accounts, need no migration, and do not stop
the inventory or final delta. Do not delete them merely to make the inventory
pass; a provider record may own an embedded wallet and can safely complete the
normal signup path later.

An unmapped identity that overlaps any Influence email metadata or verified
email claim still stops the run, as do conflicting mapping facts, unclassified
owners, duplicate verified email ownership across durable accounts, pagination
failure, or a current Influence account that would require an inventory write.

When a run stops, use its fixed reason code and `identity-ref:v1:...` reference
to investigate from a machine with the same environment secrets. Do not paste
raw emails, wallet addresses, provider subjects, tokens, or app secrets into
chat or an issue. Fix the data or mapping logic, then rerun `dry-run`, `write`,
and `final-delta`. Do not manufacture a second account to get past the stop.

## Staging rehearsal

Do this once, in this order:

1. Configure the staging Clerk application and
   `social-strategy-agent/stg`. Keep both services at
   `MANAGED_AUTH_MODE=disabled`.
2. Put the public Discord support invite on `/privacy#contact`. From the
   `ACCOUNT_SUPPORT_REQUIRED` state, follow its contact link while signed out
   and confirm it reaches Discord.
3. Back up the staging database.
4. From the tested release, apply the additive authentication migration before
   starting the new API:

   ```sh
   cd packages/api
   bun run db:migrate
   ```

5. Deploy the new API and web code with
   `PRIVY_COMPATIBILITY_BRIDGE_ENABLED=true`.
6. Configure the staging inventory secrets and private checkpoint path.
7. Run `dry-run`, fix every stop condition, then run `write`.
8. Create one new Privy email account and one new Privy wallet account. Confirm
   each receives a durable user and Privy credential.
9. Run `final-delta`. Stop if it is not ready.
10. Set `PRIVY_COMPATIBILITY_BRIDGE_ENABLED=false` and restart the API.
11. Confirm an existing Privy email user, an existing Privy wallet user, and a
    new Privy signup still work.
12. Set `MANAGED_AUTH_MODE=full` on both services and redeploy them together.
13. From clean browsers, verify:
    - password signup requires email verification;
    - password logout and login work without Privy cookies;
    - password reset works;
    - an existing Privy email account can only link, not create a duplicate;
    - a wallet-owned Privy account requires Privy wallet authentication before
      linking a password;
    - both Privy and password login return to the original OAuth request and
      use the same durable Influence ID as `sub`;
    - malformed, oversized, and burst requests receive generic errors without
      revealing whether an account exists.
14. Switch both services to `existing-only`. Confirm existing password login
    and all Privy paths still work while password creation and linking are
    blocked. Return to `full` only after this rollback rehearsal passes.

Also confirm the deployed ingress rejects managed-auth bodies over the
application's 16 KiB limit, the API rejects oversized tokens and unknown
fields, and rate-limited requests return `429` with `Retry-After`. These are
configuration checks, not paperwork.

## Production rollout

Do this during a window when you can immediately test and roll back:

1. Confirm staging completed successfully and create a current production
   database backup.
2. Configure the production Clerk instance and
   `social-strategy-agent/prd`, initially with
   `MANAGED_AUTH_MODE=disabled` on both services.
3. Confirm the production Discord support link is reachable while signed out.
4. From the tested release, apply the additive authentication migration before
   starting the new API:

   ```sh
   cd packages/api
   bun run db:migrate
   ```

5. Deploy the tested API and web release with
   `PRIVY_COMPATIBILITY_BRIDGE_ENABLED=true`.
6. Configure production inventory secrets and a private persistent checkpoint
   path.
7. Run production `dry-run`. Resolve every stop condition.
8. Run `write` to completion.
9. Exercise one existing Privy email login, one existing Privy wallet login,
   and one new Privy signup. Confirm the new signup creates its Privy
   credential.
10. Run `final-delta`. Do not continue unless it is ready with no issues.
11. Set `PRIVY_COMPATIBILITY_BRIDGE_ENABLED=false` and restart the API.
12. Repeat the existing and new Privy checks. If any fail, turn the bridge back
    on and investigate before enabling Clerk.
13. Set `MANAGED_AUTH_MODE=full` on both services and redeploy them together.
14. From a clean browser, verify password signup, email verification,
    logout/login, password reset, existing-Privy linking, and OAuth return.
15. Verify direct Privy email and wallet login again.
16. Keep the encrypted inventory checkpoint and its two inventory secrets only
    through the rollback observation window. Then delete the checkpoint and
    remove those secrets; the credential rows in the database are the durable
    result.

Keep the deploy SHA, backup location, inventory summary, and time you enabled
`full` in your normal private deployment notes. Those four facts are useful for
rollback; no separate rollout record is required.

## `ACCOUNT_SUPPORT_REQUIRED`

This is a fail-safe, not an account-creation path. It appears when ownership
cannot be established safely enough to link a credential without risking a
duplicate or takeover. It must not silently create a second account or choose a
winner.

The existing community/support Discord is sufficient if:

- it has a stable public invite that works while signed out;
- `/privacy#contact` links to it and the error state's contact link reaches that
  section;
- the help text tells the user to post only the generated `AUTH-...` reference;
- it tells the user not to post an email, wallet address, password, token,
  recovery phrase, or seed phrase publicly.

You can then inspect the referenced case privately and repair the mapping. No
ticketing system or staffed support department is required.

## Rollback

Rollback is mode and compatibility configuration, never destructive data
cleanup.

| Situation | Action |
| --- | --- |
| Inventory or Privy adoption fails before Clerk is public | Keep `MANAGED_AUTH_MODE=disabled`; restore `PRIVY_COMPATIBILITY_BRIDGE_ENABLED=true`; fix and rerun the inventory |
| Signup or linking is unsafe but Clerk login works | Set API and web to `existing-only` and redeploy together |
| Clerk authentication is unavailable | Set API and web to `disabled`; Privy remains available, but password-only users are temporarily locked out |
| A credentialless legacy Privy account needs adoption | Temporarily restore the compatibility bridge, investigate, rerun the final delta, then disable it again |
| Application release is bad | Redeploy the prior application release while keeping the new database tables and credential rows |

After the first password account exists, prefer `existing-only`: it preserves
password login while stopping new mutations. Use `disabled` only when leaving
Clerk visible is less safe than the temporary password-user lockout.

Never drop the authentication tables, delete successful credential or claim
rows, merge accounts, rewrite `users.id`, or transfer ownership during
rollback. The migration is additive and should remain in place when the
application release is rolled back.

This slice does not add server-side session revocation. Password changes do not
invalidate Privy sessions, and there are currently no wallet actions whose
authorization depends on a password change.

## OpenAI reviewer account

After production password signup is stable:

1. Create the reviewer through ordinary production password signup.
2. Give it ordinary owned-agent and accessible-game data needed by the
   submitted tools. Do not grant the `producer` role or scope.
3. Deliver a unique password through a private secret-sharing channel.
4. In a clean browser, sign in with only email/password and connect the
   deployed ChatGPT app.
5. Verify authorization-code exchange, the intended scopes, a stable Influence
   `sub`, an owned-agent read, one supported agent write or enrollment, and an
   accessible-game read.
6. After review, reset the password, revoke the MCP refresh token through
   `POST /api/oauth/mcp/revoke`, and confirm the old credentials no longer
   work.

Password reset does not revoke an already-issued Influence browser JWT in this
slice. Its current maximum lifetime is seven days, so wait through that expiry
before treating the old browser session as gone.
