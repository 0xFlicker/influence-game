---
title: House Highlights Postgame Media Pipeline
date: 2026-07-11
category: architecture-patterns
module: House Highlights postgame media
problem_type: architecture_pattern
component: background_job
severity: high
applies_when:
  - "turning completed-game facts into durable public media without coupling game completion to rendering"
  - "running Remotion, Chromium, and ffmpeg outside the API and web request processes"
  - "publishing versioned public media through a credential-free render worker"
  - "supporting safe admin backfill and rerender while preserving the current ready version"
  - "verifying a three-service media deployment from job claim through browser playback"
tags: [house-highlights, postgame-media, remotion, render-worker, presigned-upload, public-acl, immutable-media, deployment-smoke]
related_components: [service_object, database, frontend_stimulus, authentication, testing_framework, documentation]
---

# House Highlights Postgame Media Pipeline

## Context

House Highlights trailer generation is a postgame publication pipeline, not a synchronous MP4 export. The API snapshots completed-game facts and owns durable work, leases, upload constraints, and publication state. A separate worker owns Remotion, Chromium, ffmpeg, prepared music, and temporary files. The web app owns public playback, sharing, and privileged repair controls.

This separation matters because rendering is expensive and retryable while publication must remain stable. A worker can crash, a lease can expire, music can be unavailable, or an upload can fail after some objects have landed. None of those failures should change a completed game's truth, replace a working trailer, or expose a partial bundle as ready.

The publication unit is therefore a bundle: `trailer.mp4`, `poster.png`, `captions.vtt`, and `metadata.json`. Each object has a fixed content type, size limit, immutable versioned key, checksum, and public URL (`packages/api/src/lib/public-media-storage.ts`).

## Guidance

### Preserve the ownership boundaries

**The API owns facts and publication.** It builds a versioned render-input snapshot from completed results and selected House Highlights. The snapshot carries the deterministic manifest, provenance, timing contract, music identity, render version, attempt number, and opaque artifact version. Workers render the persisted claim; they do not reconstruct facts from mutable game endpoints (`packages/api/src/services/postgame-media-coordinator.ts`, `packages/engine/src/postgame-media/house-highlights-trailer-manifest.ts`).

**The worker owns media production.** It selects prepared music from House Cut count, cast size, and trailer duration; renders the visual and poster serially; muxes the score; emits captions and metadata; hashes every artifact; and removes its work directory in `finally` (`packages/web/src/lib/house-highlights-trailer-media-bundle.ts:68`). Keep one worker process and Remotion concurrency at one unless measured capacity justifies more. Chromium rendering is the peak-memory lane, so queue depth should bound pending work without creating concurrent browsers.

**The web owns playback and sharing.** Public pages consume the compact ready read model: poster, video, captions, preview copy, and share context. They do not receive leases, signed PUT URLs, object keys, music filenames, worker diagnostics, or repair controls (`packages/api/src/services/postgame-media.ts`, `packages/web/src/app/games/[slug]/components/postgame-media-player.tsx`).

### Keep rendering separate from publication

Workers claim one queued or expired job through the internal API. Claims are lease-bound; heartbeats extend active work, and reclaiming stale work allocates a fresh attempt and artifact version (`packages/api/src/services/postgame-media-worker.ts:65`). This prevents an expired worker from publishing over its replacement.

After rendering, the worker declares each artifact's content type, byte length, and SHA-256. The API returns constrained upload targets. The worker has no object-storage credentials and sends the issued URL and headers unchanged (`packages/web/src/scripts/render-house-highlights-media-worker.ts:302`). Treat that URL-plus-headers pair as one capability. Reconstructing or filtering its headers splits storage policy across services and can invalidate either the signature or publication semantics.

Finalization validates the active lease, manifest provenance, immutable object prefix, required bundle members, content types, sizes, hashes, dimensions, and safe public URLs before atomically changing the read model to `ready` (`packages/api/src/services/postgame-media-worker.ts:322`). A rerender always uses a new artifact version, so a failed replacement leaves the prior ready bundle intact.

### Sign every required S3-compatible upload header

A successful presigned PUT does not prove that its object is publicly readable. The staging investigation that motivated PR #40 found successful Linode Object Storage uploads whose public trailer URLs returned `403`; the affected object ACLs contained owner `FULL_CONTROL` but no anonymous read grant. The fix established an explicit per-object `public-read` ACL as part of this storage contract instead of relying only on bucket policy.

The API-side constrained upload must do all three things:

```ts
const command = new PutObjectCommand({
  // Key, type, length, checksum, cache policy, and create-only fields omitted.
  ACL: "public-read",
});

const uploadUrl = await getSignedUrl(client, command, {
  expiresIn,
  unhoistableHeaders: new Set(["x-amz-acl"]),
});

return {
  uploadUrl,
  uploadHeaders: { "x-amz-acl": "public-read" },
};
```

The implementation sets `ACL: "public-read"`, keeps `x-amz-acl` in the presigned URL's required signed-header list, and returns the matching upload header (`packages/api/src/lib/storage.ts:205`, `packages/api/src/lib/storage.ts:683`). Regression coverage must assert both `uploadHeaders["x-amz-acl"] === "public-read"` and that `X-Amz-SignedHeaders` includes `x-amz-acl` (`packages/api/src/__tests__/public-media-storage.test.ts`).

This only affects new objects. Existing private objects require a backfill or rerender so the worker uploads a new immutable bundle with the corrected capability.

### Prove the deployed path, not only the renderer

A green render, upload, unit test, or image build is insufficient. Deployment proof crosses every ownership boundary:

1. A completed game is queued, claimed, rendered, uploaded, finalized, and reported `ready`.
2. Anonymous `GET` and `HEAD` succeed for every object, and an MP4 range request returns `206`.
3. `ffprobe` reports H.264 video, AAC audio, 1920x1080 dimensions, and a nonzero duration matching the read model.
4. The public game page loads the poster, video, and captions and exposes sharing.
5. The worker's temporary directory is empty after both success and failure.
6. API, web, and worker run the same immutable release family.

The worker health check is intentionally non-mutating. The smoke command consumes a deliberately queued disposable job and exercises the real claim/render/upload/finalize path (`docs/deployment/house-highlights-render-worker.md`).

## Why This Matters

This pattern turns a costly multi-process render into a transactional publication workflow:

- completed-game snapshots keep truth selection deterministic and reproducible;
- leases and opaque artifact versions isolate retries and stale workers;
- serial rendering keeps peak memory bounded on small nodes;
- credential-free uploads keep bucket secrets in the API;
- immutable bundles make CDN caching and shared links stable;
- finalize-time verification prevents partial or mismatched media from becoming public;
- separate public and admin read models keep operational detail out of viewer UX.

## What Did Not Work

- Running generation in the API or Next.js process would couple request availability to Chromium and ffmpeg resource spikes.
- Treating the trailer as only an MP4 omitted the poster, captions, playback metadata, checksums, and accessibility contract.
- Letting the worker derive facts from live endpoints would make retries dependent on mutable state.
- Giving the worker object-storage credentials weakened the service boundary unnecessarily.
- Assuming bucket policy made every uploaded object public produced successful PUTs followed by public `403` responses.
- Setting `ACL: "public-read"` on the presigner command without returning and signing `x-amz-acl` left the actual worker request incomplete.
- Overwriting a published object would have made retries and CDN behavior unsafe; every attempt needs a new opaque version.

## When to Apply

Apply this pattern to completed-game trailers, poster videos, or other expensive postgame media that must be reproducible, retryable, publicly cacheable, and independent of request-process health.

Do not apply it to factual selection itself. House Cut selection, vote truth, finalist facts, and winner facts remain engine/API responsibilities. The renderer presents the supplied manifest; it does not analyze or invent the story.

## Related

- `docs/plans/2026-07-09-001-feat-house-highlights-endgame-media-pipeline-plan.md` is the implementation plan that established the API/worker/web split.
- `docs/deployment/house-highlights-render-worker.md` is the runtime, storage, smoke, admin, promotion, and rollback contract.
- `docs/house-highlights-trailer-music-cue-sheet.md` defines the deterministic prepared-music timing matrix.
- `docs/solutions/architecture-patterns/owner-scoped-alliance-read-models.md` covers the adjacent rule that public postgame presentation derives from authoritative bounded facts.
- PR #40 added the signed per-object public ACL regression fix and worker memory/concurrency hardening.
- `CONCEPTS.md` defines House Highlights Trailer, Postgame media bundle, Render worker, House Cut, and Trailer thesis.
