# Farcaster Mini App runbook

Operator checklist for deploying, verifying, and publishing Influence as a
Farcaster Mini App on `thehouse.game`.

**Audience:** solo operator / staging-to-production deploy  
**Related code:** `packages/web` (SDK, manifest, Mini App chrome),
`packages/api` (Quick Auth login, account resolution)  
**Related design notes:** [`docs/farcaster-mini-app.md`](./farcaster-mini-app.md)

---

## What this enables

| Surface | Behavior |
| --- | --- |
| Website | Unchanged Privy/Clerk login and chrome |
| Mini App host | Detects via `sdk.isInMiniApp()`, calls `ready()`, hides Sign in/out |
| Mini App auth | Quick Auth JWT → `POST /api/auth/farcaster/login` → Influence session |
| Onboarding | Same invite + public identity + Daily agent flow as website login |
| Shared EOA | Farcaster primary address matching `users.wallet_address` attaches to that account |

---

## Prerequisites

- [ ] Web and API deploy together (web needs new SDK; API needs Farcaster login route + migration).
- [ ] `WEB_BASE_URL` on the API matches the public Mini App host (e.g. `https://thehouse.game`). JWT domain check uses the **hostname only**.
- [ ] Production Postgres is available for the auth provider migration.
- [ ] Farcaster developer mode enabled for preview:
  [developer tools](https://farcaster.xyz/~/settings/developer-tools).

Do **not** add association header/payload/signature as env vars. Domain
association is committed public data (see [Sign domain ownership](#5-sign-domain-ownership-when-ready-to-publish)).

---

## 1. Database migration

Apply on every environment that runs the API (local → staging → production).

```bash
# From repo root, with API DB credentials available
cd packages/api
DRIZZLE_MIGRATIONS_DIR=./drizzle bun run db:migrate
```

Migration: `packages/api/drizzle/0053_farcaster_auth_provider.sql`

**Verify:**

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'authentication_credentials_provider_check';
```

Expected: `CHECK (provider IN ('privy', 'clerk', 'farcaster'))`.

**Stop if** migration fails or the check still excludes `farcaster`.

---

## 2. Deploy web + API

Deploy both services from the same feature branch / release.

| Package | Required pieces |
| --- | --- |
| `@influence/api` | `@farcaster/quick-auth`, Farcaster login route, migration applied |
| `@influence/web` | `@farcaster/miniapp-sdk`, MiniAppProvider, `fc:miniapp` meta, well-known route |

**Env (existing — no new association secrets):**

| Variable | Service | Role |
| --- | --- | --- |
| `WEB_BASE_URL` | API (and web if used) | Quick Auth JWT domain + absolute URLs |
| Existing Privy/Clerk vars | both | Website auth only; Mini App does not use them for login |

**Stop if** either service deploys without the other: Mini App would hang on
splash or fail login with 404/503.

---

## 3. Smoke-check publish surfaces

After deploy (or against a tunnel URL for local):

```bash
# Manifest
curl -sS "https://thehouse.game/.well-known/farcaster.json" | jq .

# Embed meta on the home document
curl -sS "https://thehouse.game/" | grep -E 'fc:miniapp'
```

**Expect:**

- Manifest JSON includes `miniapp.version` `"1"`, `name` `Influence`,
  `homeUrl` containing `app=mini`, splash color `#050508`.
- `accountAssociation` may be **absent** until domain is signed (see step 5).
- Home HTML includes `fc:miniapp` with stringified embed JSON.

**Stop if** 404 on manifest, invalid JSON, or missing `fc:miniapp`.

---

## 4. Preview in Farcaster

1. Prefer production/staging HTTPS. Local needs a tunnel (ngrok, etc.).
2. Open the tunnel/production URL once in a normal browser (iframe allowlist).
3. Open
   [Mini App Preview](https://farcaster.xyz/~/developers/mini-apps/preview)
   with a URL that includes `?app=mini`, e.g.
   `https://thehouse.game/?app=mini`.
4. Confirm:
   - [ ] Host splash dismisses (`ready()` ran).
   - [ ] No website **Sign in** / **Sign out** buttons.
   - [ ] Influence session is established (dashboard / account surfaces work).
   - [ ] New users get public-identity and Daily agent onboarding as usual.
   - [ ] Invite-gated environments still show the invite modal (without Sign out).

**Local API + web (tunnel the web origin):**

```bash
bun run dev:api
bun run dev:web
# Tunnel https → web port (default 3001)
```

Set `WEB_BASE_URL` on the API to the **public HTTPS host** you pass into Quick
Auth / preview (not `localhost`) when testing real JWT domain binding.

**Stop if** infinite splash, Privy modal appears, or login returns 401 with a
valid Mini App session (domain mismatch is the usual cause).

---

## 5. Sign domain ownership (when ready to publish)

Required for verified authorship, add-to-client, and catalog discovery. Not
required for preview or auth.

1. Open Farcaster Mini App manifest tooling for domain **`thehouse.game`**
   (exact host; no `www` drift).
2. Produce the signed `accountAssociation` (`header`, `payload`, `signature`).
3. Commit the values into `packages/web/src/lib/farcaster-miniapp.ts`:

   ```ts
   export const FARCASTER_ACCOUNT_ASSOCIATION: FarcasterAccountAssociation | null = {
     header: "...",
     payload: "...",
     signature: "...",
   };
   ```

4. Redeploy web.
5. Verify:

   ```bash
   curl -sS "https://thehouse.game/.well-known/farcaster.json" | jq .accountAssociation
   ```

6. Optionally refresh/register the manifest in Farcaster developer tools.

**Decode check (payload must be the exact domain):**

```bash
# payload is base64url; decode and confirm {"domain":"thehouse.game"}
```

**Stop if** domain in payload ≠ hosting FQDN.

---

## 6. Account-resolution spot checks

Use a throwaway FID / wallet where possible.

| Scenario | Expected |
| --- | --- |
| New FID, no prior Influence user | New `users` row + `authentication_credentials` (`farcaster`, FID) |
| FID primary EOA already on a Privy user’s `wallet_address` | Same `users.id`; farcaster credential attached |
| Later website Privy wallet login with that EOA | Same account; privy credential present |
| Two existing accounts already claiming the same wallet | Fail closed (`ACCOUNT_SUPPORT_REQUIRED`) — manual support, no auto-merge |

Inspect credentials:

```sql
SELECT provider, provider_subject, user_id, retired_at
FROM authentication_credentials
WHERE provider = 'farcaster'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 7. Rollback

| Layer | Action |
| --- | --- |
| Web-only rollback | Redeploy previous web; Mini App hosts stop getting SDK/`ready` — do not leave old web against new-only auth expectations if users are mid-flow |
| API-only rollback | Redeploy previous API; Mini App login 404s — prefer rolling both back together |
| Migration | Additive check constraint (`farcaster` allowed). Leaving it applied is safe if the API no longer writes `farcaster` rows. Do not drop `farcaster` credentials without a data plan |

Preferred rollback: redeploy previous web **and** API together.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Infinite splash | `ready()` never called | Ensure Mini App detection path runs; check browser console for SDK errors |
| 401 Invalid Farcaster token | JWT domain mismatch | Align `WEB_BASE_URL` hostname with Mini App host |
| 503 AUTH_PROVIDER_UNAVAILABLE | Primary-address lookup timeout / misconfig | Check API logs; FID-only path should still work if address lookup fails closed carefully |
| Privy modal in Mini App | Mode not confirmed / chrome not suppressed | Confirm `isInMiniApp()`; launch with `?app=mini` |
| Second career for same human | Different EOAs (Privy embedded ≠ Farcaster primary) | Expected for unequal addresses; only equal EOA auto-links |
| Manifest unsigned | Association still `null` | Complete step 5 when ready to publish |
| Images not loading | Wrong absolute URL / CDN | Manifest uses production origin `https://thehouse.game` for assets |

Official agent checklist:
[miniapps.farcaster.xyz](https://miniapps.farcaster.xyz/docs/guides/agents-checklist)

---

## Explicit non-goals (current slice)

- Notification webhooks / `webhookUrl`
- Farcaster wallet swap/send as product flows
- Replacing website Privy/Clerk
- Automatic merge of two pre-existing Influence accounts
- Page-specific embeds for every game/profile URL

---

## Quick reference paths

| Path | Purpose |
| --- | --- |
| `packages/web/src/lib/farcaster-miniapp.ts` | Embed/manifest builders + optional association |
| `packages/web/src/components/farcaster-miniapp-provider.tsx` | Detect + mode hint |
| `packages/web/src/components/farcaster-miniapp-auth-bootstrap.tsx` | Auto login + `ready()` |
| `packages/web/src/app/.well-known/farcaster.json/route.ts` | Manifest route |
| `packages/api/src/routes/auth.ts` | `POST /api/auth/farcaster/login` |
| `packages/api/src/services/authentication-providers.ts` | Quick Auth verifier |
| `packages/api/src/services/account-authentication.ts` | Credential + shared EOA resolve |
| `packages/api/drizzle/0053_farcaster_auth_provider.sql` | Provider check migration |
