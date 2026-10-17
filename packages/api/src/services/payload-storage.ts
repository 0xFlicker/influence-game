import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPrivateTraceStorageConfig } from "./private-trace-storage.js";
import type { SQLWrapper } from "drizzle-orm";

/** Private, immutable body. Authorization belongs to the owning relational row. */
export interface StoredPayload<T = unknown> {
  storage: "private-payload-v1";
  key: string;
  codec: "binary" | "json-gzip" | "text-gzip";
  sha256: string;
  byteLength: number;
  storedSha256: string;
  storedByteLength: number;
  /** Type-only association; never serialized. */
  readonly __value?: T;
}

export interface PayloadObjectStore {
  putIfAbsent(key: string, bytes: Uint8Array): Promise<void | boolean>;
  get(key: string): Promise<Uint8Array>;
}

class S3PayloadObjectStore implements PayloadObjectStore {
  private cached: { bucket: string; client: S3Client } | undefined;
  private connection() {
    if (this.cached) return this.cached;
    const config = getPrivateTraceStorageConfig();
    if (config.bucket === process.env.LINODE_OBJ_BUCKET) throw new Error("Payload storage requires a separate private bucket");
    this.cached = { bucket: config.bucket, client: new S3Client({
      region: "us-iad", endpoint: config.endpoint, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }) };
    return this.cached;
  }
  async putIfAbsent(key: string, bytes: Uint8Array): Promise<boolean> {
    const { bucket, client } = this.connection();
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
        ContentType: "application/octet-stream", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(60_000) });
          return true;
    } catch (error) {
      const status = error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined;
      if (status !== 412) throw new Error("Private payload upload failed", { cause: error });
      // Only a collision without a receipt needs the existing encoding.
      return false;
    }
  }
  async get(key: string): Promise<Uint8Array> {
    const { bucket, client } = this.connection();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(60_000) });
      if (!result.Body) throw new Error("Private payload object has no body");
      return await result.Body.transformToByteArray();
    } catch (error) { throw new Error("Private payload read failed", { cause: error }); }
  }
}

let store: PayloadObjectStore = new S3PayloadObjectStore();
const decodedReferences = new WeakSet<object>();
/** Called only by the reference-column decoder, never on arbitrary document contents. */
export function decodePayloadReference(value: unknown): StoredPayload {
  assertStoredPayload(value);
  decodedReferences.add(value);
  return value;
}
/** Explicit injection for deterministic tests; never an environment fallback. */
export function setPayloadObjectStoreForTests(replacement: PayloadObjectStore): void { store = replacement; }
export function payloadHash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

export function assertStoredPayload(value: unknown): asserts value is StoredPayload {
  if (!value || typeof value !== "object") throw new Error("Missing private payload reference");
  const ref = value as StoredPayload;
  if (ref.storage !== "private-payload-v1" || !["binary", "json-gzip", "text-gzip"].includes(ref.codec)
    || !/^[a-f0-9]{64}$/.test(ref.sha256) || !/^[a-f0-9]{64}$/.test(ref.storedSha256)
    || ref.key !== `payloads/v1/${ref.codec}/${ref.sha256}`
    || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0
    || !Number.isSafeInteger(ref.storedByteLength) || ref.storedByteLength < 0) {
    throw new Error("Invalid private payload reference");
  }
}

/** An acknowledged upload is durable; read only an existing object whose encoding is unknown. */
export async function storePayload<T>(bytes: Uint8Array, codec: StoredPayload["codec"]): Promise<StoredPayload<T>> {
  const compressed = codec === "binary" ? bytes : gzipSync(bytes);
  const sha256 = payloadHash(bytes);
  const ref: StoredPayload<T> = { storage: "private-payload-v1", key: `payloads/v1/${codec}/${sha256}`,
    codec, sha256, byteLength: bytes.byteLength, storedSha256: payloadHash(compressed), storedByteLength: compressed.byteLength };
  const created = await store.putIfAbsent(ref.key, compressed);
  if (created === false) {
    // Legacy gzip objects can use a different encoding. Never overwrite them:
    // previously committed references include the stored-byte digest.
    const actual = await store.get(ref.key);
    const decoded = codec === "binary" ? actual : gunzipSync(actual);
    if (decoded.byteLength !== bytes.byteLength || payloadHash(decoded) !== sha256) throw new Error("Uploaded payload integrity mismatch");
    ref.storedSha256 = payloadHash(actual);
    ref.storedByteLength = actual.byteLength;
  }
  decodedReferences.add(ref);
  return ref;
}

export async function readPayload(ref: StoredPayload): Promise<Buffer> {
  assertStoredPayload(ref);
  const stored = await store.get(ref.key);
  if (stored.byteLength !== ref.storedByteLength || payloadHash(stored) !== ref.storedSha256) throw new Error("Stored payload integrity mismatch");
  const bytes = ref.codec === "binary" ? Buffer.from(stored) : gunzipSync(stored);
  if (bytes.byteLength !== ref.byteLength || payloadHash(bytes) !== ref.sha256) throw new Error("Decoded payload integrity mismatch");
  return bytes;
}
export async function storeJson<T>(value: T): Promise<StoredPayload<T>> {
  return storePayload(Buffer.from(JSON.stringify(value)), "json-gzip");
}
export async function readJson<T>(ref: StoredPayload<T>): Promise<T> {
  if (ref.codec !== "json-gzip") throw new Error("Expected JSON payload");
  return JSON.parse((await readPayload(ref)).toString("utf8")) as T;
}
export async function storeText(value: string): Promise<StoredPayload<string>> { return storePayload(Buffer.from(value), "text-gzip"); }
export async function readText(ref: StoredPayload<string>): Promise<string> {
  if (ref.codec !== "text-gzip") throw new Error("Expected text payload");
  return (await readPayload(ref)).toString("utf8");
}
export async function storeBinary(value: Uint8Array): Promise<StoredPayload<Buffer>> { return storePayload(value, "binary"); }

export type Hydrated<T> = T extends StoredPayload<infer V> ? V
  : T extends Date | Uint8Array | SQLWrapper | ((...args: never[]) => unknown) ? T
  : T extends readonly unknown[] ? { [K in keyof T]: Hydrated<T[K]> }
  : T extends object ? { [K in keyof T]: Hydrated<T[K]> } : T;

/** Explicitly load selected row bodies, including nested join selections. */
export async function loadPayloads<T>(input: T | PromiseLike<T>): Promise<Hydrated<T>> {
  const value = await input;
  if (value && typeof value === "object" && decodedReferences.has(value)) {
    assertStoredPayload(value);
    const body = value.codec === "json-gzip" ? await readJson(value)
      : value.codec === "text-gzip" ? await readText(value as StoredPayload<string>) : await readPayload(value);
    return body as Hydrated<T>;
  }
  if (Array.isArray(value)) return await Promise.all(value.map(item => loadPayloads(item))) as Hydrated<T>;
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const entries = await Promise.all(Object.entries(value).map(async ([key, field]) => [key, await loadPayloads(field)]));
    return Object.fromEntries(entries) as Hydrated<T>;
  }
  return value as Hydrated<T>;
}

type StoredValue<T> = T extends null | undefined ? T : StoredPayload<T>;
type Mutable<T> = T extends Date | Uint8Array | SQLWrapper | ((...args: never[]) => unknown) ? T : string extends keyof T ? T : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type StoredFields<T, F> = T extends ReadonlyArray<infer V> ? StoredFields<V, F>[]
  : { -readonly [K in keyof T]: K extends keyof F ? StoredValue<Mutable<T[K]>> : Mutable<T[K]> };

/** Only named body fields are uploaded. Relational fields remain unchanged. */
export async function storeFields<const T, F extends Record<string, StoredPayload["codec"]>>(value: T, fields: F): Promise<StoredFields<T, F>> {
  if (Array.isArray(value)) return await Promise.all(value.map(row => storeFields(row, fields))) as StoredFields<T, F>;
  const row = { ...value } as Record<string, unknown>;
  for (const [key, codec] of Object.entries(fields)) {
    const body = row[key];
    if (body === null || body === undefined) continue;
    if (codec === "binary") {
      if (!(body instanceof Uint8Array)) throw new Error(`Expected binary body: ${key}`);
      row[key] = await storeBinary(body);
    } else if (codec === "text-gzip") {
      if (typeof body !== "string") throw new Error(`Expected text body: ${key}`);
      row[key] = await storeText(body);
    } else row[key] = await storeJson(body);
  }
  return row as StoredFields<T, F>;
}
