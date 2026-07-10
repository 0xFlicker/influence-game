import { randomUUID } from "node:crypto";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  generateConstrainedPublicUpload,
  getPublicObjectStorageBucket,
  getPublicObjectStorageClient,
  getStorageBackend,
  publicObjectUrlForKey,
  readLocalUpload,
  type ConstrainedPublicUploadResult,
} from "./storage.js";

export const HOUSE_HIGHLIGHTS_PUBLIC_MEDIA_PREFIX =
  "postgame-media/house-highlights-trailers";

export const HOUSE_HIGHLIGHTS_PUBLIC_MEDIA_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

export type HouseHighlightsTrailerArtifact = "video" | "poster" | "captions" | "metadata";

export interface PublicMediaArtifactSpec {
  artifact: HouseHighlightsTrailerArtifact;
  filename: string;
  contentType: string;
  maxBytes: number;
}

export interface HouseHighlightsArtifactLocation extends PublicMediaArtifactSpec {
  gameId: string;
  renderVersion: string;
  key: string;
}

export interface CreatePublicMediaUploadTargetInput {
  gameId: string;
  renderVersion: string;
  artifact: HouseHighlightsTrailerArtifact;
  contentType?: string;
  attemptId: string;
  leaseId: string;
  byteLength: number;
  sha256: string;
  expiresIn?: number;
  publicBaseUrl?: string;
}

export interface PublicMediaUploadTarget extends ConstrainedPublicUploadResult {
  artifact: HouseHighlightsTrailerArtifact;
  filename: string;
  attemptId: string;
  leaseId: string;
}

export interface PublicMediaObjectSummary {
  artifact: HouseHighlightsTrailerArtifact;
  filename: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  etag?: string;
  publicUrl: string;
}

export type PublicMediaArtifactInspection =
  | { valid: true; object: PublicMediaObjectSummary }
  | { valid: false; reason: "missing" | "content_type" | "content_length" | "checksum" };

const ARTIFACT_SPECS = {
  video: { filename: "trailer.mp4", contentType: "video/mp4", maxBytes: 1024 * 1024 * 1024 },
  captions: { filename: "captions.vtt", contentType: "text/vtt", maxBytes: 2 * 1024 * 1024 },
  metadata: { filename: "metadata.json", contentType: "application/json", maxBytes: 256 * 1024 },
} as const;

const POSTER_MAX_BYTES = 10 * 1024 * 1024;

export function publicMediaArtifactSpec(
  artifact: HouseHighlightsTrailerArtifact,
  contentType?: string,
): PublicMediaArtifactSpec {
  if (artifact === "poster") {
    const posterContentType = contentType ?? "image/png";
    if (posterContentType !== "image/png" && posterContentType !== "image/jpeg") {
      throw new Error("Unsupported poster content type");
    }
    return {
      artifact,
      contentType: posterContentType,
      filename: posterContentType === "image/jpeg" ? "poster.jpg" : "poster.png",
      maxBytes: POSTER_MAX_BYTES,
    };
  }

  const spec = ARTIFACT_SPECS[artifact];
  if (contentType !== undefined && contentType !== spec.contentType) {
    throw new Error(`Invalid ${artifact} content type`);
  }
  return { artifact, ...spec };
}

export function allocateHouseHighlightsTrailerArtifact(input: {
  gameId: string;
  renderVersion: string;
  artifact: HouseHighlightsTrailerArtifact;
  contentType?: string;
}): HouseHighlightsArtifactLocation {
  assertSafeOpaqueId(input.gameId, "game ID");
  assertSafeOpaqueId(input.renderVersion, "render version");
  const spec = publicMediaArtifactSpec(input.artifact, input.contentType);
  return {
    ...spec,
    gameId: input.gameId,
    renderVersion: input.renderVersion,
    key: `${HOUSE_HIGHLIGHTS_PUBLIC_MEDIA_PREFIX}/${input.gameId}/${input.renderVersion}/${spec.filename}`,
  };
}

/**
 * This helper intentionally requires both attempt and lease context. The U2
 * coordinator must verify that context is current before allocating a target.
 */
export async function createPublicMediaUploadTarget(
  input: CreatePublicMediaUploadTargetInput,
): Promise<PublicMediaUploadTarget> {
  assertSafeOpaqueId(input.attemptId, "attempt ID");
  assertSafeOpaqueId(input.leaseId, "lease ID");
  const location = allocateHouseHighlightsTrailerArtifact(input);
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > location.maxBytes) {
    throw new Error(`Invalid ${input.artifact} byte length`);
  }

  const targetId = randomUUID();
  const target = await generateConstrainedPublicUpload({
    key: location.key,
    contentType: location.contentType,
    byteLength: input.byteLength,
    sha256: input.sha256,
    targetId,
    ...(input.expiresIn !== undefined && { expiresIn: input.expiresIn }),
    ...(input.publicBaseUrl !== undefined && { publicBaseUrl: input.publicBaseUrl }),
  });
  return {
    ...target,
    artifact: location.artifact,
    filename: location.filename,
    attemptId: input.attemptId,
    leaseId: input.leaseId,
  };
}

export function sanitizePublicMediaUploadTarget(target: PublicMediaUploadTarget): {
  targetId: string;
  object: PublicMediaObjectSummary;
} {
  return {
    targetId: target.targetId,
    object: {
      artifact: target.artifact,
      filename: target.filename,
      contentType: target.contentType,
      byteLength: target.byteLength,
      sha256: target.sha256,
      publicUrl: target.publicUrl,
    },
  };
}

export async function inspectPublicMediaArtifact(
  target: Pick<PublicMediaUploadTarget, "artifact" | "filename" | "key" | "contentType" | "byteLength" | "sha256" | "publicUrl">,
): Promise<PublicMediaArtifactInspection> {
  if (getStorageBackend() === "local") {
    const object = await readLocalUpload(target.key);
    if (!object) return { valid: false, reason: "missing" };
    return validateObject({
      target,
      contentType: object.contentType,
      byteLength: object.byteLength,
      sha256: object.sha256,
      etag: object.etag,
    });
  }

  if (getStorageBackend() === "disabled") return { valid: false, reason: "missing" };
  try {
    const response = await getPublicObjectStorageClient().send(new HeadObjectCommand({
      Bucket: getPublicObjectStorageBucket(),
      Key: target.key,
      ChecksumMode: "ENABLED",
    }));
    const checksum = response.ChecksumSHA256
      ? `sha256:${Buffer.from(response.ChecksumSHA256, "base64").toString("hex")}`
      : response.Metadata?.sha256;
    return validateObject({
      target,
      contentType: response.ContentType,
      byteLength: response.ContentLength,
      sha256: checksum,
      ...(response.ETag && { etag: response.ETag }),
    });
  } catch (error) {
    if (isMissingObject(error)) return { valid: false, reason: "missing" };
    throw error;
  }
}

function validateObject(input: {
  target: Pick<PublicMediaUploadTarget, "artifact" | "filename" | "contentType" | "byteLength" | "sha256" | "publicUrl">;
  contentType: string | undefined;
  byteLength: number | undefined;
  sha256: string | undefined;
  etag?: string;
}): PublicMediaArtifactInspection {
  if (input.contentType !== input.target.contentType) return { valid: false, reason: "content_type" };
  if (input.byteLength !== input.target.byteLength) return { valid: false, reason: "content_length" };
  const actualSha256 = normalizeSha256(input.sha256);
  const expectedSha256 = normalizeSha256(input.target.sha256);
  if (!actualSha256 || !expectedSha256 || actualSha256 !== expectedSha256) {
    return { valid: false, reason: "checksum" };
  }
  return {
    valid: true,
    object: {
      artifact: input.target.artifact,
      filename: input.target.filename,
      contentType: input.target.contentType,
      byteLength: input.target.byteLength,
      sha256: expectedSha256,
      ...(input.etag && { etag: input.etag }),
      publicUrl: input.target.publicUrl,
    },
  };
}

export function publicMediaUrlForArtifact(location: HouseHighlightsArtifactLocation, publicBaseUrl?: string): string {
  return publicObjectUrlForKey(location.key, publicBaseUrl);
}

function assertSafeOpaqueId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Invalid public media ${label}`);
  }
}

function normalizeSha256(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.startsWith("sha256:") ? value : `sha256:${value}`;
  return /^sha256:[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}

function isMissingObject(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "NotFound" || error.name === "NoSuchKey" || error.name === "NotFoundError";
}
