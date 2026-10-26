import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createOpaqueAvatarStorageKey } from "../lib/avatar-storage-keys.js";
import { storePublicAvatarImage } from "../lib/storage.js";
import { exportCharacterPortrait } from "../services/visual-profile-generation.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { admitOwnedSeatInTransaction } from "../services/owned-seat-projection.js";
import { freezeWaitingRosterInTransaction } from "../services/roster-freeze.js";
import { createWerewolfLobby, fillWerewolfLobby, joinWerewolfLobby, startWerewolfLobby } from "../services/werewolf-lobbies.js";
import { readWerewolfEvents } from "../services/werewolf-games.js";
import { readWerewolfCharacter, readWerewolfWatch } from "../services/werewolf-presentation.js";
import { buildWerewolfProductionSourceSnapshot } from "../services/werewolf-production-source.js";
import { readEpisodePresentations } from "../services/episode-presentation.js";
import { createVisualRoutes } from "../routes/visual.js";
import { loadPayloads, payloadHash } from "../services/payload-storage.js";

let db: DrizzleDB, directory: string;
const saved = { ...process.env };
const context = { userId: "art-owner", publicBaseUrl: "http://localhost" };
beforeEach(async () => {
  db = await setupTestDB();
  directory = await mkdtemp(join(tmpdir(), "profile-art-"));
  process.env.INFLUENCE_LOCAL_UPLOAD_DIR = directory;
  process.env.INFLUENCE_STORAGE_BACKEND = "local";
  process.env.CHARACTER_CUTOUT_MODE = "disabled";
  await db.insert(schema.users).values({ id: context.userId });
});
afterEach(async () => {
  for (const key of ["INFLUENCE_LOCAL_UPLOAD_DIR", "INFLUENCE_STORAGE_BACKEND", "CHARACTER_CUTOUT_MODE"]) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  await rm(directory, { recursive: true, force: true });
});

async function upload(bytes: Buffer, crop: { x: number; y: number; width: number; height: number }, head: typeof crop) {
  const stored = await storePublicAvatarImage(createOpaqueAvatarStorageKey("uploaded", "png"), "image/png", new Uint8Array(bytes).buffer, context.publicBaseUrl);
  return { fullBodyReferenceUrl: stored.publicUrl, ...await exportCharacterPortrait({ sourceUrl: stored.publicUrl, x: crop.x, y: crop.y, width: crop.width, height: crop.height }, context.publicBaseUrl, head) };
}

async function games(agentProfileId: string) {
  const id = crypto.randomUUID();
  await db.insert(schema.games).values({ id, slug: id, status: "waiting", minPlayers: 1, maxPlayers: 6, config: JSON.stringify({ providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] }) });
  await db.transaction(tx => admitOwnedSeatInTransaction(tx, { gameId: id, userId: context.userId, agentProfileId }));
  const frozen = await db.transaction(tx => freezeWaitingRosterInTransaction(tx, { gameId: id, frozenAt: new Date().toISOString() }));
  await db.update(schema.games).set({ status: "in_progress", startedAt: new Date().toISOString() }).where(eq(schema.games.id, id));
  const wolf = await createWerewolfLobby(db, context.userId, { preset: "one_wolf" });
  const seat = await joinWerewolfLobby(db, wolf.id, context.userId, agentProfileId);
  await fillWerewolfLobby(db, wolf.id);
  await startWerewolfLobby(db, wolf.id);
  return { influence: id, persona: JSON.parse(frozen.seats[0]!.persona), wolf: wolf.id, player: seat.playerId };
}

test("ordinary profile publication freezes approved source, portrait and head in new games without changing old games", async () => {
  const original = await sharp({ create: { width: 100, height: 150, channels: 3, background: "blue" } }).png().toBuffer();
  const firstArt = await upload(original, { x: 0, y: 0, width: 1, height: 2 / 3 }, { x: .4, y: .1, width: .2, height: .2 });
  const first = await createOwnedAgentProfile(db, context, { name: "Approved character", personality: "Observant", personaKey: "observer", ...firstArt });
  const old = await games(first.profile.id);
  const oldEvents = await readWerewolfEvents(db, old.wolf);
  const oldSource = await db.transaction(tx => buildWerewolfProductionSourceSnapshot(tx, old.wolf, { audience: "mystery", thinking: false }, true));

  // Exercise the exact approved source and review geometry, using ordinary uploads.
  const bundle = new URL("../../../../docs/research/2026-10-25-gemini-no-crest/published-assets/", import.meta.url);
  const approved = await readFile(new URL("full-body.png", bundle));
  const manifest = JSON.parse(await readFile(new URL("manifest.json", bundle), "utf8"));
  const replacement = await upload(approved, manifest.portraitCrop, manifest.headPosition.rect);
  const updated = await updateOwnedAgentProfile(db, context, first.profile.id, { ...replacement, submissionId: crypto.randomUUID(), expectedContentRevisionId: first.profile.contentRevisionId });
  const fresh = await games(first.profile.id);
  expect(fresh.persona.fullBodyReferenceUrl).toBe(replacement.fullBodyReferenceUrl);
  expect(fresh.persona.avatarUrl).toBe(replacement.avatarUrl);
  expect(fresh.persona.headPosition.sourceHash).toBe(payloadHash(approved));
  expect(fresh.persona.headPosition.confirmation.userId).toBe(context.userId);
  const [revision] = await loadPayloads(db.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, updated.profile.contentRevisionId!)));
  expect(revision!.snapshot.assets).toMatchObject({ [replacement.fullBodyReferenceUrl]: manifest.assets["full-body.png"].sha256, [replacement.avatarUrl]: manifest.assets["portrait.webp"].sha256 });

  const visual = await (await createVisualRoutes(db).request(`/api/games/${fresh.influence}/visual`)).json() as { fullBodies: Record<string, string>; fullBodyHeads: Record<string, unknown> };
  expect(visual.fullBodies).toContainValue(replacement.fullBodyReferenceUrl);
  expect(visual.fullBodyHeads).toContainValue(manifest.headPosition.rect);
  const watch = await readWerewolfWatch(db, fresh.wolf, "mystery", 1, 64);
  expect(watch.players.find(player => player.id === fresh.player)?.headRectangle).toEqual(manifest.headPosition.rect);
  expect(watch.moments.length).toBeGreaterThan(0);
  expect(watch.moments.every(moment => moment.snapshot.players.find(player => player.id === fresh.player)?.headRectangle?.x === manifest.headPosition.rect.x)).toBe(true);
  expect(await readWerewolfCharacter(db, fresh.wolf, fresh.player, "body")).toEqual(approved);
  const exportSource = await db.transaction(tx => buildWerewolfProductionSourceSnapshot(tx, fresh.wolf, { audience: "mystery", thinking: false }, true));
  expect(exportSource.window.players.find(player => player.id === fresh.player)?.headRectangle).toEqual(manifest.headPosition.rect);

  const [oldGame] = await db.select().from(schema.games).where(eq(schema.games.id, old.influence));
  const episode = (await readEpisodePresentations(db, [oldGame!])).get(old.influence)!;
  expect(episode.cast[0]!.avatarUrl).toBe(firstArt.avatarUrl);
  expect(await readWerewolfEvents(db, old.wolf)).toEqual(oldEvents);
  expect(await readWerewolfCharacter(db, old.wolf, old.player, "body")).toEqual(original);
  const oldVisual = await (await createVisualRoutes(db).request(`/api/games/${old.influence}/visual`)).json() as { fullBodies: Record<string, string> };
  expect(oldVisual.fullBodies).toContainValue(firstArt.fullBodyReferenceUrl);
  const reread = await db.transaction(tx => buildWerewolfProductionSourceSnapshot(tx, old.wolf, { audience: "mystery", thinking: false, snapshot: oldSource.snapshot }, true));
  expect(reread.snapshot).toEqual(oldSource.snapshot);
  expect(reread.window).toEqual(oldSource.window);
});
