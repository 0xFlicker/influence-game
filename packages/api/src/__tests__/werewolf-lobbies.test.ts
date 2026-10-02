import { afterAll, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { replayWerewolf } from "@influence/engine/werewolf";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { setupTestDB } from "./test-utils.js";
import { claimWerewolfGame, readWerewolfEvents } from "../services/werewolf-games.js";
import { createWerewolfLobby, joinWerewolfLobby, leaveWerewolfLobby, readWerewolfLobby, startWerewolfLobby } from "../services/werewolf-lobbies.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";

const oldSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "werewolf-lobby-test-secret";
afterAll(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); await db.insert(schema.users).values([{ id: "owner" }, { id: "guest" }]); });
const create = () => createWerewolfLobby(db, "owner", { preset: "one_wolf", providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] });
async function profile(id: string, userId = "owner", name = id) {
  await db.insert(schema.agentProfiles).values({ id, userId, name, personality: "PRIVATE_PERSONALITY", strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: "PRIVATE_WEREWOLF_STRATEGY", personaKey: "observer" });
  return id;
}

test("a saved lobby has durable public seats but no roles, game events, or worker claim", async () => {
  const game = await create();
  await profile("agent");
  const first = await joinWerewolfLobby(db, game.slug, "owner", "agent");
  expect(await joinWerewolfLobby(db, game.id, "owner", "agent")).toEqual(first);
  const lobby = await readWerewolfLobby(db, game.slug);
  expect(lobby).toMatchObject({ status: "waiting", started: false, playerCount: 6, players: [{ id: first.playerId, name: "agent" }] });
  expect(JSON.stringify(lobby)).not.toContain("PRIVATE_");
  expect(JSON.stringify(lobby)).not.toContain("INFLUENCE_ONLY");
  expect(lobby.players[0]!.ownerPublicId).not.toBe("owner");
  expect(await readWerewolfEvents(db, game.id)).toEqual([]);
  expect((await claimWerewolfGame(db, game.id)).ok).toBe(false);
  const response = await createWerewolfRoutes(db).request("/api/werewolf");
  expect(await response.json()).toMatchObject([{ id: game.id, status: "waiting", joinedPlayers: 1, gameKind: "werewolf" }]);
  expect((await createWerewolfRoutes(db).request(`/api/werewolf/${game.id}/watch`)).status).toBe(409);
});

test("admission checks current ownership, capacity, and current multi-seat roles", async () => {
  const game = await create(); await profile("first"); await profile("second"); await profile("third");
  await expect(joinWerewolfLobby(db, game.id, "guest", "first")).rejects.toThrow("own");
  await joinWerewolfLobby(db, game.id, "owner", "first");
  await expect(joinWerewolfLobby(db, game.id, "owner", "second")).rejects.toThrow("already have");
  await db.insert(schema.roles).values({ id: "producer", name: "producer" });
  await db.insert(schema.userRoles).values({ userId: "owner", roleId: "producer" });
  await joinWerewolfLobby(db, game.id, "owner", "second");
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "owner"));
  await expect(joinWerewolfLobby(db, game.id, "owner", "third")).rejects.toThrow("already have");
  const seat = (await readWerewolfLobby(db, game.id)).players[0]!;
  await expect(leaveWerewolfLobby(db, game.id, "guest", seat.id)).rejects.toThrow("only remove");
  await leaveWerewolfLobby(db, game.id, "owner", seat.id);
  expect((await readWerewolfLobby(db, game.id)).players).toHaveLength(1);
});

test("concurrent joins serialize the last seat without overfilling", async () => {
  const game = await create();
  for (let i = 0; i < 7; i++) { await db.insert(schema.users).values({ id: `user-${i}` }); await profile(`agent-${i}`, `user-${i}`); }
  const joins = await Promise.allSettled(Array.from({ length: 7 }, (_, i) => joinWerewolfLobby(db, game.id, `user-${i}`, `agent-${i}`)));
  expect(joins.filter(result => result.status === "fulfilled")).toHaveLength(6);
  expect((await readWerewolfLobby(db, game.id)).players).toHaveLength(6);
});

test("start freezes the latest approved strategy for every owner, assigns roles once, and fills the House seats", async () => {
  const game = await create();
  const { profile: agent } = await createOwnedAgentProfile(db, { userId: "guest" }, { name: "Arden", personality: "Calm", gender: "non-binary", personaKey: "observer", strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: "BEFORE_EDIT" });
  const seat = await joinWerewolfLobby(db, game.id, "guest", agent.id);
  await updateOwnedAgentProfile(db, { userId: "guest" }, agent.id, { werewolfStrategyStyle: "LATEST_STRATEGY", submissionId: randomUUID(), expectedContentRevisionId: agent.contentRevisionId });
  const starts = await Promise.allSettled([startWerewolfLobby(db, game.id), startWerewolfLobby(db, game.id)]);
  expect(starts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const events = await readWerewolfEvents(db, game.id);
  expect(events).toHaveLength(1);
  const state = replayWerewolf(events);
  expect(state.players).toHaveLength(6);
  expect(state.players.find(player => player.id === seat.playerId)).toMatchObject({ agentProfileId: agent.id, strategy: "LATEST_STRATEGY" });
  expect(JSON.stringify(events)).not.toContain("INFLUENCE_ONLY");
  expect((await readWerewolfLobby(db, game.id)).status).toBe("in_progress");
  await expect(leaveWerewolfLobby(db, game.id, "guest", seat.playerId)).rejects.toThrow("no longer");
  await expect(joinWerewolfLobby(db, game.id, "guest", agent.id)).rejects.toThrow("no longer");
});

test("withdrawn profiles fail start atomically and are redacted until removed", async () => {
  const game = await create(); await profile("withdrawn");
  const seat = await joinWerewolfLobby(db, game.id, "owner", "withdrawn");
  await db.update(schema.agentProfiles).set({ archivedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, "withdrawn"));
  expect((await readWerewolfLobby(db, game.id)).players[0]).toMatchObject({ name: "Unavailable agent", available: false });
  await expect(startWerewolfLobby(db, game.id)).rejects.toThrow("archived");
  expect(await readWerewolfEvents(db, game.id)).toEqual([]);
  expect((await readWerewolfLobby(db, game.id)).status).toBe("waiting");
  await leaveWerewolfLobby(db, game.id, "owner", seat.playerId);
  await startWerewolfLobby(db, game.id);
  expect(replayWerewolf(await readWerewolfEvents(db, game.id)).players).toHaveLength(6);
});

test("hidden lobbies cannot be read, joined, or started through public routes", async () => {
  const game = await create(); await profile("agent");
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, game.id));
  await expect(readWerewolfLobby(db, game.slug)).rejects.toThrow("not found");
  await expect(joinWerewolfLobby(db, game.id, "owner", "agent")).rejects.toThrow("not found");
  await expect(startWerewolfLobby(db, game.id)).rejects.toThrow("not found");
  const app = createWerewolfRoutes(db);
  expect(await (await app.request("/api/werewolf")).json()).toEqual([]);
  expect((await app.request(`/api/werewolf/${game.id}/start`, { method: "POST" })).status).toBe(401);
});

test("lobby creation and start have separate permission gates, while ordinary authenticated players may join", async () => {
  const app = createWerewolfRoutes(db);
  await db.insert(schema.roles).values({ id: "creator", name: "creator" });
  await db.insert(schema.permissions).values({ id: "create_game", name: "create_game", description: "Create" });
  await db.insert(schema.rolePermissions).values({ roleId: "creator", permissionId: "create_game" });
  await db.insert(schema.userRoles).values({ userId: "owner", roleId: "creator" });
  const owner = { Authorization: `Bearer ${await createSessionToken("owner", { roles: ["creator"], permissions: ["create_game"] })}`, "Content-Type": "application/json" };
  const guest = { Authorization: `Bearer ${await createSessionToken("guest", { roles: [], permissions: [] })}`, "Content-Type": "application/json" };
  const input = JSON.stringify({ preset: "one_wolf" });
  expect((await app.request("/api/werewolf/lobbies", { method: "POST", headers: guest, body: input })).status).toBe(403);
  expect((await app.request("/api/werewolf/lobbies", { method: "POST", headers: owner, body: JSON.stringify({ preset: "invalid" }) })).status).toBe(400);
  const created = await app.request("/api/werewolf/lobbies", { method: "POST", headers: owner, body: input });
  expect(created.status).toBe(201);
  const game = await created.json() as { id: string };
  await profile("guest-agent", "guest");
  expect((await app.request(`/api/werewolf/${game.id}/join`, { method: "POST", headers: guest, body: JSON.stringify({ agentProfileId: "guest-agent" }) })).status).toBe(200);
  expect((await app.request(`/api/werewolf/${game.id}/start`, { method: "POST", headers: owner })).status).toBe(403);
  expect(await readWerewolfEvents(db, game.id)).toEqual([]);
});
