import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";

import { objectStorageBucket, objectStorageClient, objectStorageProvider, privateEvidenceReadBucket } from "../lib/object-storage-config.js";
export const getPrivateTraceStorageProvider = objectStorageProvider;
export const PRIVATE_TRACE_STORAGE_PROVIDER = "linode_object_storage";
export const PRIVATE_TRACE_CONTENT_TYPE = "application/json";

export interface PrivateTracePutObjectInput {
  bucket: string;
  key: string;
  body: string;
  contentType: string;
  abortSignal?: AbortSignal;
}

export interface PrivateTracePutObjectResult {
  etag?: string;
}

export interface PrivateTraceStorageAdapter {
  putObject(input: PrivateTracePutObjectInput): Promise<PrivateTracePutObjectResult>;
  getObject(input: {
    bucket: string;
    key: string;
    offsetBytes?: number;
    maxBytes?: number;
    abortSignal?: AbortSignal;
  }): Promise<{
    body?: string;
    bodyBytes?: Uint8Array;
    contentLength?: number;
    contentRange?: string;
    contentType?: string;
  }>;
  headObject(input: {
    bucket: string;
    key: string;
    abortSignal?: AbortSignal;
  }): Promise<{ contentLength?: number; contentType?: string }>;
}

export interface PrivateTraceStorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function getPrivateTraceS3Client(): S3Client { return objectStorageClient("evidence"); }
export function getPrivateTraceBucket(): string { return objectStorageBucket("evidence"); }

export function getPrivateTraceStorageConfig(): PrivateTraceStorageConfig {
  if (objectStorageProvider() !== "linode_object_storage") throw new Error("Legacy bucket bootstrap configuration is unavailable in AWS mode");
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
    if (input.bucket !== getPrivateTraceBucket()) throw new Error("Private evidence writes require the current configured bucket");
    const response = await this.client.send(new PutObjectCommand({
      Bucket: privateEvidenceReadBucket(input.bucket, input.key),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }), input.abortSignal ? { abortSignal: input.abortSignal } : undefined);

    return {
      ...(response.ETag && { etag: response.ETag }),
    };
  }

  async getObject(input: {
    bucket: string;
    key: string;
    offsetBytes?: number;
    maxBytes?: number;
    abortSignal?: AbortSignal;
  }): Promise<{
    bodyBytes: Uint8Array;
    contentLength?: number;
    contentRange?: string;
    contentType?: string;
  }> {
    const offsetBytes = normalizeOffsetBytes(input.offsetBytes);
    const maxBytes = normalizeMaxBytes(input.maxBytes);
    const command: GetObjectCommandInput = {
      Bucket: privateEvidenceReadBucket(input.bucket, input.key),
      Key: input.key,
      ...((offsetBytes > 0 || maxBytes !== undefined) && {
        Range: maxBytes === undefined
          ? `bytes=${offsetBytes}-`
          : `bytes=${offsetBytes}-${offsetBytes + maxBytes - 1}`,
      }),
    };
    const response = await this.client.send(
      new GetObjectCommand(command),
      input.abortSignal ? { abortSignal: input.abortSignal } : undefined,
    );
    const bodyBytes = await response.Body?.transformToByteArray();
    if (bodyBytes === undefined) {
      throw new Error("private trace object body missing");
    }
    return {
      bodyBytes,
      ...(response.ContentLength !== undefined && { contentLength: response.ContentLength }),
      ...(response.ContentRange && { contentRange: response.ContentRange }),
      ...(response.ContentType && { contentType: response.ContentType }),
    };
  }

  async headObject(input: {
    bucket: string;
    key: string;
    abortSignal?: AbortSignal;
  }): Promise<{ contentLength?: number; contentType?: string }> {
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: privateEvidenceReadBucket(input.bucket, input.key),
      Key: input.key,
    }), input.abortSignal ? { abortSignal: input.abortSignal } : undefined);
    return {
      ...(response.ContentLength !== undefined && { contentLength: response.ContentLength }),
      ...(response.ContentType && { contentType: response.ContentType }),
    };
  }
}

export function createPrivateTraceStorageAdapter(): PrivateTraceStorageAdapter {
  return new S3PrivateTraceStorageAdapter();
}

function normalizeMaxBytes(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}

function normalizeOffsetBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
