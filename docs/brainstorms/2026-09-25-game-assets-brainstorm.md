---
date: 2026-09-25
topic: game-assets
status: implemented-awaiting-operator-review
---

# Game assets: externally produced images, spoilers, and API access

## User intent

Attach images produced outside gameplay to an existing Influence game. The first placement is a banner exclusively on `/games/[slug]/results`, as requested by the user. External production workflows need token-authorized uploads; a small Bun CLI and a repository skill should support CRUD against local and deployed APIs.

The user explicitly rejected spoiler enforcement. Revealing teasers, winner imagery, and result details are acceptable. The user clarified that roles govern uploads and modifications, not viewing. Asset `visibility` now uses `public` or `spoiler` as presentation metadata, with no asset privacy filters. Images must not become game-state authority.

The initial iteration produced planning documents while another agent worked in the main checkout. On 2026-09-26 the user authorized implementation through operator review from freshly fetched `origin/main`. Implementation is isolated on `codex/game-assets` at base `a80dc90a`; the original dirty checkout is preserved. Local validation uses disposable fixtures and existing Docker MinIO/Postgres. No deployed accounts, uploads, or release have been changed.

## Seams verified during planning

Verified against the checkout during planning; re-read these seams before implementation:

- `packages/api/src/db/schema.ts`: `visual_artifacts` stores game-owned image bytes; `visual_game_assets` freezes gameplay cast/background references. `game_episode_presentations` owns editorial title, description, cover, and frame order.
- `packages/api/src/routes/episodes.ts`: cover edits accept published preview scenes or the game's ready trailer poster. Private episode previews already distinguish public games from creator/seat/admin access.
- `packages/api/src/services/episode-presentation.ts`: the preview selects saved lobby images and cast frames. Adding an external image must not fabricate a scene or canonical event.
- `packages/api/src/db/rbac-seed.ts` and `db/rbac.ts`: wallet-backed role resolution; sysop receives seeded permissions. At planning time the producer role had no seeded permissions; this implementation adds asset management to it.
- `packages/api/src/services/mcp-oauth.ts`: opaque revocable access tokens, authorization code plus PKCE, a one-hour access-token TTL, and rotating refresh families. Current grants are resource-bound to `/mcp`, audience `game-mcp`, purpose `mcp_access`.
- `packages/engine/src/game-mcp/oauth-login.ts`, `oauth.ts`, and `oauth-token-store.ts`: loopback browser login and restrictive token-file permissions. The local login helper currently requests `producer` explicitly.
- `packages/api/src/services/private-trace-storage.ts`: existing S3-compatible private-content configuration under `LINODE_PRIVATE_CONTENT_*`, with path-style requests. `bun run s3:bootstrap` runs `scripts/bootstrap-private-content-s3.sh`, which provides local MinIO and writes `.env.private-trace.local`. Public poster/avatar upload helpers are a different storage contract.
- `packages/web/src/app/games/[slug]/results/page.tsx`: the results route renders a heading and the shared `GameViewer` in results mode. Mount the banner in this route, not in the shared viewer or episode landing. `lib/api.ts` adds the browser session bearer token to API requests.

## Approaches considered

| Approach | Benefit | Reason to accept or reject |
|---|---|---|
| Add an arbitrary promotion URL to the game | Very little schema work | Reject: remote lifetime, byte ownership, and provenance are outside platform control; does not provide image CRUD. |
| Insert promotion images into gameplay visuals | Existing image storage | Reject: scenes have canonical boundaries, participant verification, and replay meaning. Promotion images have none of those responsibilities. |
| Add editorial game assets with private stored bytes | Separate labels, provenance, and lifecycle | Choose: small dedicated service, reusable storage/auth libraries, and lazy placements. |

For transport, choose bounded multipart uploads through the API for V1. The API validates and normalizes the image, writes it to private Linode storage, and publishes metadata. A 10 MiB input limit keeps this practical and makes the CLI one upload request. Direct-to-storage signed upload sessions are a later option if measured request-size or throughput needs justify them; V1 does not build a render worker or a generic upload-session platform.

## Decisions carried into the plan

1. **Dedicated asset model.** `game_assets` belongs to a game and contains metadata and an immutable storage reference. Image production happens elsewhere.
2. **Existing producer role.** Following the user's revised choice, seed `manage_game_assets` onto the existing `producer` role; sysop also receives it. No new asset role is needed. Admin status alone does not grant writes.
3. **Existing login, narrow grant.** Add opt-in OAuth scope `assets:manage`, gated by current `manage_game_assets`. Reuse the PKCE issuer and token store. Only the new asset endpoints accept this scope-bearing opaque token; ordinary app endpoints keep their session contract. Document this deliberate extension of the existing OAuth service resource, rather than silently accepting arbitrary MCP grants as app sessions.
4. **Private storage for all assets.** Use the same S3 adapter and `LINODE_PRIVATE_CONTENT_*` configuration for local MinIO and deployed Linode, a dedicated `game-assets/` prefix, and API-authorized content reads. Reuse the existing local bootstrap; no filesystem adapter or public bucket fallback. A `public` metadata value never changes an object to public-read storage.
5. **Spoiler classification.** `visibility` accepts `public` or `spoiler`, defaulting CLI uploads to spoiler. These values describe content and never control access. No winner detector, reveal approval, or game-phase gate.
6. **Read access follows the game.** Public-game asset metadata and pixels are readable while logged out, independent of management roles and presentation classification. All game viewers get the same asset DTOs. Producer/sysop authority applies to writes and operation recovery.
7. **Existing game access stays intact.** Private games retain their creator/seat/admin audience; hidden games remain unavailable through ordinary reads. Asset presentation metadata cannot change game access. Invalid supplied credentials still fail explicitly.
8. **Label convention starts with `banner`.** Allow bounded slug-like labels, with one live banner per game. Only `/games/[slug]/results` renders it, regardless of `public`/`spoiler`. Other labels remain CRUD-able but have no V1 placement.
9. **Lazy discovery.** Fetch banner metadata separately when entering the results route, on auth changes, and on window focus. An old game can receive its first asset later without replay changes, a backfill migration, or image generation on read.
10. **Safe replacement and deletion.** Uploading new pixels cannot damage a current image. Use immutable new object keys and revision checks. Deletion immediately removes read access and explicitly records whether object cleanup has completed.
11. **Environment-bound CLI credentials.** Store grants separately per API origin; reject cross-origin token-file use and redirects on authenticated API calls. No default printing of tokens or signing secrets on the client.
12. **Validation environments.** Following the user's choice, exercise real storage locally against MinIO, then test real OAuth, CRUD, private storage, and results-banner behavior on an ephemeral deployment or staging. Keep external writes in explicit smoke runs with disposable test assets; ordinary required tests use isolated doubles and no deployed credentials.

## First usable slice

A sysop logs in with the CLI against a selected API/web pair, uploads an image to an existing game with `label=banner` and `visibility=spoiler`, and sees it exclusively on `/games/[slug]/results`, including while logged out on a public game. The same path works for an old game with no assets. List, inspect, metadata update, image replacement, download, and delete complete the CRUD surface.

## Scope boundaries

V1 does not add videos, asset generation, a rich browser asset manager, automatic promotional posting, scheduled backfills, per-image arbitrary ACL lists, public cover/OG overrides, or bulk asset import. It preserves gameplay visuals and canonical replay. Public cover/share conventions can be added later using the same presentation labels.

## Iteration and handoff

- Discovery resolved the storage split: the existing Linode/MinIO bucket provides API-owned bytes and shares infrastructure with private traces; image read access is determined by the game.
- Design resolved the auth split: a new scope plus a fresh permission gate on a narrow endpoint family, without globally modifying `requireAuth` or using the loopback-only session exchange in production.
- The user subsequently selected the existing producer role. Grant its asset-management permission to producer and sysop while keeping explicit asset-token consent; remove the proposed separate writer role from implementation.
- The user subsequently restricted banner placement to `/games/[slug]/results`. The banner must not mount on the game landing, replay, highlights, or shared viewer; this is a placement convention, not an asset read restriction.
- The user selected existing local MinIO for development and an ephemeral deployment or staging for testing. Remove the proposed local filesystem backend and include non-production deployment proof in the implementation acceptance tasks.
- The plan must address multipart size bounds, upload/DB failure recovery, optimistic revisions, cleanup versus in-flight publication, fresh reads after deletion/replacement or game-access changes, browser logout/route races, and concurrent migration numbering.
- The user rejected the inferred asset privacy requirement and then selected `spoiler` in place of the `private` label. Retain the classification as presentation metadata only, with no role-based read filters or signed-in requirement on public games.

Implementation and local evidence: [implementation plan](../plans/2026-09-25-003-feat-game-assets-plan.md) and [ordered tasks](../plans/2026-09-25-003-feat-game-assets-tasks.md).
