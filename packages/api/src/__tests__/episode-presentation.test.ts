import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame } from "./durable-run-test-utils.js";
import { decodeEpisodeCopy, queueEpisodeCopy, readEpisodePresentations, runEpisodeJob } from "../services/episode-presentation.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createEpisodeRoutes, visibleEpisodeGames } from "../routes/episodes.js";

describe("episode presentation", () => {
  let db: DrizzleDB;
  beforeEach(async () => { db = await setupTestDB(); });
  async function fixture() {
    const id = await insertGame(db, { status: "in_progress", config: { visibility: "public" } });
    await db.insert(schema.gamePlayers).values({ id: crypto.randomUUID(), gameId: id, persona: JSON.stringify({ name: "Mira", personality: "Patient", avatarUrl: "/original.png" }), agentConfig: "{}" });
    await queueEpisodeCopy(db, id); return id;
  }
  test("rejects malformed, fenced, missing and extra structured fields", () => {
    for (const raw of ["not JSON", "```json\n{}\n```", "prefix {}", "{}", '{"title":"Quiet"}', '{"title":"Quiet","description":"Room","winner":"Mira"}', '{"title":"","description":"Room"}', JSON.stringify({ title: "x".repeat(91), description: "Room" })]) expect(() => decodeEpisodeCopy(raw)).toThrow();
  });
  test("publishes validated House copy without altering canonical game identity", async () => {
    const id = await fixture();
    await runEpisodeJob(db, async cast => { expect(cast).toEqual([{ name: "Mira", personality: "Patient" }]); return { title: "Quiet Company", description: "A room full of competing intentions." }; });
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, id));
    const presentation = (await readEpisodePresentations(db, [game!])).get(id)!;
    expect(presentation.title).toBe("Quiet Company"); expect(presentation.status).toBe("ready"); expect(presentation.cast[0]?.avatarUrl).toBe("/original.png"); expect(game?.slug).toBe(`test-${id}`);
  });
  test("a late generation cannot overwrite a concurrent manual edit", async () => {
    const id = await fixture();
    await runEpisodeJob(db, async () => { await db.update(schema.gameEpisodePresentations).set({ title: "My title", description: "My description", locked: true, revision: 1, status: "ready" }).where(eq(schema.gameEpisodePresentations.gameId, id)); return { title: "Old title", description: "Old description" }; });
    const [row] = await db.select().from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, id));
    expect(row?.title).toBe("My title"); expect(row?.status).toBe("ready");
  });
  test("provider failure retains published copy and records failure", async () => {
    const id = await fixture();
    await db.update(schema.gameEpisodePresentations).set({ title: "Existing", description: "Keep me" }).where(eq(schema.gameEpisodePresentations.gameId, id));
    await runEpisodeJob(db, async () => { throw new Error("Bad structured output"); });
    const [row] = await db.select().from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, id));
    expect(row?.status).toBe("failed"); expect(row?.title).toBe("Existing"); expect(row?.failure).toContain("Bad structured output");
  });
  test("private cards and previews are not exposed anonymously", async () => {
    const id = await insertGame(db);
    const games = await db.select().from(schema.games).where(eq(schema.games.id, id));
    expect(await visibleEpisodeGames(db, games)).toEqual([]);
    const app = createEpisodeRoutes(db);
    expect((await app.request(`/api/games/${id}/episode`)).status).toBe(404);
    expect((await app.request(`/api/admin/games/${id}/episode`, { method: "PATCH", body: "{}" })).status).toBe(401);
  });
  test("locked presentation does not queue for regeneration", async () => {
    const id = await fixture();
    await db.update(schema.gameEpisodePresentations).set({ locked: true, status: "ready" }).where(eq(schema.gameEpisodePresentations.gameId, id));
    await queueEpisodeCopy(db, id, true);
    let called = false; await runEpisodeJob(db, async () => { called = true; return { title: "No", description: "No" }; });
    expect(called).toBe(false);
  });
  test("admin edits validate media, reject stale revisions and fence generation", async () => {
    const id = await fixture();
    await seedRBAC(db);
    const userId = crypto.randomUUID();
    const wallet = "0xepisodeadmin";
    await db.insert(schema.users).values({ id: userId, walletAddress: wallet, displayName: "Editor" });
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "admin"));
    await db.insert(schema.addressRoles).values({ walletAddress: wallet, roleId: role!.id, grantedBy: "test" });
    const token = await createSessionToken(userId, { roles: ["admin"], permissions: ["view_admin", "manage_postgame_media"] });
    const app = createEpisodeRoutes(db);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const draft = { title: "New title", description: "A new description", locked: true, revision: 0, coverUrl: null, frameOrder: ["house", "cast:0"] };
    const edit = (body: unknown) => app.request(`/api/admin/games/${id}/episode`, { method: "PATCH", headers, body: JSON.stringify(body) });
    expect((await edit({ ...draft, coverUrl: "https://outside.example/image.jpg" })).status).toBe(400);
    expect((await edit({ ...draft, frameOrder: ["house", "house"] })).status).toBe(400);
    expect((await edit(draft)).status).toBe(200);
    expect((await edit({ ...draft, title: "Stale edit" })).status).toBe(409);
    const result = await app.request("/api/admin/episodes/backfill", { method: "POST", headers, body: JSON.stringify({ gameIds: [id], regenerate: true, preview: true }) });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ calls: 0, skipped: 1 });
  });
  test("malformed structured results cannot become accepted copy", async () => {
    const id = await fixture();
    await runEpisodeJob(db, async () => ({ title: "", description: "Bad" }));
    const [row] = await db.select().from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, id));
    expect(row?.title).toBeNull(); expect(row?.status).toBe("failed");
  });
  test("an unexpired claim prevents a second provider call", async () => {
    const id = await fixture();
    await db.update(schema.gameEpisodePresentations).set({ status: "generating", leaseToken: "active", leaseUntil: new Date(Date.now() + 60_000).toISOString() }).where(eq(schema.gameEpisodePresentations.gameId, id));
    let called = false;
    await runEpisodeJob(db, async () => { called = true; return { title: "Duplicate", description: "Duplicate" }; });
    expect(called).toBe(false);
  });

});
