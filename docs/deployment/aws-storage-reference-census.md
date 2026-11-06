# Historical storage references — preparation census

Revision 3, 2026-11-03. [Issue #281](https://github.com/0xFlicker/influence-game/issues/281). This is a code-path census and synthetic validation record, not a census of live user records.

| Boundary | Prepared behavior / remaining work |
| --- | --- |
| `public-media-delivery.ts`, runtime config and context | Exact configured aliases only. Per-request browser delivery map and runtime worker settings; no build-time environment binding. Preserve normal query/fragment semantics, remove source signing fields, reject source version/part URLs pending explicit mapping. |
| Shared Influence/format/Werewolf frames and openings, Remotion | Derive presentation props while retaining canonical input, timing and hashes. Neighbor images participate in Werewolf dissolves. Synthetic source/hash and actual renderer assertions pass. Actual historical viewer/Studio/encoded-export acceptance is pending. |
| Cast selector, waiting-room cards/dialogs, AgentAvatar, embed layout | Use the same runtime delivery context. Site and embed rendering receive server-selected public config; no module-wide mutable delivery state. |
| Replay `assets.ts` and House Highlights bundle callbacks | Resolve at fetch/render boundaries, before API credential attachment. Fresh fixture preparation preserves actual PNG bytes/hash; prepared bundle paths stay local. Worker runtime must receive the same three public variables. |
| `agent-content-submissions.ts` | Asset evidence is keyed by original URL and revision fingerprint. Saved submission replay and revision bodies stay canonical; `readVisualProfileImage` already resolves approved storage location when bytes must be fetched. Do not replace stored map keys, fingerprints or idempotency results. Raw editor/crop and every owner-review image boundary still require historical browser acceptance. |
| `routes/games.ts`, raw revision/owner responses | Some raw URL fields deliberately remain canonical. Current shared presentation consumes them through the delivery map. Non-web API consumers and downloaded raw documents need an explicit compatibility inventory before retirement. |
| `server-share-metadata.ts`, House Cuts card-image route | Inspected current House Cuts metadata points to the application card-image route; that renderer reads bundled local backdrops. Profile social metadata adds no agent-image URL. This does not account for externally cached cards or previously shared provider URLs. |
| Published House Highlights playback JSON | Existing objects can embed old video/poster/caption URLs even when their object URL is mapped. The local tool below prepares a new delivery document with a new key/digest and retained original/media hashes. No upload or DB pointer update is implemented by that tool. |
| External provider URLs / old offline bundles | Provider-owned hosts cannot redirect after deletion. Locate owned pointers and republish, or explicitly accept individual retirement scope. Preserve old self-contained bundles and their identity. |

## Prepare a derived public playback document locally

`scripts/prepare-public-playback-delivery.ts` accepts only the current `influence.house-highlights.playback` version 1 schema. It rejects unknown fields/schemas, unrelated artifact origins, source version/part URLs, malformed media hashes and changed input digests. It changes only `videoUrl`, `posterUrl` and `captionsUrl`; accepted media hashes, dimensions, duration, render version and text remain exact. No media regeneration is involved.

```sh
bun scripts/prepare-public-playback-delivery.ts \
  --source /private/operator/original.json --source-sha256 <reviewed-original-sha256> \
  --config /private/operator/public-delivery.json --config-sha256 <reviewed-config-sha256> \
  --output /private/operator/new-preparation-directory
```

The configuration is `{ "version": 1, "publicBaseUrl": "https://assets-staging.thehouse.game", "legacyBases": ["https://influence-assets-stg.us-iad-10.linodeobjects.com", "https://us-iad-10.linodeobjects.com/influence-assets-stg"] }`; production uses its own exact origins. Output is an exclusive private directory containing `delivery.json` and `receipt.json`. The proposed key is under `postgame-media/delivery-v1/<original-sha>/<derived-sha>.json`. An existing output directory is never overwritten. Source/destination document hashes are distinct from the preserved media hashes.

The execution packet must separately bind this receipt to the original bucket/key/version, owning database row, accepted render version and expected current artifact metadata. Upload/readback verification must precede a compare-and-swap pointer update. If publication advanced concurrently, stop and replan. Retain the original pointer and document for rollback; after writers reopen, reconcile any accepted new publication before reverting. This tool does not make a live reference set complete and does not authorize changing a pointer.

## Publication pointer reconciliation preparation

`scripts/public-playback-pointer.ts` now prepares forward and rollback PostgreSQL transactions for the exact `game_postgame_media` row. This is a library with no connection, upload or execution entrypoint. Supply the complete `SELECT to_jsonb(row)` snapshot, original source bytes/hash, exact environment delivery map, derived-document readback bytes, and the four current target-manifest records (video, poster, captions and derived JSON). The reviewed execution packet must pin the complete source/target manifests and this subset's provenance; manually invented hashes are not verification.

The planner checks source metadata, media hashes/lengths/types, object keys, preview/duration/dimensions and retained private S3 versions. It preserves source documents, media hashes, publication time, accepted render identity and unrelated row fields. It updates public delivery locations plus the new document key/hash/length. `artifact_metadata` changes only when it is the same artifact as `current_ready_artifact_metadata`; a newer in-progress attempt is retained independently.

Both SQL directions lock the game before the media row, matching publication's lock order, and compare the complete row. Exact retry is a no-op; any changed attempt, publication, metadata or schema requires replanning. Metadata is encoded as hex JSON literals, preventing prose from becoming SQL. Keep the plan/SQL private because the full row may contain operational metadata. The rollback SQL is only a guarded pointer inverse; it does not authorize rollback after writers reopen or replace whole-application reconciliation.

The explicit synthetic rehearsal is:

```sh
bun scripts/rehearse-public-playback-pointer.ts --run-disposable-postgres
```

It creates its own memory-backed PostgreSQL 17 container with no host port, network or mounted user data, and removes only that container afterward. The actual SQL passes forward application, exact retry, pre-write inverse, stale-publication rejection, later-accepted-write preservation and schema-drift rejection. This exercises the relevant synthetic table shape, not live database privileges or all application constraints. Three provider-free tests cover preparation and corruption/environment drift. Live source coverage, object upload/readback, final manifests, controller execution and browser/Studio/export acceptance remain outstanding.


## Read-only historical document audit

The file-only `scripts/audit-storage-reference-file.ts` now audits supplied JSON plus locally retained `private-payload-v1` objects. It checks both stored and decoded SHA-256/lengths before traversing JSON/text bodies, handles repeated references without changing source identity, and reports missing/corrupt/conflicting references. It recognizes public aliases, explicit source versions, unfamiliar provider hosts, canonical URL map keys, embedded/encoded provider references, legacy S3 URIs and provider/bucket identifiers. Other object keys are marked for their own object census; it does not pretend every locator is a payload reference.

```sh
bun scripts/audit-storage-reference-file.ts \
  --input /private/operator/export.json --input-sha256 <file-sha256> \
  --delivery /private/operator/delivery.json --delivery-sha256 <file-sha256> \
  --payload-directory /private/operator/retained-payloads \
  --output /private/operator/new-reference-audit.json
```

Payload files live beneath the local directory using their exact `payloads/v1/<codec>/<sha256>` key. The tool never downloads them. Paths resolving outside that directory are rejected. Inputs are rechecked before writing a new private 0600 report; an existing report is never replaced. Terminal output contains only aggregate categories/counts. Reports contain private JSON paths and must remain private.

`payloadBodiesComplete` describes only recognized payload references in the supplied documents. It does not cover omitted database rows, separate public JSON/evidence/export documents, externally held URLs or every historical consumer. `retirementReady` is always false. The operator still needs a complete versioned export/census and the actual viewer/Studio/export acceptance matrix. Supported aliases do not authorize rewriting canonical map keys or prose.

Synthetic coverage includes frozen URL-indexed asset maps, nested owner revisions, copied-episode locator metadata, raw API URLs, encoded/S3 references, version-pinned links, missing/corrupt bodies and conflicting stored metadata. The test compares the original document byte representation before/after and exercises the actual private-output CLI. No live historical records or bodies were read.
