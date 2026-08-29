# Farcaster Mini App

Influence can run as a hybrid **website + Farcaster Mini App** on
[`thehouse.game`](https://thehouse.game).

**Operator deploy checklist:**
[`docs/farcaster-mini-app-runbook.md`](./farcaster-mini-app-runbook.md).

## Runtime detection

- Client truth: `sdk.isInMiniApp()` from `@farcaster/miniapp-sdk`.
- Launch hint: `?app=mini` on Mini App launch URLs (embed + manifest
  `homeUrl`). This is **not** a security boundary — it only suppresses
  website Sign in/out chrome while probing and pre-wires Mini App UX.
- When Mini App is confirmed, the client calls `sdk.actions.ready()` after
  session exchange succeeds or fails so the host splash never hangs forever.

## Authentication

Inside a confirmed Mini App:

1. `sdk.quickAuth.getToken()` obtains a domain-bound Quick Auth JWT.
2. Web posts to `POST /api/auth/farcaster/login`.
3. API verifies the JWT with `@farcaster/quick-auth` against the app host
   (from `WEB_BASE_URL` or request `Host`).
4. Optional primary Ethereum address is resolved for the FID.
5. Account resolution:
   - existing `(farcaster, fid)` credential → that user
   - else matching `users.wallet_address` → attach farcaster credential
     (shared EOA with Privy wallet careers)
   - else create a new Influence user
6. Normal invite gate, public identity onboarding, and Daily agent prompt
   run on the Influence session.

Website Privy/Clerk login is unchanged outside Mini App mode.

### Domain for Quick Auth

`WEB_BASE_URL` (e.g. `https://thehouse.game`) should match the Mini App
domain. JWT verification uses the hostname only.

## Publish surface

| Surface | Location |
| --- | --- |
| Manifest | `GET /.well-known/farcaster.json` |
| Embed meta | Root layout `fc:miniapp` |
| Embed image | `/farcaster/embed.png` (3:2) |
| Icon / splash | `/logo.png` |

Manifest and embed builders live in
`packages/web/src/lib/farcaster-miniapp.ts`.

### Domain association (optional until signed)

`accountAssociation` is **public** manifest data. It is **not** configured
via env vars.

1. Sign domain ownership for `thehouse.game` in the Farcaster developer
   manifest tooling.
2. Paste `header`, `payload`, and `signature` into
   `FARCASTER_ACCOUNT_ASSOCIATION` in
   `packages/web/src/lib/farcaster-miniapp.ts`.
3. Deploy. Clients fetch the association from
   `/.well-known/farcaster.json`.

Until signed, preview + detect + ready + Quick Auth still work; verified
catalog ownership is incomplete.

## Local preview

1. Serve the web app over HTTPS (tunnel such as ngrok if needed).
2. Open the tunnel URL once in a normal browser (iframe allowlist).
3. Use
   [Mini App Preview](https://farcaster.xyz/~/developers/mini-apps/preview)
   with `?app=mini` on the URL.
4. Confirm splash dismisses and Sign in/out are hidden.

## Explicit non-goals (current slice)

- Notification webhooks
- Farcaster wallet swap/send actions
- Replacing website Privy/Clerk
- Automatic merge of two pre-existing Influence accounts that already claim
  the same wallet (fail closed)
