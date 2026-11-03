# Historical storage references — preparation census

Revision 1, 2026-11-03. [Issue #281](https://github.com/0xFlicker/influence-game/issues/281). This is a code-path census and synthetic validation record, not a census of live user records.

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
