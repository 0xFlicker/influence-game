---
title: "feat: Game asset CRUD with scoped OAuth and private banners"
type: feat
date: 2026-09-25
status: ready-after-current-repo-work
origin: docs/brainstorms/2026-09-25-game-assets-brainstorm.md
tasks: docs/plans/2026-09-25-003-feat-game-assets-tasks.md
---

# Game asset CRUD with scoped OAuth and private banners

## Outcome and authorization

An external workflow can use a short-lived token to upload, read, update, replace, and delete labeled images belonging to an Influence game. A private `banner` appears exclusively on `/games/[slug]/results` for authorized viewers. The same S3 storage path uses local MinIO in development and private Linode storage on deployed servers; PostgreSQL owns game association, metadata, and publication state. Deployment testing targets an ephemeral environment or staging.

This is an implementation handoff, not implementation completed. The user authorized planning documents only for this iteration. Do not execute application edits, migrations, cloud writes, role assignments, deployment, commits, or pushes from this planning turn. After the current repo work finishes, re-read the checkout and implement the ordered tasks under the user's execution authorization.

## Requirements

| ID | Requirement |
|---|---|
| R1 | External images attach to any existing game, including historical games, without mutating canonical events, scenes, agent context, or replay. |
| R2 | The existing `producer` role and sysop receive DB permission `manage_game_assets` and can manage game assets; admin status alone never grants writes. No new asset role is added. |
| R3 | Reuse browser OAuth plus PKCE for one-hour, revocable opaque tokens carrying explicit `assets:manage`; check permission on consent, exchange, refresh, and use. |
| R4 | Every image has a label and `public` or `private` visibility. Authorization governs metadata and byte reads; no spoiler enforcement exists. |
| R5 | Private Linode storage backs deployed uploads; local development uses existing MinIO through the same S3 adapter and private-content settings. No filesystem backend. |
| R6 | Provide bounded validated upload, paginated list, inspect, download, metadata update, immutable-pixel replacement, and delete. |
| R7 | Show the `banner` convention exclusively on `/games/[slug]/results`, including late attachments to old games, without blocking results content. |
| R8 | A small Bun CLI and repository skill operate against explicit local/deployed API targets using origin-bound token files. |
| R9 | Retries, stale edits, storage failures, lost responses, and partial deletes have explicit recoverable outcomes and cannot expose private bytes. |
| R10 | Required local tests/checks and explicit local MinIO smoke pass; real OAuth/storage/browser proof runs on an ephemeral deployment or staging. |

## Reader and placement policy

Working default from the brainstorm: `private` means authenticated plus current access to the game. For a public game, any signed-in viewer can see private assets. For a private game, use its existing creator/seated-player/admin audience. Resolve current roles/permissions from DB; do not trust JWT-embedded role claims for elevated access. `manage_game_assets`, granted to producer and sysop, permits global asset inspection and management, including hidden games. An OAuth grant still needs `assets:manage`; scope `producer` alone does not authorize asset endpoints.

| Caller | Public asset on accessible game | Private asset on accessible game | Mutate |
|---|---|---|---|
| Anonymous | Yes, only if the game is public and visible | No | No |
| App-session viewer | Yes | Yes, when the game audience permits it | Only with current `manage_game_assets` |
| OAuth asset client | Yes | Yes globally, with `assets:manage` and current `manage_game_assets` | Same scope and current permission |
| Other OAuth scopes | No authority on these new endpoints | No authority on these new endpoints | No |

Ordinary readers receive only ready, live assets they may see. List filters must not reveal unauthorized private counts, source fields, pending uploads, or tombstones. Direct unauthorized asset reads return the same not-found response as nonexistent assets. Invalid supplied credentials fail explicitly instead of falling back to anonymous reads. Management failures distinguish missing authentication (401), insufficient scope/permission (403), and stale revision/request conflicts (409).

`banner` is a placement convention, not a privacy gate. There is one live ready banner per `(game_id, visibility)`, enforced in PostgreSQL. Generic labels may have multiple images. Selection on `/games/[slug]/results` prefers an authorized private banner, then an authorized public one. Do not render or request this banner on `/games/[slug]`, replay, highlights, library cards, episode covers, SSR metadata, OG images, or trailers. The user chose the results-only placement; authorized API/CLI asset access remains available for production workflows.

## Data and publication

Add `game_assets` with UUID ID, game FK, label, visibility, alt text, optional `sourceWorkflow`/`sourceRunId`, storage backend and object key, normalized SHA-256, content type, dimensions, byte length, revision, creator/updater, timestamps, and deletion timestamp. These fields are authoritative metadata, not gameplay facts. Public/viewer DTOs omit storage keys and operational provenance; managers may read source/actor data but never bucket credentials.

Add a small `game_asset_operations` table for mutation receipts and upload intents. A request ID is unique within the actor; bind it to operation, game/asset, expected revision, and a fingerprint of the validated input plus normalized content hash. Persist candidate object keys before S3 writes so crashes leave discoverable cleanup work. Retain the previous key for replacement cleanup. Use typed operation outcomes and cleanup state; do not create a generic job framework or background worker.

Use positive revision/dimension/size checks, a constrained visibility value, game FKs, request-ID uniqueness, and a partial unique index for live banners. Duplicate request IDs with identical input return the existing receipt; different input returns 409. Re-read the migration journal when execution starts: `0099_anonymous_creation.sql` was in flight during planning, so no migration number is reserved here.

Publication sequence:

1. Authenticate and check current management permission before consuming an upload body.
2. Bound and parse multipart input; validate metadata and normalize passive image bytes.
3. Record the request fingerprint and intended immutable private object key.
4. Write the object outside the DB transaction. A retry verifies an existing candidate's hash instead of blindly overwriting it.
5. In a short transaction, re-check current permission and expected revision; publish the new asset/reference and applied receipt together.
6. Retire previous object bytes after publication. Cleanup failure is visible in the operation receipt and recoverable through the same request/cleanup operation.

No ready metadata is published before storage succeeds. A replacement failure leaves the prior ready asset usable. A crash or DB failure after storage leaves the upload intent available for reconcile/cleanup. A same-request retry must acquire an operation claim or equivalent DB fence so it cannot perform two publications concurrently. A stale revision cannot revive a deleted asset or overwrite another writer.

Delete first tombstones the association with revision fencing, immediately denying metadata/content reads. Then remove private object bytes. If removal fails, return the applied deletion receipt with `cleanup=pending`; a repeat/cleanup request retries removal without restoring the image. Retained tombstones and operation receipts explain partial outcomes. Cleanup endpoints must verify the candidate/retired key is no longer live before deleting it. Publication and cleanup share the same operation fence: an unreferenced-key lookup alone is insufficient because an active upload could publish immediately afterward. Cleanup must claim/terminalize an abandoned intent or require an already applied/failed terminal outcome before object removal; a cancelled/cleaned intent cannot later publish through a stale completion.

## Storage contract

Implement `services/game-asset-storage.ts` using the existing AWS SDK and `getPrivateTraceStorageConfig()` configuration; keep trace JSON semantics out of the image service. Use the same S3 adapter for local MinIO and deployed Linode, retaining path-style requests as in the existing client. Store objects under `game-assets/<game-id>/<opaque-version>.png`. Keep bucket/object access private, use immutable keys and bounded S3 read/write timeouts, and expose no anonymous storage URLs. Validate S3 requests against both storage targets. Never call `generateConstrainedPublicUpload` or use the public avatar/poster directory for game assets.

Initial upload contract: PNG, JPEG, or WebP input, 10 MiB maximum file size, 12 MiB maximum multipart body including metadata, and at most 4096 pixels on either dimension with a 4096 x 4096 total input-pixel ceiling. Reject SVG, animation/multiple frames, corrupt files, mismatched declared media type, missing dimensions, and decompression bombs. Normalize with existing Sharp to a single PNG, stripping supplied metadata; require normalized output at most 10 MiB. Return actual dimensions/type/hash from normalization, not client declarations.

Reuse the existing local bootstrap and source its settings when starting the API:

```bash
bun run s3:bootstrap
set -a
source .env.private-trace.local
set +a
```

The checked-in bootstrap defaults to MinIO at `http://127.0.0.1:19000` with private bucket `influence-private-content-local`. The API receives `LINODE_PRIVATE_CONTENT_ENDPOINT`, `LINODE_PRIVATE_CONTENT_ACCESS_KEY`, `LINODE_PRIVATE_CONTENT_SECRET_KEY`, and `LINODE_PRIVATE_CONTENT_BUCKET`; the CLI receives only the API target and its access token. Assets share the private-content service using their own prefix. Preserve existing trace objects and bucket settings. Missing storage configuration yields a clear unavailable error in every environment; there is no filesystem or public-storage fallback.

All content reads go through the API and authorize the current association and visibility. Use `Cache-Control: private, no-store`, `Vary: Authorization`, passive `Content-Type: image/png`, and `X-Content-Type-Options: nosniff` for this V1 on metadata and bytes, including public assets. This keeps a later public-to-private change from leaving a shared cache copy. Privacy cannot revoke bytes someone already downloaded; do not promise that it can.

## Auth integration

Seed permission `manage_game_assets` and map it to the existing `producer` role and sysop in `db/rbac-seed.ts`. Do not create a new asset role. Update the producer description to include asset management alongside its existing MCP access. Use `db/rbac.ts` resolution, including wallet normalization. Walletless users do not gain this wallet-backed role merely by logging in. Existing role assignments acquire the seeded permission after deployment; planning/implementation does not assign real accounts automatically.

Add opt-in `assets:manage` to `services/mcp-scope-policy.ts` with an assets consent group and a current-permission eligibility gate. Extend scope validation/DB check constraints, browser scope unions and consent group rendering, issuer metadata, code exchange, refresh, and introspection. Losing `manage_game_assets` through role removal or permission revocation must invalidate asset-bearing token use and prevent renewed issuance. A scope string never grants a role. A sysop can obtain an asset grant without an additional producer-role assignment; this feature does not broaden the existing producer-scope eligibility for private trace access.

Create an asset-specific HTTP auth adapter. It accepts a valid app session for viewer reads, and a validated existing opaque OAuth token only when it includes `assets:manage`. Mutations require the current DB permission in both cases. Reuse the existing bearer validator's resource, issuer, purpose, legal-acceptance, revocation, and expiry checks; do not weaken those checks or bypass them with a local JWT minting command.

This intentionally extends the existing Influence OAuth service grant to one new endpoint family: `/api/games/:idOrSlug/assets...`, `/api/game-asset-operations/...`, and `/api/game-assets/capabilities`. The token retains its current canonical resource/audience/purpose contract; document the endpoint family as part of that protected service capability, on the same API origin as its resource identifier. Do not infer permission from endpoint-prefix matching. Do not change global `requireAuth`, accept arbitrary producer/game tokens on asset routes, exchange a grant into an unrestricted app session, or enable the loopback-only `/api/auth/local-cli-session` on deployed servers. Asset-only grants must not gain MCP producer/private-trace authority.

The shared service resource identifier is a project design choice, not a claim that a scope can bypass resource binding. [RFC 8707, section 2](https://www.rfc-editor.org/rfc/rfc8707.html#section-2) distinguishes a resource identifier from its network location and separates intended audience from requested scope. Preserve exact existing resource validation while explicitly documenting the endpoints included in this service.

Keep one issuer and token lifecycle. New authentication infrastructure, a second token store, a broad role framework, and changes to unrelated MCP tool authorization are not required. Add missing scope/type handling only where the new grant flows through existing code.

## HTTP contract

Resolve game IDs or slugs once, before asset lookup; always constrain asset lookup to that resolved game. Inputs use exact closed schemas, reject extra/unknown fields, and never accept an arbitrary storage key/URL from the caller.

| Method/path | Input | Result |
|---|---|---|
| `GET /api/game-assets/capabilities` | Manager authentication | Current actor, granted scope/session authority, management permission, resource, and image limits; no credentials |
| `GET /api/games/:idOrSlug/assets` | Optional label, visibility, cursor; limit 1-100, default 20 | Authorized ready asset page with `nextCursor`; no hidden counts |
| `POST /api/games/:idOrSlug/assets` | Multipart `file` and JSON `metadata`: requestId, label, visibility, altText, optional sourceWorkflow/sourceRunId | 201 asset + operation receipt; identical retry returns the applied receipt |
| `GET /api/games/:idOrSlug/assets/:assetId` | None | Authorized asset metadata |
| `GET /api/games/:idOrSlug/assets/:assetId/content` | None | Authorized normalized PNG bytes |
| `PATCH /api/games/:idOrSlug/assets/:assetId` | requestId, expectedRevision, supplied metadata changes | Updated metadata + receipt; revision advances |
| `PUT /api/games/:idOrSlug/assets/:assetId/content` | Multipart file and metadata: requestId, expectedRevision | New immutable pixels on the same asset ID + advanced revision |
| `DELETE /api/games/:idOrSlug/assets/:assetId` | requestId, expectedRevision | Tombstone/cleanup receipt |
| `GET /api/game-asset-operations/:requestId` | Requester's request ID | Redacted outcome/recovery state, manager-authenticated |
| `POST /api/game-asset-operations/:requestId/cleanup` | Explicit requester's cleanup request | Reconciled or purged unreferenced candidate/retired object; never a live object |

Labels match lowercase slug syntax and are at most 64 characters. Require nonempty alt text at most 500 characters; source fields are optional bounded strings at most 200 characters. Request IDs are nonempty opaque strings at most 200 characters. Update supports explicitly clearing optional source fields with null. Upload visibility is explicit in HTTP; CLI defaults to private and sends it. List cursors bind resolved game, filters, and current reader identity/policy so they cannot cross privacy boundaries. Bound validation occurs before storage writes.

Return typed errors such as `asset_invalid`, `asset_conflict`, `asset_not_found`, `asset_storage_unavailable`, and `asset_operation_pending`. Do not log bearer tokens, request bodies, image bytes, private object URLs, or bucket credentials. Retain safe operation/game/actor IDs and outcome diagnostics.

## CLI and skill

Add `scripts/game-assets.ts` and root command `bun run game-assets`. Use Bun, native fetch/FormData, and the existing PKCE/token-file helpers after making the login request scope an explicit parameter with existing callers preserving their current selection. Keep the engine package independent of API DB/storage internals.

Commands: `login`, `logout`, `whoami`, `upload`, `list`, `show`, `download`, `update`, `replace`, `delete`, `receipt`, and `cleanup`. `whoami` reads the capabilities endpoint rather than trusting the token file to prove a current role. Normal output is machine-readable JSON; login instructions go to stderr. Validate malformed CLI arguments before network writes. Download streams to an explicit output path without overwriting an existing file unless requested. `logout` revokes the saved access token through the existing issuer before deleting the local credential; if the server cannot be reached, report that revocation is unconfirmed and require explicit local-only removal rather than claiming remote logout succeeded.

Planned examples, not executable until implementation:

```sh
bun run game-assets login --api http://127.0.0.1:3000 --web http://127.0.0.1:3001
bun run game-assets upload --api http://127.0.0.1:3000 --game GAME_SLUG --file /absolute/banner.png --label banner --visibility private --alt "Cast teaser" --request-id WORKFLOW_RUN_ID
bun run game-assets list --api http://127.0.0.1:3000 --game GAME_SLUG
bun run game-assets replace --api http://127.0.0.1:3000 --game GAME_SLUG --asset ASSET_ID --file /absolute/banner-v2.png --revision 1 --request-id REPLACEMENT_RUN_ID
bun run game-assets login --api https://API_HOST --web https://WEB_HOST
```

Require an explicit `--api` or `INFLUENCE_GAME_ASSETS_API_URL`; no implicit deployment selection. Store a separate 0600 token file in a 0700 directory per normalized API origin under `~/.influence-game/game-assets/`. Include API origin, canonical OAuth resource, scope, and expiry in the stored envelope. Preserve state and PKCE verification, timeout/loopback callback cleanup, and HTTPS outside loopback. Reject credential-bearing URLs and redirects on authenticated calls; never forward a bearer to another origin. A supplied token-file override must still match the target origin/resource. Token expiry gives a clear login instruction; V1 need not persist/use refresh tokens automatically.

Writes expose/reuse request IDs and expected revisions. A network error does not imply failure: inspect the receipt or retry identical input with the same request ID. Do not silently create a fresh ID for retries or apply a newer revision after a conflict.

Create `.agents/skills/manage-game-assets/SKILL.md`, covering environment selection, login, CRUD commands, private/banner conventions, receipt recovery, and targeted cleanup. Keep scope/visibility distinctions explicit. Link detailed API/storage operations in `docs/game-assets.md`; no copied OAuth manual. Validate the skill with the skill-creator validator. The skill supports authorized user operations; it does not grant permission to publish, delete, deploy, or operate a different server.

## Results page behavior

Add a small client `components/game-banner.tsx` component to `app/games/[slug]/results/page.tsx`, below the results heading and above `GameViewer`. Mount it only in this route; `GameViewer` is shared across other contexts and must not own the banner. Present a responsive full-width image with its original aspect ratio and sensible maximum height; use contain framing to preserve text embedded in teasers. This is a banner placement, not an asset browser. Show meaningful alt text. The existing results viewer and controls remain usable.

Lazy-load metadata on entering the results route after auth readiness, on game/auth identity changes, and on window focus while that route is mounted. Fetch authorized image bytes with the session header and create a browser object URL; do not put tokens in query strings or use an unauthenticated image tag against private content. Revoke object URLs on replacement, logout, unmount, and route change, including leaving results for the same game's landing/replay/highlights. Abort stale fetches and fence completions by game/auth generation. No private pixels may remain drawn for a new/anonymous identity or after leaving the results route.

No asset produces no placeholder UI or results-loading failure. In-flight lookup does not delay results content. A fetch failure is recoverable with a small status/retry action and no exposure of operational keys. Focus refresh on the results route makes a later historical upload visible without needing a game execution or migration. No polling worker, asset-generation call, or side effect on read is introduced.

## Validation and proof boundaries

- PostgreSQL-owned tests use `setupTestDB()` and remain sequential. Cover producer/sysop permission seeding, fresh role grants/revocation, scope issuance/exchange/refresh/introspection, session-vs-OAuth boundaries, asset-scope enforcement even for producers, sysop without a producer role, private-game/public-asset intersection, hidden games, and guessed/cross-game asset IDs.
- Exercise real multipart parsing/normalization through route tests with an isolated in-process storage double: create/list/read/content/update/replace/delete, pagination, banner uniqueness, malformed input, size/pixel limits, duplicate requests, concurrent writers, storage errors, DB-finalization failure, cleanup retries, and public-to-private cache headers. The double is test infrastructure, not an alternate runtime storage backend.
- Provider-free CLI tests use an in-process fake HTTP server and temporary token/files. Prove PKCE scope parameterization, origin separation, expiry, redirects, request/revision reuse, malformed options, and bytes downloaded correctly; no provider or deployed credentials.
- Deterministic browser coverage proves the private banner visible only on `/games/[slug]/results` for the chosen reader policy, denied to anonymous users, reset on logout/navigation, and discovered on focus after late attachment. Assert no banner rendering or banner requests on the game landing, replay, highlights, or library, including navigation away from results for the same game. Reuse an API-owned `.e2e.test.ts` harness with per-process DB/child cleanup; classify any new root Playwright spec explicitly.
- Run `bun run test`, elevated `bun run test:postgres`, and `bun run check`. Check affected deterministic browser journeys and run a read-only Grok review if available under repository preferences. Preserve unrelated failures and report their exact boundary.
- Add an explicit `*.external-smoke.test.ts` local MinIO journey using the real S3 adapter and disposable game/assets. Exercise upload, authorized read/download, update, replacement, deletion, receipts/cleanup, and anonymous direct-object denial. Run it separately from required CI; local storage writes require only local credentials. Cleanup targets only that run's objects and fixtures, never the shared bucket or trace prefix.
- Complete deployment proof on an ephemeral environment or staging, as selected by the user: real browser OAuth and current producer/sysop authority; private Linode PUT/GET/delete; anonymous direct-object denial; authorized results-banner load; unauthorized API denial; and the documented upload bound through ingress. Record the exact target/release and cleanup. Treat this as an implementation acceptance task once a runnable deployment is available; this planning turn does not execute it. MinIO and storage doubles do not prove deployed storage ACLs, OAuth, ingress limits, or browser behavior. Keep deployed credentials and external writes out of ordinary tests.

Update `docs/game-assets.md`, `docs/game-mcp-production-oauth.md`, `DEVELOPMENT.md`, `CONCEPTS.md`, and a relevant `docs/solutions/` entry in the implementation branch. No reasoning/transcript/simulation behavior changes are intended.

## Review iteration incorporated

The planning review tightened six seams: private storage rather than public poster helpers; an explicit narrow OAuth REST capability rather than global session acceptance; durable upload intents plus revision fences across S3/DB boundaries; fencing cleanup against in-flight publication; no shared caching across privacy changes; and browser auth-generation cleanup. It also made `whoami` a server check and distinguished remote token revocation from local credential deletion. The user's later role decision reuses producer and sysop with `manage_game_assets`, while retaining explicit asset-scope consent. Their placement correction mounts the banner exclusively on the results route rather than the landing or shared viewer. Their environment choice reuses local MinIO through the deployed S3 adapter and requires deployment proof on an ephemeral environment or staging. It removed speculative spoiler flags, automatic generation/backfills, public cover overrides, a second token lifecycle, and the local filesystem backend. The task list below carries these decisions into checkable units.

Execution order and done conditions: [tasks](2026-09-25-003-feat-game-assets-tasks.md).
