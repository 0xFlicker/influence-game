import { and, eq } from "drizzle-orm";
import type {
  PostgameMediaArtifactMetadata,
  PostgameMediaStatus,
} from "../db/schema.js";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export type { PostgameMediaArtifactMetadata } from "../db/schema.js";

const MEDIA_TYPE = "house_highlights_trailer" as const;
const SCHEMA_VERSION = 1 as const;
const REDACTED_VALUE = "[redacted]";

export type PublicPostgameMediaStatus =
  | "not_requested"
  | "waiting_inputs"
  | "waiting_music"
  | "queued"
  | "rendering"
  | "ready"
  | "failed";

export type PublicPostgameMediaRead =
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      mediaType: typeof MEDIA_TYPE;
      status: Exclude<PublicPostgameMediaStatus, "ready">;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      mediaType: typeof MEDIA_TYPE;
      status: "ready";
      renderVersion: number;
      durationSeconds: number;
      preview: PostgameMediaArtifactMetadata["preview"];
      video: {
        url: string;
        contentType: string;
        width: number;
        height: number;
      };
      poster: {
        url: string;
        contentType: string;
        altText: string;
      };
      captions: {
        url: string;
        contentType: string;
        language: string;
        label: string;
      };
      manifest: {
        url: string;
        contentType: string;
      };
    };

export type AdminPostgameMediaRead =
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      mediaType: typeof MEDIA_TYPE;
      status: "not_requested";
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      mediaType: typeof MEDIA_TYPE;
      status: PostgameMediaStatus;
      renderVersion: number;
      artifactVersion?: string;
      attemptNumber: number;
      lease?: {
        active: boolean;
        expiresAt: string | null;
      };
      failure?: {
        category: string | null;
        message: string | null;
      };
      artifactMetadata?: PostgameMediaArtifactMetadata;
      cueMetadata?: Record<string, unknown>;
      diagnostics?: Record<string, unknown>;
      provenance?: {
        renderInputSnapshotHash: string;
        renderInputSnapshotVersion: number;
        rendererVersion: string;
        timingContractVersion: string;
        musicAssetId: string;
      };
      currentReady?: {
        renderVersion: number;
        durationSeconds: number;
        publishedAt: string;
        artifactMetadata: PostgameMediaArtifactMetadata;
      };
      timestamps: {
        createdAt: string;
        updatedAt: string;
        claimedAt: string | null;
        attemptStartedAt: string | null;
        attemptFinishedAt: string | null;
      };
    };

export async function getPublicPostgameMedia(
  db: DrizzleDB,
  gameId: string,
): Promise<PublicPostgameMediaRead> {
  const row = await loadPostgameMedia(db, gameId);
  if (!row) return publicState("not_requested");

  const currentReady = publicCurrentReady(row);
  if (currentReady) return currentReady;
  if (row.status === "ready") return publicState("failed");

  return publicState(publicStatusFor(row.status));
}

export async function getAdminPostgameMedia(
  db: DrizzleDB,
  gameId: string,
): Promise<AdminPostgameMediaRead> {
  const row = await loadPostgameMedia(db, gameId);
  if (!row) {
    return {
      schemaVersion: SCHEMA_VERSION,
      mediaType: MEDIA_TYPE,
      status: "not_requested",
    };
  }

  const failure = row.failureCategory || row.failureMessage
    ? {
        category: row.failureCategory,
        message: row.failureMessage ? redactString(row.failureMessage) : null,
      }
    : undefined;
  const lease = row.workerIdHash || row.leaseTokenHash || row.leaseExpiresAt
    ? {
        active: row.workerIdHash !== null && row.leaseTokenHash !== null,
        expiresAt: row.leaseExpiresAt,
      }
    : undefined;
  const currentReady = adminCurrentReady(row);
  const provenance = hasSnapshotProvenance(row)
    ? {
        renderInputSnapshotHash: row.renderInputSnapshotHash,
        renderInputSnapshotVersion: row.renderInputSnapshotVersion,
        rendererVersion: row.rendererVersion,
        timingContractVersion: row.timingContractVersion,
        musicAssetId: row.musicAssetId,
      }
    : undefined;

  return {
    schemaVersion: SCHEMA_VERSION,
    mediaType: MEDIA_TYPE,
    status: row.status,
    renderVersion: row.renderVersion,
    ...(row.artifactVersion ? { artifactVersion: row.artifactVersion } : {}),
    attemptNumber: row.attemptNumber,
    ...(lease ? { lease } : {}),
    ...(failure ? { failure } : {}),
    ...(row.artifactMetadata
      ? { artifactMetadata: redactArtifactMetadata(row.artifactMetadata) }
      : {}),
    ...(row.cueMetadata ? { cueMetadata: redactRecord(row.cueMetadata) } : {}),
    ...(row.diagnostics ? { diagnostics: redactRecord(row.diagnostics) } : {}),
    ...(provenance ? { provenance } : {}),
    ...(currentReady ? { currentReady } : {}),
    timestamps: {
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      claimedAt: row.claimedAt,
      attemptStartedAt: row.attemptStartedAt,
      attemptFinishedAt: row.attemptFinishedAt,
    },
  };
}

async function loadPostgameMedia(db: DrizzleDB, gameId: string) {
  const [row] = await db.select()
    .from(schema.gamePostgameMedia)
    .where(and(
      eq(schema.gamePostgameMedia.gameId, gameId),
      eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
    ))
    .limit(1);
  return row;
}

function publicState(status: Exclude<PublicPostgameMediaStatus, "ready">): PublicPostgameMediaRead {
  return { schemaVersion: SCHEMA_VERSION, mediaType: MEDIA_TYPE, status };
}

function hasSnapshotProvenance(
  row: typeof schema.gamePostgameMedia.$inferSelect,
): row is typeof schema.gamePostgameMedia.$inferSelect & {
  renderInputSnapshotHash: string;
  renderInputSnapshotVersion: number;
  rendererVersion: string;
  timingContractVersion: string;
  musicAssetId: string;
} {
  return row.renderInputSnapshotHash !== null
    && row.renderInputSnapshotVersion !== null
    && row.rendererVersion !== null
    && row.timingContractVersion !== null
    && row.musicAssetId !== null;
}

function publicStatusFor(status: PostgameMediaStatus): Exclude<PublicPostgameMediaStatus, "ready"> {
  switch (status) {
    case "waiting_inputs":
    case "waiting_music":
    case "queued":
    case "failed":
      return status;
    case "claimed":
    case "rendering":
    case "composing":
    case "uploading":
    case "ready":
      return "rendering";
  }
}

function publicCurrentReady(
  row: typeof schema.gamePostgameMedia.$inferSelect,
): Extract<PublicPostgameMediaRead, { status: "ready" }> | null {
  if (
    row.currentReadyRenderVersion === null
    || row.currentReadyDurationMs === null
    || row.currentReadyArtifactMetadata === null
  ) {
    return null;
  }

  const artifacts = row.currentReadyArtifactMetadata;
  if (!hasSafePublicUrls(artifacts)) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    mediaType: MEDIA_TYPE,
    status: "ready",
    renderVersion: row.currentReadyRenderVersion,
    durationSeconds: row.currentReadyDurationMs / 1_000,
    preview: artifacts.preview,
    video: {
      url: artifacts.video.publicUrl,
      contentType: artifacts.video.contentType,
      width: artifacts.video.width,
      height: artifacts.video.height,
    },
    poster: {
      url: artifacts.poster.publicUrl,
      contentType: artifacts.poster.contentType,
      altText: artifacts.poster.altText,
    },
    captions: {
      url: artifacts.captions.publicUrl,
      contentType: artifacts.captions.contentType,
      language: artifacts.captions.language,
      label: artifacts.captions.label,
    },
    manifest: {
      url: artifacts.manifest.publicUrl,
      contentType: artifacts.manifest.contentType,
    },
  };
}

function adminCurrentReady(
  row: typeof schema.gamePostgameMedia.$inferSelect,
): Extract<AdminPostgameMediaRead, { status: PostgameMediaStatus }>["currentReady"] {
  if (
    row.currentReadyRenderVersion === null
    || row.currentReadyDurationMs === null
    || row.currentReadyArtifactMetadata === null
    || row.currentReadyPublishedAt === null
  ) {
    return undefined;
  }

  return {
    renderVersion: row.currentReadyRenderVersion,
    durationSeconds: row.currentReadyDurationMs / 1_000,
    publishedAt: row.currentReadyPublishedAt,
    artifactMetadata: redactArtifactMetadata(row.currentReadyArtifactMetadata),
  };
}

function hasSafePublicUrls(artifacts: PostgameMediaArtifactMetadata): boolean {
  return [
    artifacts.video.publicUrl,
    artifacts.poster.publicUrl,
    artifacts.captions.publicUrl,
    artifacts.manifest.publicUrl,
  ].every((url) => !isBearerUrl(url));
}

function redactArtifactMetadata(
  artifacts: PostgameMediaArtifactMetadata,
): PostgameMediaArtifactMetadata {
  return {
    ...artifacts,
    video: redactArtifactUrl(artifacts.video),
    poster: redactArtifactUrl(artifacts.poster),
    captions: redactArtifactUrl(artifacts.captions),
    manifest: redactArtifactUrl(artifacts.manifest),
  };
}

function redactArtifactUrl<T extends { publicUrl: string }>(artifact: T): T {
  return {
    ...artifact,
    publicUrl: isBearerUrl(artifact.publicUrl) ? REDACTED_VALUE : artifact.publicUrl,
  };
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = redactDiagnosticValue(entry, key);
  }
  return redacted;
}

function redactDiagnosticValue(value: unknown, key?: string): unknown {
  if (key && /(?:token|authorization|bearer|secret|credential|password|signature)/i.test(key)) {
    return REDACTED_VALUE;
  }
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => redactDiagnosticValue(entry));
  if (isRecord(value)) return redactRecord(value);
  return value;
}

function redactString(value: string): string {
  return isBearerUrl(value) || /\b(?:authorization|bearer)\s*[:= ]/i.test(value)
    ? REDACTED_VALUE
    : value;
}

function isBearerUrl(value: string): boolean {
  if (/^bearer\s+/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.username.length > 0
      || url.password.length > 0
      || Array.from(url.searchParams.keys()).some((key) =>
        /^(?:x-amz-|signature$|token$|authorization$|credential$|security-token$)/i.test(key));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
