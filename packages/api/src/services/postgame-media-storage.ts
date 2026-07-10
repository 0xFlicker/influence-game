import type {
  HouseHighlightsTrailerArtifact,
  PublicMediaArtifactInspection,
  PublicMediaUploadTarget,
} from "../lib/public-media-storage.js";
import { inspectPublicMediaArtifact, sanitizePublicMediaUploadTarget } from "../lib/public-media-storage.js";

export const HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_SCHEMA =
  "influence.house-highlights.playback" as const;
export const HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_VERSION = 1 as const;

export interface HouseHighlightsPlaybackMetadata {
  schema: typeof HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_SCHEMA;
  version: typeof HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_VERSION;
  durationMs: number;
  dimensions: { width: number; height: number };
  title: string;
  description: string;
  videoUrl: string;
  posterUrl: string;
  captionsUrl: string;
  renderVersion: string;
  contentHashes: {
    video: string;
    poster: string;
    captions: string;
  };
}

export function createHouseHighlightsPlaybackMetadata(input: {
  durationMs: number;
  width: number;
  height: number;
  title: string;
  description: string;
  videoUrl: string;
  posterUrl: string;
  captionsUrl: string;
  renderVersion: string;
  contentHashes: HouseHighlightsPlaybackMetadata["contentHashes"];
}): HouseHighlightsPlaybackMetadata {
  return assertSafeHouseHighlightsPlaybackMetadata({
    schema: HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_SCHEMA,
    version: HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_VERSION,
    durationMs: input.durationMs,
    dimensions: { width: input.width, height: input.height },
    title: input.title,
    description: input.description,
    videoUrl: input.videoUrl,
    posterUrl: input.posterUrl,
    captionsUrl: input.captionsUrl,
    renderVersion: input.renderVersion,
    contentHashes: input.contentHashes,
  });
}

/**
 * The public metadata object is deliberately smaller than the internal render
 * manifest. Unknown fields fail closed so cue data and diagnostics cannot
 * drift into an object loaded by public players or crawlers.
 */
export function assertSafeHouseHighlightsPlaybackMetadata(value: unknown): HouseHighlightsPlaybackMetadata {
  const record = assertRecord(value, "Invalid playback metadata");
  const allowed = new Set([
    "schema",
    "version",
    "durationMs",
    "dimensions",
    "title",
    "description",
    "videoUrl",
    "posterUrl",
    "captionsUrl",
    "renderVersion",
    "contentHashes",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`Unexpected playback metadata field: ${key}`);
  }

  if (record.schema !== HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_SCHEMA) {
    throw new Error("Invalid playback metadata schema");
  }
  if (record.version !== HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_VERSION) {
    throw new Error("Invalid playback metadata version");
  }
  const durationMs = assertInteger(record.durationMs, "Invalid playback duration", 1, 3 * 60 * 60 * 1_000);
  const dimensions = assertRecord(record.dimensions, "Invalid playback dimensions");
  const width = assertInteger(dimensions.width, "Invalid playback width", 1, 7_680);
  const height = assertInteger(dimensions.height, "Invalid playback height", 1, 4_320);
  const title = assertText(record.title, "Invalid playback title", 1, 160);
  const description = assertText(record.description, "Invalid playback description", 1, 600);
  const videoUrl = assertPublicUrl(record.videoUrl, "Invalid playback video URL");
  const posterUrl = assertPublicUrl(record.posterUrl, "Invalid playback poster URL");
  const captionsUrl = assertPublicUrl(record.captionsUrl, "Invalid playback captions URL");
  const renderVersion = assertOpaqueVersion(record.renderVersion);
  const contentHashes = assertRecord(record.contentHashes, "Invalid playback content hashes");
  if (Object.keys(contentHashes).some((key) => !["video", "poster", "captions"].includes(key))) {
    throw new Error("Unexpected playback content hash");
  }

  return {
    schema: HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_SCHEMA,
    version: HOUSE_HIGHLIGHTS_PLAYBACK_METADATA_VERSION,
    durationMs,
    dimensions: { width, height },
    title,
    description,
    videoUrl,
    posterUrl,
    captionsUrl,
    renderVersion,
    contentHashes: {
      video: assertSha256(contentHashes.video, "Invalid video content hash"),
      poster: assertSha256(contentHashes.poster, "Invalid poster content hash"),
      captions: assertSha256(contentHashes.captions, "Invalid captions content hash"),
    },
  };
}

export function serializeHouseHighlightsPlaybackMetadata(value: HouseHighlightsPlaybackMetadata): string {
  const metadata = assertSafeHouseHighlightsPlaybackMetadata(value);
  const serialized = JSON.stringify(metadata);
  if (Buffer.byteLength(serialized) > 256 * 1024) {
    throw new Error("Playback metadata exceeds public media size limit");
  }
  return serialized;
}

export async function verifyPublicMediaTargets(
  targets: readonly PublicMediaUploadTarget[],
): Promise<{
  valid: boolean;
  artifacts: Array<{ artifact: HouseHighlightsTrailerArtifact; inspection: PublicMediaArtifactInspection }>;
}> {
  const artifacts = await Promise.all(targets.map(async (target) => ({
    artifact: target.artifact,
    inspection: await inspectPublicMediaArtifact(target),
  })));
  return { valid: artifacts.every(({ inspection }) => inspection.valid), artifacts };
}

export function sanitizePublicMediaTargets(targets: readonly PublicMediaUploadTarget[]): Array<{
  targetId: string;
  object: ReturnType<typeof sanitizePublicMediaUploadTarget>["object"];
}> {
  return targets.map(sanitizePublicMediaUploadTarget);
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function assertInteger(value: unknown, message: string, min: number, max: number): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < min
    || value > max
  ) throw new Error(message);
  return value;
}

function assertText(value: unknown, message: string, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(message);
  }
  return value;
}

function assertPublicUrl(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.hash
  ) throw new Error(message);
  if (url.search && !isSafeLocalPublicObjectUrl(url)) throw new Error(message);
  return url.toString();
}

function isSafeLocalPublicObjectUrl(url: URL): boolean {
  return url.pathname === "/api/uploads/local"
    && url.searchParams.has("key")
    && Array.from(url.searchParams.keys()).every((key) => key === "key");
}

function assertOpaqueVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Invalid playback render version");
  }
  return value;
}

function assertSha256(value: unknown, message: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(value)) throw new Error(message);
  return value.toLowerCase();
}
