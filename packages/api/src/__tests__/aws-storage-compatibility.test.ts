import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { objectStorageBucket, objectStorageClientConfig, objectStorageProvider, privateEvidenceReadBucket, publicDeliveryBaseUrl } from "../lib/object-storage-config.js";
import { generateConstrainedPublicUpload, generatePresignedUpload, getStorageBackend, getStorageStatus, normalizeUploadedAvatarUrl, ownedPublicAvatarStorageKey, publicObjectUrlForKey, resolvePublicObjectDeliveryUrl } from "../lib/storage.js";
import { S3PrivateTraceStorageAdapter, getPrivateTraceBucket, getPrivateTraceStorageProvider } from "../services/private-trace-storage.js";
import { assertPrivateContentStoragePointer } from "../services/game-evidence.js";
import { renderDownload, renderUpload } from "../services/render-object-storage.js";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { writePrivateDecisionTrace } from "../services/private-trace-writer.js";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import { listOwnedAgents } from "../services/agent-profile-management.js";
import { getPublicPostgameMedia, type PostgameMediaArtifactMetadata } from "../services/postgame-media.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";

const envKeys = ["HOUSE_OBJECT_STORAGE_PROVIDER", "HOUSE_OBJECT_STORAGE_REGION", "HOUSE_PUBLIC_BUCKET", "HOUSE_DATA_BUCKET", "HOUSE_EVIDENCE_BUCKET", "HOUSE_PUBLIC_BASE_URL", "HOUSE_OBJECT_STORAGE_ACCESS_KEY", "HOUSE_OBJECT_STORAGE_SECRET_KEY", "HOUSE_OBJECT_STORAGE_SESSION_TOKEN", "HOUSE_LEGACY_PRIVATE_BUCKET", "HOUSE_LEGACY_PUBLIC_BASE_URLS", "INFLUENCE_STORAGE_BACKEND", "LINODE_OBJ_BUCKET", "LINODE_OBJ_ENDPOINT", "LINODE_PRIVATE_CONTENT_BUCKET"];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, { HOUSE_OBJECT_STORAGE_PROVIDER: "aws", HOUSE_OBJECT_STORAGE_REGION: "us-west-1",
    HOUSE_PUBLIC_BUCKET: "house-test-public", HOUSE_DATA_BUCKET: "house-test-data", HOUSE_EVIDENCE_BUCKET: "house-test-evidence",
    HOUSE_PUBLIC_BASE_URL: "https://assets.thehouse.game", HOUSE_OBJECT_STORAGE_ACCESS_KEY: "synthetic-access",
    HOUSE_OBJECT_STORAGE_SECRET_KEY: "synthetic-secret", HOUSE_OBJECT_STORAGE_SESSION_TOKEN: "synthetic-session",
    HOUSE_LEGACY_PRIVATE_BUCKET: "influence-transcript-events-stg",
    HOUSE_LEGACY_PUBLIC_BASE_URLS: "https://influence-assets-stg.us-iad-10.linodeobjects.com,https://us-iad-10.linodeobjects.com/influence-assets-stg" });
});
afterEach(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

describe("AWS object storage compatibility", () => {
  test("explicit AWS mode separates buckets and refuses incomplete configuration", () => {
    expect(objectStorageProvider()).toBe("aws_s3");
    expect(objectStorageBucket("public")).toBe("house-test-public");
    expect(objectStorageBucket("data")).toBe("house-test-data");
    expect(getPrivateTraceBucket()).toBe("house-test-evidence");
    expect(getPrivateTraceStorageProvider()).toBe("aws_s3");
    expect(getStorageBackend()).toBe("s3");
    expect(getStorageStatus().missingS3Env).toEqual([]);
    process.env.HOUSE_DATA_BUCKET = "house-test-public";
    expect(() => objectStorageBucket("data")).toThrow("distinct");
    expect(getStorageBackend()).toBe("disabled");
  });

  test("credentials support sessions or SDK role chain without mixing partial keys", () => {
    expect(objectStorageClientConfig("data").credentials).toEqual({ accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret", sessionToken: "synthetic-session" });
    delete process.env.HOUSE_OBJECT_STORAGE_SECRET_KEY;
    expect(() => objectStorageClientConfig("data")).toThrow("Incomplete");
    delete process.env.HOUSE_OBJECT_STORAGE_ACCESS_KEY;
    delete process.env.HOUSE_OBJECT_STORAGE_SESSION_TOKEN;
    expect(objectStorageClientConfig("data").credentials).toBeUndefined();
  });

  test("presigned AWS uploads omit ACL and use the configured signing region", async () => {
    const upload = await generatePresignedUpload("pfp/synthetic image.png", "image/png");
    const signed = new URL(upload.uploadUrl);
    expect(signed.hostname).toBe("house-test-public.s3.us-west-1.amazonaws.com");
    expect(signed.searchParams.get("X-Amz-Credential")).toContain("/us-west-1/s3/aws4_request");
    expect(signed.searchParams.get("X-Amz-Security-Token")).toBe("synthetic-session");
    expect(upload.uploadUrl).not.toContain("public-read");
    expect(upload.publicUrl).toBe("https://assets.thehouse.game/pfp/synthetic%20image.png");
    const constrained = await generateConstrainedPublicUpload({ key: "postgame-media/fixture/video.mp4", contentType: "video/mp4", byteLength: 3, sha256: "a".repeat(64), targetId: "synthetic-target" });
    expect(constrained.uploadHeaders["x-amz-acl"]).toBeUndefined();
    expect(constrained.uploadHeaders["if-none-match"]).toBe("*");
    expect(new URL(constrained.uploadUrl).searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
  });

  test("public legacy URLs resolve only through exact configured bases", () => {
    for (const old of ["https://influence-assets-stg.us-iad-10.linodeobjects.com/pfp/fixture.png", "https://us-iad-10.linodeobjects.com/influence-assets-stg/pfp/fixture.png", "https://assets.thehouse.game/pfp/fixture.png"]) {
      expect(ownedPublicAvatarStorageKey(old)).toBe("pfp/fixture.png");
      expect(normalizeUploadedAvatarUrl(old)).toBe("https://assets.thehouse.game/pfp/fixture.png");
    }
    for (const unrelated of ["https://influence-assets-prd.us-iad-10.linodeobjects.com/pfp/fixture.png", "https://assets.thehouse.game.evil.test/pfp/fixture.png", "https://user:pass@assets.thehouse.game/pfp/fixture.png", "https://assets.thehouse.game/pfp/%2e%2e%2fsecret", "https://us-iad-10.linodeobjects.com/influence-assets-stg-extra/pfp/fixture.png"]) {
      expect(ownedPublicAvatarStorageKey(unrelated)).toBeNull();
    }
    expect(publicObjectUrlForKey("characters/fixture #1.png")).toBe("https://assets.thehouse.game/characters/fixture%20%231.png");
    const external = "https://external.example.test/private?X-Amz-Signature=fixture";
    expect(resolvePublicObjectDeliveryUrl(external)).toBe(external);
    expect(resolvePublicObjectDeliveryUrl(null)).toBeNull();
  });

  test("stable delivery origin cannot contain credentials, a path or insecure protocol", () => {
    for (const value of ["http://assets.thehouse.game", "https://assets.thehouse.game/path", "https://user@assets.thehouse.game"]) {
      process.env.HOUSE_PUBLIC_BASE_URL = value;
      expect(() => publicDeliveryBaseUrl()).toThrow();
    }
  });

  test("private historical bucket aliases preserve keys without exposing other buckets", () => {
    expect(privateEvidenceReadBucket("influence-transcript-events-stg", "content/fixture/trace.json")).toBe("house-test-evidence");
    expect(privateEvidenceReadBucket("house-test-evidence", "content/fixture/trace.json")).toBe("house-test-evidence");
    expect(() => privateEvidenceReadBucket("influence-transcript-events-prd", "content/fixture/trace.json")).toThrow();
    expect(() => privateEvidenceReadBucket("house-test-evidence", "payloads/v1/private")).toThrow();
    expect(() => privateEvidenceReadBucket("house-test-evidence", "content/../private")).toThrow();
    expect(() => assertPrivateContentStoragePointer({ provider: "aws_s3", bucket: "house-test-evidence", key: "content/fixture/trace.json" })).not.toThrow();
    expect(() => assertPrivateContentStoragePointer({ provider: "aws_s3", bucket: "house-test-public", key: "content/fixture/trace.json" })).toThrow();
  });

  test("actual evidence adapter reads a legacy row from the new private bucket", async () => {
    const client = new S3Client({ region: "us-west-1" });
    const send = spyOn(client as unknown as { send: (command: { input: unknown }) => Promise<unknown> }, "send").mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array([1, 2]) }, ContentLength: 2 });
    try {
      const adapter = new S3PrivateTraceStorageAdapter(client);
      const bytes = await adapter.getObject({ bucket: "influence-transcript-events-stg", key: "content/fixture/trace.json" });
      expect(bytes.bodyBytes).toEqual(new Uint8Array([1, 2]));
      expect(send.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "house-test-evidence", Key: "content/fixture/trace.json" });
      await expect(adapter.putObject({ bucket: "influence-transcript-events-stg", key: "content/fixture/trace.json", body: "{}", contentType: "application/json" })).rejects.toThrow("current configured bucket");
    } finally { send.mockRestore(); client.destroy(); }
  });

  test("Studio grants use the data bucket and preserve checksum/conditional headers", async () => {
    const upload = await renderUpload("renders/fixture/recording.webm", 3, "b".repeat(64));
    const download = await renderDownload("renders/fixture/recording.webm");
    expect(new URL(upload.url).hostname).toBe("house-test-data.s3.us-west-1.amazonaws.com");
    expect(new URL(download).hostname).toBe("house-test-data.s3.us-west-1.amazonaws.com");
    expect(upload.headers["If-None-Match"]).toBe("*");
    expect(upload.url).not.toContain("public-read");
  });

  test("visual image fetches use the AWS alias while preserving legacy delivery", async () => {
    const old = "https://influence-assets-stg.us-iad-10.linodeobjects.com/pfp/fixture.png";
    const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response(new Uint8Array([1, 2, 3])), { preconnect: () => {} }));
    try {
      expect(await readVisualProfileImage(old, { name: "Synthetic", personaKey: "" })).toEqual(Buffer.from([1, 2, 3]));
      expect(fetcher.mock.calls[0]?.[0]).toBe("https://assets.thehouse.game/pfp/fixture.png");
      process.env.HOUSE_OBJECT_STORAGE_PROVIDER = "linode";
      process.env.LINODE_OBJ_BUCKET = "influence-assets-stg";
      process.env.LINODE_OBJ_ENDPOINT = "https://us-iad-10.linodeobjects.com";
      await readVisualProfileImage(old, { name: "Synthetic", personaKey: "" });
      expect(fetcher.mock.calls[1]?.[0]).toBe(old);
      await expect(readVisualProfileImage("https://external.example.test/image.png", { name: "Synthetic", personaKey: "" })).rejects.toThrow("application image storage");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { fetcher.mockRestore(); }
  });

  test("AWS evidence writes and historical reads retain canonical manifests and hashes", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const objects = new Map<string, Uint8Array>();
    const client = new S3Client({ region: "us-west-1" });
    const send = spyOn(client as unknown as { send: (command: { input: Record<string, unknown> }) => Promise<unknown> }, "send").mockImplementation(async ({ input }) => {
      expect(input.Bucket).toBe("house-test-evidence");
      const key = String(input.Key);
      if (typeof input.Body === "string") objects.set(key, new TextEncoder().encode(input.Body));
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing synthetic object");
      return { ETag: "synthetic", ContentLength: bytes.length, ContentType: "application/json", Body: { transformToByteArray: async () => bytes } };
    });
    try {
      const adapter = new S3PrivateTraceStorageAdapter(client);
      const result = await writePrivateDecisionTrace(db, { gameId, ownerEpoch, trace: {
        version: 2, gameId, ownerEpoch, action: "vote", actor: { id: "synthetic-actor", name: "Synthetic", role: "player" },
        createdAt: "2026-11-03T00:00:00Z", model: { name: "synthetic" },
        prompt: { messages: [{ role: "user", content: "synthetic private evidence" }] }, response: { raw: { answer: "synthetic" } },
      } }, { storage: adapter });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      const predicate = eq(schema.gameEvidenceManifests.id, result.manifestId);
      const [written] = await db.select().from(schema.gameEvidenceManifests).where(predicate);
      expect(written).toMatchObject({ storageProvider: "aws_s3", storageBucket: "house-test-evidence" });
      const reader = new PrivateTraceReadModel(db, () => adapter);
      const current = await reader.readContent(result.manifestId);
      expect(current.ok).toBe(true);
      // Simulate an already-copied historical locator; the bytes stay in AWS.
      await db.update(schema.gameEvidenceManifests).set({ storageProvider: "linode_object_storage", storageBucket: "influence-transcript-events-stg" }).where(predicate);
      const [historical] = await db.select().from(schema.gameEvidenceManifests).where(predicate);
      expect((await reader.readContent(result.manifestId))).toEqual(current);
      const [afterRead] = await db.select().from(schema.gameEvidenceManifests).where(predicate);
      expect(afterRead).toEqual(historical);
      expect(afterRead?.metadata).toEqual(written?.metadata);
      const denied = await reader.readContent(result.manifestId, { accessor: { roles: [] } });
      expect(denied).toMatchObject({ ok: false, status: "denied" });
    } finally { send.mockRestore(); client.destroy(); }
  });

  test("public read models resolve old URLs without rewriting stored records", async () => {
    const db = await setupTestDB();
    const old = "https://influence-assets-stg.us-iad-10.linodeobjects.com";
    await db.insert(schema.users).values({ id: "storage-fixture-owner" });
    const profile = { id: "storage-fixture-profile", userId: "storage-fixture-owner", name: "Storage Fixture", personality: "Synthetic", avatarUrl: `${old}/pfp/fixture.png`, fullBodyReferenceUrl: `${old}/characters/fixture.png` };
    await db.insert(schema.agentProfiles).values(profile);
    const agents = await listOwnedAgents(db, { userId: profile.userId });
    expect(agents.agents[0]).toMatchObject({ avatarUrl: "https://assets.thehouse.game/pfp/fixture.png", fullBodyReferenceUrl: "https://assets.thehouse.game/characters/fixture.png" });
    const [storedProfile] = await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profile.id));
    expect(storedProfile).toMatchObject(profile);
    const gameId = await insertGame(db, { status: "completed" });
    const artifact = (name: string, contentType: string) => ({ publicUrl: `${old}/postgame-media/fixture/${name}`, objectKey: `postgame-media/fixture/${name}`, contentType, byteLength: 123, sha256: "sha256:" + "a".repeat(64) });
    const artifacts: PostgameMediaArtifactMetadata = {
      preview: { title: "Synthetic", description: "Fixture" },
      video: { ...artifact("video.mp4", "video/mp4"), width: 1920, height: 1080 },
      poster: { ...artifact("poster.png", "image/png"), altText: "Synthetic" },
      captions: { ...artifact("captions.vtt", "text/vtt"), language: "en", label: "English" },
      manifest: artifact("manifest.json", "application/json"), storage: { provider: "s3", bucket: "influence-assets-stg" },
    };
    await db.insert(schema.gamePostgameMedia).values({ gameId, mediaType: "house_highlights_trailer", status: "ready", currentReadyRenderVersion: 1, currentReadyDurationMs: 1000, currentReadyArtifactMetadata: artifacts, currentReadyPublishedAt: "2026-11-03T00:00:00Z" });
    const ready = await getPublicPostgameMedia(db, gameId);
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") throw new Error("Expected fixture media");
    for (const item of [ready.video, ready.poster, ready.captions, ready.manifest]) expect(item.url).toStartWith("https://assets.thehouse.game/postgame-media/fixture/");
    const [storedMedia] = await db.select().from(schema.gamePostgameMedia).where(eq(schema.gamePostgameMedia.gameId, gameId));
    expect(storedMedia?.currentReadyArtifactMetadata).toEqual(artifacts);
  });
});
