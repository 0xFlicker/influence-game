import { grantTestAuthority } from "./rbac-fixtures.js";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { replayWerewolf, werewolfConfig } from "@influence/engine/werewolf";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { setupTestDB } from "./test-utils.js";
import { claimWerewolfGame, readWerewolfEvents } from "../services/werewolf-games.js";
import { createWerewolfLobby, fillWerewolfLobby, joinWerewolfLobby, leaveWerewolfLobby, readWerewolfLobby, startWerewolfLobby } from "../services/werewolf-lobbies.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";

const oldSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "werewolf-lobby-test-secret";
afterAll(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); await db.insert(schema.users).values([{ id: "owner" }, { id: "guest" }]); });
const create = () => createWerewolfLobby(db, "owner", { preset: "one_wolf" });
async function profile(id: string, userId = "owner", name = id) {
  await db.insert(schema.agentProfiles).values({ id, userId, name, personality: "PRIVATE_PERSONALITY", strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: "PRIVATE_WEREWOLF_STRATEGY", personaKey: "observer" });
  return id;
}

test("a saved lobby has durable public seats but no roles, game events, or worker claim", async () => {
  const game = await create();
  await profile("agent");
  expect(await db.select().from(schema.gameEpisodePresentations)).toHaveLength(0);
  const first = await joinWerewolfLobby(db, game.slug, "owner", "agent");
  expect(await joinWerewolfLobby(db, game.id, "owner", "agent")).toEqual(first);
  const lobby = await readWerewolfLobby(db, game.slug);
  expect(lobby).toMatchObject({ status: "waiting", started: false, playerCount: 6, players: [{ id: first.playerId, name: "agent" }] });
  expect(lobby.episode.cast).toEqual([{ id: first.playerId, name: "agent", avatarUrl: null, personaKey: "observer" }]);
  const listed = await (await createWerewolfRoutes(db).request("/api/werewolf")).json();
  expect(listed).toMatchObject([{ joinedPlayers: 1, episode: { cast: lobby.episode.cast } }]);
  expect(JSON.stringify(listed)).not.toContain("PRIVATE_");
  expect(JSON.stringify(listed)).not.toContain("INFLUENCE_ONLY");
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

test("waiting discovery uses approved joined identities, follows removal, and never exposes draft content", async () => {
  const game = await create();
  const { profile: agent } = await createOwnedAgentProfile(db, { userId: "guest" }, {
    name: "Arden", personality: "PRIVATE_PERSONALITY", gender: "non-binary", personaKey: "observer",
    strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: "PRIVATE_WEREWOLF_STRATEGY",
  });
  const seat = await joinWerewolfLobby(db, game.id, "guest", agent.id);
  await db.update(schema.agentProfiles).set({ name: "Unapproved draft name", avatarUrl: "/unapproved-draft.png" }).where(eq(schema.agentProfiles.id, agent.id));
  const response = await (await createWerewolfRoutes(db).request("/api/werewolf")).json();
  expect(response).toMatchObject([{ joinedPlayers: 1, episode: { cast: [{ id: seat.playerId, name: "Arden" }] } }]);
  for (const secret of ["Unapproved draft", "unapproved-draft.png", "PRIVATE_", "INFLUENCE_ONLY", "roles", "ownerPublicId", "agentProfileId"]) {
    expect(JSON.stringify(response)).not.toContain(secret);
  }
  await leaveWerewolfLobby(db, game.id, "guest", seat.playerId);
  expect((await readWerewolfLobby(db, game.id)).episode.cast).toEqual([]);
});

test("start freezes the latest approved strategy for every owner, assigns roles once, and preserves the filled House seats", async () => {
  const game = await create();
  const { profile: agent } = await createOwnedAgentProfile(db, { userId: "guest" }, { name: "Arden", personality: "Calm", gender: "non-binary", personaKey: "observer", strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: "BEFORE_EDIT" });
  const seat = await joinWerewolfLobby(db, game.id, "guest", agent.id);
  await updateOwnedAgentProfile(db, { userId: "guest" }, agent.id, { werewolfStrategyStyle: "LATEST_STRATEGY", submissionId: randomUUID(), expectedContentRevisionId: agent.contentRevisionId });
  await fillWerewolfLobby(db, game.id);
  const starts = await Promise.allSettled([startWerewolfLobby(db, game.id), startWerewolfLobby(db, game.id)]);
  expect(starts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(schema.gameEpisodePresentations)).toMatchObject([{ gameId: game.id, status: "queued" }]);
  const events = await readWerewolfEvents(db, game.id);
  expect(events).toHaveLength(1);
  const state = replayWerewolf(events);
  expect(state.players).toHaveLength(6);
  expect(state.players.find(player => player.id === seat.playerId)).toMatchObject({ agentProfileId: agent.id, strategy: "LATEST_STRATEGY" });
  expect(JSON.stringify(events)).not.toContain("INFLUENCE_ONLY");
  const started = await readWerewolfLobby(db, game.id);
  expect(started.status).toBe("in_progress");
  expect(started.episode.cast.map(player => player.name)).toEqual(state.players.map(player => player.name));
  await db.update(schema.agentProfiles).set({ name: "Changed after start", avatarUrl: "/later.png" }).where(eq(schema.agentProfiles.id, agent.id));
  expect((await readWerewolfLobby(db, game.id)).episode.cast).toEqual(started.episode.cast);
  await expect(leaveWerewolfLobby(db, game.id, "guest", seat.playerId)).rejects.toThrow("no longer");
  await expect(joinWerewolfLobby(db, game.id, "guest", agent.id)).rejects.toThrow("no longer");
});

test("withdrawn profiles fail start atomically and are redacted until removed", async () => {
  const game = await create(); await profile("withdrawn");
  const seat = await joinWerewolfLobby(db, game.id, "owner", "withdrawn");
  await fillWerewolfLobby(db, game.id);
  await db.update(schema.agentProfiles).set({ archivedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, "withdrawn"));
  const unavailable = await readWerewolfLobby(db, game.id);
  expect(unavailable.players[0]).toMatchObject({ name: "Unavailable agent", available: false });
  expect(unavailable.episode.cast[0]).toMatchObject({ name: "Unavailable agent", avatarUrl: null, personaKey: null });
  await expect(startWerewolfLobby(db, game.id)).rejects.toThrow("archived");
  expect(await readWerewolfEvents(db, game.id)).toEqual([]);
  expect((await readWerewolfLobby(db, game.id)).status).toBe("waiting");
  await leaveWerewolfLobby(db, game.id, "owner", seat.playerId);
  await fillWerewolfLobby(db, game.id);
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


test("an older waiting lobby preserves its frozen rules version and config fields", async () => {
  const game = await create();
  const [waiting] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
  // Represent a lobby persisted before the deployment upgraded Werewolf rules.
  const olderConfig = { ...JSON.parse(waiting!.config), rulesVersion: 8, customMetadata: { label: "preserve me" } };
  await db.update(schema.games).set({ config: JSON.stringify(olderConfig) }).where(eq(schema.games.id, game.id));
  await fillWerewolfLobby(db, game.id);
  await startWerewolfLobby(db, game.id);

  const events = await readWerewolfEvents(db, game.id);
  expect(events).toHaveLength(1);
  const event = events[0]!;
  expect(event.type).toBe("werewolf.started");
  if (event.type !== "werewolf.started") throw new Error("Expected canonical start event");
  const currentVersion = werewolfConfig("one_wolf").rulesVersion;
  expect(currentVersion).not.toBe(olderConfig.rulesVersion);
  expect(event.payload.config.rulesVersion).toBe(olderConfig.rulesVersion);
  const [started] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
  expect(started!.status).toBe("in_progress");
  expect(JSON.parse(started!.config)).toMatchObject(olderConfig);
  expect(Object.keys(JSON.parse(started!.config).modelRouting.contestants)).toHaveLength(6);
});

test("custom setup, provider policy, casting and visuals survive lobby start", async () => {
  await grantTestAuthority(db, "owner", [], "admin");
  const setup = {playerCount:7 as const,wolves:2 as const,seer:false,doctor:true};
  const g = await createWerewolfLobby(db,"owner",{preset:"two_wolves",setup,visualMode:true,personaPool:["observer","aggressive"],fillStrategy:"balanced",providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID,reasoningPolicy:"low"}]});
  expect((await readWerewolfLobby(db,g.id)).playerCount).toBe(7);
  await fillWerewolfLobby(db,g.id);
  await startWerewolfLobby(db,g.id);
  const state = replayWerewolf(await readWerewolfEvents(db,g.id));
  expect(state.config.setup).toEqual(setup);
  expect(state.players).toHaveLength(7);
  expect(new Set(state.players.map(p=>p.personaKey))).toEqual(new Set(["observer","aggressive"]));
  const roles = Object.values(state.roles);
  expect(roles.filter(r=>r==="werewolf")).toHaveLength(2);
  expect(roles).not.toContain("seer");
  expect(roles.filter(r=>r==="doctor")).toHaveLength(1);
  const [row] = await db.select().from(schema.games).where(eq(schema.games.id,g.id));
  expect(JSON.parse(row!.config)).toMatchObject({visualMode:true,modelRouting:{defaultManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID,reasoningPolicy:"low"}]}});
});

test("disabled Werewolf rejects creation and discovery but leaves existing game reads available",async()=>{
  const g = await create();
  const old=process.env.NEXT_PUBLIC_ENABLED_GAMES;
  try {
    process.env.NEXT_PUBLIC_ENABLED_GAMES="influence";
    await expect(create()).rejects.toThrow("unavailable");
    expect(await (await createWerewolfRoutes(db).request("/api/werewolf")).json()).toEqual([]);
    expect((await readWerewolfLobby(db,g.id)).id).toBe(g.id);
  } finally {if(old===undefined)delete process.env.NEXT_PUBLIC_ENABLED_GAMES;else process.env.NEXT_PUBLIC_ENABLED_GAMES=old;}
});

test.each(["gamer", "admin", "sysop", "player", "producer"])("only operator roles may start: %s", async role => {
  const { grantTestAuthority } = await import("./rbac-fixtures.js");
  // Even an accidentally granted permission cannot authorize other roles.
  await grantTestAuthority(db, "owner", ["start_game", "create_game"], role);
  const token = await createSessionToken("owner", { roles: ["sysop"], permissions: ["start_game", "create_game"] });
  const game = await create();
  await fillWerewolfLobby(db, game.id);
  const app = createWerewolfRoutes(db);
  const response = await app.request(`/api/werewolf/${game.id}/start`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const allowed = ["gamer", "admin", "sysop"].includes(role);
  expect(response.status).toBe(allowed ? 200 : 403);
  expect((await readWerewolfLobby(db, game.id)).status).toBe(allowed ? "in_progress" : "waiting");
  if (!allowed) {
    expect(await readWerewolfEvents(db, game.id)).toEqual([]);
    expect((await app.request("/api/werewolf", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  }
});

test("revoking the operator role invalidates an existing start token", async () => {
  const { grantTestAuthority } = await import("./rbac-fixtures.js");
  await grantTestAuthority(db, "owner", ["start_game"], "gamer");
  const token = await createSessionToken("owner", { roles: ["gamer"], permissions: ["start_game"] });
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "owner"));
  const game = await create();
  const response = await createWerewolfRoutes(db).request(`/api/werewolf/${game.id}/start`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  expect(response.status).toBe(403);
  expect(await readWerewolfEvents(db, game.id)).toEqual([]);
});


test("Fill AI persists a complete cast without starting, is idempotent, and Start requires full seats", async () => {
  const game = await create();
  await profile("joined");
  await joinWerewolfLobby(db, game.id, "owner", "joined");
  await expect(startWerewolfLobby(db, game.id)).rejects.toThrow("Fill all seats");
  const results = await Promise.all([fillWerewolfLobby(db, game.id), fillWerewolfLobby(db, game.id)]);
  expect(results.map(result => result.filled).sort()).toEqual([0, 5]);
  const filled = await readWerewolfLobby(db, game.id);
  expect(filled.status).toBe("waiting");
  expect(filled.started).toBe(false);
  expect(filled.players).toHaveLength(6);
  expect(filled.players.filter(player => player.agentProfileId === null)).toHaveLength(5);
  expect(new Set(filled.players.map(player => player.name)).size).toBe(6);
  expect(await readWerewolfEvents(db, game.id)).toEqual([]);
  expect((await claimWerewolfGame(db, game.id)).ok).toBe(false);
  expect(JSON.stringify(filled)).not.toContain("personality");
  expect(JSON.stringify(filled)).not.toContain("strategy");
  const listed = await (await createWerewolfRoutes(db).request("/api/werewolf")).json();
  expect(listed).toMatchObject([{ joinedPlayers: 6, episode: { cast: filled.episode.cast } }]);
  const house = filled.players.find(player => player.agentProfileId === null)!;
  await expect(leaveWerewolfLobby(db, game.id, "guest", house.id)).rejects.toThrow("only remove");
  const { grantTestAuthority } = await import("./rbac-fixtures.js");
  await grantTestAuthority(db, "owner", [], "sysop");
  await leaveWerewolfLobby(db, game.id, "owner", house.id);
  await expect(startWerewolfLobby(db, game.id)).rejects.toThrow("Fill all seats");
  await fillWerewolfLobby(db, game.id);
  const final = await readWerewolfLobby(db, game.id);
  await startWerewolfLobby(db, game.id);
  const state = replayWerewolf(await readWerewolfEvents(db, game.id));
  expect(state.players.map(player => ({ id: player.id, name: player.name }))).toEqual(final.players.map(player => ({ id: player.id, name: player.name })));
  await expect(fillWerewolfLobby(db, game.id)).rejects.toThrow("no longer");
});

test("Fill AI checks current fill permission independently of start permission", async () => {
  const { grantTestAuthority } = await import("./rbac-fixtures.js");
  await grantTestAuthority(db, "owner", ["fill_game"], "filler");
  const token = await createSessionToken("owner", { roles: ["filler"], permissions: ["fill_game"] });
  const app = createWerewolfRoutes(db), game = await create();
  const headers = { authorization: `Bearer ${token}` };
  expect((await app.request(`/api/werewolf/${game.id}/fill`, { method: "POST" })).status).toBe(401);
  expect((await app.request(`/api/werewolf/${game.id}/fill`, { method: "POST", headers })).status).toBe(200);
  expect((await app.request(`/api/werewolf/${game.id}/start`, { method: "POST", headers })).status).toBe(403);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "owner"));
  expect((await app.request(`/api/werewolf/${game.id}/fill`, { method: "POST", headers })).status).toBe(403);
});
