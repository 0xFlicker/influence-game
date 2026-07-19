# Managed authentication provider selection

Last reviewed: 2026-07-19

## Decision and authority boundary

Influence adopts Clerk for managed email/password credentials. Clerk owns
password custody, email verification, recovery, provider sessions, and its
credential-abuse controls. It is additive to permanent direct Privy
signup/login.

Clerk is not the Influence account, role, ownership, browser-session, or MCP
authority. The API will verify a presented Clerk session assertion with
`@clerk/backend`, read the current backend user and primary verified email, and
then resolve that credential to the permanent `users.id`. It will not use Clerk
middleware as a second authorization layer for product routes. Browser-supplied
email or verification fields are never proof.

The web integration uses Clerk Core custom-flow hooks from `@clerk/nextjs`.
Hosted redirects and Clerk Elements are not part of this adoption because the
existing OAuth authorization request must remain mounted.

Pinned SDK contract:

| Package | Location | Version |
| --- | --- | --- |
| `@clerk/nextjs` | `packages/web` dependency | `7.5.20` |
| `@clerk/backend` | `packages/api` dependency | `3.11.7` |
| `@clerk/testing` | root development dependency | `2.2.10` |

These were the current registry versions checked with Bun on 2026-07-19.
`@clerk/nextjs` 7.5.20 declares support for Next 16.1 and React 19.2, matching
this repository's resolved versions. Update all three deliberately, rerun the
real-provider suite, and review Clerk's custom-flow changes before accepting a
new pin.

## Mode contract

`MANAGED_AUTH_MODE` is the only rollout mode and defaults to `disabled`.
Unknown values are startup errors.

| Mode | Clerk entry | Permitted managed-auth behavior |
| --- | --- | --- |
| `disabled` | Hidden; the public key is returned as an empty string | None. Clerk credentials are not required. Direct Privy remains mandatory and available. |
| `existing-only` | Visible when Clerk configuration is complete | Sign in an already-linked password credential. Account creation and every Clerk create/link mutation must fail closed. |
| `full` | Visible when Clerk configuration is complete | The reviewed signup, sign-in, and explicit linking journeys may run. |

Changing the mode does not disable Privy, invalidate an Influence JWT, mutate an
account, or change an MCP grant. Downstream handlers must authorize their
operation against this mode; merely receiving a valid Clerk session is never
mutation authority.

## Environment contract

| Variable | Consumer | Required |
| --- | --- | --- |
| `MANAGED_AUTH_MODE` | API and web server | Optional; defaults to `disabled` |
| `CLERK_PUBLISHABLE_KEY` | Web server, then public runtime config | Required in `existing-only` and `full` |
| `CLERK_SECRET_KEY` | API only | Required in `existing-only` and `full` |
| `CLERK_JWT_KEY` | API only | Required in `existing-only` and `full` |
| `CLERK_AUTHORIZED_PARTIES` | API only | Required in `existing-only` and `full`; comma-separated exact `http`/`https` origins with no paths |

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` remains a local Next.js fallback for the
publishable key. The runtime endpoint returns only `CLERK_PUBLISHABLE_KEY` and
`MANAGED_AUTH_MODE`; it never returns the secret key, JWT verification material,
or authorized-party allowlist.

`CLERK_AUTHORIZED_PARTIES` must name every browser origin permitted to obtain a
session assertion for this API, for example
`http://127.0.0.1:3001,https://influence.example`. The API must pass this
allowlist and `CLERK_JWT_KEY` to Clerk token verification so the token signature,
expiry, and `azp` claim fail closed. CORS configuration is separate and is not a
substitute for token authorized-party validation.

Provision separate values in the existing Doppler
`social-strategy-agent/{dev,stg,prd}` configs:

- `dev`: the local Clerk development instance.
- `stg`: a staging-only Clerk application/instance and staging origins.
- `prd`: the production Clerk instance and production origins.

Do not copy development users or credentials into production; Clerk documents
development and production instances as separate and does not support migrating
development users into production. Start each environment at `disabled`.
Promotion to `existing-only` or `full` requires that environment's complete
configuration and its own smoke evidence.

Privy variables remain unconditionally required by the API in every mode.

## Dashboard configuration checklist

Apply this checklist independently to development, staging, and production.
Capture a dated screenshot or settings export for review; dashboard state is
release state, not an undocumented default.

- Public signups: enabled.
- Email: required for signup and enabled for sign-in.
- Verify at signup: enabled with email verification code.
- Password signup/sign-in: enabled; no email-code-only login path.
- Email changes: user permission to add, remove, or modify email identifiers
  disabled.
- Account Portal: disabled after the custom flow exists; direct portal pages
  must return 404.
- Client Trust: disabled. Clerk enables it by default for newer applications,
  so this must be checked explicitly.
- MFA strategies and required MFA: disabled for v1.
- Passkeys: disabled for v1.
- Social login, phone, username, Web3, SSO, Organizations, and other managed
  methods: disabled.
- Block email subaddresses: disabled. Plus-tagged addresses and dotted Gmail
  local parts must remain admissible and are tested as distinct under
  Influence's trim-and-case-only normalization.

A clean staging browser must prove signup requires the emailed verification
code and that a later fresh-browser login needs only email and password. It must
also prove Account Portal, identifier changes, Client Trust, MFA, and passkeys
are unavailable. This real-provider evidence is not replaced by mocks.

## Secrets, rotation, and rollback

`CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, and their historical values must not appear
in source, image build arguments, logs, fixtures, screenshots, support tickets,
or browser output. Store them only in the relevant Doppler config and inject
them into the API container at runtime. Although the JWT verification key is
public-key material, this project handles it through the same operational path
to keep the server contract out of browser and support surfaces.

Routine secret-key rotation:

1. Create a descriptively named second Clerk Secret Key for one instance.
2. Update only that environment's `CLERK_SECRET_KEY` in Doppler.
3. Deploy without deleting the old key.
4. Exercise one complete Clerk assertion exchange and one direct Privy login.
5. Confirm the new key is in use and the old key is no longer used.
6. Delete the old key in Clerk, then record only date, environment, deploy SHA,
   operator, and result.

Clerk supports multiple active Secret Keys, which makes that cutover and a
pre-deletion rollback possible. Before step 6, rollback means restoring the
prior deployment/Doppler version while the old key remains active. After
deletion, roll forward with the new key; do not resurrect retired material.

If a Secret Key is suspected compromised, create and deploy its replacement
immediately, verify the new path, and delete the exposed key. If safe overlap is
not possible, disable managed auth and accept a password-login outage while
keeping Privy available. Never paste the compromised value into the incident or
support record.

If Clerk changes the instance JWT signing material, update
`CLERK_JWT_KEY` and verify an assertion exchange in the same coordinated
deployment. Do not promote a JWT-key change based only on a health check. A
failed exchange rolls managed auth back to `disabled`; it does not weaken
verification or fall back to trusting browser claims.

## Provider exit contract

Clerk's official migration guide documents two exit inputs:

- a Dashboard user export; and
- paginated Backend API retrieval with `getUserList()`.

The Backend `User` includes the stable Clerk user ID, primary email identifier,
and email-address records. Each backend `EmailAddress` includes a verification
object whose status distinguishes verified from unverified addresses. Influence
must export that data while the Clerk instance is available and reconcile it
against its own `authentication_credentials` mapping.

For a replacement provider:

1. Freeze the Clerk subject-to-Influence-ID mapping and verified primary email
   evidence.
2. Verify the replacement credential and its email with the replacement
   provider.
3. Attach the replacement provider subject to the same Influence `users.id`.
4. Retire the old Clerk credential mapping only after reconciliation.
5. Prove ownership, roles, history, wallets, and MCP grants still reference the
   unchanged Influence ID.

Password hashes, MFA factors, provider sessions, lockout/risk state, and
passwordless continuity are not required to be portable. Users may need a
password reset and future MFA re-enrollment.

Official documentation is necessary but not sufficient for production
enablement. Written Clerk support confirmation must cover stable identity
records, verified-email continuity, and the supported mapping into a
replacement credential. An export/import rehearsal is not required.

## Clerk support request

Status on 2026-07-19: **prepared for operator submission; no request ID or
written response is recorded.** Production enablement remains blocked until a
response is attached to the release evidence and accepted against the criteria
below.

Submit this without secrets, real user identifiers, or email addresses:

> Influence uses Clerk only as an additive email/password credential provider.
> Our permanent account ID and ownership data remain in our database. Please
> confirm in writing: (1) which Dashboard export or Backend API fields preserve
> each stable Clerk user ID, primary email identity, and verified-email status;
> (2) whether those records are sufficient to reconstruct verified identity
> continuity when leaving Clerk; and (3) whether a replacement-provider subject
> can be mapped by our application to the same permanent Influence account
> without changing that account ID. Password hashes, MFA factors, sessions,
> lockout state, and risk data do not need to be portable. Please identify any
> retention window, plan restriction, rate limit, support-only step, or field
> that is omitted from self-service export.

Accept the response only if it explicitly identifies the durable user ID and
verified-email evidence available at exit, names material limitations, and does
not require changing Influence account IDs. An answer that only says “users can
be exported” is insufficient.

## Official Clerk references

- [Custom email/password flow](https://clerk.com/docs/guides/development/custom-flows/authentication/email-password)
- [Sign-in/sign-up options and identifier restrictions](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options)
- [Client Trust](https://clerk.com/docs/guides/secure/client-trust)
- [Disable Account Portal](https://clerk.com/docs/guides/account-portal/disable-account-portal)
- [Email-subaddress restriction](https://clerk.com/docs/guides/secure/restricting-access)
- [Backend token verification and authorized parties](https://clerk.com/docs/reference/backend/verify-token)
- [Environment variables](https://clerk.com/docs/guides/development/clerk-environment-variables)
- [Secret-key rotation](https://clerk.com/docs/guides/secure/rotate-api-keys)
- [Migration and export](https://clerk.com/docs/guides/development/migrating/overview)
- [Backend user list](https://clerk.com/docs/reference/backend/user/get-user-list)
- [Backend User](https://clerk.com/docs/reference/backend/types/backend-user)
- [Backend EmailAddress verification state](https://clerk.com/docs/reference/backend/types/backend-email-address)
