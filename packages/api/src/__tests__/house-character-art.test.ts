import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { HOUSE_BODY_ART, bundledHouseBody, houseFullBodyUrl } from "@influence/engine/house-character-art";
import { startWerewolf, werewolfConfig } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createWerewolfHousePlayers } from "../services/werewolf-games.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import { freezeWerewolfReferences, werewolfReferenceMetadata } from "../services/werewolf-production.js";
import { readWerewolfCharacter, readWerewolfWatch } from "../services/werewolf-presentation.js";
import { payloadHash, readPayload } from "../services/payload-storage.js";
import { createVisualRoutes } from "../routes/visual.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";

let db: DrizzleDB, directory: string | undefined;
const envKeys = ["INFLUENCE_PERSONA_ASSET_DIR", "CHARACTER_CUTOUT_MODE", "CUTOUT_API_URL", "INFLUENCE_DEPLOYMENT_ENVIRONMENT"] as const;
let saved: Record<string, string | undefined>;
beforeEach(async () => { saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]])); db = await setupTestDB(); delete process.env.INFLUENCE_PERSONA_ASSET_DIR; });
afterEach(async () => {
  for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  if (directory) { await rm(directory, { recursive: true, force: true }); directory = undefined; }
});

test("bundled full-bodies decode as genuine transparent references and reject changed bytes", async () => {
  for (const [key, art] of Object.entries(HOUSE_BODY_ART)) {
    const bytes = await readVisualProfileImage(art.url, { name: key, personaKey: key });
    expect(payloadHash(bytes)).toBe(art.sha256);
    const image = sharp(bytes), meta = await image.metadata(), alpha = await image.extractChannel("alpha").raw().toBuffer();
    expect(meta.hasAlpha).toBe(true); expect(meta.channels).toBe(4);
    expect(alpha.some(value => value === 0)).toBe(true); expect(alpha.some(value => value >= 250)).toBe(true);
  }
  directory = await mkdtemp(join(tmpdir(), "house-art-integrity-"));
  await mkdir(join(directory, "full-body-v1"));
  await writeFile(join(directory, "full-body-v1/strategic.webp"), await readVisualProfileImage(HOUSE_BODY_ART.honest.url, { name: "Finn", personaKey: "honest" }));
  process.env.INFLUENCE_PERSONA_ASSET_DIR = directory;
  await expect(readVisualProfileImage(HOUSE_BODY_ART.strategic.url, { name: "Atlas", personaKey: "strategic" })).rejects.toThrow("integrity mismatch");
});

async function village(id: string, historical = false) {
  const cast = createWerewolfHousePlayers([], 6);
  const players = historical ? cast.map(({ fullBodyReferenceUrl: _body, ...player }) => player) : cast;
  const event = startWerewolf(id, players, werewolfConfig("one_wolf"), "house-art");
  await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "in_progress", startedAt: new Date().toISOString(), config: "{}" });
  await db.insert(schema.werewolfEvents).values({ gameId: id, sequence: event.sequence, event });
  return players;
}

test("new Werewolf casts use frozen bundled bodies through playback and visual preparation without cutout jobs", async () => {
  const gameId = "house-art-new", cast = await village(gameId);
  process.env.CHARACTER_CUTOUT_MODE = "local"; process.env.CUTOUT_API_URL = "http://127.0.0.1:3000"; delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  const refs = await werewolfReferenceMetadata(db, gameId);
  for (const ref of refs) {
    expect(ref.kind).toBe("full_body"); expect(ref.bundled).toBe(true);
    const bytes = await readWerewolfCharacter(db, gameId, ref.profile.id, "body");
    expect(payloadHash(bytes!)).toBe(ref.bodyHash!);
  }
  const watch = await readWerewolfWatch(db, gameId, "mystery", 1, 64);
  expect(watch.players.every(player => player.fullBodyReferenceUrl?.includes("image=body"))).toBe(true);
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
  const prepared = await freezeWerewolfReferences(db, gameId, cast);
  for (const member of prepared.cast) {
    expect(member.portraitFallback).toBe(false);
    const [artifact] = await db.select().from(schema.visualArtifacts).where(eq(schema.visualArtifacts.id, member.referenceArtifactId));
    const ref = refs.find(ref => ref.profile.id === member.id)!;
    const original = await readVisualProfileImage(ref.profile.fullBodyReferenceUrl, ref.profile);
    const stored = await readPayload(artifact!.image);
    expect((await sharp(stored).ensureAlpha().raw().toBuffer()).equals(await sharp(original).ensureAlpha().raw().toBuffer())).toBe(true);
  }
  // Replay/export pins contain the bundled hash; excluding it cannot advertise a body.
  const excluded = await werewolfReferenceMetadata(db, gameId, undefined, { availableHashes: [] });
  expect(excluded.every(ref => ref.kind === "portrait" && ref.bodyHash === null)).toBe(true);
});

test("historical Werewolf rosters never acquire new bundled full-bodies on reads", async () => {
  const gameId = "house-art-historical", cast = await village(gameId, true);
  const refs = await werewolfReferenceMetadata(db, gameId);
  expect(refs.every(ref => ref.kind === "portrait" && ref.bodyHash === null)).toBe(true);
  expect(await readWerewolfCharacter(db, gameId, cast[0]!.id, "body")).toBeNull();
  expect((await freezeWerewolfReferences(db, gameId, cast)).cast.every(member => member.portraitFallback)).toBe(true);
});

test("Influence playback exposes bundled bodies and does not requeue background removal after artifact preparation", async () => {
  const gameId = "house-art-influence", playerId = "atlas-seat", fullBodyReferenceUrl = houseFullBodyUrl("Atlas", "strategic");
  await db.insert(schema.games).values({ id: gameId, slug: gameId, status: "in_progress", startedAt: new Date().toISOString(), config: "{}" });
  await db.insert(schema.gamePlayers).values({ id: playerId, gameId, persona: JSON.stringify({ name: "Atlas", personaKey: "strategic", gender: "male", fullBodyReferenceUrl }), agentConfig: "{}" });
  const profile = { id: playerId, name: "Atlas", personaKey: "strategic", avatarUrl: null, fullBodyReferenceUrl, performanceInstructions: "" };
  const artifact = await storeVisualArtifact(db, gameId, await readVisualProfileImage(fullBodyReferenceUrl, profile));
  await db.insert(schema.visualGameAssets).values({ gameId, profiles: [profile], status: "ready", cast: [{ id: playerId, name: "Atlas", referenceArtifactId: artifact, portraitFallback: false, performanceInstructions: "" }] });
  process.env.CHARACTER_CUTOUT_MODE = "local"; process.env.CUTOUT_API_URL = "http://127.0.0.1:3000"; delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  const response = await createVisualRoutes(db).request(`/api/games/${gameId}/visual`);
  expect(response.status).toBe(200);
  const visual = await response.json() as { fullBodies: Record<string, string> };
  expect(visual.fullBodies[playerId]).toBe(`/api/games/${gameId}/visual/artifacts/${artifact}`);
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
  expect(bundledHouseBody(fullBodyReferenceUrl)).not.toBeNull();
});
