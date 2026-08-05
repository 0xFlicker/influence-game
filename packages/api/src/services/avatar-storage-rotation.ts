import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  paginateListObjectsV2,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  and,
  eq,
} from "drizzle-orm";
import {
  hashHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  isLegacyIdentityBearingAvatarStorageKey,
  isOpaqueAvatarStorageKey,
  opaqueReplacementAvatarStorageKey,
} from "../lib/avatar-storage-keys.js";
import {
  getPublicObjectStorageBucket,
  getPublicObjectStorageClient,
  ownedPublicAvatarStorageKey,
  publicObjectUrlForKey,
} from "../lib/storage.js";

export const AVATAR_STORAGE_ROTATION_MANIFEST_VERSION = 1;

export interface AvatarObjectMetadata {
  key: string;
  byteLength: number;
  etag: string | null;
  contentType: string | null;
}

export interface AvatarObjectStore {
  bucket: string;
  endpointHost: string;
  list(prefix: string): Promise<AvatarObjectMetadata[]>;
  head(key: string): Promise<AvatarObjectMetadata | null>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export interface AvatarStorageReferenceCounts {
  agentProfiles: number;
  avatarGenerationRequests: number;
  avatarChangeEvents: number;
  postgameMediaSnapshots: number;
  total: number;
}

export interface AvatarStorageRotationEntry {
  oldKey: string;
  newKey: string | null;
  oldPublicUrl: string;
  newPublicUrl: string | null;
  byteLength: number;
  etag: string | null;
  contentType: string | null;
  initialReferences: AvatarStorageReferenceCounts;
  copiedAt?: string;
  repointedAt?: string;
  deletedAt?: string;
}

export interface AvatarStorageRotationManifest {
  version: typeof AVATAR_STORAGE_ROTATION_MANIFEST_VERSION;
  bucket: string;
  endpointHost: string;
  createdAt: string;
  updatedAt: string;
  entries: AvatarStorageRotationEntry[];
}

export interface AvatarStorageRotationVerification {
  ok: boolean;
  legacyObjectsRemaining: number;
  untrackedLegacyObjects: number;
  oldReferencesRemaining: number;
  missingReplacementObjects: number;
  mismatchedReplacementObjects: number;
  errors: string[];
}

type RotationDatabase = Pick<DrizzleDB, "select" | "update">;
type RotationTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type Checkpoint = (manifest: AvatarStorageRotationManifest) => Promise<void>;
type AvatarStorageReferenceMapping = {
  oldKey: string;
  newKey: string;
  oldPublicUrl: string;
  newPublicUrl: string;
};
type AvatarStorageReferenceCategory = Exclude<keyof AvatarStorageReferenceCounts, "total">;

export function createPublicAvatarObjectStore(): AvatarObjectStore {
  const client = getPublicObjectStorageClient();
  const bucket = getPublicObjectStorageBucket();
  const endpoint = process.env.LINODE_OBJ_ENDPOINT;
  if (!endpoint) throw new Error("LINODE_OBJ_ENDPOINT must be set");
  const endpointHost = new URL(endpoint).host;

  return {
    bucket,
    endpointHost,
    list: (prefix) => listObjects(client, bucket, prefix),
    head: (key) => headObject(client, bucket, key),
    async copy(sourceKey, destinationKey) {
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: destinationKey,
        CopySource: encodeCopySource(bucket, sourceKey),
        ACL: "public-read",
        MetadataDirective: "COPY",
      }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    publicUrl: (key) => publicObjectUrlForKey(key),
  };
}

export async function inventoryAvatarStorageRotations(
  db: RotationDatabase,
  store: AvatarObjectStore,
  now = new Date(),
): Promise<AvatarStorageRotationManifest> {
  const objects = (await store.list("pfp/"))
    .filter(({ key }) => isLegacyIdentityBearingAvatarStorageKey(key))
    .sort((left, right) => left.key.localeCompare(right.key));
  const objectKeys = new Set(objects.map(({ key }) => key));
  const referenceCounts = await countAllLegacyAvatarStorageReferences(db);
  const missingReferencedKey = [...referenceCounts.keys()].find((key) => !objectKeys.has(key));
  if (missingReferencedKey) {
    throw new Error(`A referenced legacy avatar object is missing during inventory: ${missingReferencedKey}`);
  }
  const entries: AvatarStorageRotationEntry[] = [];

  for (const listed of objects) {
    const current = await store.head(listed.key);
    if (!current) throw new Error("A legacy avatar object disappeared during inventory");
    if (!current.etag) throw new Error("A legacy avatar object has no comparable ETag");
    const oldPublicUrl = store.publicUrl(current.key);
    const initialReferences = referenceCounts.get(current.key) ?? emptyReferenceCounts();
    const newKey = initialReferences.total > 0
      ? opaqueReplacementAvatarStorageKey(current.key)
      : null;
    entries.push({
      oldKey: current.key,
      newKey,
      oldPublicUrl,
      newPublicUrl: newKey ? store.publicUrl(newKey) : null,
      byteLength: current.byteLength,
      etag: current.etag,
      contentType: current.contentType,
      initialReferences,
    });
  }

  const timestamp = now.toISOString();
  return {
    version: AVATAR_STORAGE_ROTATION_MANIFEST_VERSION,
    bucket: store.bucket,
    endpointHost: store.endpointHost,
    createdAt: timestamp,
    updatedAt: timestamp,
    entries,
  };
}

export async function copyAvatarStorageRotations(
  manifest: AvatarStorageRotationManifest,
  store: AvatarObjectStore,
  checkpoint: Checkpoint = async () => undefined,
  now: () => Date = () => new Date(),
): Promise<void> {
  assertManifestMatchesStore(manifest, store);
  for (const entry of manifest.entries) {
    if (!entry.newKey) continue;
    const source = await requireMatchingObject(store, entry.oldKey, entry);
    const existing = await store.head(entry.newKey);
    if (existing) {
      assertObjectsMatch(source, existing, "Existing replacement object does not match source");
    } else {
      await store.copy(entry.oldKey, entry.newKey);
      const copied = await store.head(entry.newKey);
      if (!copied) throw new Error("Replacement avatar object is missing after copy");
      assertObjectsMatch(source, copied, "Copied replacement object does not match source");
    }
    entry.copiedAt = now().toISOString();
    touchManifest(manifest, now());
    await checkpoint(manifest);
  }
}

export async function repointAvatarStorageRotations(
  db: DrizzleDB,
  manifest: AvatarStorageRotationManifest,
  store: AvatarObjectStore,
  checkpoint: Checkpoint = async () => undefined,
  now: () => Date = () => new Date(),
): Promise<void> {
  assertManifestMatchesStore(manifest, store);
  const trackedLegacyKeys = new Set(manifest.entries.map(({ oldKey }) => oldKey));
  const allLegacyReferences = await countAllLegacyAvatarStorageReferences(db);
  const untrackedReference = [...allLegacyReferences.keys()]
    .find((key) => !trackedLegacyKeys.has(key));
  if (untrackedReference) {
    throw new Error(`A legacy avatar reference is not represented in the manifest: ${untrackedReference}`);
  }
  for (const entry of manifest.entries) {
    const currentReferences = await countAvatarStorageReferences(db, entry.oldKey);
    if (currentReferences.total > 0) {
      if (!entry.newKey || !entry.newPublicUrl || !entry.copiedAt) {
        throw new Error("Referenced legacy avatar has no verified replacement copy");
      }
      await requireMatchingObject(store, entry.newKey, entry);
      await repointAvatarStorageReferences(db, {
        oldKey: entry.oldKey,
        newKey: entry.newKey,
        oldPublicUrl: entry.oldPublicUrl,
        newPublicUrl: entry.newPublicUrl,
      });
    }
    entry.repointedAt = now().toISOString();
    touchManifest(manifest, now());
    await checkpoint(manifest);
  }
}

export async function deleteRepointedAvatarStorageObjects(
  db: RotationDatabase,
  manifest: AvatarStorageRotationManifest,
  store: AvatarObjectStore,
  checkpoint: Checkpoint = async () => undefined,
  now: () => Date = () => new Date(),
): Promise<void> {
  assertManifestMatchesStore(manifest, store);
  const trackedLegacyKeys = new Set(manifest.entries.map(({ oldKey }) => oldKey));
  const untrackedLegacyObjects = (await store.list("pfp/"))
    .filter(({ key }) => isLegacyIdentityBearingAvatarStorageKey(key) && !trackedLegacyKeys.has(key));
  if (untrackedLegacyObjects.length > 0) {
    throw new Error("Refusing deletion because untracked legacy avatar objects exist");
  }
  const allLegacyReferences = await countAllLegacyAvatarStorageReferences(db);
  if (totalReferenceCount(allLegacyReferences) !== 0) {
    throw new Error("Refusing to delete while legacy avatar references remain");
  }
  for (const entry of manifest.entries) {
    if (!entry.repointedAt) {
      throw new Error("Refusing to delete an avatar object before the repoint phase completed");
    }
    const references = await countAvatarStorageReferences(db, entry.oldKey);
    if (references.total !== 0) {
      throw new Error("Refusing to delete a legacy avatar object that is still referenced");
    }
    if (entry.newKey) {
      if (!entry.copiedAt) throw new Error("Refusing to delete before replacement copy verification");
      await requireMatchingObject(store, entry.newKey, entry);
    }
    await store.delete(entry.oldKey);
    if (await store.head(entry.oldKey)) {
      throw new Error("Legacy avatar object still exists after deletion");
    }
    entry.deletedAt = now().toISOString();
    touchManifest(manifest, now());
    await checkpoint(manifest);
  }
}

export async function verifyAvatarStorageRotation(
  db: RotationDatabase,
  manifest: AvatarStorageRotationManifest,
  store: AvatarObjectStore,
): Promise<AvatarStorageRotationVerification> {
  assertManifestMatchesStore(manifest, store);
  const errors: string[] = [];
  let legacyObjectsRemaining = 0;
  let missingReplacementObjects = 0;
  let mismatchedReplacementObjects = 0;
  const allLegacyReferences = await countAllLegacyAvatarStorageReferences(db);
  const oldReferencesRemaining = totalReferenceCount(allLegacyReferences);

  for (const entry of manifest.entries) {
    const oldObject = await store.head(entry.oldKey);
    if (oldObject) legacyObjectsRemaining += 1;
    if (entry.deletedAt && oldObject) {
      errors.push("A deleted legacy avatar object is still readable");
    }
    if (entry.newKey) {
      const replacement = await store.head(entry.newKey);
      if (!replacement) {
        missingReplacementObjects += 1;
      } else if (!objectsMatch(entry, replacement)) {
        mismatchedReplacementObjects += 1;
      }
    }
  }

  const tracked = new Set(manifest.entries.map(({ oldKey }) => oldKey));
  const untrackedLegacyObjects = (await store.list("pfp/"))
    .filter(({ key }) => isLegacyIdentityBearingAvatarStorageKey(key) && !tracked.has(key))
    .length;
  if (untrackedLegacyObjects > 0) errors.push("Untracked legacy avatar objects exist");
  if (oldReferencesRemaining > 0) errors.push("Database references to legacy avatar objects remain");
  if (missingReplacementObjects > 0) errors.push("Referenced replacement avatar objects are missing");
  if (mismatchedReplacementObjects > 0) errors.push("Replacement avatar objects do not match their sources");
  return {
    ok: errors.length === 0,
    legacyObjectsRemaining,
    untrackedLegacyObjects,
    oldReferencesRemaining,
    missingReplacementObjects,
    mismatchedReplacementObjects,
    errors,
  };
}

async function countAvatarStorageReferences(
  db: RotationDatabase,
  oldKey: string,
): Promise<AvatarStorageReferenceCounts> {
  return (await countAllLegacyAvatarStorageReferences(db)).get(oldKey)
    ?? emptyReferenceCounts();
}

async function countAllLegacyAvatarStorageReferences(
  db: RotationDatabase,
): Promise<Map<string, AvatarStorageReferenceCounts>> {
  const [profiles, generations, changes, media] = await Promise.all([
    db.select({ avatarUrl: schema.agentProfiles.avatarUrl }).from(schema.agentProfiles),
    db.select({ safeMetadata: schema.avatarGenerationRequests.safeMetadata })
      .from(schema.avatarGenerationRequests),
    db.select({
      previousAvatarUrl: schema.avatarChangeEvents.previousAvatarUrl,
      newAvatarUrl: schema.avatarChangeEvents.newAvatarUrl,
      safeMetadata: schema.avatarChangeEvents.safeMetadata,
    }).from(schema.avatarChangeEvents),
    db.select({ renderInputSnapshot: schema.gamePostgameMedia.renderInputSnapshot })
      .from(schema.gamePostgameMedia),
  ]);
  const counts = new Map<string, AvatarStorageReferenceCounts>();
  for (const row of profiles) {
    countLegacyAvatarStorageReferencesInValue(counts, "agentProfiles", row.avatarUrl);
  }
  for (const row of generations) {
    countLegacyAvatarStorageReferencesInValue(
      counts,
      "avatarGenerationRequests",
      row.safeMetadata,
    );
  }
  for (const row of changes) {
    countLegacyAvatarStorageReferencesInValue(
      counts,
      "avatarChangeEvents",
      row.previousAvatarUrl,
    );
    countLegacyAvatarStorageReferencesInValue(
      counts,
      "avatarChangeEvents",
      row.newAvatarUrl,
    );
    countLegacyAvatarStorageReferencesInValue(
      counts,
      "avatarChangeEvents",
      row.safeMetadata,
    );
  }
  for (const row of media) {
    countLegacyAvatarStorageReferencesInValue(
      counts,
      "postgameMediaSnapshots",
      row.renderInputSnapshot,
    );
  }
  return counts;
}

async function repointAvatarStorageReferences(
  db: DrizzleDB,
  mapping: AvatarStorageReferenceMapping,
): Promise<void> {
  return db.transaction(async (tx) => {
    await repointProfiles(tx, mapping);
    await repointGenerationRequests(tx, mapping);
    await repointChangeEvents(tx, mapping);
    await repointPostgameMediaSnapshots(tx, mapping);
    const after = await countAvatarStorageReferences(tx, mapping.oldKey);
    if (after.total !== 0) throw new Error("Avatar storage repoint left legacy references behind");
  });
}

function countLegacyAvatarStorageReferencesInValue(
  counts: Map<string, AvatarStorageReferenceCounts>,
  category: AvatarStorageReferenceCategory,
  value: unknown,
): void {
  if (typeof value === "string") {
    const key = legacyAvatarStorageKeyForReference(value);
    if (!key) return;
    const current = counts.get(key) ?? emptyReferenceCounts();
    current[category] += 1;
    current.total += 1;
    counts.set(key, current);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      countLegacyAvatarStorageReferencesInValue(counts, category, item);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) {
    countLegacyAvatarStorageReferencesInValue(counts, category, item);
  }
}

function legacyAvatarStorageKeyForReference(value: string): string | null {
  if (isLegacyIdentityBearingAvatarStorageKey(value)) return value;
  const ownedKey = ownedPublicAvatarStorageKey(value);
  return ownedKey && isLegacyIdentityBearingAvatarStorageKey(ownedKey)
    ? ownedKey
    : null;
}

function emptyReferenceCounts(): AvatarStorageReferenceCounts {
  return {
    agentProfiles: 0,
    avatarGenerationRequests: 0,
    avatarChangeEvents: 0,
    postgameMediaSnapshots: 0,
    total: 0,
  };
}

function totalReferenceCount(
  counts: ReadonlyMap<string, AvatarStorageReferenceCounts>,
): number {
  let total = 0;
  for (const count of counts.values()) total += count.total;
  return total;
}

function replaceAvatarStorageReferencesInValue(
  value: unknown,
  mapping: AvatarStorageReferenceMapping,
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const replacement = replacementForAvatarStorageReference(value, mapping);
    return replacement === null
      ? { value, changed: false }
      : { value: replacement, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const replaced = value.map((item) => {
      const result = replaceAvatarStorageReferencesInValue(item, mapping);
      changed ||= result.changed;
      return result.value;
    });
    return changed ? { value: replaced, changed } : { value, changed };
  }
  if (!value || typeof value !== "object") return { value, changed: false };
  let changed = false;
  const replaced = Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const result = replaceAvatarStorageReferencesInValue(item, mapping);
    changed ||= result.changed;
    return [key, result.value];
  }));
  return changed ? { value: replaced, changed } : { value, changed };
}

async function repointProfiles(
  tx: RotationTransaction,
  mapping: AvatarStorageReferenceMapping,
): Promise<void> {
  const rows = await tx.select({ id: schema.agentProfiles.id, avatarUrl: schema.agentProfiles.avatarUrl })
    .from(schema.agentProfiles);
  for (const row of rows) {
    const avatarUrl = replacementForAvatarStorageReference(row.avatarUrl, mapping);
    if (!avatarUrl) continue;
    await tx.update(schema.agentProfiles)
      .set({ avatarUrl })
      .where(eq(schema.agentProfiles.id, row.id));
  }
}

async function repointGenerationRequests(
  tx: RotationTransaction,
  mapping: AvatarStorageReferenceMapping,
): Promise<void> {
  const rows = await tx.select({
    id: schema.avatarGenerationRequests.id,
    safeMetadata: schema.avatarGenerationRequests.safeMetadata,
  }).from(schema.avatarGenerationRequests);
  for (const row of rows) {
    const replaced = replaceAvatarStorageReferencesInValue(row.safeMetadata, mapping);
    if (!replaced.changed) continue;
    await tx.update(schema.avatarGenerationRequests)
      .set({ safeMetadata: replaced.value as Record<string, unknown> })
      .where(eq(schema.avatarGenerationRequests.id, row.id));
  }
}

async function repointChangeEvents(
  tx: RotationTransaction,
  mapping: AvatarStorageReferenceMapping,
): Promise<void> {
  const rows = await tx.select().from(schema.avatarChangeEvents);
  for (const row of rows) {
    const metadata = replaceAvatarStorageReferencesInValue(row.safeMetadata, mapping);
    const previousAvatarUrl = replacementForAvatarStorageReference(
      row.previousAvatarUrl,
      mapping,
    ) ?? row.previousAvatarUrl;
    const newAvatarUrl = replacementForAvatarStorageReference(row.newAvatarUrl, mapping)
      ?? row.newAvatarUrl;
    if (!metadata.changed
      && previousAvatarUrl === row.previousAvatarUrl
      && newAvatarUrl === row.newAvatarUrl) continue;
    await tx.update(schema.avatarChangeEvents).set({
      previousAvatarUrl,
      newAvatarUrl,
      safeMetadata: metadata.value as Record<string, unknown> | null,
    }).where(eq(schema.avatarChangeEvents.id, row.id));
  }
}

async function repointPostgameMediaSnapshots(
  tx: RotationTransaction,
  mapping: AvatarStorageReferenceMapping,
): Promise<void> {
  const rows = await tx.select({
    gameId: schema.gamePostgameMedia.gameId,
    mediaType: schema.gamePostgameMedia.mediaType,
    renderInputSnapshot: schema.gamePostgameMedia.renderInputSnapshot,
  }).from(schema.gamePostgameMedia);
  for (const row of rows) {
    const replaced = replaceAvatarStorageReferencesInValue(row.renderInputSnapshot, mapping);
    if (!replaced.changed) continue;
    const snapshot = replaced.value as HouseHighlightsTrailerManifest;
    await tx.update(schema.gamePostgameMedia).set({
      renderInputSnapshot: snapshot,
      renderInputSnapshotHash: hashHouseHighlightsTrailerManifest(snapshot),
    }).where(and(
      eq(schema.gamePostgameMedia.gameId, row.gameId),
      eq(schema.gamePostgameMedia.mediaType, row.mediaType),
    ));
  }
}

function replacementForAvatarStorageReference(
  value: string | null,
  mapping: AvatarStorageReferenceMapping,
): string | null {
  if (value === null) return null;
  if (value === mapping.oldKey) return mapping.newKey;
  return isAvatarStorageReference(value, mapping.oldKey, mapping.oldPublicUrl)
    ? mapping.newPublicUrl
    : null;
}

function isAvatarStorageReference(
  value: string,
  oldKey: string,
  oldPublicUrl: string,
): boolean {
  return value === oldKey
    || value === oldPublicUrl
    || ownedPublicAvatarStorageKey(value) === oldKey;
}

function assertManifestMatchesStore(
  manifest: AvatarStorageRotationManifest,
  store: AvatarObjectStore,
): void {
  if (manifest.version !== AVATAR_STORAGE_ROTATION_MANIFEST_VERSION) {
    throw new Error(`Unsupported avatar rotation manifest version: ${manifest.version}`);
  }
  if (manifest.bucket !== store.bucket || manifest.endpointHost !== store.endpointHost) {
    throw new Error("Avatar rotation manifest does not match configured object storage");
  }
  const oldKeys = new Set<string>();
  const newKeys = new Set<string>();
  for (const entry of manifest.entries) {
    if (oldKeys.has(entry.oldKey)) {
      throw new Error("Avatar rotation manifest contains a duplicate legacy object mapping");
    }
    oldKeys.add(entry.oldKey);
    if (!isLegacyIdentityBearingAvatarStorageKey(entry.oldKey)
      || entry.oldPublicUrl !== store.publicUrl(entry.oldKey)) {
      throw new Error("Avatar rotation manifest contains an invalid legacy object mapping");
    }
    if (entry.newKey === null) {
      if (entry.newPublicUrl !== null) {
        throw new Error("Avatar rotation manifest contains a replacement URL without a key");
      }
    } else {
      if (newKeys.has(entry.newKey)) {
        throw new Error("Avatar rotation manifest contains a duplicate replacement object mapping");
      }
      newKeys.add(entry.newKey);
      if (!isOpaqueAvatarStorageKey(entry.newKey)
        || entry.newPublicUrl !== store.publicUrl(entry.newKey)
        || entry.newKey === entry.oldKey) {
        throw new Error("Avatar rotation manifest contains an invalid replacement object mapping");
      }
    }
  }
}

function touchManifest(manifest: AvatarStorageRotationManifest, now: Date): void {
  manifest.updatedAt = now.toISOString();
}

async function requireMatchingObject(
  store: AvatarObjectStore,
  key: string,
  expected: Pick<AvatarObjectMetadata, "byteLength" | "etag" | "contentType">,
): Promise<AvatarObjectMetadata> {
  const object = await store.head(key);
  if (!object) throw new Error("Required avatar object is missing");
  if (!objectsMatch(expected, object)) throw new Error("Avatar object metadata does not match manifest");
  return object;
}

function assertObjectsMatch(
  expected: Pick<AvatarObjectMetadata, "byteLength" | "etag" | "contentType">,
  actual: Pick<AvatarObjectMetadata, "byteLength" | "etag" | "contentType">,
  message: string,
): void {
  if (!objectsMatch(expected, actual)) throw new Error(message);
}

function objectsMatch(
  expected: Pick<AvatarObjectMetadata, "byteLength" | "etag" | "contentType">,
  actual: Pick<AvatarObjectMetadata, "byteLength" | "etag" | "contentType">,
): boolean {
  return expected.byteLength === actual.byteLength
    && expected.etag !== null
    && actual.etag !== null
    && expected.etag === actual.etag
    && expected.contentType === actual.contentType;
}

async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<AvatarObjectMetadata[]> {
  const objects: AvatarObjectMetadata[] = [];
  for await (const response of paginateListObjectsV2({ client }, {
      Bucket: bucket,
      Prefix: prefix,
    })) {
    for (const object of response.Contents ?? []) {
      if (!object.Key || object.Size === undefined) continue;
      objects.push({
        key: object.Key,
        byteLength: object.Size,
        etag: normalizeEtag(object.ETag),
        contentType: null,
      });
    }
  }
  return objects;
}

async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<AvatarObjectMetadata | null> {
  try {
    const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      key,
      byteLength: response.ContentLength ?? 0,
      etag: normalizeEtag(response.ETag),
      contentType: response.ContentType ?? null,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function encodeCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeEtag(value: string | undefined): string | null {
  return value?.replace(/^"|"$/g, "") ?? null;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "$metadata" in error
    ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}
