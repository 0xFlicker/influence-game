/**
 * S3-compatible object storage client for Linode Object Storage (E1).
 *
 * Uses browser-direct presigned URL uploads. The E1 endpoint (us-iad)
 * supports CORS and object ACLs, so clients PUT directly to the bucket.
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
): Promise<PresignedUploadResult> {
  const client = getS3Client();
  const bucket = getBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ACL: "public-read",
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  // Public URL: https://{bucket}.{endpoint-host}/{key}
  const endpoint = process.env.LINODE_OBJ_ENDPOINT!;
  const endpointHost = new URL(endpoint).host;
  const publicUrl = `https://${bucket}.${endpointHost}/${key}`;

  return { uploadUrl, key, publicUrl };
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
