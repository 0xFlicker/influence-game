import * as imageStorage from "../services/visual-game-assets.js";
import { storePublicAvatarImage } from "../lib/storage.js";
import { createOpaqueAvatarStorageKey } from "../lib/avatar-storage-keys.js";
import { convertCharacterArt } from "../scripts/convert-character-art.js";
import { readCharacterArtwork } from "../services/character-art.js";
import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { acceptCutout, claimCutout, CUTOUT_RECIPE, enqueueCutout, expireCutoutLeases, reserveCutout, prepareCutoutDemands, savePendingCharacterArt } from "../services/character-cutouts.js";
import { loadPayloads, storeBinary, storeJson } from "../services/payload-storage.js";
import { saveReadyCharacterArt, isSavedCharacterArt } from "../services/character-art-save.js";
import { createVisualRoutes } from "../routes/visual.js";
import { contentSnapshot } from "../services/agent-content-submissions.js";
import { werewolfReferenceMetadata } from "../services/werewolf-production.js";

let db: DrizzleDB, source: Buffer, cutout: Buffer, directory: string;
const saved = { ...process.env };
const keys = ["INFLUENCE_STORAGE_BACKEND", "INFLUENCE_LOCAL_UPLOAD_DIR", "CHARACTER_CUTOUT_MODE", "CUTOUT_API_URL", "INFLUENCE_DEPLOYMENT_ENVIRONMENT"] as const;
beforeEach(async () => {
  db = await setupTestDB();
  directory = await mkdtemp(join(tmpdir(), "character-art-"));
  process.env.INFLUENCE_STORAGE_BACKEND = "local";
  process.env.INFLUENCE_LOCAL_UPLOAD_DIR = directory;
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  process.env.CHARACTER_CUTOUT_MODE = "local";
  process.env.CUTOUT_API_URL = "http://localhost:3018";
  source = await sharp({ create: { width: 8, height: 12, channels: 3, background: "red" } }).png().toBuffer();
  const pixels = Buffer.alloc(8 * 12 * 4, 255); pixels[3] = 0;
  cutout = await sharp(pixels, { raw: { width: 8, height: 12, channels: 4 } }).png().toBuffer();
  await db.insert(schema.games).values({ id: "art-game", slug: "art-game", status: "completed", config: "{}" });
});
afterEach(async () => {
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("sources deduplicate; duplicate workers and stale leases cannot publish", async () => {
  const first = await enqueueCutout(db, source), second = await enqueueCutout(db, source);
  expect(second.id).toBe(first.id);
  const reservation = (await reserveCutout(db, first.id))!;
  expect(await reserveCutout(db, first.id)).toBeNull();
  expect(await claimCutout(db, first.id, "wrong", CUTOUT_RECIPE)).toBeUndefined();
  expect(await claimCutout(db, first.id, reservation.token, "wrong-recipe")).toBeUndefined();
  expect(await claimCutout(db, first.id, reservation.token, CUTOUT_RECIPE)).toBeDefined();
  expect(await claimCutout(db, first.id, reservation.token, CUTOUT_RECIPE)).toBeUndefined();
  await expect(acceptCutout(db, first.id, reservation.token, source)).rejects.toThrow("RGBA PNG");
  const wrongDimensions = await sharp(cutout).resize(4, 6).png().toBuffer();
  await expect(acceptCutout(db, first.id, reservation.token, wrongDimensions)).rejects.toThrow("source dimensions");
  const opaque = await sharp(source).ensureAlpha().png().toBuffer();
  await expect(acceptCutout(db, first.id, reservation.token, opaque)).rejects.toThrow("foreground and transparent background");
  await expireCutoutLeases(db, new Date(Date.now() + 2 * 3600_000));
  expect(await acceptCutout(db, first.id, reservation.token, cutout)).toBe(false);
  const retry = (await reserveCutout(db, first.id))!;
  expect(await claimCutout(db, first.id, reservation.token, CUTOUT_RECIPE)).toBeUndefined();
  await claimCutout(db, first.id, retry.token, CUTOUT_RECIPE);
  expect(await acceptCutout(db, first.id, retry.token, cutout)).toBe(true);
  expect(await acceptCutout(db, first.id, retry.token, cutout)).toBe(false);
});


async function characterFixture() {
  const job = await enqueueCutout(db, source);
  await db.insert(schema.users).values({ id: "owner" });
  await db.insert(schema.agentProfiles).values({ id: "character", userId: "owner", name: "Example", personality: "Patient", fullBodyReferenceUrl: "/old-body.png" });
  const [created] = await db.select().from(schema.agentProfiles);
  const snapshot = { ...contentSnapshot(created!), assets: { "/old-body.png": job.sourceHash } };
  await db.insert(schema.agentContentAssets).values({ hash: job.sourceHash, bytes: await storeBinary(source) });
  await db.insert(schema.agentContentRevisions).values({ id: "revision", agentProfileId: "character", userId: "owner", fingerprint: "before", snapshot: await storeJson(snapshot) });
  await db.update(schema.agentProfiles).set({ contentRevisionId: "revision", latestContentRevisionId: "revision" }).where(eq(schema.agentProfiles.id, "character"));
  await db.insert(schema.gamePlayers).values({ id: "player", gameId: "art-game", agentProfileId: "character", agentConfig: "{}", persona: JSON.stringify({ name: "Example", contentRevisionId: "revision", fullBodyReferenceUrl: "/old-body.png", personality: "Patient" }) });
  await db.insert(schema.visualArtifacts).values({ id: "old-art", gameId: "art-game", contentHash: job.sourceHash, image: await storeBinary(source), width: 8, height: 12 });
  await db.insert(schema.visualGameAssets).values({ gameId: "art-game", profiles: [{ id: "player", name: "Example", personaKey: "", fullBodyReferenceUrl: "/old-body.png", avatarUrl: null, performanceInstructions: "" }],
    cast: [{ id: "player", name: "Example", referenceArtifactId: "old-art", performanceInstructions: "", portraitFallback: false }] });
  await db.insert(schema.characterCutoutDemands).values({ id: "demand", agentProfileId: "character", playerId: "character", sourceKey: `sha256:${job.sourceHash}`, recipe: CUTOUT_RECIPE, cutoutId: job.id });
  return job;
}
async function complete(id: string) {
  const reservation = (await reserveCutout(db, id))!;
  await claimCutout(db, id, reservation.token, CUTOUT_RECIPE);
  expect(await acceptCutout(db, id, reservation.token, cutout)).toBe(true);
}
test("revision-specific transparent artwork serves old and new seats without job records", async () => {
  const job = await characterFixture();
  await complete(job.id);
  const [profile] = await db.select().from(schema.agentProfiles);
  expect(profile!.fullBodyReferenceUrl).toBe("/old-body.png");
  expect(isSavedCharacterArt((await db.select().from(schema.agentContentAssets))[0]!.transparentUrl)).toBe(true);
  const [original] = await db.select().from(schema.gamePlayers);
  expect(JSON.parse(original!.persona).fullBodyReferenceUrl).toBe("/old-body.png");
  await db.insert(schema.gamePlayers).values({ id: "new-player", gameId: "art-game", agentProfileId: "character", persona: JSON.stringify({ name: "Example", contentRevisionId: "revision", fullBodyReferenceUrl: "/old-body.png" }), agentConfig: "{}" });
  await db.delete(schema.characterCutoutDemands); await db.delete(schema.characterCutouts);
  const route = createVisualRoutes(db);
  for (let reload = 0; reload < 2; reload++) {
    const response = await route.request("/api/games/art-game/visual");
    const result = await response.json() as { fullBodies: Record<string, string> };
    expect(result.fullBodies.player).toBe((await db.select().from(schema.agentContentAssets))[0]!.transparentUrl!);
    expect(result.fullBodies["new-player"]).toBe((await db.select().from(schema.agentContentAssets))[0]!.transparentUrl!);
  }
  const [revision] = await loadPayloads(db.select().from(schema.agentContentRevisions));
  expect(revision!.snapshot.fullBodyReferenceUrl).toBe("/old-body.png");
  const refs = await werewolfReferenceMetadata(db, "art-game", [{ id: "player", name: "Example", personality: "Patient", backstory: "", strategy: "", avatarUrl: null, agentProfileId: "character", contentRevisionId: "revision" }]);
  expect(refs[0]!.transparentUrl).toBe((await db.select().from(schema.agentContentAssets))[0]!.transparentUrl!);
});

test("temporary publication failure retries finished bytes without another generation", async () => {
  const job = await characterFixture();
  process.env.INFLUENCE_STORAGE_BACKEND = "disabled";
  await complete(job.id);
  const [finished] = await db.select().from(schema.characterCutouts);
  expect(finished!.status).toBe("ready"); expect(finished!.artSavedAt).toBeNull();
  process.env.INFLUENCE_STORAGE_BACKEND = "local";
  await saveReadyCharacterArt(db, job.id);
  const [saved] = await db.select().from(schema.characterCutouts);
  expect(saved!.image).toEqual(finished!.image);
  expect(saved!.attempts).toBe(finished!.attempts);
  expect(saved!.artSavedAt).not.toBeNull();
});

test("attaching a character after completion reuses the finished image", async () => {
  const job = await characterFixture();
  await db.delete(schema.characterCutoutDemands);
  await complete(job.id);
  await db.insert(schema.characterCutoutDemands).values({ id: "late", agentProfileId: "character", playerId: "character", sourceKey: `sha256:${job.sourceHash}`, recipe: CUTOUT_RECIPE });
  await prepareCutoutDemands(db);
  const [profile] = await db.select().from(schema.agentProfiles);
  expect(profile!.fullBodyReferenceUrl).toBe("/old-body.png");
  expect(isSavedCharacterArt((await db.select().from(schema.agentContentAssets))[0]!.transparentUrl)).toBe(true);
  const [saved] = await db.select().from(schema.characterCutouts);
  expect(saved!.attempts).toBe(1);
});

test("saving one owner ignores malformed unrelated seats and revision payloads", async () => {
  const job = await characterFixture();
  await db.insert(schema.gamePlayers).values({ id: "unrelated", gameId: "art-game", persona: "not json", agentConfig: "{}" });
  await complete(job.id);
  const [profile] = await db.select().from(schema.agentProfiles);
  expect(profile!.fullBodyReferenceUrl).toBe("/old-body.png");
  expect(isSavedCharacterArt((await db.select().from(schema.agentContentAssets))[0]!.transparentUrl)).toBe(true);
});

test("conversion discovers unassociated finished images and is repeatable without generation", async () => {
  const job = await characterFixture();
  await db.delete(schema.characterCutoutDemands);
  await db.update(schema.characterCutouts).set({ status: "ready", image: await storeBinary(cutout), readyAt: new Date() }).where(eq(schema.characterCutouts.id, job.id));
  await convertCharacterArt(db);
  const first = await readCharacterArtwork(db, "art-game");
  expect(isSavedCharacterArt(first[0]!.fullBodyReferenceUrl)).toBe(true);
  await convertCharacterArt(db);
  expect(await readCharacterArtwork(db, "art-game")).toEqual(first);
  expect((await db.select().from(schema.characterCutouts))[0]!.attempts).toBe(0);
});

test.each(["before", "after"] as const)("game creation %s completion needs no artwork propagation", async order => {
  const job = await characterFixture();
  const create = () => db.insert(schema.gamePlayers).values({ id: "concurrent-player", gameId: "art-game", agentProfileId: "character", persona: JSON.stringify({ name: "Example", contentRevisionId: "revision", fullBodyReferenceUrl: "/old-body.png", personality: "Concurrent" }), agentConfig: "{}" });
  if (order === "before") await create();
  await complete(job.id);
  if (order === "after") await create();
  const art = (await readCharacterArtwork(db, "art-game")).find(row => row.id === "concurrent-player");
  expect(isSavedCharacterArt(art!.fullBodyReferenceUrl)).toBe(true);

});

test("public verification and uncaptured source reads finish outside the save transaction", async () => {
  const job = await characterFixture();
  const uploaded = await storePublicAvatarImage(createOpaqueAvatarStorageKey("uploaded", "png"), "image/png", Uint8Array.from(source).buffer);
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: uploaded.publicUrl, contentRevisionId: null }).where(eq(schema.agentProfiles.id, "character"));
  await db.update(schema.characterCutouts).set({ status: "ready", image: await storeBinary(cutout), readyAt: new Date() }).where(eq(schema.characterCutouts.id, job.id));
  let inTransaction = false;
  const original = imageStorage.readVisualProfileImage;
  const reads = spyOn(imageStorage, "readVisualProfileImage").mockImplementation(async (...args) => {
    expect(inTransaction).toBe(false); return original(...args);
  });
  const observed = new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return (callback: (tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0]) => Promise<unknown>) => target.transaction(async tx => {
      inTransaction = true;
      try { return await callback(tx); } finally { inTransaction = false; }
    });
  } });
  try {
    await saveReadyCharacterArt(observed, job.id);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(isSavedCharacterArt((await readCharacterArtwork(db, "art-game"))[0]!.fullBodyReferenceUrl)).toBe(true);
  } finally { reads.mockRestore(); }
});

test("disabled generation still reuses a ready image and never creates a new job", async () => {
  const job = await characterFixture();
  await db.update(schema.characterCutoutDemands).set({ cutoutId: null });
  await db.update(schema.characterCutouts).set({ status: "ready", image: await storeBinary(cutout), readyAt: new Date() }).where(eq(schema.characterCutouts.id, job.id));
  process.env.CHARACTER_CUTOUT_MODE = "disabled";
  await db.insert(schema.characterCutoutDemands).values(Array.from({ length: 16 }, (_, index) => ({
    id: `disabled-${index}`, agentProfileId: "character", playerId: "character",
    sourceKey: `sha256:${(index + 1).toString(16).padStart(64, "0")}`, recipe: CUTOUT_RECIPE,
    createdAt: new Date(1000 + index),
  })));
  await prepareCutoutDemands(db);
  await prepareCutoutDemands(db);
  expect(isSavedCharacterArt((await readCharacterArtwork(db, "art-game"))[0]!.fullBodyReferenceUrl)).toBe(true);
  await db.insert(schema.characterCutoutDemands).values({ id: "no-generation", agentProfileId: "character", playerId: "character", sourceKey: `sha256:${"f".repeat(64)}`, recipe: CUTOUT_RECIPE });
  await prepareCutoutDemands(db);
  expect(await db.select().from(schema.characterCutouts)).toHaveLength(1);
  expect((await db.select().from(schema.characterCutouts))[0]!.attempts).toBe(0);
});

test("finished save retries do not starve behind sixteen persistently failing images", async () => {
  const valid = await characterFixture();
  const image = await storeBinary(cutout);
  const badImage = { ...image, sha256: "0".repeat(64), key: "payloads/v1/binary/" + "0".repeat(64) };
  await db.insert(schema.characterCutouts).values(Array.from({ length: 16 }, (_, index) => ({
    id: `failed-save-${index}`, sourceHash: String(index).padStart(64, "0"), recipe: CUTOUT_RECIPE,
    source: image, image: badImage, width: 8, height: 12, status: "ready" as const,
    readyAt: new Date(1000 + index), attempts: 1,
  })));
  await db.update(schema.characterCutouts).set({ status: "ready", image, readyAt: new Date(2000), attempts: 1 }).where(eq(schema.characterCutouts.id, valid.id));
  for (let tick = 0; tick < 3; tick++) await savePendingCharacterArt(db);
  const rows = await db.select().from(schema.characterCutouts);
  expect(rows.find(row => row.id === valid.id)!.artSavedAt).not.toBeNull();
  expect(isSavedCharacterArt((await db.select().from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, valid.sourceHash)))[0]!.transparentUrl)).toBe(true);
  const failed = rows.filter(row => row.id !== valid.id);
  expect(failed).toHaveLength(16);
  expect(failed.every(row => row.status === "ready" && row.artSavedAt === null && row.saveError)).toBe(true);
  expect(rows.every(row => row.attempts === 1)).toBe(true);
  await db.update(schema.characterCutouts).set({ image }).where(eq(schema.characterCutouts.id, failed[0]!.id));
  for (let tick = 0; tick < 2; tick++) await savePendingCharacterArt(db);
  expect((await db.select().from(schema.characterCutouts).where(eq(schema.characterCutouts.id, failed[0]!.id)))[0]!.artSavedAt).not.toBeNull();
});
