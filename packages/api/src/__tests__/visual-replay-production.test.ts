import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { GameState, Phase, type GameTurnIntentV1 } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertOwner, insertCanonicalEventRows } from "./durable-run-test-utils.js";
import { createInitialGameExecutionStateV1 } from "../services/game-turn-commit.js";
import { createSessionToken } from "../middleware/auth.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
import { readReplayVisualProduction, renderMissingReplayScene } from "../services/visual-replay-production.js";
import { readVisualMedia, controlVisualMedia } from "../services/visual-media-repair.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
import { readViewerMedia } from "../services/visual-media-viewer.js";
import { createVisualRoutes } from "../routes/visual.js";

let db: DrizzleDB, state: GameState, ownerEpoch: string, savedEvents: number, dialogueSequence: number, turnSequence: number, calls: number;
const gameId = "replay-production";
const originalFetch = globalThis.fetch, originalSecret = process.env.JWT_SECRET;
beforeEach(async () => {
  db = await setupTestDB(); savedEvents = 0; dialogueSequence = 0; turnSequence = 0; calls = 0;
  process.env.JWT_SECRET = "provider-free-replay-production";
  globalThis.fetch = Object.assign(async () => { calls++; throw new Error("No provider calls are allowed"); }, { preconnect: originalFetch.preconnect });
  await db.insert(schema.games).values({ id: gameId, slug: "recorded-without-visuals", status: "completed", maxPlayers: 6, config: JSON.stringify({ visualMode: false, modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" } }) });
  ownerEpoch = await insertOwner(db, gameId);
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
  state = new GameState(players, { gameId }); state.startRound();
  await db.insert(schema.gamePlayers).values(players.map(player => ({ id: player.id, gameId, persona: JSON.stringify({ name: player.name, personaKey: "honest" }), agentConfig: "{}" })));
  await beat(Phase.LOBBY);
  await beat(Phase.LOBBY); // unchanged cast reuses one scene
  await beat(Phase.FORMAT_MINGLE, ["p1"], 1);
  state.eliminatePlayer("p5"); state.startRound();
  await beat(Phase.LOBBY);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});

async function beat(phase: Phase, audience: string[] = [], roomId?: number, scope: "public" | "diary" = "public", speaker = "p0") {
  const events = state.getCanonicalEvents();
  if (events.length > savedEvents) await insertCanonicalEventRows(db, gameId, ownerEpoch, events.slice(savedEvents));
  savedEvents = events.length; turnSequence++; dialogueSequence++;
  const execution = createInitialGameExecutionStateV1({ gameId, ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } });
  const turnId = `beat-${turnSequence}`, hash = `sha256:${"a".repeat(64)}`, date = new Date().toISOString();
  const intent: GameTurnIntentV1 = { version: 1, gameId, turnId, turnSequence, seed: "test", baseHeads: execution.heads,
    branch: { version: 1, kind: "engine", action: "round_start" }, actorIds: [], targetIds: [], handles: [], participantIds: [], providerSubcalls: [] };
  await db.insert(schema.gameTurns).values({ id: turnId, gameId, turnSequence, plannedOwnerEpoch: ownerEpoch, committedOwnerEpoch: ownerEpoch,
    baseEventSequence: savedEvents, baseDialogueSequence: dialogueSequence - 1, basePublicationSequence: 0, intent, intentHash: hash, effectHash: hash, status: "committed", committedAt: date,
    commitResult: { version: 1, gameId, turnId, turnSequence, intentHash: hash, effectHash: hash, committedAt: date, state: execution, canonicalEvents: [], dialogueSequences: [], publications: [], alreadyCommitted: false } });
  await db.insert(schema.transcripts).values({ gameId, gameTurnId: turnId, gameTurnTranscriptOrdinal: 1, entrySequence: scope === "diary" ? null : dialogueSequence,
    round: state.round, phase, scope, text: "Prose falsely claims Player 5 is here and everyone moved to another room.", timestamp: 1,
    speakerPlayerId: speaker, audiencePlayerIds: scope === "diary" ? null : audience, safeContext: scope === "diary" ? null : { version: 1, ...(roomId !== undefined && { roomId }) } });
}
const render = (scene: Awaited<ReturnType<typeof readReplayVisualProduction>>["scenes"][number], requestId: string = crypto.randomUUID()) =>
  renderMissingReplayScene(db, gameId, "operator", { key: scene.key, previewHash: scene.previewHash, requestId });
async function complete() {
  const job = (await claimVisualMediaJob(db, "test-worker"))!; expect(job).not.toBeNull();
  const image = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#332244" } }).png().toBuffer();
  const imageArtifactId = await storeVisualArtifact(db, gameId, image);
  await executeVisualMediaJob(db, job, new AbortController().signal, async () => ({ imageArtifactId,
    localization: { count: job.plan.cast.length, verifiedParticipantIds: job.plan.cast.map(member => member.id), anchors: [] } }));
  return job;
}
async function acceptedRecords() {
  return Promise.all([db.select().from(schema.games), db.select().from(schema.gameTurns), db.select().from(schema.gameEvents),
    db.select().from(schema.transcripts), db.select().from(schema.gameRunOwners), db.select().from(schema.gameExecutionStates)]);
}

test("discovery is read-only and plans from canonical rosters and exact private audiences", async () => {
  await beat(Phase.FORMAT_MINGLE, ["p0"], 1, "public", "p1"); // same audience, different speaker
  await beat(Phase.INTRODUCTION);
  await beat(Phase.FORMAT_MINGLE); // missing room metadata cannot be guessed
  await beat(Phase.LOBBY, [], undefined, "diary");
  const before = await acceptedRecords();
  const inventory = await readReplayVisualProduction(db, gameId);
  expect(inventory.scenes.map(scene => [scene.roomId, scene.participants.map(member => member.id)])).toEqual([
    ["lobby", ["p0", "p1", "p2", "p3", "p4", "p5"]], ["mingle-1", ["p0", "p1"]], ["lobby", ["p0", "p1", "p2", "p3", "p4"]],
  ]);
  expect(await db.select().from(schema.visualScenes)).toHaveLength(0);
  expect(await db.select().from(schema.visualGameAssets)).toHaveLength(0);
  expect(await db.select().from(schema.visualArtifacts)).toHaveLength(0);
  expect(await acceptedRecords()).toEqual(before); expect(calls).toBe(0);
});

test("one selected historical scene queues once; candidates require publication and nonvisual viewers adopt it", async () => {
  const before = await acceptedRecords();
  const inventory = await readReplayVisualProduction(db, gameId);
  const selected = inventory.scenes[2]!;
  const receipts = await Promise.all([render(selected, "same-request"), render(selected, "same-request")]);
  expect(receipts[0]).toEqual(receipts[1]); expect(receipts[0]).toMatchObject({ accepted: true, version: 1 });
  expect((await readVisualMedia(db, gameId)).jobs).toHaveLength(1);
  expect(await db.select().from(schema.visualScenes)).toHaveLength(1);
  const [assets] = await db.select().from(schema.visualGameAssets);
  expect(assets!.cast).toHaveLength(5); expect(assets!.backgrounds).toEqual({}); expect(calls).toBe(0);
  const refreshed = await readReplayVisualProduction(db, gameId);
  expect(refreshed.scenes.find(scene => scene.key === selected.key)?.previewHash).toBe(selected.previewHash);
  expect(await render(selected, "same-request")).toEqual(receipts[0]);
  expect(await render(inventory.scenes[0]!, "another-request")).toMatchObject({ accepted: false, code: "game_pending" });
  expect((await readVisualMedia(db, gameId)).jobs).toHaveLength(1);
  const job = await complete();
  expect((await readViewerMedia(db, gameId)).scenes).toHaveLength(0);
  const api = createVisualRoutes(db);
  const version = (await readVisualMedia(db, gameId)).versions[0]!;
  expect((await api.request(`/api/games/${gameId}/visual/artifacts/${version.imageArtifactId}`)).status).toBe(404);
  expect(await controlVisualMedia(db, gameId, "operator", { action: "publish", requestId: "publish", sceneId: job.sceneId, expectedVersion: 1, expectedPublication: 0, versionId: job.id })).toMatchObject({ accepted: true });
  const viewer = await (await api.request(`/api/games/${gameId}/visual`)).json() as Awaited<ReturnType<typeof readViewerMedia>> & { enabled: boolean; status: string | null };
  expect(viewer).toMatchObject({ enabled: true, status: null }); expect(viewer.scenes).toHaveLength(1);
  expect(viewer.bindings[4]).toBe(job.sceneId); expect(viewer.bindings[1]).not.toBe(job.sceneId);
  expect((await api.request(`/api/games/${gameId}/visual/artifacts/${version.imageArtifactId}`)).status).toBe(200);
  expect(await acceptedRecords()).toEqual(before); expect(calls).toBe(0);
  // Earlier boundaries can be rendered after later ones, without rewriting gameplay.
  expect(await render(inventory.scenes[0]!, "earlier")).toMatchObject({ accepted: true });
});

test("partial backfills never carry a voted-off player into a later Lobby", async () => {
  const earlier = (await readReplayVisualProduction(db, gameId)).scenes[0]!;
  await render(earlier); const job = await complete();
  await controlVisualMedia(db, gameId, "operator", { action: "publish", requestId: "publish", sceneId: job.sceneId, expectedVersion: 1, expectedPublication: 0, versionId: job.id });
  const viewer = await readViewerMedia(db, gameId);
  expect(viewer.bindings[1]).toBe(job.sceneId); expect(viewer.bindings[2]).toBe(job.sceneId); expect(viewer.bindings[4]).toBeUndefined();
});

test("stale previews reject before writing and request IDs cannot be reused for another preview", async () => {
  const selected = (await readReplayVisualProduction(db, gameId)).scenes[0]!;
  await expect(renderMissingReplayScene(db, gameId, "operator", { key: selected.key, previewHash: "stale", requestId: "stale" })).rejects.toMatchObject({ code: "stale_preview" });
  expect(await db.select().from(schema.visualScenes)).toHaveLength(0);
  await render(selected, "lost-response");
  // A different input with the same ID cannot dispatch another request.
  await expect(renderMissingReplayScene(db, gameId, "operator", { key: "other", previewHash: selected.previewHash, requestId: "lost-response" })).rejects.toMatchObject({ code: "request_conflict" });
  expect((await readVisualMedia(db, gameId)).jobs).toHaveLength(1);
});

test("Judgment plans include the active jury, while older jurors are excluded", async () => {
  for (const id of ["p4", "p3", "p2"]) state.eliminatePlayer(id);
  state.setEndgameStage("judgment"); await beat(Phase.OPENING_STATEMENTS);
  const finals = (await readReplayVisualProduction(db, gameId)).scenes.find(scene => scene.roomId === "finals")!;
  expect(finals.participants.map(member => member.id)).toEqual(["p0", "p1", "p4", "p3", "p2"]);
  expect(finals.roles).toEqual({ p0: "finalist", p1: "finalist", p4: "juror", p3: "juror", p2: "juror" });
});

test("untrusted canonical records leave unsupported beats unstaged instead of inferring from prose", async () => {
  await db.update(schema.gameEvents).set({ eventHash: "corrupt" }).where(eq(schema.gameEvents.sequence, 1));
  const inventory = await readReplayVisualProduction(db, gameId);
  expect(inventory.scenes).toHaveLength(0); expect(inventory.warnings).toHaveLength(2);
  expect(await db.select().from(schema.visualScenes)).toHaveLength(0);
});

async function operator(role: string) {
  const address = `0x${role}`, id = `user-${role}`;
  await db.insert(schema.users).values({ id, walletAddress: address, displayName: role });
  await db.insert(schema.roles).values({ id: role, name: role });
  await db.insert(schema.addressRoles).values({ walletAddress: address, roleId: role });
  const token = await createSessionToken(id, { roles: [role], permissions: ["view_admin", "start_game"] });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
test.each(["producer", "sysop"])("Production endpoints authorize current %s roles and reject revoked session claims", async role => {
  const headers = await operator(role), app = createVisualReplayProductionRoutes(db), root = `/api/admin/production/games/${gameId}/visual`;
  expect((await app.request(root)).status).toBe(401);
  const read = await app.request(root, { headers }); expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store");
  await db.insert(schema.games).values({ id: "not-completed", slug: "waiting-game", status: "waiting", config: "{}" });
  const list = await app.request("/api/admin/production/games", { headers });
  expect(list.status).toBe(200); expect(list.headers.get("cache-control")).toBe("private, no-store");
  const rows = await list.json() as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: gameId, slug: "recorded-without-visuals", status: "completed", hidden: false, playerCount: 6, episode: { status: "unrequested" }, completionSettlement: { state: "not_applicable" }, modelLabel: expect.any(String) });
  const preview = (await readReplayVisualProduction(db, gameId)).scenes[0]!;
  expect((await app.request(`${root}/missing`, { method: "POST", headers, body: "{" })).status).toBe(400);
  expect((await app.request(`${root}/media`, { method: "POST", headers, body: "{" })).status).toBe(400);
  expect((await app.request(`${root}/missing`, { method: "POST", headers, body: JSON.stringify({ key: preview.key, previewHash: preview.previewHash, requestId: "authorized" }) })).status).toBe(200);
  const [artifact] = await db.select().from(schema.visualArtifacts);
  expect((await app.request(`${root}/evidence/artifact/${artifact!.id}`, { headers })).status).toBe(200);
  await db.delete(schema.addressRoles).where(eq(schema.addressRoles.roleId, role));
  for (const path of [root, "/api/admin/production/games", `${root}/evidence/artifact/${artifact!.id}`]) expect((await app.request(path, { headers })).status).toBe(403);
  expect((await app.request(`${root}/missing`, { method: "POST", headers, body: JSON.stringify({ key: preview.key, previewHash: preview.previewHash, requestId: "revoked" }) })).status).toBe(403);
  expect((await readVisualMedia(db, gameId)).jobs).toHaveLength(1);
});
test("ordinary admin permissions cannot operate the Producer/Sysop panel", async () => {
  const headers = await operator("admin"), app = createVisualReplayProductionRoutes(db);
  expect((await app.request("/api/admin/production/games", { headers })).status).toBe(403);
  expect((await app.request(`/api/admin/production/games/${gameId}/visual/missing`, { method: "POST", headers, body: "{}" })).status).toBe(403);
  expect((await readVisualMedia(db, gameId)).jobs).toHaveLength(0);
});

test("Production refuses unfinished games and caller-authored scene fields", async () => {
  const headers = await operator("producer"), app = createVisualReplayProductionRoutes(db), root = `/api/admin/production/games/${gameId}/visual`;
  const scene = (await readReplayVisualProduction(db, gameId)).scenes[0]!;
  expect((await app.request(`${root}/missing`, { method: "POST", headers, body: JSON.stringify({ key: scene.key, previewHash: scene.previewHash, requestId: "extra", cast: ["invented"] }) })).status).toBe(400);
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, gameId));
  expect((await app.request(root, { headers })).status).toBe(409);
  expect((await app.request(`${root}/missing`, { method: "POST", headers, body: JSON.stringify({ key: scene.key, previewHash: scene.previewHash, requestId: "running" }) })).status).toBe(409);
  expect(await db.select().from(schema.visualScenes)).toHaveLength(0);
});
