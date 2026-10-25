import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createSessionToken } from "../middleware/auth.js";
import { localCharacterArt, readLocalCharacterArt } from "../services/local-character-art.js";
import { createLocalCharacterArtRoutes } from "../routes/local-character-art.js";
import { createVisualRoutes } from "../routes/visual.js";
import { readWerewolfWatch } from "../services/werewolf-presentation.js";
import { readWerewolfProductionCharacter, readWerewolfProductionSource } from "../services/werewolf-production-source.js";
import { readInfluenceProductionSource } from "../services/influence-production-source.js";
import { appendGameEvents } from "../services/game-events.js";
import { createResolvedRoundCanonicalEventFixture, insertGame, insertOwner, withJuryWinner, withRetrospective, insertRetrospectiveTranscriptFixture } from "./durable-run-test-utils.js";

let db: DrizzleDB, directory: string, image: Buffer;
const saved = { ...process.env };
const keys = ["DATABASE_URL", "NODE_ENV", "INFLUENCE_DEPLOYMENT_ENVIRONMENT", "INFLUENCE_LOCAL_CHARACTER_ART_MANIFEST", "CHARACTER_CUTOUT_MODE", "JWT_SECRET"];
beforeEach(async () => {
  db = await setupTestDB();
  directory = await mkdtemp(join(tmpdir(), "character-art-"));
  process.env.DATABASE_URL = "postgres://localhost:54320/local-art-test";
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "local-character-art-test-only";
  process.env.CHARACTER_CUTOUT_MODE = "disabled";
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  delete process.env.INFLUENCE_LOCAL_CHARACTER_ART_MANIFEST;
  image = await sharp({ create: { width: 16, height: 24, channels: 4, background: "red" } }).png().toBuffer();
  await writeFile(join(directory, "art.png"), image);
});
afterEach(async () => {
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  await rm(directory, { recursive: true, force: true });
});
async function publish(gameId: string, playerId: string, publishedAt = new Date().toISOString()) {
  const asset = { path: join(directory, "art.png"), sha256: createHash("sha256").update(image).digest("hex") };
  const entry = { gameId, playerId, publishedAt, head: { x: .4, y: .02, width: .2, height: .2 }, assets: { body: asset, cutout: asset, portrait: asset } };
  const path = join(directory, "manifest.json");
  await writeFile(path, JSON.stringify({ version: 1, entries: [entry] }));
  process.env.INFLUENCE_LOCAL_CHARACTER_ART_MANIFEST = path;
  return entry;
}

test("local-only gate, exact player/game binding, publication cutoff and hash verification", async () => {
  await publish("game", "gemini", "2026-01-01T00:00:00.000Z");
  expect(await localCharacterArt("other", ["gemini"])).toEqual({});
  expect(await localCharacterArt("game", ["other"])).toEqual({});
  expect(await localCharacterArt("game", ["gemini"], "2025-01-01T00:00:00.000Z")).toEqual({});
  const art = (await localCharacterArt("game", ["gemini"])).gemini!;
  expect(art.fullBodyUrl).toContain(art.revision);
  expect((await readLocalCharacterArt("game", "gemini", art.revision, "cutout"))?.bytes).toEqual(Buffer.from(image));
  expect(await readLocalCharacterArt("other", "gemini", art.revision, "cutout")).toBeNull();
  await writeFile(join(directory, "art.png"), "changed");
  await expect(readLocalCharacterArt("game", "gemini", art.revision, "cutout")).rejects.toThrow("integrity");
  for (const environment of ["production", "staging"]) {
    process.env.NODE_ENV = environment;
    await expect(localCharacterArt("game", ["gemini"])).rejects.toThrow("localhost");
  }
  process.env.NODE_ENV = "test"; process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT = "staging";
  await expect(localCharacterArt("game", ["gemini"])).rejects.toThrow("localhost");
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  process.env.DATABASE_URL = "postgres://production.invalid/database";
  await expect(localCharacterArt("game", ["gemini"])).rejects.toThrow("localhost");
});

test("public assets enforce game visibility, membership and revision; producer URLs require auth", async () => {
  await db.insert(schema.games).values({ id: "art-game", slug: "art-game", status: "completed", config: "{}" });
  await db.insert(schema.gamePlayers).values({ id: "gemini", gameId: "art-game", persona: "{}", agentConfig: "{}" });
  await publish("art-game", "gemini");
  const art = (await localCharacterArt("art-game", ["gemini"])).gemini!;
  const routes = createLocalCharacterArtRoutes(db);
  expect(Buffer.from(await (await routes.request(art.fullBodyUrl)).arrayBuffer())).toEqual(Buffer.from(image));
  expect((await routes.request(art.fullBodyUrl.replace(art.revision, "wrong"))).status).toBe(404);
  expect((await routes.request(art.fullBodyUrl.replace("/gemini/", "/unknown/"))).status).toBe(404);
  expect((await routes.request(art.fullBodyUrl.replace("/api/games/", "/api/admin/production/games/"))).status).toBe(401);
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, "art-game"));
  expect((await routes.request(art.fullBodyUrl)).status).toBe(404);
  await db.insert(schema.users).values({ id: "producer" });
  await db.insert(schema.roles).values({ id: "producer", name: "producer" }).onConflictDoNothing();
  await db.insert(schema.userRoles).values({ userId: "producer", roleId: "producer" });
  const token = await createSessionToken("producer", { roles: ["producer"], permissions: [] });
  const headers = { Authorization: `Bearer ${token}` };
  const privateUrl = art.fullBodyUrl.replace("/api/games/", "/api/admin/production/games/");
  expect((await routes.request(privateUrl, { headers })).status).toBe(200);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "producer"));
  expect((await routes.request(privateUrl, { headers })).status).toBe(403);
});

test("appending a publication refreshes cache identity while retaining the old version", async () => {
  const first = await publish("game", "gemini", "2026-01-01T00:00:00.000Z");
  const old = (await localCharacterArt("game", ["gemini"])) .gemini!;
  const later = { ...first, publishedAt: "2026-01-02T00:00:00.000Z", head: { ...first.head, x: .3 } };
  await writeFile(process.env.INFLUENCE_LOCAL_CHARACTER_ART_MANIFEST!, JSON.stringify({ version: 1, entries: [first, later] }));
  expect((await localCharacterArt("game", ["gemini"])).gemini!.revision).not.toBe(old.revision);
  expect((await localCharacterArt("game", ["gemini"], first.publishedAt)).gemini).toEqual(old);
  expect((await readLocalCharacterArt("game", "gemini", old.revision, "portrait"))?.bytes).toEqual(Buffer.from(image));
});

test("Influence viewer/export art changes while canonical acceptance and old exports remain identical", async () => {
  const gameId = await insertGame(db, { id: "art-influence", slug: "art-influence", status: "completed", config: {} });
  await db.insert(schema.gamePlayers).values(["atlas", "echo", "mira", "nyx"].map(id => ({ id, gameId, persona: JSON.stringify({ name: id, personality: "frozen", avatarUrl: `/original/${id}.png` }), agentConfig: "{}" })));
  const ownerEpoch = await insertOwner(db, gameId);
  const events = withRetrospective(withJuryWinner(createResolvedRoundCanonicalEventFixture(gameId), "mira"), 1000);
  await appendGameEvents(db, { gameId, ownerEpoch, events }); await insertRetrospectiveTranscriptFixture(db, events);
  const old = await readInfluenceProductionSource(db, gameId);
  await new Promise(resolve => setTimeout(resolve, 5));
  await publish(gameId, "atlas");
  const current = await readInfluenceProductionSource(db, gameId, { snapshot: old.snapshot, refreshVisuals: true });
  expect(current.snapshot.acceptedSourceHash).toBe(old.snapshot.acceptedSourceHash);
  expect(current.snapshot.sourceHash).not.toBe(old.snapshot.sourceHash);
  expect(current.visual.fullBodies.atlas).toContain("/local-character-art/atlas/");
  expect(current.visual.portraits.atlas).toEndWith("/portrait");
  expect(current.game).toEqual(old.game);
  expect(current.frames).toEqual(old.frames);
  expect((await readInfluenceProductionSource(db, gameId, { snapshot: old.snapshot })).snapshot).toEqual(old.snapshot);
  expect((await readInfluenceProductionSource(db, gameId, { snapshot: current.snapshot })).snapshot).toEqual(current.snapshot);
  const viewer = await (await createVisualRoutes(db).request(`/api/games/${gameId}/visual`)).json() as { fullBodies: Record<string, string>; portraits: Record<string, string> };
  expect(viewer.fullBodies.atlas!.replace("/api/games/", "/api/admin/production/games/")).toBe(current.visual.fullBodies.atlas!);
  expect(viewer.portraits).not.toHaveProperty("echo");
  const frozen = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  expect(frozen.every(player => JSON.parse(player.persona).avatarUrl === `/original/${player.id}.png`)).toBeTrue();
});

test("Werewolf viewer and export replace every Gemini occurrence without mutating frozen events or old pins", async () => {
  const gameId = "art-werewolf";
  const events = await completedWerewolfResultsFixture("saved", gameId);
  const started = events[0]!; if (started.type !== "werewolf.started") throw Error("Expected start");
  const playerId = started.payload.players[0]!.id;
  await db.insert(schema.games).values({ id: gameId, slug: gameId, status: "completed", gameKind: "werewolf", startedAt: "2026-01-01T00:00:00.000Z", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId, sequence: event.sequence, event })));
  const old = await readWerewolfProductionSource(db, gameId, { audience: "mystery", thinking: false });
  await new Promise(resolve => setTimeout(resolve, 5));
  const entry = await publish(gameId, playerId);
  const live = await readWerewolfWatch(db, gameId, "mystery", 1, 64, entry.publishedAt);
  const art = (await localCharacterArt(gameId, [playerId], entry.publishedAt))[playerId]!;
  const changed = live.players.find(player => player.id === playerId)!;
  expect(changed.avatarUrl).toBe(art.portraitUrl);
  expect(changed.fullBodyReferenceUrl).toBe(art.fullBodyUrl);
  for (const moment of live.moments) for (const player of moment.snapshot.players) if (player.id === playerId) expect(player.avatarUrl).toBe(art.portraitUrl);
  expect(live.players.filter(player => player.id !== playerId).every(player => !player.avatarUrl?.includes("local-character-art"))).toBeTrue();
  const current = await readWerewolfProductionSource(db, gameId, { audience: "mystery", thinking: false });
  expect(current.snapshot.sourceHash).not.toBe(old.snapshot.sourceHash);
  expect(current.window.players.find(player => player.id === playerId)!.avatarUrl).toContain("/api/admin/production/games/");
  expect((await readWerewolfProductionCharacter(db, gameId, playerId, { snapshot: current.snapshot, image: "body" })).bytes).toEqual(new Uint8Array(image));
  expect((await readWerewolfProductionCharacter(db, gameId, playerId, { snapshot: current.snapshot, image: "portrait" })).bytes).toEqual(new Uint8Array(image));
  expect((await readWerewolfProductionSource(db, gameId, { audience: "mystery", thinking: false, snapshot: old.snapshot })).snapshot).toEqual(old.snapshot);
  expect((await db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, gameId))).map(row => row.event)).toEqual(events);
  // File paths stay server-side; the public DTO includes only immutable URLs and pixels' coordinates.
  expect(JSON.stringify(live)).not.toContain(directory);
  expect(JSON.stringify(current)).not.toContain(directory);
  expect(await readFile(join(directory, "art.png"))).toEqual(Buffer.from(image));
});
