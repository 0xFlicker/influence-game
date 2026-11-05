import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

export type ObjectStorageWorkload = "public" | "data" | "evidence";
export type ObjectStorageProvider = "linode_object_storage" | "aws_s3";
/** Existing S3-compatible adapter, restricted to the explicitly selected local service. */
export function localObjectStorageEnabled(): boolean {
  if (process.env.HOUSE_LOCAL_OBJECT_STORAGE !== "1") return false;
  if (process.env.NODE_ENV === "production" || process.env.HOUSE_OBJECT_STORAGE_PROVIDER === "aws") {
    throw new Error("Local object storage cannot be used in production or AWS mode");
  }
  for (const name of ["LINODE_OBJ_ENDPOINT", "LINODE_PRIVATE_CONTENT_ENDPOINT"]) {
    const url = new URL(required(name));
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
      throw new Error("Local object storage requires exact loopback HTTP endpoints");
    }
  }
  if (required("LINODE_OBJ_BUCKET") === required("LINODE_PRIVATE_CONTENT_BUCKET")) {
    throw new Error("Local public and private content buckets must be distinct");
  }
  return true;
}
export function objectStorageProvider(): ObjectStorageProvider {
  const provider = process.env.HOUSE_OBJECT_STORAGE_PROVIDER;
  if (!provider || provider === "linode") return "linode_object_storage";
  if (provider === "aws") return "aws_s3";
  throw new Error("HOUSE_OBJECT_STORAGE_PROVIDER must be linode or aws");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for object storage`);
  return value;
}

export function objectStorageBucket(workload: ObjectStorageWorkload): string {
  if (objectStorageProvider() === "linode_object_storage") {
    return required(workload === "public" ? "LINODE_OBJ_BUCKET" : "LINODE_PRIVATE_CONTENT_BUCKET");
  }
  const names = { public: required("HOUSE_PUBLIC_BUCKET"), data: required("HOUSE_DATA_BUCKET"), evidence: required("HOUSE_EVIDENCE_BUCKET") };
  if (new Set(Object.values(names)).size !== 3 || Object.values(names).some(name => !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name))) {
    throw new Error("AWS public, data and evidence buckets must be valid and distinct");
  }
  return names[workload];
}

export function objectStorageClientConfig(workload: ObjectStorageWorkload): S3ClientConfig {
  localObjectStorageEnabled();
  if (objectStorageProvider() === "linode_object_storage") {
    const prefix = workload === "public" ? "LINODE_OBJ" : "LINODE_PRIVATE_CONTENT";
    return { region: "us-iad", endpoint: required(`${prefix}_ENDPOINT`), forcePathStyle: true,
      credentials: { accessKeyId: required(`${prefix}_ACCESS_KEY`), secretAccessKey: required(`${prefix}_SECRET_KEY`) } };
  }
  const region = required("HOUSE_OBJECT_STORAGE_REGION");
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) throw new Error("Invalid HOUSE_OBJECT_STORAGE_REGION");
  const accessKeyId = process.env.HOUSE_OBJECT_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.HOUSE_OBJECT_STORAGE_SECRET_KEY;
  const sessionToken = process.env.HOUSE_OBJECT_STORAGE_SESSION_TOKEN;
  if (!!accessKeyId !== !!secretAccessKey || sessionToken && !accessKeyId) throw new Error("Incomplete AWS object storage credentials");
  objectStorageBucket(workload);
  return { region, endpoint: `https://s3.${region}.amazonaws.com`, forcePathStyle: false,
    // Omitting credentials intentionally enables the SDK's renewable role chain.
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } } : {}) };
}

const clients = new Map<ObjectStorageWorkload, { identity: string; client: S3Client }>();
export function objectStorageClient(workload: ObjectStorageWorkload): S3Client {
  const config = objectStorageClientConfig(workload);
  const identity = JSON.stringify(config);
  const existing = clients.get(workload);
  if (existing?.identity === identity) return existing.client;
  const client = new S3Client(config);
  clients.set(workload, { identity, client });
  return client;
}

export function publicObjectAcl(): { ACL?: "public-read" } {
  return objectStorageProvider() === "linode_object_storage" && !localObjectStorageEnabled() ? { ACL: "public-read" } : {};
}

export function publicDeliveryBaseUrl(): string {
  if (objectStorageProvider() === "linode_object_storage") {
    return `https://${objectStorageBucket("public")}.${new URL(required("LINODE_OBJ_ENDPOINT")).host}`;
  }
  const value = required("HOUSE_PUBLIC_BASE_URL").replace(/\/$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) throw new Error("HOUSE_PUBLIC_BASE_URL must be an exact HTTPS origin");
  return value;
}

/** Exact legacy bucket only; never allow arbitrary persisted endpoints/buckets. */
export function privateEvidenceReadBucket(bucket: string, key: string): string {
  const current = objectStorageBucket("evidence");
  if (!key.startsWith("content/") || key.split("/").some(part => !part || part === "." || part === "..") || key.includes("\\")) {
    throw new Error("Invalid private evidence key");
  }
  if (bucket === current) return current;
  if (objectStorageProvider() === "aws_s3" && bucket === process.env.HOUSE_LEGACY_PRIVATE_BUCKET) return current;
  throw new Error("Private evidence bucket is not configured");
}

export function isPrivateEvidenceProvider(provider: unknown): provider is ObjectStorageProvider {
  return provider === "linode_object_storage" || provider === "aws_s3";
}
