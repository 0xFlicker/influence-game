import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  hashHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "@influence/engine";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  isOpaqueAvatarStorageKey,
  opaqueReplacementAvatarStorageKey,
} from "../lib/avatar-storage-keys.js";
import {
  copyAvatarStorageRotations,
  deleteRepointedAvatarStorageObjects,
  inventoryAvatarStorageRotations,
  repointAvatarStorageRotations,
  verifyAvatarStorageRotation,
  type AvatarObjectMetadata,
  type AvatarObjectStore,
} from "../services/avatar-storage-rotation.js";
import { setupTestDB } from "./test-utils.js";

const USER_ID = "did:privy:must-stay-private";
const OLD_KEY = `pfp/${USER_ID}/11111111-1111-4111-8111-111111111111.png`;
const ORPHAN_KEY = "pfp/did:privy:orphan/22222222-2222-4222-8222-222222222222.png";
const BUCKET = "avatar-rotation-test";
const ENDPOINT_HOST = "objects.example.test";
const OLD_URL = `https://${BUCKET}.${ENDPOINT_HOST}/${OLD_KEY}`;
const OLD_SIGNED_URL = `https://${ENDPOINT_HOST}/${BUCKET}/${OLD_KEY.replaceAll(":", "%3A")}?X-Amz-Signature=secret`;
const MISSING_KEY = "pfp/did:privy:missing/77777777-7777-4777-8777-777777777777.png";
const MISSING_URL = `https://${BUCKET}.${ENDPOINT_HOST}/${MISSING_KEY}`;

const STORAGE_ENV_KEYS = ["LINODE_OBJ_ENDPOINT", "LINODE_OBJ_BUCKET"] as const;

describe("private avatar storage rotation", () => {
  let db: DrizzleDB;
  let store: FakeAvatarObjectStore;
  let savedEnv: Record<(typeof STORAGE_ENV_KEYS)[number], string | undefined>;

  beforeEach(async () => {
    savedEnv = Object.fromEntries(
      STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]),
    ) as Record<(typeof STORAGE_ENV_KEYS)[number], string | undefined>;
    process.env.LINODE_OBJ_ENDPOINT = `https://${ENDPOINT_HOST}`;
    process.env.LINODE_OBJ_BUCKET = BUCKET;
    db = await setupTestDB();
    store = new FakeAvatarObjectStore();
    store.put(OLD_KEY, 3, "old-etag", "image/png");
    store.put(ORPHAN_KEY, 4, "orphan-etag", "image/png");
    store.put("pfp/33333333-3333-4333-8333-333333333333.png", 5, "opaque-etag", "image/png");
    store.put(
      "pfp/generated/55555555-5555-4555-8555-555555555555.png",
      6,
      "opaque-generated-etag",
      "image/png",
    );

    await db.insert(schema.users).values({
      id: USER_ID,
      email: "avatar-rotation@example.test",
      displayName: "Avatar Rotation",
    });
    await db.insert(schema.agentProfiles).values({
      id: "rotation-agent",
      userId: USER_ID,
      name: "Rotation Agent",
      personality: "Patient",
      avatarUrl: OLD_URL,
    });
    await db.insert(schema.avatarGenerationRequests).values({
      id: "rotation-generation",
      userId: USER_ID,
      agentProfileId: "rotation-agent",
      purpose: "agent_profile_completion",
      status: "completed",
      triggerSource: "web_user_prompt",
      safeMetadata: { storageKey: OLD_KEY, avatarUrl: OLD_URL },
    });
    await db.insert(schema.avatarChangeEvents).values({
      id: "rotation-change",
      userId: USER_ID,
      agentProfileId: "rotation-agent",
      generationRequestId: "rotation-generation",
      source: "web_generated_completion",
      status: "completed",
      previousAvatarUrl: OLD_URL,
      newAvatarUrl: OLD_URL,
      safeMetadata: {
        storageKey: OLD_KEY,
        nested: { avatarUrl: OLD_URL },
        signedUploadUrl: OLD_SIGNED_URL,
      },
    });
    await db.insert(schema.games).values({
      id: "rotation-game",
      slug: "rotation-game",
      config: "{}",
      status: "completed",
    });
    const snapshot = manifestFixture();
    await db.insert(schema.gamePostgameMedia).values({
      gameId: "rotation-game",
      mediaType: "house_highlights_trailer",
      status: "queued",
      renderVersion: 1,
      artifactVersion: "rv_rotation",
      attemptNumber: 1,
      renderInputSnapshot: snapshot,
      renderInputSnapshotHash: hashHouseHighlightsTrailerManifest(snapshot),
      renderInputSnapshotVersion: 1,
      rendererVersion: "test-renderer",
      timingContractVersion: "test-v1",
      musicAssetId: "test-music",
    });
  });

  afterEach(() => {
    for (const key of STORAGE_ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("copies, repoints, verifies, and deletes every identity-bearing object", async () => {
    expect(opaqueReplacementAvatarStorageKey(
      "pfp/did:privy:uppercase/44444444-4444-4444-8444-444444444444.PNG",
    )).toMatch(/^pfp\/[0-9a-f-]+\.png$/);

    const checkpoints: string[] = [];
    const manifest = await inventoryAvatarStorageRotations(db, store, new Date("2026-08-04T00:00:00.000Z"));
    const referenced = manifest.entries.find(({ oldKey }) => oldKey === OLD_KEY)!;
    const orphan = manifest.entries.find(({ oldKey }) => oldKey === ORPHAN_KEY)!;

    expect(manifest.entries).toHaveLength(2);
    expect(referenced.initialReferences).toMatchObject({
      agentProfiles: 1,
      avatarGenerationRequests: 2,
      avatarChangeEvents: 5,
      postgameMediaSnapshots: 6,
      total: 14,
    });
    expect(referenced.newKey).not.toBeNull();
    expect(isOpaqueAvatarStorageKey(referenced.newKey!)).toBe(true);
    expect(referenced.newKey).not.toContain("must-stay-private");
    expect(orphan.initialReferences.total).toBe(0);
    expect(orphan.newKey).toBeNull();

    await copyAvatarStorageRotations(manifest, store, async () => {
      checkpoints.push("copy");
    });
    expect(await store.head(referenced.newKey!)).toMatchObject({
      byteLength: 3,
      etag: "old-etag",
    });

    await repointAvatarStorageRotations(db, manifest, store, async () => {
      checkpoints.push("repoint");
    });
    const [profile] = await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, "rotation-agent"));
    const [generation] = await db.select().from(schema.avatarGenerationRequests);
    const [change] = await db.select().from(schema.avatarChangeEvents);
    const [media] = await db.select().from(schema.gamePostgameMedia);
    expect(profile!.avatarUrl).toBe(referenced.newPublicUrl);
    expect(generation!.safeMetadata).toEqual({
      storageKey: referenced.newKey,
      avatarUrl: referenced.newPublicUrl,
    });
    expect(change).toMatchObject({
      previousAvatarUrl: referenced.newPublicUrl,
      newAvatarUrl: referenced.newPublicUrl,
      safeMetadata: {
        storageKey: referenced.newKey,
        nested: { avatarUrl: referenced.newPublicUrl },
        signedUploadUrl: referenced.newPublicUrl,
      },
    });
    const repointedSnapshot = media!.renderInputSnapshot as HouseHighlightsTrailerManifest;
    expect(repointedSnapshot.cast[0]?.avatarUrl).toBe(referenced.newPublicUrl!);
    expect(JSON.stringify(repointedSnapshot)).not.toContain(OLD_KEY);
    expect(JSON.stringify(repointedSnapshot)).not.toContain(OLD_URL);
    expect(media!.renderInputSnapshotHash).toBe(
      hashHouseHighlightsTrailerManifest(repointedSnapshot),
    );

    const beforeDelete = await verifyAvatarStorageRotation(db, manifest, store);
    expect(beforeDelete).toMatchObject({
      ok: true,
      legacyObjectsRemaining: 2,
      oldReferencesRemaining: 0,
      missingReplacementObjects: 0,
    });

    store.remove(referenced.newKey!);
    expect(await verifyAvatarStorageRotation(db, manifest, store)).toMatchObject({
      ok: false,
      missingReplacementObjects: 1,
      mismatchedReplacementObjects: 0,
    });
    await expect(deleteRepointedAvatarStorageObjects(db, manifest, store))
      .rejects.toThrow("Required avatar object is missing");

    store.put(referenced.newKey!, 3, null, "image/png");
    expect(await verifyAvatarStorageRotation(db, manifest, store)).toMatchObject({
      ok: false,
      missingReplacementObjects: 0,
      mismatchedReplacementObjects: 1,
    });
    await expect(deleteRepointedAvatarStorageObjects(db, manifest, store))
      .rejects.toThrow("Avatar object metadata does not match manifest");
    store.put(referenced.newKey!, 3, "old-etag", "image/png");

    store.put(
      "pfp/did:privy:late/44444444-4444-4444-8444-444444444444.png",
      1,
      "late-etag",
      "image/png",
    );
    await expect(deleteRepointedAvatarStorageObjects(db, manifest, store))
      .rejects.toThrow("untracked legacy avatar objects");
    expect(await store.head(OLD_KEY)).not.toBeNull();
    store.remove("pfp/did:privy:late/44444444-4444-4444-8444-444444444444.png");

    await deleteRepointedAvatarStorageObjects(db, manifest, store, async () => {
      checkpoints.push("delete");
    });
    const afterDelete = await verifyAvatarStorageRotation(db, manifest, store);
    expect(afterDelete).toEqual({
      ok: true,
      legacyObjectsRemaining: 0,
      untrackedLegacyObjects: 0,
      oldReferencesRemaining: 0,
      missingReplacementObjects: 0,
      mismatchedReplacementObjects: 0,
      errors: [],
    });
    expect(checkpoints).toEqual(["copy", "repoint", "repoint", "delete", "delete"]);
  });

  test("fails closed when the database references a legacy key missing from storage", async () => {
    const manifest = await inventoryAvatarStorageRotations(db, store);
    await copyAvatarStorageRotations(manifest, store);
    await repointAvatarStorageRotations(db, manifest, store);
    await db.update(schema.agentProfiles)
      .set({ avatarUrl: MISSING_URL })
      .where(eq(schema.agentProfiles.id, "rotation-agent"));

    await expect(repointAvatarStorageRotations(db, manifest, store))
      .rejects.toThrow(`not represented in the manifest: ${MISSING_KEY}`);
    expect(await verifyAvatarStorageRotation(db, manifest, store)).toMatchObject({
      ok: false,
      oldReferencesRemaining: 1,
    });
    await expect(deleteRepointedAvatarStorageObjects(db, manifest, store))
      .rejects.toThrow("legacy avatar references remain");
    await expect(inventoryAvatarStorageRotations(db, store))
      .rejects.toThrow(`missing during inventory: ${MISSING_KEY}`);
  });

  test("rejects legacy source objects without a comparable ETag", async () => {
    store.put(OLD_KEY, 3, null, "image/png");

    await expect(inventoryAvatarStorageRotations(db, store))
      .rejects.toThrow("legacy avatar object has no comparable ETag");
  });
});

function manifestFixture(): HouseHighlightsTrailerManifest {
  const winner = {
    id: "winner",
    name: "Mira Solari",
    initials: "MS",
    avatarUrl: OLD_URL,
    placement: 1,
    status: "winner" as const,
  };
  const runnerUp = {
    id: "runner-up",
    name: "Orion Vale",
    initials: "OV",
    avatarUrl: "https://media.example.test/orion.png",
    placement: 2,
    status: "finalist" as const,
  };
  return {
    schemaVersion: 1,
    mediaType: "house_highlights_trailer",
    timingContractVersion: "house-highlights-trailer-timing-v1",
    game: { id: "rotation-game", slug: "rotation-game", status: "completed" },
    frameRate: 30,
    width: 1920,
    height: 1080,
    cast: [winner, runnerUp],
    scenelets: [],
    finalVote: {
      finalists: [winner, runnerUp],
      groups: [
        { finalist: winner, votes: 4, jurors: [runnerUp] },
        { finalist: runnerUp, votes: 3, jurors: [winner] },
      ],
      voteLabel: "4-3",
      winner,
    },
    playerResults: [{ agent: winner, placementLabel: "Winner", tags: [] }],
    cueSheet: {
      schemaVersion: 1,
      timingContractVersion: "house-highlights-trailer-timing-v1",
      frameRate: 30,
      totalFrames: 474,
      totalDurationSeconds: 15.8,
      segments: [],
      markers: { finalVoteRevealSeconds: 5, winnerRevealSeconds: 10 },
    },
  };
}

class FakeAvatarObjectStore implements AvatarObjectStore {
  readonly bucket = BUCKET;
  readonly endpointHost = ENDPOINT_HOST;
  private readonly objects = new Map<string, AvatarObjectMetadata>();

  put(key: string, byteLength: number, etag: string | null, contentType: string): void {
    this.objects.set(key, { key, byteLength, etag, contentType });
  }

  remove(key: string): void {
    this.objects.delete(key);
  }

  async list(prefix: string): Promise<AvatarObjectMetadata[]> {
    return [...this.objects.values()].filter(({ key }) => key.startsWith(prefix));
  }

  async head(key: string): Promise<AvatarObjectMetadata | null> {
    return this.objects.get(key) ?? null;
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const source = this.objects.get(sourceKey);
    if (!source) throw new Error("missing fake source");
    this.objects.set(destinationKey, { ...source, key: destinationKey });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  publicUrl(key: string): string {
    return `https://${this.bucket}.${this.endpointHost}/${key}`;
  }
}
