/**
 * S3-compatible object storage client for Linode Object Storage.
 *
 * Provides presigned PUT URL generation for direct browser-to-bucket uploads.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
// Presigned URL generation
// ---------------------------------------------------------------------------

export interface PresignedUploadResult {
  /** Presigned PUT URL for direct upload (5 min expiry). */
  uploadUrl: string;
  /** Permanent public URL for the uploaded file. */
  publicUrl: string;
  /** The object key in the bucket. */
  key: string;
}

/**
 * Generate a presigned PUT URL for uploading an object.
 *
 * @param key       Object key (path) within the bucket
 * @param contentType  MIME type of the uploaded file
 * @param maxSizeBytes Maximum allowed content length
 * @param expiresIn    URL expiry in seconds (default 300 = 5 min)
 */
export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  maxSizeBytes: number,
  expiresIn = 300,
): Promise<PresignedUploadResult> {
  const client = getS3Client();
  const bucket = getBucket();
  const endpoint = process.env.LINODE_OBJ_ENDPOINT!;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: maxSizeBytes,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  // Public URL: https://<bucket>.<endpoint-host>/<key>
  const endpointUrl = new URL(endpoint);
  const publicUrl = `${endpointUrl.protocol}//${bucket}.${endpointUrl.host}/${key}`;

  return { uploadUrl, publicUrl, key };
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
