import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const PRIVATE_TRACE_STORAGE_PROVIDER = "linode_object_storage";
export const PRIVATE_TRACE_CONTENT_TYPE = "application/json";

export interface PrivateTracePutObjectInput {
  bucket: string;
  key: string;
  body: string;
  contentType: string;
}

export interface PrivateTracePutObjectResult {
  etag?: string;
}

export interface PrivateTraceStorageAdapter {
  putObject(input: PrivateTracePutObjectInput): Promise<PrivateTracePutObjectResult>;
  getObject(input: { bucket: string; key: string }): Promise<{ body: string; contentLength?: number; contentType?: string }>;
  headObject(input: { bucket: string; key: string }): Promise<{ contentLength?: number; contentType?: string }>;
}

let privateTraceS3Client: S3Client | null = null;

function getPrivateTraceS3Client(): S3Client {
  if (!privateTraceS3Client) {
    const endpoint = process.env.LINODE_OBJ_ENDPOINT;
    const accessKeyId = process.env.LINODE_OBJ_ACCESS_KEY;
    const secretAccessKey = process.env.LINODE_OBJ_SECRET_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "LINODE_OBJ_ENDPOINT, LINODE_OBJ_ACCESS_KEY, and LINODE_OBJ_SECRET_KEY must be set",
      );
    }

    privateTraceS3Client = new S3Client({
      region: "us-iad",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return privateTraceS3Client;
}

export function getPrivateTraceBucket(): string {
  const bucket = process.env.LINODE_PRIVATE_EVIDENCE_BUCKET;
  if (!bucket) {
    throw new Error("LINODE_PRIVATE_EVIDENCE_BUCKET must be configured for private evidence storage");
  }
  return bucket;
}

export class S3PrivateTraceStorageAdapter implements PrivateTraceStorageAdapter {
  constructor(private readonly client = getPrivateTraceS3Client()) {}

  async putObject(input: PrivateTracePutObjectInput): Promise<PrivateTracePutObjectResult> {
    const response = await this.client.send(new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }));

    return {
      ...(response.ETag && { etag: response.ETag }),
    };
  }

  async getObject(input: { bucket: string; key: string }): Promise<{ body: string; contentLength?: number; contentType?: string }> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }));
    const body = await response.Body?.transformToString();
    if (body === undefined) {
      throw new Error("private trace object body missing");
    }
    return {
      body,
      ...(response.ContentLength !== undefined && { contentLength: response.ContentLength }),
      ...(response.ContentType && { contentType: response.ContentType }),
    };
  }

  async headObject(input: { bucket: string; key: string }): Promise<{ contentLength?: number; contentType?: string }> {
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }));
    return {
      ...(response.ContentLength !== undefined && { contentLength: response.ContentLength }),
      ...(response.ContentType && { contentType: response.ContentType }),
    };
  }
}

export function createPrivateTraceStorageAdapter(): PrivateTraceStorageAdapter {
  return new S3PrivateTraceStorageAdapter();
}
