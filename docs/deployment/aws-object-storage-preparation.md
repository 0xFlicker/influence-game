# AWS object storage compatibility preparation

Tracking: [#281](https://github.com/0xFlicker/influence-game/issues/281). This is an opt-in application compatibility change, prepared locally on current main `0664b151`. It does not migrate existing objects, update deployment configuration or authorize activation. Leave `HOUSE_OBJECT_STORAGE_PROVIDER` unset until all data and reference gates in the `falsefloor/infra` storage runbook are satisfied.

## Configuration and routing

Existing `LINODE_OBJ_*` / `LINODE_PRIVATE_CONTENT_*` configuration remains the default, including local MinIO. Explicit `HOUSE_OBJECT_STORAGE_PROVIDER=aws` selects AWS S3; partial or invalid AWS configuration disables public storage instead of falling back to local storage.

| Variable | Purpose |
|---|---|
| `HOUSE_OBJECT_STORAGE_PROVIDER` | `aws` activates the new adapter; unset/`linode` preserves the existing adapter. |
| `HOUSE_OBJECT_STORAGE_REGION` | Explicit signing region, proposed `us-west-1`; endpoint is constructed from the region. |
| `HOUSE_PUBLIC_BUCKET` | Published avatars, character art and postgame media. |
| `HOUSE_DATA_BUCKET` | Durable payloads, private game images and Studio recordings/render artifacts. |
| `HOUSE_EVIDENCE_BUCKET` | Provider attempts, private traces and owner-learning failure evidence. |
| `HOUSE_PUBLIC_BASE_URL` | Exact HTTPS origin, proposed `https://assets.thehouse.game` or staging alias. |
| `HOUSE_OBJECT_STORAGE_ACCESS_KEY`, `HOUSE_OBJECT_STORAGE_SECRET_KEY` | Optional paired explicit credentials. With neither set, use the AWS SDK renewable default credential chain. |
| `HOUSE_OBJECT_STORAGE_SESSION_TOKEN` | Optional session token with the explicit pair. Partial credentials are rejected. |
| `HOUSE_LEGACY_PRIVATE_BUCKET` | One exact former private bucket in this environment, accepted as a historical read alias only for `content/` evidence. |
| `HOUSE_LEGACY_PUBLIC_BASE_URLS` | Comma-separated exact old public URL bases, including explicitly needed virtual-host and path-style forms. No wildcard hosts. |
| `NEXT_PUBLIC_HOUSE_OBJECT_STORAGE_PROVIDER` | Nonsecret web build and render-worker setting; `aws` enables public media delivery aliases. |
| `NEXT_PUBLIC_HOUSE_PUBLIC_BASE_URL` | Same exact public origin as the API's `HOUSE_PUBLIC_BASE_URL`. |
| `NEXT_PUBLIC_HOUSE_LEGACY_PUBLIC_BASE_URLS` | Same exact source bases as the API, available to web builds and media workers. |

All three AWS bucket names must be distinct. AWS uploads omit ACLs and use S3 BucketOwnerEnforced semantics; public delivery is through the configured CloudFront origin. Presigned grants preserve checksum, content length and conditional-write requirements. Studio reads/writes use the data bucket. The legacy/local bucket bootstrap refuses AWS mode because AWS resources/CORS are owned by `falsefloor/infra`.

The three `NEXT_PUBLIC_*` values contain only public routing information. Next compiles them into browser bundles; changing runtime environment alone does not change an existing bundle. The release controller must pin matching API, web-build and worker values with the accepted image family. Never put storage credentials in these variables or render workers. Deployment wiring is not part of this preparation.

Example source aliases for staging are `influence-transcript-events-stg` and `https://influence-assets-stg.us-iad-10.linodeobjects.com,https://us-iad-10.linodeobjects.com/influence-assets-stg`. Production uses its own `-prd` aliases. These are mappings to already-verified destination objects, not instructions to read from Linode after cutover. Do not configure another environment's aliases.

## Historical references

New evidence manifests use provider `aws_s3` and the configured evidence bucket. Historical `linode_object_storage` rows remain recognizable. The actual S3 read adapter resolves only the current bucket or the exact configured legacy bucket, preserving object key, canonical row identity, stored byte lengths and hashes. This avoids rewriting accepted evidence simply to change location. Keep the alias configuration for as long as those historical locators exist; removing Linode credentials/endpoints does not mean deleting historical alias information.

Relational provider/bucket/key fields found in current `schema.ts` are `game_evidence_manifests` and `agent_learning_review_failure_manifests`. Key-only fields also occur in game-asset operations and render-upload targets. Payload references contain content-addressed keys and stored/decoded hashes; they route through the data bucket. A fresh complete inventory must still inspect current schema, copied episode evidence, private source-pointer documents, retained backups and all operational tools before activation.

Public URL helpers recognize exact configured legacy and new bases, encode AWS delivery keys and reject unrelated hosts, credential-bearing URLs and traversal keys. Existing visual source reads resolve application-owned old URLs through the new delivery base. Agent-input normalization, owned-agent summaries and published postgame-media playback responses use the alias. Database-backed tests prove the stored profile and media artifact metadata remain unchanged. External URLs are preserved. Ordinary query parameters and media fragments are preserved; provider signing parameters are removed. Source `versionId`/`partNumber` URLs fail explicitly until a retained-version mapping exists. These changes **do not automatically rewrite every read model or existing public JSON document**.

Frozen playback compatibility now derives public delivery props in the shared Influence/format/Werewolf presentation frames and openings, including neighboring Werewolf dissolve images, AgentAvatar, Remotion saved-source rendering and House Highlights visual/poster callbacks. Original source documents, URL-indexed asset maps, text, settings and hashes remain unchanged. Replay preparation resolves aliases at fetch/redirect boundaries before deciding API authentication, hashes and stores the actual fetched bytes, and retains canonical input identity. Existing prepared local asset paths remain local. No API bearer token follows an asset redirect to CloudFront.

Remaining public-reference work is explicit:

- Finish coverage of other public URL response fields, including frozen game-player output in `routes/games.ts`, owner-content/submission replay, and profile revision snapshots. `agent-content-submissions.ts` keys immutable asset evidence by original URL: preserve these keys and their hashes rather than rewriting them during migration.
- Complete end-to-end historical viewer/Studio/export acceptance with actual saved selections and frozen bundles. Shared render/fetch boundaries now have synthetic coverage, but OpenGraph/social metadata, other response fields and already-exported documents still need a complete reference census. Publish a new versioned delivery document and update its current pointer when a stored public JSON body embeds old URLs; keep the original and accepted digest.
- Verify encoded keys, source-byte hashes and image/caption/video equivalence across viewer, Studio and fresh export. No historical media regeneration is authorized by this change.
- Provider-owned Linode URLs already shared externally cannot be redirected after bucket deletion. Their retirement must be explicitly resolved in the execution review.

Start the frozen-consumer audit at `packages/web/src/lib/replay-export/{source,production-source,prepare,prepare-selection,assets,worker-media-fetch}.ts`, `house-highlights-trailer-media-bundle.ts`, and the API's `production-render-order.ts`, `render-job-dispatch.ts`, `render-jobs.ts` and `werewolf-trailer-snapshot.ts`. A delivery alias must be resolved at fetch/output boundaries without altering a pinned source manifest or its identity. Retain the original source digest and verify the fetched bytes against its asset digest; do not silently rehash a rewritten historical snapshot. Offline bundles already held by users need an explicit compatibility policy.

Do not enable AWS mode until the entire environment is copied/verified and the remaining reference work passes. A new-writes-only cutover is incomplete. Existing local development data remains in its current MinIO/filesystem stores and must remain readable; it is not implicitly uploaded to AWS.

## Tests and execution boundary

`aws-storage-compatibility.test.ts` exercises actual signing and adapter routing with synthetic credentials: region/session handling, no public ACLs, bucket separation, exact historical aliases, private-evidence read mapping, and Studio grants. Database-backed cases write an AWS evidence manifest, read a simulated copied historical locator with the actual S3 adapter, preserve hashes/records and reject an unauthorized reader. Public read-model tests retain stored originals; visual-fetch tests cover AWS and legacy resolution.

Validation on 2026-11-03:

- `bun run test`: 3,312 passed, 5 skipped, 0 failed after the frozen playback changes. The successful run had local loopback access. Subsequent URL-query/version handling and neighboring-cue changes were checked with the focused regressions below.
- `bun run check`: all workspace type checks and lint passed.
- `bun run test:postgres`: 2,342 passed, 1 failed in 215 files before the final read-model additions. The unchanged `staging-render-proof.test.ts` setup rejects any disposable database port other than 54320, so its suite could not initialize on 19432. Its source guard is unchanged from main. This is **not** a fully green API baseline.
- Final focused storage/read-model regression: 57 passed, 0 failed in five files, with the repository's 30-second timeout, including the 11 AWS compatibility cases. An initial focused invocation used Bun's default 5-second timeout and an incomplete synthetic publication fixture; both were corrected before the passing run.
- Final playback/delivery regression: 29 passed, 0 failed in five files, including eight delivery tests and the existing Werewolf dissolve and viewer/export tests. Synthetic fixture assertions verify frozen source JSON stays unchanged, fetched PNG bytes/hash remain exact, both current/outgoing images resolve, and redirects do not leak API credentials. The House Highlights bundle-adapter regression also passed in the full provider-free suite.
- Final API URL query/version regression: 1 passed, 10 filtered out; no database used. Final workspace type checks/lint passed after these changes.

Every database test used a separately created disposable PostgreSQL service on `127.0.0.1:19432`; both `TEST_DATABASE_URL` and `DATABASE_URL` pointed there. The service had a temporary memory-backed volume and no shared development data. No test used the shared service on 54320. Do not weaken the existing staging-proof safety guard to bypass its fixed-port restriction; solve that test's isolated service configuration independently.

Deployment configuration is still pending: the existing `linode-iac/scripts/storage-cutover-config.ts` has Linode-specific guards for an earlier payload migration. A provider-switch controller must explicitly export the new variables to gateway/game-worker services and public delivery build/worker configuration, keep storage credentials out of render workers, fence every writer, retain exact image/config identities, and rehearse rollback. The infra companion `docs/storage-cutover-controller-design.md` specifies reuse of existing restart/maintenance/drain barriers, all nine writer groups, outstanding upload grants and remote Batch jobs. Its tested offline receipt model requires a new fence and accepted-write reconciliation before rollback after AWS writes open. It does not control real hosts. Neither this branch nor the old controller authorizes deployment or full-environment cutover.

Infrastructure, copy/verification tooling, stopped-writer sequencing, cost review, rollback and retirement belong to the versioned `falsefloor/infra/docs/aws-storage-migration.md` runbook. No live resource, object, credential, DNS or application configuration mutation occurred during this preparation.
