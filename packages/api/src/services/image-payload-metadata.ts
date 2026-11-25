import { createHash } from "node:crypto";
import {
  CopyObjectCommand, GetObjectAclCommand, GetObjectCommand, GetObjectTaggingCommand, HeadObjectCommand,
  type HeadObjectCommandOutput, type S3Client,
} from "@aws-sdk/client-s3";
import { IMAGE_SIGNATURE_BYTES, imageContentType, type ImageContentType } from "../lib/image-content-type.js";
import { localObjectStorageEnabled } from "../lib/object-storage-config.js";
import type { StoredPayload } from "./payload-storage.js";

const timeout = () => ({ abortSignal: AbortSignal.timeout(30_000) });

function preservedMetadata(head: HeadObjectCommandOutput) {
  return {
    CacheControl: head.CacheControl,
    ContentDisposition: head.ContentDisposition,
    ContentEncoding: head.ContentEncoding,
    ContentLanguage: head.ContentLanguage,
    Expires: head.Expires,
    WebsiteRedirectLocation: head.WebsiteRedirectLocation,
    Metadata: Object.fromEntries(Object.entries(head.Metadata ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    StorageClass: head.StorageClass,
    ServerSideEncryption: head.ServerSideEncryption,
    SSEKMSKeyId: head.SSEKMSKeyId,
    BucketKeyEnabled: head.BucketKeyEnabled,
  };
}

export function imageObjectReceipt(head: HeadObjectCommandOutput) {
  return {
    contentType: head.ContentType ?? null, length: head.ContentLength ?? null,
    etag: head.ETag ?? null, version: head.VersionId ?? null, modified: head.LastModified?.toISOString() ?? null,
    preservedMetadataSha256: createHash("sha256").update(JSON.stringify(preservedMetadata(head))).digest("hex"),
  };
}

export async function inspectImageObject(client: S3Client, bucket: string, ref: StoredPayload) {
  const object = { Bucket: bucket, Key: ref.key };
  const head = await client.send(new HeadObjectCommand(object), timeout());
  if (!head.ETag || head.ContentLength !== ref.storedByteLength) throw new Error("Object length or ETag disagrees with reference");
  if (!head.ContentLength) return { head, type: undefined };
  const length = Math.min(IMAGE_SIGNATURE_BYTES, head.ContentLength);
  const result = await client.send(new GetObjectCommand({
    ...object, IfMatch: head.ETag, Range: `bytes=0-${length - 1}`,
  }), timeout());
  if (result.$metadata.httpStatusCode !== 206 || result.ContentLength !== length
    || result.ContentRange !== `bytes 0-${length - 1}/${head.ContentLength}` || result.VersionId !== head.VersionId) {
    await result.Body?.transformToWebStream().cancel();
    throw new Error("Storage did not honor the signature range");
  }
  const bytes = await result.Body?.transformToByteArray();
  if (bytes?.byteLength !== length) throw new Error("Incomplete image signature");
  return { head, type: imageContentType(bytes) };
}

/** Application payloads are owner-private; leave any unexpected ACL untouched. */
async function imageAccess(client: S3Client, object: { Bucket: string; Key: string; VersionId?: string }) {
  const acl = await client.send(new GetObjectAclCommand(object), timeout());
  const grant = acl.Grants?.[0];
  // Local MinIO omits both IDs in its owner-private ACL response.
  const owner = acl.Owner?.ID ?? (localObjectStorageEnabled() && !grant?.Grantee?.ID ? "" : undefined);
  if (owner === undefined || acl.Grants?.length !== 1 || (grant?.Grantee?.ID ?? "") !== owner
    || grant?.Grantee?.Type !== "CanonicalUser" || grant.Permission !== "FULL_CONTROL") {
    throw new Error("Unexpected object ACL; metadata copy requires owner-only access");
  }
  const tags = await client.send(new GetObjectTaggingCommand(object), timeout());
  const tagSha256 = createHash("sha256").update(JSON.stringify((tags.TagSet ?? [])
    .map(({ Key, Value }) => [Key, Value]).sort(([a], [b]) => (a ?? "").localeCompare(b ?? "")))).digest("hex");
  return { owner, tagSha256 };
}

export async function verifyImageObjectBytes(client: S3Client, bucket: string, ref: StoredPayload, head: HeadObjectCommandOutput) {
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket, Key: ref.key, IfMatch: head.ETag, VersionId: head.VersionId,
  }), timeout());
  if (!response.Body) throw new Error("Object verification body missing");
  const hash = createHash("sha256");
  let length = 0;
  for await (const chunk of response.Body.transformToWebStream()) {
    length += chunk.byteLength;
    hash.update(chunk);
  }
  const sha256 = hash.digest("hex");
  if (sha256 !== ref.storedSha256 || length !== ref.storedByteLength) throw new Error("Object bytes disagree with immutable reference");
  return sha256;
}

/** Copy within the same bucket/key, leaving any prior version at its original ID. */
export async function replaceImageContentType(client: S3Client, bucket: string, ref: StoredPayload,
  before: HeadObjectCommandOutput, type: ImageContentType, recordIntent: (before: ReturnType<typeof imageObjectReceipt>, access: { tagSha256: string }) => Promise<void>) {
  if (before.MissingMeta || before.ContentEncoding || before.SSECustomerAlgorithm || before.ArchiveStatus
    || before.ObjectLockMode || before.ObjectLockRetainUntilDate || before.ObjectLockLegalHoldStatus === "ON") {
    throw new Error("Object has metadata or protection that requires manual review");
  }
  const object = { Bucket: bucket, Key: ref.key };
  const beforeAccess = await imageAccess(client, { ...object, VersionId: before.VersionId });
  const source = `${bucket}/${ref.key}${before.VersionId ? `?versionId=${encodeURIComponent(before.VersionId)}` : ""}`;
  await recordIntent(imageObjectReceipt(before), { tagSha256: beforeAccess.tagSha256 });
  const copy = await client.send(new CopyObjectCommand({
    ...object, CopySource: source, CopySourceIfMatch: before.ETag, MetadataDirective: "REPLACE", TaggingDirective: "COPY",
    ...preservedMetadata(before), ContentType: type,
  }), timeout());
  const after = await client.send(new HeadObjectCommand(object), timeout());
  const afterAccess = await imageAccess(client, { ...object, VersionId: after.VersionId });
  if (!copy.CopyObjectResult?.ETag || copy.CopyObjectResult.ETag !== after.ETag || copy.VersionId !== after.VersionId
    || after.ContentLength !== ref.storedByteLength || after.ContentType !== type
    || imageObjectReceipt(before).preservedMetadataSha256 !== imageObjectReceipt(after).preservedMetadataSha256
    || beforeAccess.owner !== afterAccess.owner || beforeAccess.tagSha256 !== afterAccess.tagSha256) {
    throw new Error("Metadata copy did not preserve verified storage properties");
  }
  if (before.VersionId && before.VersionId !== after.VersionId) {
    const prior = await client.send(new HeadObjectCommand({ ...object, VersionId: before.VersionId }), timeout());
    if (prior.ETag !== before.ETag || prior.ContentType !== before.ContentType) throw new Error("Previous version changed");
  }
  const sha256 = await verifyImageObjectBytes(client, bucket, ref, after);
  return { after: imageObjectReceipt(after), sha256, tagSha256: afterAccess.tagSha256 };
}
