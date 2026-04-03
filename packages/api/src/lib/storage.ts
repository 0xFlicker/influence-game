/**
 * S3-compatible object storage client for Linode Object Storage.
 *
 * Provides server-side upload and proxied reads (Linode Object Storage
 * does not support S3 ACLs or CORS, so we proxy through the API).
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

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
      region: "us-ord-1",
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

// ---------------------------------------------------------------------------
// Server-side upload
// ---------------------------------------------------------------------------

export interface UploadResult {
  /** The object key in the bucket. */
  key: string;
  /** API-proxied URL to access the file (e.g. /api/files/pfp/user/file.png). */
  publicUrl: string;
}

/**
 * Upload a file to object storage server-side.
 *
 * @param key         Object key (path) within the bucket
 * @param contentType MIME type of the uploaded file
 * @param body        File body (Buffer, Uint8Array, or ReadableStream)
 * @param apiBaseUrl  Base URL for the API (used to construct the proxied public URL)
 */
export async function uploadObject(
  key: string,
  contentType: string,
  body: Buffer | Uint8Array | ReadableStream,
  apiBaseUrl: string,
): Promise<UploadResult> {
  const client = getS3Client();
  const bucket = getBucket();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      Body: body,
    }),
  );

  // Return a proxied URL through our API (avoids CORS/ACL issues)
  const publicUrl = `${apiBaseUrl}/api/files/${key}`;

  return { key, publicUrl };
}

// ---------------------------------------------------------------------------
// Server-side read (proxy)
// ---------------------------------------------------------------------------

export interface FileReadResult {
  body: ReadableStream | null;
  contentType: string | undefined;
}

/**
 * Read a file from object storage (for proxying to clients).
 */
export async function readObject(key: string): Promise<FileReadResult> {
  const client = getS3Client();
  const bucket = getBucket();

  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  return {
    body: result.Body?.transformToWebStream() ?? null,
    contentType: result.ContentType,
  };
}

/**
 * Check whether the required storage env vars are configured.
 */
export function isStorageConfigured(): boolean {
  return !!(
    process.env.LINODE_OBJ_ENDPOINT &&
    process.env.LINODE_OBJ_ACCESS_KEY &&
    process.env.LINODE_OBJ_SECRET_KEY &&
    process.env.LINODE_OBJ_BUCKET
  );
}
