import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.LINODE_OBJ_ENDPOINT;
const accessKeyId = process.env.LINODE_OBJ_ACCESS_KEY;
const secretAccessKey = process.env.LINODE_OBJ_SECRET_KEY;
const bucket = process.env.LINODE_PRIVATE_EVIDENCE_BUCKET;

if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error(
    "LINODE_OBJ_ENDPOINT, LINODE_OBJ_ACCESS_KEY, LINODE_OBJ_SECRET_KEY, and LINODE_PRIVATE_EVIDENCE_BUCKET are required",
  );
}

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
