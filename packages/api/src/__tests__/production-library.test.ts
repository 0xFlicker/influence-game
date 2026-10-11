import { fixtureWerewolfRetrospective } from "@influence/engine";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { advanceWerewolf, nextWerewolfStep, replayWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import { werewolfConversationScene } from "@influence/engine/werewolf/visual-scenes";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
import { parseProductionLibraryQuery, readProductionLibrary } from "../services/production-library.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore } from "../services/werewolf-games.js";
import { pauseWerewolfForVisuals, WerewolfVisualBlocked } from "../services/werewolf-visual-policy.js";
import { insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

let db: DrizzleDB;
const originalSecret = process.env.JWT_SECRET;
const producer = { roles: ["producer"], permissions: [] };
beforeEach(async () => {
  db = await setupTestDB();
  process.env.JWT_SECRET = "production-library-local-test";
  await db.insert(schema.users).values({ id: "operator" });
});
afterEach(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
async function game(id: string, createdAt = "2026-10-09T12:00:00.000Z") {
  await db.insert(schema.games).values({ id, slug: id, status: "completed", createdAt,
    config: JSON.stringify({ privateEvidence: "must not be serialized", visualMode: true }) });
}
async function influencePause(id: string) {
  await game(id);
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, id));
  const ownerEpoch = await insertOwner(db, id);
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(id));
  await initializeGameExecutionAuthority(db, createInitialGameExecutionStateV1({ gameId: id, ownerEpoch,
    xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } }));
  await db.update(schema.games).set({ status: "suspended", config: JSON.stringify({ visualMode: true,
    visualPause: { boundarySequence: 0, reason: "Private preparation detail" } }) }).where(eq(schema.games.id, id));
}
async function headers(permissions: string[], roles: string[] = []) {
  for (const name of permissions) await db.insert(schema.permissions).values({ id: name, name });
  await db.insert(schema.roles).values({ id: "fixture-role", name: roles[0] ?? "fixture-admin" });
  await db.insert(schema.userRoles).values({ userId: "operator", roleId: "fixture-role" });
  if (permissions.length) await db.insert(schema.rolePermissions).values(permissions.map(name => ({ roleId: "fixture-role", permissionId: name })));
  return { Authorization: `Bearer ${await createSessionToken("operator", { roles: ["sysop"], permissions: ["start_game"] })}` };
}

test("library is a bounded metadata allowlist with stable keyset pages", async () => {
  for (const id of ["a", "b", "c"]) await game(id, "2026-10-09T12:00:00.123456Z");
  await db.insert(schema.gameEpisodePresentations).values({ gameId: "b", title: "A public episode", description: "Private draft copy", status: "ready" });
  const first = await readProductionLibrary(db, parseProductionLibraryQuery({ limit: "2" }), producer);
  expect(first.items.map(row => row.id)).toEqual(["c", "b"]);
  expect(first.nextCursor).toBeString();
  const second = await readProductionLibrary(db, parseProductionLibraryQuery({ limit: "2", cursor: first.nextCursor! }), producer);
  expect(second.items.map(row => row.id)).toEqual(["a"]);
  expect(second.nextCursor).toBeNull();
  const serialized = JSON.stringify(first);
  for (const secret of ["privateEvidence", "must not be serialized", "Private draft copy", "config", "cast", "jobs", "transcripts"]) expect(serialized).not.toContain(secret);
  expect(first.items[0]?.capabilities).toMatchObject({ sceneRepair: true, resume: false, episodeRead: false, episodeEdit: false });
});

test("kind, status, literal search and attention filters apply before pagination", async () => {
  await game("ordinary"); await game("literal_percent%"); await influencePause("paused");
  await db.insert(schema.games).values({ id: "wolf", slug: "wolf", gameKind: "werewolf", status: "completed", config: "{}" });
  expect((await readProductionLibrary(db, parseProductionLibraryQuery({ kind: "werewolf" }), producer)).items.map(row => row.id)).toEqual(["wolf"]);
  expect((await readProductionLibrary(db, parseProductionLibraryQuery({ search: "%" }), producer)).items.map(row => row.id)).toEqual(["literal_percent%"]);
  expect((await readProductionLibrary(db, parseProductionLibraryQuery({ status: "suspended", attention: "needs_attention" }), producer)).items.map(row => row.id)).toEqual(["paused"]);
  await db.insert(schema.gameEpisodePresentations).values({ gameId: "ordinary", title: "Searchable title", status: "failed", failure: "private failure" });
  const failed = await readProductionLibrary(db, parseProductionLibraryQuery({ search: "Searchable", attention: "needs_attention" }), producer);
  expect(failed.items.map(row => row.id)).toEqual(["ordinary"]);
  expect(JSON.stringify(failed)).not.toContain("private failure");
});

test("invalid paused candidates cannot strand the following page or acquire recovery capabilities", async () => {
  await game("a-valid"); await game("z-invalid");
  await db.update(schema.games).set({ status: "suspended", config: JSON.stringify({ visualMode: true,
    visualPause: { boundarySequence: 999, reason: "Forged pause" } }) }).where(eq(schema.games.id, "z-invalid"));
  const first = await readProductionLibrary(db, parseProductionLibraryQuery({ limit: "1" }), producer);
  expect(first.items).toEqual([]); expect(first.skippedInvalidPauses).toBe(1); expect(first.nextCursor).toBeString();
  const second = await readProductionLibrary(db, parseProductionLibraryQuery({ limit: "1", cursor: first.nextCursor! }), producer);
  expect(second.items.map(row => row.id)).toEqual(["a-valid"]);
});

const agent: WerewolfAgent = { getRetrospectiveStatement: fixtureWerewolfRetrospective, async decide({ request }) {
  if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
  if (request.legalTargetIds.length) return { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" };
  return { kind: "speech", text: "Fixture contribution", cue: null };
} };
test.each(["scene", "form"] as const)("validated Werewolf %s pause is discoverable without private work details", async kind => {
  const created = await createWerewolfGame(db, "operator", { preset: kind === "form" ? "one_wolf" : "two_wolves", maxDays: 1, agentProfileIds: [] });
  const [row] = await db.select().from(schema.games).where(eq(schema.games.id, created.id));
  await db.update(schema.games).set({ config: JSON.stringify({ ...JSON.parse(row!.config), visualMode: true, visualFailurePolicy: "require_visuals" }) }).where(eq(schema.games.id, created.id));
  const claim = await claimWerewolfGame(db, created.id); if (!claim.ok) throw new Error(claim.error);
  const store = createWerewolfStore(db, created.id, claim.claim.ownerEpoch);
  let paused = false;
  for (let i = 0; i < 200; i++) {
    const state = replayWerewolf(await store.read()), step = nextWerewolfStep(state);
    if (step.kind === "action" && step.request.action === (kind === "form" ? "attack" : "pack_talk")) {
      const work = kind === "form" ? { kind, playerId: step.request.actorId } : { kind, descriptor: werewolfConversationScene(state, step.request.action)! };
      await pauseWerewolfForVisuals(db, new WerewolfVisualBlocked(created.id, claim.claim.ownerEpoch, state.sequence, work, "Private pause detail"), new AbortController().signal);
      paused = true; break;
    }
    await advanceWerewolf(store, agent);
  }
  expect(paused).toBe(true);
  const library = await readProductionLibrary(db, parseProductionLibraryQuery({}), producer);
  expect(library.items[0]).toMatchObject({ id: created.id, recovery: kind, capabilities: { visualRead: true, sceneRepair: kind === "scene", resume: false, formRepair: kind === "form" } });
  for (const secret of ["Private pause detail", "playerId", "wolfIds", "descriptor", "thinking"]) expect(JSON.stringify(library)).not.toContain(secret);
});

const adminCases: Array<{ permissions: string[] }> = [{ permissions: ["view_admin"] }, { permissions: ["view_admin", "start_game"] }, { permissions: ["manage_roles"] }];
test.each(adminCases)("admin discovery grants %j do not grant producer details", async ({ permissions }) => {
  await influencePause("influence-paused");
  const authorization = await headers(permissions), app = createVisualReplayProductionRoutes(db);
  const response = await app.request("/api/admin/production/library", { headers: authorization });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const result = await response.json() as Awaited<ReturnType<typeof readProductionLibrary>>;
  expect(result.items[0]?.recovery).toBe("visual");
  expect(result.items[0]?.capabilities).toMatchObject({ editorial: false, resume: permissions.includes("start_game"), sceneRepair: permissions.includes("start_game"), visualRead: permissions.includes("view_admin") });
  for (const path of ["/api/admin/production/games", "/api/admin/production/games/influence-paused/visual", "/api/admin/production/games/influence-paused/visual/evidence/artifact/private"]) expect((await app.request(path, { headers: authorization })).status).toBe(403);
  expect((await app.request("/api/admin/production/games/influence-paused/visual/media", { method: "POST", headers: authorization, body: "{}" })).status).toBe(403);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "operator"));
  expect((await app.request("/api/admin/production/library", { headers: authorization })).status).toBe(403);
});

test("producer-only discovery is allowed; denied and anonymous callers remain denied", async () => {
  await game("completed"); const authorization = await headers([], ["producer"]), app = createVisualReplayProductionRoutes(db);
  expect((await app.request("/api/admin/production/library", { headers: authorization })).status).toBe(200);
  expect((await app.request("/api/admin/production/library")).status).toBe(401);
  await db.update(schema.roles).set({ name: "unprivileged" }).where(eq(schema.roles.id, "fixture-role"));
  expect((await app.request("/api/admin/production/library", { headers: authorization })).status).toBe(403);
});

test("exact Influence visual workspace preserves active-game inspection without expanding the library or editorial grants",async () => {
  await game("active-visual");
  await db.update(schema.games).set({status:"in_progress"}).where(eq(schema.games.id,"active-visual"));
  const access = {roles:["producer"],permissions:["view_admin","start_game"]};
  expect((await readProductionLibrary(db,parseProductionLibraryQuery({}),access)).items).toEqual([]);
  const exact = await readProductionLibrary(db,parseProductionLibraryQuery({id:"active-visual",limit:"1"}),access);
  expect(exact.items[0]?.capabilities).toMatchObject({visualRead:true,sceneRepair:true,editorial:false});
  expect((await readProductionLibrary(db,parseProductionLibraryQuery({id:"active-visual",limit:"1"}),producer)).items).toEqual([]);
});

test("malformed filters and cursor fail explicitly before returning a page", async () => {
  const authorization = await headers([], ["producer"]), app = createVisualReplayProductionRoutes(db);
  for (const query of ["limit=0", "limit=101", "limit=1.5", "kind=unknown", "status=in_progress", "attention=all", "cursor=bad", "extra=value", `search=${"a".repeat(201)}`])
    expect((await app.request(`/api/admin/production/library?${query}`, { headers: authorization })).status).toBe(400);
});
