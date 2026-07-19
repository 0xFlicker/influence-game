# Managed authentication provider setup

Last reviewed: 2026-07-19

## What Clerk owns

Influence uses Clerk for email/password credentials, email verification,
password recovery, and Clerk sessions. Clerk is additive to permanent Privy
login and signup.

Clerk does not own the Influence account. `users.id` remains the durable account
ID and continues to own roles, agents, games, browser sessions, and MCP grants.
The API verifies a Clerk assertion, fetches the current Clerk user and verified
primary email, and resolves the Clerk subject through
`authentication_credentials` to the existing `users.id`. Never authorize from
an email or verification flag supplied by the browser.

The web app uses Clerk custom-flow hooks from `@clerk/nextjs` so the existing
OAuth authorization request stays mounted during login. Clerk's hosted sign-in
pages and Account Portal are not used.

Pinned packages:

| Package | Location | Version |
| --- | --- | --- |
| `@clerk/nextjs` | `packages/web` | `7.5.20` |
| `@clerk/backend` | `packages/api` | `3.11.7` |
| `@clerk/testing` | repository root | `2.2.10` |

Upgrade the three packages together and rerun both layered-auth test lanes
before accepting a new version.

## Rollout modes

`MANAGED_AUTH_MODE` defaults to `disabled`. An unknown value prevents startup.
Set the same value on the API and web service.

| Mode | Behavior |
| --- | --- |
| `disabled` | Clerk is hidden and its configuration is optional. Privy login and signup remain available. |
| `existing-only` | Existing Clerk credentials may sign in. Clerk account creation and linking are blocked. |
| `full` | Password signup, sign-in, and explicit linking are available. Privy login and signup remain available. |

Changing this mode does not invalidate an Influence session, disable Privy,
change an MCP grant, or mutate an account.

## Configure each environment

Use a separate Clerk application or instance and separate Doppler values in
each environment. Do not share Clerk users or keys between environments.

| Environment | Clerk | Doppler config | Allowed browser origins |
| --- | --- | --- | --- |
| Development | Development instance used only with disposable local data | `social-strategy-agent/dev` | The exact local web origin, normally `http://127.0.0.1:3001` |
| Staging | Staging-only Clerk application/instance | `social-strategy-agent/stg` | The exact staging web origin |
| Production | Production Clerk application/instance | `social-strategy-agent/prd` | The exact production web origin |

Start every environment with `MANAGED_AUTH_MODE=disabled`.

### Clerk Dashboard

Apply these settings separately in development, staging, and production:

- Enable public signup.
- Require email at signup and allow email for sign-in.
- Require an emailed verification code during signup.
- Enable password signup and sign-in.
- Disable user changes to email identifiers.
- Disable Account Portal after the custom flow is deployed.
- Disable Client Trust. Clerk enables this by default for newer applications.
- Disable MFA requirements, passkeys, social login, phone, username, Web3,
  SSO, Organizations, and every other managed sign-in method.
- Leave email-subaddress blocking disabled. Plus-tagged addresses remain valid.

Create the environment's Secret Key on Clerk's **API keys** page. Copy the
instance JWT public key from **API keys → Show JWT public key → PEM Public
Key**. Keep the PEM formatting intact.

### Doppler

Set these values for both deployed services where indicated:

| Variable | API | Web | Value |
| --- | --- | --- | --- |
| `MANAGED_AUTH_MODE` | Yes | Yes | `disabled`, `existing-only`, or `full` |
| `CLERK_PUBLISHABLE_KEY` | Yes | Yes | Environment's Clerk publishable key |
| `CLERK_SECRET_KEY` | Yes | No | Environment's Clerk Secret Key |
| `CLERK_JWT_KEY` | Yes | No | Environment's Clerk PEM JWT public key |
| `CLERK_AUTHORIZED_PARTIES` | Yes | No | Comma-separated exact web origins, including scheme and port, with no paths |

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is only a local Next.js fallback.
Production browser configuration comes from the runtime endpoint, which
returns only the publishable key and mode.

`CLERK_AUTHORIZED_PARTIES` is token audience protection, not CORS. Include
every legitimate web origin that can send Clerk assertions to that API and
nothing else. Privy configuration remains required in every mode.

### Check the configuration

Before changing an environment to `full`:

1. Start or deploy the API and web service with the same mode.
2. Confirm the API rejects startup in `existing-only` or `full` when any
   required Clerk value is missing.
3. In a clean browser, create a password account and confirm the emailed code is
   required.
4. Sign out, open another clean browser, and sign in with email/password.
5. Confirm Account Portal, email changes, Client Trust, MFA, passkeys, and
   every other sign-in method are unavailable.
6. Confirm direct Privy email login and direct Privy wallet login still work.

Use only disposable users in development and staging.

## Rotate Clerk keys

For a routine Secret Key rotation:

1. Create a second Clerk Secret Key for the affected environment.
2. Replace only that environment's `CLERK_SECRET_KEY` in Doppler.
3. Redeploy the API while leaving the old key active.
4. Complete one password login and one Privy login.
5. Delete the old key in Clerk.

Before step 5, rollback by restoring the previous Doppler value and deployment.
After step 5, fix forward with the new key.

If a Secret Key may be compromised, replace it immediately. If the new key
cannot be deployed safely, switch managed auth to `existing-only` to stop new
credential creation, or to `disabled` if password login must also be stopped.
Privy remains available. Never put key material in source, build arguments,
logs, screenshots, chat, or support messages.

When Clerk changes its JWT signing material, update `CLERK_JWT_KEY`, redeploy
the API, and complete a real password login before removing the prior
configuration. A health check alone does not prove token verification works.

## If Clerk is unavailable

- Direct Privy login and signup continue to work.
- Existing Influence browser sessions and MCP grants continue until their
  normal expiry or revocation.
- Use `existing-only` when signup or linking is unsafe but existing password
  users can still authenticate.
- Use `disabled` only when Clerk authentication itself must be removed from the
  UI. After the first password-only user exists, this temporarily locks that
  user out; it does not delete or alter the account.

## Changing providers later

No Clerk support request is required for this rollout. Clerk's documented
Dashboard export and paginated Backend API expose the Clerk user ID, primary
email, and email verification state needed to reconcile
`authentication_credentials`.

If Clerk is replaced:

1. Export Clerk users while the instance is available.
2. Match each Clerk subject to its existing Influence credential mapping.
3. Have the replacement provider verify the user's new credential and email.
4. Attach the replacement subject to the same `users.id`.
5. Retire the Clerk credential only after reconciliation succeeds.

Password hashes, sessions, MFA factors, and provider risk state are not assumed
to be portable. A provider change may require password resets, but it must not
change Influence account IDs, ownership, roles, history, wallets, or MCP grants.

## Clerk references

- [Custom email/password flow](https://clerk.com/docs/guides/development/custom-flows/authentication/email-password)
- [Sign-in and sign-up options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options)
- [Client Trust](https://clerk.com/docs/guides/secure/client-trust)
- [Disable Account Portal](https://clerk.com/docs/guides/account-portal/disable-account-portal)
- [Email-subaddress restriction](https://clerk.com/docs/guides/secure/restricting-access)
- [Backend token verification](https://clerk.com/docs/reference/backend/verify-token)
- [Environment variables](https://clerk.com/docs/guides/development/clerk-environment-variables)
- [Secret-key rotation](https://clerk.com/docs/guides/secure/rotate-api-keys)
- [Migration and export](https://clerk.com/docs/guides/development/migrating/overview)
- [Backend user list](https://clerk.com/docs/reference/backend/user/get-user-list)
