# Editorial game images

Game assets attach externally produced PNG, JPEG, or WebP images to existing games, including old completed games. They do not create scenes, events, model context, or gameplay decisions. The `banner` convention renders only inside `/games/[slug]/results`, below its heading and above the viewer. It discovers later uploads on page entry, authentication changes, and window focus. Other labels remain available through CRUD without a browser placement.

## Management authority and spoiler labels

Producer and sysop receive `manage_game_assets` through RBAC seeding. Admin alone does not receive asset writes. Upload, update, replacement, deletion, capabilities, and operation recovery require current database permission; external clients also require explicit OAuth scope `assets:manage`. Existing producer trace scope does not authorize asset management, and an asset-only token does not grant producer trace access.

Asset `visibility` is presentation metadata: `public` or `spoiler`. CLI uploads default to `spoiler`; `private` is not an accepted asset value. Neither label adds an access restriction or requires sign-in. All viewers of the game receive the same live asset metadata and bytes. Public-game assets are readable anonymously. Existing private-game creator/seated-player/admin access and hidden-game rules still apply to the game itself. Management roles grant writes, not a separate asset viewing audience.

There is no spoiler detector, phase gate, or reveal approval. Revealing teasers and winner imagery are allowed. The `banner` label places one image per game only on `/games/[slug]/results`, regardless of its presentation classification. Explicit list filters select metadata; they never enforce an asset audience.

Objects use the existing restricted S3 bucket because it also contains private traces. That infrastructure setting does not make an image private: the API serves public-game images anonymously. Storage keys/direct object URLs are omitted from every asset DTO. Metadata and bytes use no-store caching so replacement, deletion, and changes to game access take effect on later requests.

## Storage and local development

The same AWS SDK adapter uses `LINODE_PRIVATE_CONTENT_ENDPOINT`, `LINODE_PRIVATE_CONTENT_ACCESS_KEY`, `LINODE_PRIVATE_CONTENT_SECRET_KEY`, and `LINODE_PRIVATE_CONTENT_BUCKET` for local MinIO and deployed Linode. Keep this bucket separate from the public profile/poster bucket. Missing settings fail clearly; there is no filesystem backend or public-storage fallback. Asset keys live under `game-assets/<game-id>/` and never reuse trace keys.

```sh
bun run s3:bootstrap
set -a
source .env.private-trace.local
set +a
```

The existing bootstrap defaults to MinIO at `http://127.0.0.1:19000`, bucket `influence-private-content-local`, and container `influence-private-content-s3`. Keep existing objects and settings. The bootstrap's container filesystem has no configured persistent host volume; recreating the container can remove local objects. The CLI needs only an API origin and its OAuth token, not these storage settings.

Inputs are limited to 10 MiB, with a 12 MiB multipart body limit and 4096 pixels per dimension. Animated/multiple-frame images, SVG, corrupt content, and MIME mismatches are rejected. Sharp normalizes a passive PNG, strips embedded metadata, applies orientation, and limits normalized output to 10 MiB.

## CLI

Run `bun run game-assets --help`, or `<command> --help`. Supply `--api ORIGIN` explicitly, or set `INFLUENCE_GAME_ASSETS_API_URL`; there is no implicit deployed target. Login requires `--web ORIGIN` and prints a browser authorization URL to stderr. Select **Manage game images** and return to the terminal. Login uses PKCE/state verification and a temporary loopback callback which stops on success, failure, timeout, or interrupt.

```sh
bun run game-assets login --api http://127.0.0.1:3000 --web http://127.0.0.1:3001
bun run game-assets whoami --api http://127.0.0.1:3000
bun run game-assets upload --api http://127.0.0.1:3000 --game GAME_SLUG --file /absolute/banner.png --label banner --visibility spoiler --alt "Cast teaser" --request-id WORKFLOW_RUN_ID
bun run game-assets list --api http://127.0.0.1:3000 --game GAME_SLUG
bun run game-assets show --api http://127.0.0.1:3000 --game GAME_SLUG --asset ASSET_ID
bun run game-assets download --api http://127.0.0.1:3000 --game GAME_SLUG --asset ASSET_ID --out /absolute/banner-copy.png
bun run game-assets replace --api http://127.0.0.1:3000 --game GAME_SLUG --asset ASSET_ID --file /absolute/banner-v2.png --revision 1 --request-id REPLACEMENT_RUN_ID
bun run game-assets update --api http://127.0.0.1:3000 --game GAME_SLUG --asset ASSET_ID --alt "New description" --revision 2 --request-id METADATA_RUN_ID
bun run game-assets delete --api http://127.0.0.1:3000 --game GAME_SLUG --asset ASSET_ID --revision 3 --request-id DELETION_RUN_ID
bun run game-assets receipt --api http://127.0.0.1:3000 --request-id DELETION_RUN_ID
bun run game-assets cleanup --api http://127.0.0.1:3000 --request-id DELETION_RUN_ID
bun run game-assets logout --api http://127.0.0.1:3000
```

`list`, `show`, and `download` are anonymous by default and need no saved token on public games. Supply `--token-file` explicitly when authenticating for an existing protected game. Management commands use the origin-bound saved token. Supplied invalid credentials fail rather than silently changing identity.

Normal command results are JSON. List accepts `--label`, `--visibility`, `--limit 1..100`, and `--cursor`; use the same filters and limit for subsequent pages; cursors are shared across game viewers. Update supports label, visibility, alt text, and source fields. Clear sources with the literal `null`; upload source flags are optional. Request IDs are required for writes and must be reused for identical retries. Revision is required for edits/replacement/deletion and must come from current metadata. Downloads require `--overwrite` to replace an existing file.

Tokens live in `~/.influence-game/game-assets/<API-origin-hash>.json`, with directory mode 0700 and file mode 0600. `--token-file` overrides the path but still enforces API/resource binding. Access lasts one hour; expiry requires login again. Authenticated requests reject redirects. Logout revokes remotely before removing the credential; explicit `--local-only` reports revocation as unconfirmed when removing a file without contacting the issuer.

A custom `--token-file` must use a private directory with mode 0700. Login refuses a broader existing directory without changing its permissions; choose a dedicated credential directory.

## HTTP and recovery

| Method | Path | Contract |
|---|---|---|
| GET | `/api/game-assets/capabilities` | Current manager authority, resource, and image limits |
| GET / POST | `/api/games/:idOrSlug/assets` | Authorized paginated list / multipart upload |
| GET / PATCH / DELETE | `/api/games/:idOrSlug/assets/:assetId` | Metadata read / closed metadata changes / tombstone |
| GET / PUT | `/api/games/:idOrSlug/assets/:assetId/content` | Authorized PNG / immutable pixel replacement |
| GET | `/api/game-asset-operations/:requestId` | Requester's durable operation receipt |
| POST | `/api/game-asset-operations/:requestId/cleanup` | No body; cleanup of unreferenced candidates/retired objects |

Upload multipart contains exactly one `file` and one JSON `metadata` field. Create metadata includes `requestId`, `label`, `visibility`, `altText`, and optional `sourceWorkflow`/`sourceRunId`. Replacement metadata contains only `requestId` and `expectedRevision`. PATCH uses flat JSON with those two fields plus at least one metadata change. DELETE uses only those two fields. Unknown fields are rejected. Labels are lowercase slugs up to 64 characters, alt text is nonblank and at most 500, and source/request fields are bounded to 200.

One live banner is permitted per game, across both presentation labels. Replacement preserves the asset ID while publishing a new immutable key and revision. PostgreSQL owns associations and receipts; bytes are published only after storage succeeds. A failed replacement retains prior pixels. Request IDs are actor-scoped and fingerprinted; different inputs or stale revisions return 409. A crash can leave a candidate object whose key is retained privately in its receipt. A duplicate pending request returns `asset_operation_pending`; a same-input retry after its 90-second claim expires can recover it.

Cleanup shares publication fences, rejects active uploads, terminalizes abandoned work before deleting candidates, and never deletes a live reference. Delete tombstones first and denies reads immediately. An applied deletion with `cleanup=pending` remains deleted; retry its explicit cleanup. If an interrupted upload completes after cancellation, it cannot publish and its receipt records pending cleanup. Inspect receipts after network failures instead of assuming a write failed or advancing a revision automatically.

## Verification

Required checks: `bun run test`, `bun run test:postgres`, and `bun run check`. API fixtures use the shared database lock; deterministic browser fixtures own a per-process database and terminate every child. Ordinary tests use isolated storage doubles, no cloud credentials, and no provider calls.

Run the explicit real-MinIO smoke separately:

```sh
set -a
source .env.private-trace.local
set +a
GAME_ASSETS_MINIO_SMOKE=1 bun test --config=bunfig.manual.toml packages/api/src/__tests__/game-assets-minio.external-smoke.test.ts
bun test --config=bunfig.browser.toml packages/api/src/e2e/game-assets.e2e.test.ts
```

The MinIO smoke restricts its endpoint to loopback and cleans only disposable test objects. A local smoke does not establish deployed OAuth, ingress limits, or Linode permissions. Complete those on an ephemeral deployment or staging using the [operator review](deployment/game-assets-operator-review.md).
