import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  PostgameMediaArtifactKind,
  PostgameMediaArtifactMetadata,
  PostgameMediaUploadTargetMetadata,
} from "../db/schema.js";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  allocateHouseHighlightsTrailerArtifact,
  createPublicMediaUploadTarget,
  inspectPublicMediaArtifact,
  publicMediaUrlForArtifact,
  publicMediaArtifactSpec,
  readPublicMediaArtifactBody,
  type HouseHighlightsTrailerArtifact,
  type PublicMediaUploadTarget,
} from "../lib/public-media-storage.js";
import {
  getPublicObjectStorageBucket,
  getStorageBackend,
} from "../lib/storage.js";
import {
  assertSafeHouseHighlightsPlaybackMetadata,
} from "./postgame-media-storage.js";
import {
  authorizeActivePostgameMediaLease,
  type ArtifactVerifierContext,
  type LeaseRequest,
} from "./postgame-media-worker.js";

const MEDIA_TYPE = "house_highlights_trailer" as const;
const MUTABLE_STATUSES = ["claimed", "rendering", "composing", "uploading"] as const;
const REQUIRED_ARTIFACTS: readonly HouseHighlightsTrailerArtifact[] = [
  "video",
  "poster",
  "captions",
  "metadata",
];
const MAX_PUBLIC_METADATA_BYTES = 256 * 1024;

export interface PostgameMediaUploadDeclaration {
  artifact: HouseHighlightsTrailerArtifact;
  contentType: string;
  byteLength: number;
  sha256: string;
}

export interface PostgameMediaPublicArtifactLocation {
  artifact: HouseHighlightsTrailerArtifact;
  filename: string;
  contentType: string;
  objectKey: string;
  publicUrl: string;
}

export type IssuePostgameMediaUploadTargetsResult =
  | { ok: true; targets: PublicMediaUploadTarget[] }
  | { ok: false; error: "stale_or_invalid_lease" | "invalid_artifacts" | "targets_already_issued" };

export function postgameMediaPublicArtifactLocations(
  gameId: string,
  artifactVersion: string,
  publicBaseUrl?: string,
): PostgameMediaPublicArtifactLocation[] {
  return REQUIRED_ARTIFACTS.map((artifact) => {
    const location = allocateHouseHighlightsTrailerArtifact({
      gameId,
      renderVersion: artifactVersion,
      artifact,
    });
    return {
      artifact,
      filename: location.filename,
      contentType: location.contentType,
      objectKey: location.key,
      publicUrl: publicMediaUrlForArtifact(location, publicBaseUrl),
    };
  });
}

export function postgameMediaPublicStorageIdentity(): {
  provider: "local" | "s3";
  bucket: string;
} {
  const backend = getStorageBackend();
  if (backend === "disabled") throw new Error("Public media storage is not configured");
  return {
    provider: backend,
    bucket: backend === "s3" ? getPublicObjectStorageBucket() : "local",
  };
}

export async function issuePostgameMediaUploadTargets(
  db: DrizzleDB,
  request: LeaseRequest & {
    declarations: readonly PostgameMediaUploadDeclaration[];
    publicBaseUrl?: string;
  },
  now = new Date(),
): Promise<IssuePostgameMediaUploadTargetsResult> {
  const authorization = await authorizeActivePostgameMediaLease(db, request, now);
  if (!authorization) return { ok: false, error: "stale_or_invalid_lease" };
  if (!validDeclarations(request.declarations)) {
    return { ok: false, error: "invalid_artifacts" };
  }

  const current = (await db.select({
    uploadTargetMetadata: schema.gamePostgameMedia.uploadTargetMetadata,
  }).from(schema.gamePostgameMedia).where(and(
    eq(schema.gamePostgameMedia.gameId, request.gameId),
    eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
  )).limit(1))[0];
  if (current?.uploadTargetMetadata?.length) {
    return { ok: false, error: "targets_already_issued" };
  }

  const attemptId = `attempt_${request.attemptNumber}`;
  const leaseId = `lease_${createHash("sha256")
    .update(request.leaseToken)
    .digest("hex")
    .slice(0, 24)}`;
  let targets: PublicMediaUploadTarget[];
  try {
    targets = await Promise.all(request.declarations.map((declaration) =>
      createPublicMediaUploadTarget({
        gameId: request.gameId,
        renderVersion: authorization.artifactVersion,
        artifact: declaration.artifact,
        contentType: declaration.contentType,
        attemptId,
        leaseId,
        byteLength: declaration.byteLength,
        sha256: declaration.sha256,
        ...(request.publicBaseUrl ? { publicBaseUrl: request.publicBaseUrl } : {}),
      })));
  } catch {
    return { ok: false, error: "invalid_artifacts" };
  }

  const metadata = targets.map((target): PostgameMediaUploadTargetMetadata => ({
    targetId: target.targetId,
    attemptNumber: request.attemptNumber,
    artifactVersion: authorization.artifactVersion,
    artifact: target.artifact,
    filename: target.filename,
    objectKey: target.key,
    publicUrl: target.publicUrl,
    contentType: target.contentType,
    byteLength: target.byteLength,
    sha256: target.sha256,
  }));
  const nowIso = now.toISOString();
  const updated = await db.update(schema.gamePostgameMedia).set({
    status: "uploading",
    uploadTargetMetadata: metadata,
    updatedAt: nowIso,
  }).where(and(
    eq(schema.gamePostgameMedia.gameId, request.gameId),
    eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
    eq(schema.gamePostgameMedia.attemptNumber, request.attemptNumber),
    eq(schema.gamePostgameMedia.artifactVersion, authorization.artifactVersion),
    eq(schema.gamePostgameMedia.leaseTokenHash, authorization.leaseTokenHash),
    inArray(schema.gamePostgameMedia.status, MUTABLE_STATUSES),
    gt(schema.gamePostgameMedia.leaseExpiresAt, nowIso),
    isNull(schema.gamePostgameMedia.uploadTargetMetadata),
  )).returning({ gameId: schema.gamePostgameMedia.gameId });
  return updated.length === 1
    ? { ok: true, targets }
    : { ok: false, error: "stale_or_invalid_lease" };
}

export async function verifyPostgameMediaArtifacts(
  db: DrizzleDB,
  context: ArtifactVerifierContext,
): Promise<void> {
  const row = (await db.select({
    artifactVersion: schema.gamePostgameMedia.artifactVersion,
    attemptNumber: schema.gamePostgameMedia.attemptNumber,
    uploadTargetMetadata: schema.gamePostgameMedia.uploadTargetMetadata,
  }).from(schema.gamePostgameMedia).where(and(
    eq(schema.gamePostgameMedia.gameId, context.gameId),
    eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
  )).limit(1))[0];
  if (!row?.artifactVersion || row.attemptNumber !== context.attemptNumber) {
    throw new Error("Upload target attempt mismatch");
  }
  const allocations = row.uploadTargetMetadata;
  if (!allocations || !validAllocationSet(allocations, row.attemptNumber, row.artifactVersion)) {
    throw new Error("Required upload targets were not allocated");
  }

  const artifactsByKind = artifactMetadataByKind(context.artifacts);
  for (const allocation of allocations) {
    const reported = artifactsByKind.get(allocation.artifact);
    if (!reported || !artifactMatchesAllocation(reported, allocation)) {
      throw new Error("Reported artifact does not match its allocated target");
    }
    const inspection = await inspectPublicMediaArtifact({
      artifact: allocation.artifact,
      filename: allocation.filename,
      key: allocation.objectKey,
      contentType: allocation.contentType,
      byteLength: allocation.byteLength,
      sha256: allocation.sha256,
      publicUrl: allocation.publicUrl,
    });
    if (!inspection.valid) throw new Error(`Uploaded ${allocation.artifact} failed verification`);
  }

  const metadataAllocation = allocations.find(({ artifact }) => artifact === "metadata");
  if (!metadataAllocation) throw new Error("Public metadata target is missing");
  const body = await readPublicMediaArtifactBody(
    { key: metadataAllocation.objectKey },
    MAX_PUBLIC_METADATA_BYTES,
  );
  if (!body) throw new Error("Public metadata object is missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("Public metadata object is not valid JSON");
  }
  const playback = assertSafeHouseHighlightsPlaybackMetadata(parsed);
  if (
    playback.durationMs !== context.renderDurationMs
    || playback.dimensions.width !== context.artifacts.video.width
    || playback.dimensions.height !== context.artifacts.video.height
    || playback.title !== context.artifacts.preview.title
    || playback.description !== context.artifacts.preview.description
    || playback.videoUrl !== context.artifacts.video.publicUrl
    || playback.posterUrl !== context.artifacts.poster.publicUrl
    || playback.captionsUrl !== context.artifacts.captions.publicUrl
    || playback.renderVersion !== row.artifactVersion
    || playback.contentHashes.video !== context.artifacts.video.sha256
    || playback.contentHashes.poster !== context.artifacts.poster.sha256
    || playback.contentHashes.captions !== context.artifacts.captions.sha256
  ) {
    throw new Error("Public metadata does not match the uploaded media bundle");
  }

  const storage = postgameMediaPublicStorageIdentity();
  if (
    context.artifacts.storage.provider !== storage.provider
    || context.artifacts.storage.bucket !== storage.bucket
  ) {
    throw new Error("Reported storage identity is invalid");
  }
}

function validDeclarations(
  declarations: readonly PostgameMediaUploadDeclaration[],
): boolean {
  if (declarations.length !== REQUIRED_ARTIFACTS.length) return false;
  const kinds = new Set(declarations.map(({ artifact }) => artifact));
  if (REQUIRED_ARTIFACTS.some((artifact) => !kinds.has(artifact))) return false;
  try {
    for (const declaration of declarations) {
      const spec = publicMediaArtifactSpec(declaration.artifact, declaration.contentType);
      if (
        !Number.isSafeInteger(declaration.byteLength)
        || declaration.byteLength < 1
        || declaration.byteLength > spec.maxBytes
        || !/^sha256:[a-f0-9]{64}$/i.test(declaration.sha256)
      ) return false;
    }
  } catch {
    return false;
  }
  return true;
}

function validAllocationSet(
  allocations: readonly PostgameMediaUploadTargetMetadata[],
  attemptNumber: number,
  artifactVersion: string,
): boolean {
  return allocations.length === REQUIRED_ARTIFACTS.length
    && new Set(allocations.map(({ artifact }) => artifact)).size === REQUIRED_ARTIFACTS.length
    && allocations.every((allocation) =>
      REQUIRED_ARTIFACTS.includes(allocation.artifact)
      && allocation.attemptNumber === attemptNumber
      && allocation.artifactVersion === artifactVersion);
}

type ReportedArtifact =
  | PostgameMediaArtifactMetadata["video"]
  | PostgameMediaArtifactMetadata["poster"]
  | PostgameMediaArtifactMetadata["captions"]
  | PostgameMediaArtifactMetadata["manifest"];

function artifactMetadataByKind(
  artifacts: PostgameMediaArtifactMetadata,
): Map<PostgameMediaArtifactKind, ReportedArtifact> {
  return new Map([
    ["video", artifacts.video],
    ["poster", artifacts.poster],
    ["captions", artifacts.captions],
    ["metadata", artifacts.manifest],
  ]);
}

function artifactMatchesAllocation(
  artifact: ReportedArtifact,
  allocation: PostgameMediaUploadTargetMetadata,
): boolean {
  return artifact.objectKey === allocation.objectKey
    && artifact.publicUrl === allocation.publicUrl
    && artifact.contentType === allocation.contentType
    && artifact.byteLength === allocation.byteLength
    && artifact.sha256.toLowerCase() === allocation.sha256.toLowerCase();
}
