/**
 * Object storage helpers for profile-picture uploads.
 *
 * Hosted/staging deployments use Linode Object Storage via S3-compatible
 * presigned PUT URLs. Local dev can fall back to a filesystem-backed PUT
 * endpoint so the profile flow works without cloud object-storage secrets.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StorageBackend = "s3" | "local" | "disabled";

const STORAGE_ENV = [
  "LINODE_OBJ_ENDPOINT",
  "LINODE_OBJ_ACCESS_KEY",
  "LINODE_OBJ_SECRET_KEY",
  "LINODE_OBJ_BUCKET",
] as const;

const DEFAULT_LOCAL_UPLOAD_DIR = ".local-uploads";
const LOCAL_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_client) {
    const endpoint = process.env.LINODE_OBJ_ENDPOINT;
    const accessKeyId = process.env.LINODE_OBJ_ACCESS_KEY;
    const secretAccessKey = process.env.LINODE_OBJ_SECRET_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "LINODE_OBJ_ENDPOINT, LINODE_OBJ_ACCESS_KEY, and LINODE_OBJ_SECRET_KEY must be set",
      );
    }

    _client = new S3Client({
      region: "us-iad",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return _client;
}

function getBucket(): string {
  const bucket = process.env.LINODE_OBJ_BUCKET;
  if (!bucket) {
    throw new Error("LINODE_OBJ_BUCKET must be set");
  }
  return bucket;
}

function hasS3Config(): boolean {
  return STORAGE_ENV.every((key) => !!process.env[key]);
}

function isLocalRuntime(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function getStorageBackend(): StorageBackend {
  const requested = process.env.INFLUENCE_STORAGE_BACKEND?.toLowerCase();

  if (requested === "disabled") return "disabled";
  if (requested === "local") return "local";
  if (requested === "s3") return hasS3Config() ? "s3" : "disabled";
  if (hasS3Config()) return "s3";
  if (isLocalRuntime()) return "local";
  return "disabled";
}

export function getStorageStatus(): {
  backend: StorageBackend;
  localDir?: string;
  missingS3Env: string[];
} {
  const backend = getStorageBackend();
  return {
    backend,
    localDir: backend === "local" ? getLocalUploadDir() : undefined,
    missingS3Env: STORAGE_ENV.filter((key) => !process.env[key]),
  };
}

// ---------------------------------------------------------------------------
// Presigned URL generation
// ---------------------------------------------------------------------------

export interface PresignedUploadResult {
  /** Presigned PUT URL for the client to upload directly. */
  uploadUrl: string;
  /** The object key in the bucket. */
  key: string;
  /** Direct public URL to the uploaded file. */
  publicUrl: string;
}

/**
 * Generate a presigned PUT URL for browser-direct upload.
 *
 * @param key         Object key (path) within the bucket
 * @param contentType MIME type the client will upload
 * @param expiresIn   URL validity in seconds (default: 300 = 5 minutes)
 */
export async function generatePresignedUpload(
  key: string,
  contentType: string,
  expiresIn = 300,
  publicBaseUrl?: string,
): Promise<PresignedUploadResult> {
  const backend = getStorageBackend();
  if (backend === "local") {
    return generateLocalUpload(key, contentType, expiresIn, publicBaseUrl);
  }
  if (backend === "disabled") {
    throw new Error("Object storage is not configured");
  }

  const client = getS3Client();
  const bucket = getBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ACL: "public-read",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadUrl = await getSignedUrl(client as any, command, { expiresIn });

  // Public URL: https://{bucket}.{endpoint-host}/{key}
  const endpoint = process.env.LINODE_OBJ_ENDPOINT!;
  const endpointHost = new URL(endpoint).host;
  const publicUrl = `https://${bucket}.${endpointHost}/${key}`;

  return { uploadUrl, key, publicUrl };
}

function generateLocalUpload(
  key: string,
  contentType: string,
  expiresIn: number,
  publicBaseUrl?: string,
): PresignedUploadResult {
  validateLocalKey(key);

  const expiresAt = Date.now() + expiresIn * 1000;
  const token = signLocalUpload(key, contentType, expiresAt);
  const params = new URLSearchParams({
    key,
    contentType,
    expiresAt: expiresAt.toString(),
    token,
  });

  const uploadPath = `/api/upload/local?${params.toString()}`;
  const publicPath = getLocalPublicUploadPath(key);

  return {
    uploadUrl: absolutizeApiUrl(uploadPath, publicBaseUrl),
    publicUrl: absolutizeApiUrl(publicPath, publicBaseUrl),
    key,
  };
}

/**
 * Check whether the required storage env vars are configured.
 */
export function isStorageConfigured(): boolean {
  return getStorageBackend() !== "disabled";
}

export function verifyLocalUploadToken(
  key: string,
  contentType: string,
  expiresAt: number,
  token: string,
): boolean {
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return false;
  }

  const expected = signLocalUpload(key, contentType, expiresAt);
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  return expectedBuffer.length === tokenBuffer.length
    && timingSafeEqual(expectedBuffer, tokenBuffer);
}

export async function writeLocalUpload(
  key: string,
  contentType: string,
  body: ArrayBuffer,
): Promise<void> {
  validateLocalKey(key);

  if (body.byteLength > LOCAL_UPLOAD_MAX_BYTES) {
    throw new LocalUploadError(413, "File must be under 2 MB");
  }

  const filePath = getLocalUploadPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(body));
  await writeFile(`${filePath}.content-type`, contentType);
}

export async function readLocalUpload(key: string): Promise<{
  body: Buffer;
  contentType: string;
} | null> {
  validateLocalKey(key);

  const filePath = getLocalUploadPath(key);
  try {
    const body = await readFile(filePath);
    const contentType = await readContentType(filePath, key);
    return { body, contentType };
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw error;
  }
}

export function normalizeUploadedAvatarUrl(
  avatarUrl: string,
  publicBaseUrl?: string,
): string {
  const trimmed = avatarUrl.trim();
  if (!trimmed) return trimmed;

  const parsed = parseUrl(trimmed, publicBaseUrl);
  if (!parsed) return trimmed;

  if (parsed.pathname === "/api/upload/local") {
    const key = parsed.searchParams.get("key");
    return key
      ? absolutizeApiUrl(getLocalPublicUploadPath(key), publicBaseUrl ?? parsed.origin)
      : trimmed;
  }

  if (parsed.pathname === "/api/uploads/local") {
    return absolutizeApiUrl(`${parsed.pathname}${parsed.search}`, publicBaseUrl ?? parsed.origin);
  }

  if (!hasExpiringSignatureParams(parsed)) {
    return trimmed;
  }

  const configuredPublicUrl = publicObjectUrlFromConfiguredS3(parsed);
  if (configuredPublicUrl) return configuredPublicUrl;

  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export class LocalUploadError extends Error {
  constructor(
    public readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "LocalUploadError";
  }
}

function getLocalUploadDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.INFLUENCE_LOCAL_UPLOAD_DIR ?? DEFAULT_LOCAL_UPLOAD_DIR,
  );
}

function getLocalUploadPath(key: string): string {
  validateLocalKey(key);

  const baseDir = getLocalUploadDir();
  const filePath = path.resolve(baseDir, key);
  if (!filePath.startsWith(`${baseDir}${path.sep}`)) {
    throw new LocalUploadError(400, "Invalid upload key");
  }
  return filePath;
}

function getLocalPublicUploadPath(key: string): string {
  validateLocalKey(key);
  return `/api/uploads/local?key=${encodeURIComponent(key)}`;
}

function absolutizeApiUrl(pathOrUrl: string, publicBaseUrl?: string): string {
  if (!publicBaseUrl || /^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, publicBaseUrl).toString();
}

function parseUrl(value: string, publicBaseUrl?: string): URL | null {
  try {
    return new URL(value, publicBaseUrl);
  } catch {
    return null;
  }
}

function hasExpiringSignatureParams(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (
      normalized.startsWith("x-amz-")
      || normalized === "expires"
      || normalized === "signature"
    ) {
      return true;
    }
  }
  return false;
}

function publicObjectUrlFromConfiguredS3(url: URL): string | null {
  const endpoint = process.env.LINODE_OBJ_ENDPOINT;
  const bucket = process.env.LINODE_OBJ_BUCKET;
  if (!endpoint || !bucket) return null;

  let endpointHost: string;
  try {
    endpointHost = new URL(endpoint).host;
  } catch {
    return null;
  }

  const bucketHost = `${bucket}.${endpointHost}`;
  if (url.host === bucketHost) {
    const key = url.pathname.replace(/^\/+/, "");
    return key ? `https://${bucketHost}/${key}` : null;
  }

  if (url.host !== endpointHost) return null;

  const pathPrefix = `/${bucket}/`;
  if (!url.pathname.startsWith(pathPrefix)) return null;

  const key = url.pathname.slice(pathPrefix.length);
  return key ? `https://${bucketHost}/${key}` : null;
}

function validateLocalKey(key: string): void {
  if (
    !key
    || key.startsWith("/")
    || key.includes("\\")
    || key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new LocalUploadError(400, "Invalid upload key");
  }
}

function signLocalUpload(key: string, contentType: string, expiresAt: number): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be set for local upload signing");
  }

  return createHmac("sha256", secret)
    .update(key)
    .update("\0")
    .update(contentType)
    .update("\0")
    .update(expiresAt.toString())
    .digest("hex");
}

async function readContentType(filePath: string, key: string): Promise<string> {
  try {
    return (await readFile(`${filePath}.content-type`, "utf-8")).trim();
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }

  const ext = path.extname(key).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
