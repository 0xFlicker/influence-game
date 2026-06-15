import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { getPrivateTraceStorageConfig } from "../services/private-trace-storage.js";

const { endpoint, accessKeyId, secretAccessKey, bucket } = getPrivateTraceStorageConfig();

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("$metadata" in error)) {
    return undefined;
  }
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode;
}

const client = new S3Client({
  region: "us-iad",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
} catch (error) {
  if (httpStatus(error) !== 404) {
    throw error;
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}

await client.send(new HeadBucketCommand({ Bucket: bucket }));
console.log(`Private evidence bucket is ready: ${bucket}`);
