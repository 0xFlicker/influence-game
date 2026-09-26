import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { getPrivateTraceStorageConfig } from "./private-trace-storage.js";

export const GAME_ASSET_LIMITS = { fileBytes: 10 * 1024 * 1024, bodyBytes: 12 * 1024 * 1024, dimension: 4096 } as const;
export class GameAssetError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503, message: string) { super(message); }
}
export interface NormalizedGameImage { bytes: Uint8Array; sha256: string; width: number; height: number }
export interface GameAssetStorage {
  put(key: string, image: NormalizedGameImage): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
export function imageHash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

export async function normalizeGameImage(bytes: Uint8Array, mime: string): Promise<NormalizedGameImage> {
  if (!bytes.length || bytes.length > GAME_ASSET_LIMITS.fileBytes) throw new GameAssetError("asset_invalid", 413, "Image must be between 1 byte and 10 MiB");
  try {
    const input = sharp(bytes, { animated: true, limitInputPixels: GAME_ASSET_LIMITS.dimension ** 2, failOn: "warning" });
    const meta = await input.metadata();
    const expected = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
    if (!meta.format || !(meta.format in expected) || expected[meta.format as keyof typeof expected] !== mime
      || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || (meta.pages ?? 1) !== 1) {
      throw new GameAssetError("asset_invalid", 400, "Use a single-frame PNG, JPEG, or WebP, at most 4096 pixels per dimension, with matching media type");
    }
    const normalized = await input.rotate().png().toBuffer({ resolveWithObject: true });
    if (normalized.data.length > GAME_ASSET_LIMITS.fileBytes) throw new GameAssetError("asset_invalid", 413, "Normalized PNG exceeds 10 MiB");
    return { bytes: normalized.data, sha256: imageHash(normalized.data), width: normalized.info.width, height: normalized.info.height };
  } catch (error) {
    if (error instanceof GameAssetError) throw error;
    throw new GameAssetError("asset_invalid", 400, "Image could not be decoded safely");
  }
}

export async function readBoundedBytes(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new GameAssetError("asset_invalid", 413, "Payload exceeds its size limit");
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** One private S3 path for MinIO and Linode. No filesystem or public fallback. */
export class S3GameAssetStorage implements GameAssetStorage {
  private config() {
    try {
      const config = getPrivateTraceStorageConfig();
      if (config.bucket === process.env.LINODE_OBJ_BUCKET) throw new Error("Private and public buckets must differ");
      const client = new S3Client({ region: "us-iad", endpoint: config.endpoint, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, forcePathStyle: true });
      return { client, bucket: config.bucket };
    } catch { throw new GameAssetError("asset_storage_unavailable", 503, "Private content storage is not configured"); }
  }
  async put(key: string, image: NormalizedGameImage): Promise<void> {
    const { client, bucket } = this.config();
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: image.bytes, ContentType: "image/png", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(25_000) });
    } catch (error) {
      const status = error && typeof error === "object" && "$metadata" in error ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined;
      if (status !== 412 || imageHash(await this.get(key)) !== image.sha256) throw new GameAssetError("asset_storage_unavailable", 503, "Private image upload did not complete; inspect the operation receipt");
    } finally { client.destroy(); }
  }
  async get(key: string): Promise<Uint8Array> {
    const { client, bucket } = this.config();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(25_000) });
      if (!result.Body || (result.ContentLength ?? 0) > GAME_ASSET_LIMITS.fileBytes) throw new Error("Invalid stored content");
      return await readBoundedBytes(result.Body.transformToWebStream(), GAME_ASSET_LIMITS.fileBytes);
    } catch { throw new GameAssetError("asset_storage_unavailable", 503, "Private image could not be read"); }
    finally { client.destroy(); }
  }
  async delete(key: string): Promise<void> {
    const { client, bucket } = this.config();
    try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(25_000) }); }
    catch { throw new GameAssetError("asset_storage_unavailable", 503, "Object cleanup is pending; retry this operation's cleanup"); }
    finally { client.destroy(); }
  }
}
