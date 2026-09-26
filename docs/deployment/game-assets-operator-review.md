# Game assets operator review

The implementation adds producer/sysop image CRUD through scoped OAuth, private S3 storage, a Bun CLI and skill, and results-only banners. The work started from fetched `origin/main` (`a80dc90a`) in `codex/game-assets` and is integrated into PR #153 (`codex/completed-replay-image-backfill`) with completed replay image production. Migration `0100_game_assets` adds asset/operation tables and expands OAuth scope constraints. Startup RBAC seeding grants `manage_game_assets` to existing producer/sysop roles without assigning new real accounts.

## Local validation at review

The final local checks cover `public`/`spoiler` presentation metadata and management-only roles.

| Check | Result |
|---|---|
| Provider-free baseline after PR #153 integration | 2,028 passed, 5 skipped, 0 failed |
| Full PostgreSQL baseline after PR #153 integration | 1,758 passed, 0 failed; 20,092 assertions |
| Typecheck and lint | All workspaces passed |
| Focused API regressions | 13 passed, 97 assertions |
| Focused CLI/banner tests | 13 passed, 58 assertions |
| Real local MinIO and opaque OAuth CLI CRUD | 1 passed, 16 assertions; disposable objects removed |
| API/Next/Chrome results journey | 1 passed, 13 assertions; screenshot visually inspected |
| Full API browser lane after PR #153 integration | 26 passed across 9 files; 201 assertions |
| Public identity browser lane after PR #153 integration | 13 passed, including desktop/mobile character creation |
| Migration release policy | `0100_game_assets.sql` accepted |
| Repository skill validation | Valid; upload/update/list help verified |

The MinIO CLI upload defaults to `spoiler`, and anonymous API reads return its exact normalized bytes while direct bucket access stays restricted. Browser evidence covers late anonymous discovery, public results after sign-out, existing private-game access, and no banner requests on landing/replay/highlights/library. API tests prove changing presentation classification preserves reads, role removal blocks edits only, revisions fence concurrent writers, and cleanup cannot publish or lose a late candidate. The combined browser lane also covers Producer/Sysop replay production, lost-request recovery, and publication. Its temporary output paths are portable, and standing-agent teardown has an explicit bound long enough for the server cleanup contract.

Temporary task-owned API/web/browser/callback processes are stopped; existing Docker Postgres/MinIO and unrelated work are preserved. Harness-generated web configuration changes were removed. This is local evidence: deployed OAuth, Linode, and ingress remain T9.

Read-only Grok attempts on the earlier scoped implementation returned no finding report. Independent review remains pending; no clean external review is claimed. Committing and updating PR #153 are user-authorized. No deployment or real account assignment has occurred.

## Review before deployment

Review the scoped branch diff and local validation report in the task document. Verify the target's private-content endpoint, bucket, and scoped key; use the existing MinIO settings locally and Linode on deployed servers. Existing private traces share this service using a separate prefix. Confirm the release includes API and web changes together and that its ingress supports the 12 MiB upload contract.

Asset `visibility` is a `public` or `spoiler` presentation label, with no asset privacy filter. Public-game assets are readable anonymously; roles govern uploads and modifications. Existing private/hidden game access still applies. The single banner appears only on `/games/[slug]/results` and may reveal winners or other results. The bucket stays restricted to protect shared trace objects; that infrastructure choice is separate from image read access.

## Ephemeral or staging acceptance

Use a runnable ephemeral deployment or staging, exact API/web origins, a dedicated test identity, and a disposable game. Keep its CLI token separate from local credentials. Complete browser login as a producer and as a sysop with explicit `assets:manage`; sysop must work without an additional producer role.

1. Upload a spoiler banner, list/show it, and download the normalized PNG with the CLI. Check dimensions and downloaded bytes.
2. Confirm anonymous direct object access fails, anonymous public-game API metadata/bytes succeed for both classifications, and viewers see the banner only on results. Test a private game's existing audience too.
3. Attach a banner after first opening old results; focus the browser and verify discovery. Sign out on public results and verify the banner reloads anonymously. Navigate to the same game's landing/replay/highlights; verify pixels and banner requests do not persist.
4. Update metadata, replace pixels with an explicit revision/request ID, and retry identical requests. Confirm stale revisions and conflicting request IDs fail without overwriting newer work.
5. Delete the image, inspect its receipt, and finish any pending cleanup. Confirm no live or unrelated object was deleted.
6. Revoke the test token and temporarily remove the dedicated test identity's management permission; verify management token use and refresh fail while anonymous public-game images remain readable. Restore only deliberate test changes.
7. Check one request at the documented file/body bound through deployed ingress. Record environment/release, operation IDs, browser evidence, and cleanup outcomes without tokens or secrets.

Stop all temporary API/web/browser/callback processes after verification. Preserve the existing Docker Postgres and MinIO services and shared private-content objects. Production deployment and production testing are outside this acceptance target.

## Approval boundary

Local implementation and validation are prepared for operator review. An ephemeral/staging run requires a runnable release of this branch and the selected target/test identity. Record its result as deployed proof only after that run succeeds; local MinIO and deterministic browser results are separate evidence.
