# Persistent localhost storage

Local development uses the existing MinIO Docker data volume and a shared private configuration at `~/.local/share/thehouse/storage/config.json` (0600), outside all worktrees. `HOUSE_LOCAL_STORAGE_CONFIG` selects another absolute config path. It contains existing local credentials: never commit or print it.

When `HOUSE_LOCAL_STORAGE_CONFIG` explicitly selects a missing file, the private-content bootstrap exits before starting a container or writing the legacy environment file. Correct the path or remove the override before using the intended local configuration.

On this Mac the adopted service is `influence-private-evidence-s3`, endpoint `http://127.0.0.1:19000`. Its existing `/data` volume is recorded in the private config. `house-public-local` holds local public media; the original `influence-private-content-local` retains private payloads, evidence, game assets and recordings. Both buckets remain private. No credentials were created or rotated, no anonymous bucket policy was installed, and no existing container was recreated or restarted during adoption.

## Startup from any worktree containing this change

```sh
bun run s3:bootstrap
bun run storage:local status
bun run dev:gateway
# Another terminal, using the same shared config:
bun run dev:game-worker
bun run dev:web
```

The API service command loads shared storage **after** Doppler dev settings, for both gateway and game-worker. Without a shared config it preserves existing startup behavior. An explicitly selected missing/invalid config fails. Production or a non-dev Doppler config cannot use this wrapper. Trace MCP also loads the shared configuration. No file needs copying between worktrees.

The bootstrap starts only the recorded container if stopped, checking its exact image and data-volume identity. If that container was removed, it stops for a reviewed recreation using the recorded retained volume; it never silently initializes a replacement empty store. Do not run Docker volume pruning against this volume. The current container's pre-existing published ports were preserved; adoption does not change host networking or security settings.

MinIO public media uses the existing `/api/uploads/local?key=...` application route, preserving old local profile/replay URLs. Browser uploads use scoped signed PUTs; public reads use the app's public bucket only. The private-content bucket is never reachable through that route. Shared local mode requires loopback endpoints and distinct public/private buckets. Local development continues using the existing S3-compatible adapter and its historical provider labels; it does not activate AWS.

`HOUSE_LOCAL_API_ORIGIN` is derived from the shared config (`http://127.0.0.1:3000` on this Mac). Existing stored localhost URLs retain their original port; keep the public gateway on that port when reading them. API responses preserve byte hashes, MIME types and range/HEAD behavior.

## Adopt or import existing data

Inspect the current service and source directories first. Adoption reuses an existing running MinIO with a Docker `/data` volume and matching private-content configuration; it does not install software or invent credentials:

```sh
bun run storage:local adopt --container EXACT_EXISTING_CONTAINER \
  --legacy-env /absolute/path/to/existing/.env.private-trace.local
bun run storage:local inventory --source /absolute/path/to/.local-uploads
bun run storage:local import --source /absolute/path/to/.local-uploads \
  --receipt /private/path/new-import-receipt.json
bun run storage:local verify --source /absolute/path/to/.local-uploads \
  --receipt /private/path/new-verification-receipt.json
```

Repeat `--source` for multiple roots. Inventory rejects conflicting keys, symlinks and mismatched hash sidecars. Identical objects deduplicate. Import uses conditional create, verifies full bytes/length/content type, and refuses to overwrite differing destination objects. It preserves every source file and DB pointer; receipts contain private file/key information and are written 0600. Re-running import is safe. Run the final incremental import after old filesystem writers stop, before starting the new local gateway/worker. An optional explicitly configured shared `INFLUENCE_LOCAL_UPLOAD_DIR` remains a read fallback during transition.

On 2026-11-05, 603 unique objects / 274,677,756 bytes from the main, championship and registered local worktree upload directories were copied and verified. The existing private bucket was retained. Running gateway/worker processes were not restarted: they continue with their loaded configuration until a coordinated local restart. Therefore run the final delta import before switching them; this preparation does not claim those already-running processes have changed provider.

The reconnection check reverified all 603 source objects against MinIO with zero copies needed. The active services run from the championship worktree, which does not contain this startup/read-route change, and the local database still has two games marked in progress. No processes were restarted or checkout files changed. Before the coordinated switch, integrate this change into the checkout owning those services, establish that its game/worker activity can safely pause, then stop the old filesystem writers, repeat the delta import and start both roles through the shared wrapper. A stale game status or an empty owner query alone is not proof that a running service is safe to replace.

## Coordinated switch

The prepared local integration candidate must be reviewed against the current championship checkout and tested before use. Before selecting a window, identify the actual gateway, game-worker and web processes and their owning revisions; inventory all filesystem upload roots and any other processes that can write them. Check durable game owners, planned turns, queued work and active uploads using read-only aggregate diagnostics. A game status or empty owner list alone does not prove the worker is idle. Do not stop a current game without its required explicit approval.

Before selecting a window, establish how local admission, outstanding direct upload grants and independent writers will be fenced; availability of an appropriate local admission control is not yet verified. Once work is safely quiescent, prevent new claims/uploads and stop only the identified old writers. Verify they have stopped, perform an exclusive-receipt final import and full byte/MIME verification for every inventoried root, and keep all original files. Start the reviewed gateway and worker through the shared-config wrapper; verify historical profile and game media, signed uploads, private-content access and cross-worktree reads before releasing admission. Ensure old worktrees or independent tools cannot continue writing to their private filesystem roots unnoticed. The previous filesystem fallback is read-only compatibility, not dual-write.

Before switching back after MinIO has accepted writes, fence local writers again and inventory/reconcile all MinIO-only accepted objects and references into a verified, non-overwriting recovery location. The current importer does not provide a complete MinIO-to-filesystem exporter or database-reference reconciliation; implement and rehearse those before relying on rollback. Preserve both stores and all receipts. Do not restart or remove a shared container to accomplish the switch.

## Verification and rollback

The explicit `local-storage.external-smoke.test.ts` writes uniquely named synthetic probes, confirms anonymous bucket access is denied, and starts fresh read-route processes in two supplied worktree directories. It verifies exact bytes, old local media URLs, HEAD and range reads. It uses no application database, provider, cloud account or live game controls. The importer regression also proves collision rejection, no-overwrite resume and source preservation.

Before rollback after any new MinIO writes, preserve and reconcile those writes back to the old filesystem layout and verify their sidecars. Disabling the shared config alone would hide new assets. Do not delete the MinIO volume, source directories or import receipts. Old worktrees without this change retain their old behavior; use a worktree containing this branch for the coordinated switch.
