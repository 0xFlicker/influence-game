import { and, eq, gt, inArray, lte, or } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  parseHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "@influence/engine";
import type { PostgameMediaArtifactMetadata } from "../db/schema.js";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { hashPostgameMediaToken, secureTokenEquals } from "./postgame-media-worker-auth.js";

const MEDIA_TYPE = "house_highlights_trailer" as const;
const CLAIMABLE_STALE_STATUSES = ["claimed", "rendering", "composing", "uploading"] as const;
const MUTABLE_STATUSES = ["claimed", "rendering", "composing", "uploading"] as const;
const MAX_LEASE_MS = 20 * 60 * 1_000;
const MIN_LEASE_MS = 60 * 1_000;
const DEFAULT_LEASE_MS = 10 * 60 * 1_000;

export interface PostgameMediaClaim {
  gameId: string;
  renderVersion: number;
  artifactVersion: string;
  attemptNumber: number;
  leaseToken: string;
  leaseExpiresAt: string;
  manifest: HouseHighlightsTrailerManifest;
  provenance: {
    renderInputSnapshotHash: string;
    renderInputSnapshotVersion: number;
    rendererVersion: string;
    timingContractVersion: string;
    musicAssetId: string;
  };
}

export interface LeaseRequest {
  gameId: string;
  attemptNumber: number;
  leaseToken: string;
}

export interface FinalizePostgameMediaRequest extends LeaseRequest {
  renderDurationMs: number;
  renderInputSnapshotHash: string;
  renderInputSnapshotVersion: number;
  rendererVersion: string;
  timingContractVersion: string;
  musicAssetId: string;
  artifacts: PostgameMediaArtifactMetadata;
  cueMetadata?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}

export interface ArtifactVerifierContext {
  gameId: string;
  renderVersion: number;
  artifactVersion: string;
  attemptNumber: number;
  renderDurationMs: number;
  artifacts: PostgameMediaArtifactMetadata;
}

export type ArtifactVerifier = (context: ArtifactVerifierContext) => Promise<void>;

export async function claimPostgameMedia(
  db: DrizzleDB,
  workerToken: string,
  now = new Date(),
): Promise<PostgameMediaClaim | null> {
  const nowIso = now.toISOString();
  const candidates = await db.select().from(schema.gamePostgameMedia)
    .where(or(
      eq(schema.gamePostgameMedia.status, "queued"),
      and(
        inArray(schema.gamePostgameMedia.status, CLAIMABLE_STALE_STATUSES),
        lte(schema.gamePostgameMedia.leaseExpiresAt, nowIso),
      ),
    ))
    .limit(20);

  for (const candidate of candidates) {
    if (!candidate.artifactVersion || !candidate.renderInputSnapshot || !candidate.renderInputSnapshotHash
      || !candidate.renderInputSnapshotVersion || !candidate.rendererVersion
      || !candidate.timingContractVersion || !candidate.musicAssetId) {
      continue;
    }
    let manifest: HouseHighlightsTrailerManifest;
    try {
      manifest = parseHouseHighlightsTrailerManifest(candidate.renderInputSnapshot);
    } catch {
      continue;
    }

    const leaseToken = randomLeaseToken();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs()).toISOString();
    const stale = candidate.status !== "queued";
    const nextAttempt = stale ? candidate.attemptNumber + 1 : candidate.attemptNumber;
    const artifactVersion = stale ? randomArtifactVersion() : candidate.artifactVersion;
    const conditions = [
      eq(schema.gamePostgameMedia.gameId, candidate.gameId),
      eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
      eq(schema.gamePostgameMedia.status, candidate.status),
    ];
    if (stale) {
      conditions.push(lte(schema.gamePostgameMedia.leaseExpiresAt, nowIso));
    }
    const claimed = await db.update(schema.gamePostgameMedia)
      .set({
        status: "claimed",
        attemptNumber: nextAttempt,
        artifactVersion,
        workerIdHash: hashPostgameMediaToken(workerToken),
        leaseTokenHash: hashPostgameMediaToken(leaseToken),
        leaseExpiresAt,
        claimedAt: nowIso,
        attemptStartedAt: nowIso,
        attemptFinishedAt: null,
        failureCategory: null,
        failureMessage: null,
        artifactMetadata: null,
        uploadTargetMetadata: null,
        cueMetadata: null,
        diagnostics: null,
        updatedAt: nowIso,
      })
      .where(and(...conditions))
      .returning({ gameId: schema.gamePostgameMedia.gameId });
    if (claimed.length === 0) continue;

    return {
      gameId: candidate.gameId,
      renderVersion: candidate.renderVersion,
      artifactVersion,
      attemptNumber: nextAttempt,
      leaseToken,
      leaseExpiresAt,
      manifest,
      provenance: {
        renderInputSnapshotHash: candidate.renderInputSnapshotHash,
        renderInputSnapshotVersion: candidate.renderInputSnapshotVersion,
        rendererVersion: candidate.rendererVersion,
        timingContractVersion: candidate.timingContractVersion,
        musicAssetId: candidate.musicAssetId,
      },
    };
  }
  return null;
}

export async function heartbeatPostgameMedia(
  db: DrizzleDB,
  request: LeaseRequest,
  now = new Date(),
): Promise<boolean> {
  const authorization = await authorizeActiveLease(db, request, now);
  if (!authorization) return false;
  const updated = await db.update(schema.gamePostgameMedia)
    .set({
      leaseExpiresAt: new Date(now.getTime() + leaseDurationMs()).toISOString(),
      updatedAt: now.toISOString(),
    })
    .where(activeLeaseWhere(request, authorization.leaseTokenHash, now.toISOString()))
    .returning({ gameId: schema.gamePostgameMedia.gameId });
  return updated.length === 1;
}

export async function reportPostgameMediaProgress(
  db: DrizzleDB,
  request: LeaseRequest & { status: "rendering" | "composing" | "uploading" | "waiting_music"; diagnostics?: Record<string, unknown> },
  now = new Date(),
): Promise<boolean> {
  const authorization = await authorizeActiveLease(db, request, now);
  if (!authorization) return false;
  const waitingForMusic = request.status === "waiting_music";
  const updated = await db.update(schema.gamePostgameMedia)
    .set({
      status: request.status,
      diagnostics: request.diagnostics ? sanitizeRecord(request.diagnostics) : null,
      ...(waitingForMusic
        ? {
            workerIdHash: null,
            leaseTokenHash: null,
            leaseExpiresAt: null,
            attemptFinishedAt: now.toISOString(),
          }
        : {}),
      updatedAt: now.toISOString(),
    })
    .where(activeLeaseWhere(request, authorization.leaseTokenHash, now.toISOString()))
    .returning({ gameId: schema.gamePostgameMedia.gameId });
  return updated.length === 1;
}

export async function failPostgameMediaAttempt(
  db: DrizzleDB,
  request: LeaseRequest & { category: string; message: string; diagnostics?: Record<string, unknown> },
  now = new Date(),
): Promise<boolean> {
  const authorization = await authorizeActiveLease(db, request, now);
  if (!authorization) return false;
  const updated = await db.update(schema.gamePostgameMedia)
    .set({
      status: "failed",
      workerIdHash: null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      attemptFinishedAt: now.toISOString(),
      failureCategory: sanitizeText(request.category, 100),
      failureMessage: sanitizeText(request.message, 1_000),
      diagnostics: request.diagnostics ? sanitizeRecord(request.diagnostics) : null,
      updatedAt: now.toISOString(),
    })
    .where(activeLeaseWhere(request, authorization.leaseTokenHash, now.toISOString()))
    .returning({ gameId: schema.gamePostgameMedia.gameId });
  return updated.length === 1;
}

export async function finalizePostgameMedia(
  db: DrizzleDB,
  request: FinalizePostgameMediaRequest,
  options: { artifactVerifier?: ArtifactVerifier; now?: Date } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = options.now ?? new Date();
  const authorization = await authorizeActiveLease(db, request, now);
  if (!authorization) return { ok: false, error: "stale_or_invalid_lease" };
  const provenanceError = validateFinalizeProvenance(authorization, request);
  if (provenanceError) return { ok: false, error: provenanceError };
  const artifactError = validateArtifacts(request.gameId, authorization.artifactVersion, request.artifacts);
  if (artifactError) return { ok: false, error: artifactError };
  try {
    await options.artifactVerifier?.({
      gameId: request.gameId,
      renderVersion: authorization.renderVersion,
      artifactVersion: authorization.artifactVersion,
      attemptNumber: request.attemptNumber,
      renderDurationMs: request.renderDurationMs,
      artifacts: request.artifacts,
    });
  } catch {
    return { ok: false, error: "artifact_verification_failed" };
  }

  const nowIso = now.toISOString();
  const updated = await db.update(schema.gamePostgameMedia)
    .set({
      status: "ready",
      workerIdHash: null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      attemptFinishedAt: nowIso,
      renderDurationMs: request.renderDurationMs,
      artifactMetadata: request.artifacts,
      uploadTargetMetadata: null,
      cueMetadata: request.cueMetadata ? sanitizeRecord(request.cueMetadata) : null,
      diagnostics: request.diagnostics ? sanitizeRecord(request.diagnostics) : null,
      currentReadyRenderVersion: authorization.renderVersion,
      currentReadyDurationMs: request.renderDurationMs,
      currentReadyArtifactMetadata: request.artifacts,
      currentReadyPublishedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(activeLeaseWhere(request, authorization.leaseTokenHash, nowIso))
    .returning({ gameId: schema.gamePostgameMedia.gameId });
  return updated.length === 1 ? { ok: true } : { ok: false, error: "stale_or_invalid_lease" };
}

export type ActiveLeaseAuthorization = {
  leaseTokenHash: string;
  renderVersion: number;
  artifactVersion: string;
  renderInputSnapshotHash: string;
  renderInputSnapshotVersion: number;
  rendererVersion: string;
  timingContractVersion: string;
  musicAssetId: string;
};

export async function authorizeActivePostgameMediaLease(
  db: DrizzleDB,
  request: LeaseRequest,
  now: Date,
): Promise<ActiveLeaseAuthorization | null> {
  const row = (await db.select().from(schema.gamePostgameMedia)
    .where(and(
      eq(schema.gamePostgameMedia.gameId, request.gameId),
      eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
    ))
    .limit(1))[0];
  if (!row || !row.artifactVersion || !row.leaseTokenHash || !row.leaseExpiresAt || !row.renderInputSnapshotHash
    || !row.renderInputSnapshotVersion || !row.rendererVersion || !row.timingContractVersion || !row.musicAssetId
    || row.attemptNumber !== request.attemptNumber || !MUTABLE_STATUSES.includes(row.status as typeof MUTABLE_STATUSES[number])
    || new Date(row.leaseExpiresAt).getTime() <= now.getTime()) {
    return null;
  }
  const providedHash = hashPostgameMediaToken(request.leaseToken);
  if (!secureTokenEquals(providedHash, row.leaseTokenHash)) return null;
  return {
    leaseTokenHash: row.leaseTokenHash,
    renderVersion: row.renderVersion,
    artifactVersion: row.artifactVersion,
    renderInputSnapshotHash: row.renderInputSnapshotHash,
    renderInputSnapshotVersion: row.renderInputSnapshotVersion,
    rendererVersion: row.rendererVersion,
    timingContractVersion: row.timingContractVersion,
    musicAssetId: row.musicAssetId,
  };
}

const authorizeActiveLease = authorizeActivePostgameMediaLease;

function activeLeaseWhere(request: LeaseRequest, leaseTokenHash: string, nowIso: string) {
  return and(
    eq(schema.gamePostgameMedia.gameId, request.gameId),
    eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
    eq(schema.gamePostgameMedia.attemptNumber, request.attemptNumber),
    eq(schema.gamePostgameMedia.leaseTokenHash, leaseTokenHash),
    inArray(schema.gamePostgameMedia.status, MUTABLE_STATUSES),
    gt(schema.gamePostgameMedia.leaseExpiresAt, nowIso),
  );
}

function validateFinalizeProvenance(
  stored: ActiveLeaseAuthorization,
  request: FinalizePostgameMediaRequest,
): string | null {
  if (!Number.isInteger(request.renderDurationMs) || request.renderDurationMs <= 0 || request.renderDurationMs > 30 * 60 * 1_000) {
    return "invalid_render_duration";
  }
  if (stored.renderInputSnapshotHash !== request.renderInputSnapshotHash
    || stored.renderInputSnapshotVersion !== request.renderInputSnapshotVersion
    || stored.rendererVersion !== request.rendererVersion
    || stored.timingContractVersion !== request.timingContractVersion
    || stored.musicAssetId !== request.musicAssetId) {
    return "manifest_provenance_mismatch";
  }
  return null;
}

function validateArtifacts(
  gameId: string,
  artifactVersion: string,
  artifacts: PostgameMediaArtifactMetadata,
): string | null {
  const prefix = `postgame-media/house-highlights-trailers/${gameId}/${artifactVersion}/`;
  const required = [
    [artifacts?.video, "video/mp4"],
    [artifacts?.poster, "image/png"],
    [artifacts?.captions, "text/vtt"],
    [artifacts?.manifest, "application/json"],
  ] as const;
  if (!artifacts?.preview?.title || !artifacts.preview.description || !artifacts.storage?.provider || !artifacts.storage.bucket) {
    return "invalid_artifact_metadata";
  }
  for (const [artifact, contentType] of required) {
    if (!artifact || artifact.contentType !== contentType || !artifact.objectKey.startsWith(prefix)
      || !Number.isInteger(artifact.byteLength) || artifact.byteLength <= 0
      || !/^sha256:[a-f0-9]{64}$/.test(artifact.sha256) || !isSafePublicUrl(artifact.publicUrl)) {
      return "invalid_artifact_metadata";
    }
  }
  if (artifacts.video.width !== 1920 || artifacts.video.height !== 1080 || !artifacts.poster.altText
    || !artifacts.captions.language || !artifacts.captions.label) {
    return "invalid_artifact_metadata";
  }
  return null;
}

function isSafePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const safeLocalObjectQuery = url.pathname === "/api/uploads/local"
      && Array.from(url.searchParams.keys()).every((key) => key === "key")
      && url.searchParams.has("key");
    return (url.protocol === "https:" || url.protocol === "http:")
      && (!url.search || safeLocalObjectQuery)
      && !url.hash
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function leaseDurationMs(): number {
  const configured = Number(process.env.POSTGAME_MEDIA_LEASE_MS);
  if (!Number.isFinite(configured)) return DEFAULT_LEASE_MS;
  return Math.max(MIN_LEASE_MS, Math.min(Math.floor(configured), MAX_LEASE_MS));
}

function randomLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

function randomArtifactVersion(): string {
  return `rv_${randomBytes(18).toString("base64url")}`;
}

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(/(?:bearer\s+|token\s*[:=]\s*)[^\s,;]+/gi, "[redacted]").slice(0, maxLength);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = /(?:token|authorization|secret|credential|signature)/i.test(key)
      ? "[redacted]"
      : typeof entry === "string"
        ? sanitizeText(entry, 1_000)
        : Array.isArray(entry)
          ? entry.map((item) => typeof item === "string" ? sanitizeText(item, 1_000) : item)
          : entry;
  }
  return sanitized;
}
