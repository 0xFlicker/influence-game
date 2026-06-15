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

export interface PrivateTraceStorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

let privateTraceS3Client: S3Client | null = null;
let privateTraceS3ClientKey: string | null = null;

function getPrivateTraceS3Client(): S3Client {
  const config = getPrivateTraceStorageConfig();
  const clientKey = JSON.stringify([
    config.endpoint,
    config.accessKeyId,
    config.secretAccessKey,
  ]);

  if (!privateTraceS3Client || privateTraceS3ClientKey !== clientKey) {
    privateTraceS3Client = new S3Client({
      region: "us-iad",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    privateTraceS3ClientKey = clientKey;
  }
  return privateTraceS3Client;
}

export function getPrivateTraceBucket(): string {
  const bucket = process.env.LINODE_PRIVATE_CONTENT_BUCKET;
  if (!bucket) {
    throw new Error("LINODE_PRIVATE_CONTENT_BUCKET must be configured for private content storage");
  }
  return bucket;
}

export function getPrivateTraceStorageConfig(): PrivateTraceStorageConfig {
  const endpoint = process.env.LINODE_PRIVATE_CONTENT_ENDPOINT;
  const accessKeyId = process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY;
  const secretAccessKey = process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY;
  const missing: string[] = [];
  if (!endpoint) missing.push("LINODE_PRIVATE_CONTENT_ENDPOINT");
  if (!accessKeyId) missing.push("LINODE_PRIVATE_CONTENT_ACCESS_KEY");
  if (!secretAccessKey) missing.push("LINODE_PRIVATE_CONTENT_SECRET_KEY");
  if (missing.length > 0 || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(`${missing.join(", ")} must be set for private content storage`);
  }

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket: getPrivateTraceBucket(),
  };
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
