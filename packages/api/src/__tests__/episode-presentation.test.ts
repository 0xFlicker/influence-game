import { createGameRoutes } from "../routes/games.js";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { testUserIdForWallet } from "./rbac-fixtures.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame } from "./durable-run-test-utils.js";
import { decodeEpisodeCopy, queueEpisodeCopy, readEpisodePresentations, readEpisodePreview, runEpisodeJob } from "../services/episode-presentation.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createEpisodeRoutes } from "../routes/episodes.js";

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
  test("fills missing cast portraits from linked profiles without replacing frozen identity or artwork", async () => {
    const id = await insertGame(db);
    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    await db.insert(schema.users).values({ id: userId, walletAddress: "0xportraitowner" });
    await db.insert(schema.agentProfiles).values({ id: profileId, userId, name: "Renamed agent", personality: "Changed", avatarUrl: "/current.png" });
    await db.insert(schema.gamePlayers).values([
      { id: "missing", gameId: id, agentProfileId: profileId, persona: JSON.stringify({ name: "Original name", personaKey: "honest" }), agentConfig: "{}" },
      { id: "frozen", gameId: id, agentProfileId: profileId, persona: JSON.stringify({ name: "Frozen", avatarUrl: "/original.png" }), agentConfig: "{}" },
      { id: "unlinked", gameId: id, persona: JSON.stringify({ name: "No profile" }), agentConfig: "{}" },
    ]);
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, id));
    const readCast = async () => (await readEpisodePresentations(db, [game!])).get(id)!.cast;
    expect(await readCast()).toEqual(expect.arrayContaining([
      { id: "missing", name: "Original name", personaKey: "honest", avatarUrl: "/current.png" },
      { id: "frozen", name: "Frozen", personaKey: null, avatarUrl: "/original.png" },
      { id: "unlinked", name: "No profile", personaKey: null, avatarUrl: null },
    ]));
    await db.update(schema.users).set({ walletAddress: "imported-portraitowner" }).where(eq(schema.users.id, userId));
    const importedCast = await readCast();
    expect(importedCast.find(p => p.id === "missing")?.avatarUrl).toBeNull();
    expect(importedCast.find(p => p.id === "frozen")?.avatarUrl).toBe("/original.png");
    await db.update(schema.users).set({ walletAddress: "0xportraitowner" }).where(eq(schema.users.id, userId));
    await db.update(schema.agentProfiles).set({ avatarUrl: null }).where(eq(schema.agentProfiles.id, profileId));
    expect((await readCast()).find(p => p.id === "missing")?.avatarUrl).toBeNull();
  });
  test("provider failure retains published copy and records failure", async () => {
    const id = await fixture();
    await db.update(schema.gameEpisodePresentations).set({ title: "Existing", description: "Keep me" }).where(eq(schema.gameEpisodePresentations.gameId, id));
    await runEpisodeJob(db, async () => { throw new Error("Bad structured output"); });
    const [row] = await db.select().from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, id));
    expect(row?.status).toBe("failed"); expect(row?.title).toBe("Existing"); expect(row?.failure).toContain("Bad structured output");
  });
  test("hidden previews are not exposed anonymously", async () => {
    const id = await insertGame(db);
    const games = await db.select().from(schema.games).where(eq(schema.games.id, id));
    expect(games).toHaveLength(1);
    await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
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
    await db.insert(schema.userRoles).values({ userId: testUserIdForWallet(wallet), roleId: role!.id, grantedBy: "test" });
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

  test("Werewolf packaging uses the original public cast and never creates Influence rows or reads private scenes", async () => {
    const id = crypto.randomUUID(), slug = "lantern-test";
    const events = await werewolfResultsFixture("village", id);
    await db.insert(schema.games).values({id, slug, gameKind:"werewolf", status:"completed", startedAt:new Date().toISOString(), config:JSON.stringify({visibility:"public",providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]})});
    await db.insert(schema.werewolfEvents).values(events.map(event => ({gameId:id,sequence:event.sequence,event})));
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id,id));
    const preview = await readEpisodePreview(db,game!);
    const opening = events[0]!;
    if (opening.type !== "werewolf.started") throw Error("Missing opening");
    expect(preview.episode.cast.map(p=>p.name)).toEqual(opening.payload.players.map(p=>p.name));
    expect(preview.episode.title).toBe(slug);
    expect(preview.episode.coverUrl).toBeNull();
    expect(preview.frames.every(f=>f.kind !== "scene")).toBe(true);
    const text=JSON.stringify(preview);
    for (const secret of ["SECRET_SEED","SECRET_STRATEGY","SECRET_PACK","SECRET_THINKING","roles","personality"]) expect(text).not.toContain(secret);
    expect(await db.select().from(schema.gamePlayers)).toHaveLength(0);
    expect(await db.select().from(schema.gameEpisodePresentations)).toHaveLength(0);
    // Copy is presentation; direct links retain the slug. Reads neither queue nor generate.
    await db.insert(schema.gameEpisodePresentations).values({gameId:id,title:"Lanterns and Lies",description:"Six contrasting voices gather in the village.",status:"ready",locked:true});
    const app=createWerewolfRoutes(db), episodes=createGameRoutes(db);
    const listed=await (await app.request('/api/werewolf')).json();
    expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({slug,episode:expect.objectContaining({title:"Lanterns and Lies"})})]));
    for (const visibility of ["public","unlisted"]) {
      await db.update(schema.games).set({config:JSON.stringify({visibility,providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]})}).where(eq(schema.games.id,id));
      expect((await episodes.request(`/api/games/${slug}/episode`)).status).toBe(200);
      expect(await (await app.request(`/api/werewolf/${slug}/lobby`)).json()).toMatchObject({episode:{title:"Lanterns and Lies"}});
    }
    expect(await (await app.request('/api/werewolf')).json()).toEqual([]);
    await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,id));
    expect((await episodes.request(`/api/games/${slug}/episode`)).status).toBe(404);
    expect((await app.request(`/api/werewolf/${slug}/lobby`)).status).toBe(404);
  });

  test("Werewolf naming sends only the frozen names and personalities with its own premise", async () => {
    const id = crypto.randomUUID();
    const events = await werewolfResultsFixture("village", id);
    await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "completed", config: "{}" });
    await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
    const opening = events[0]!;
    if (opening.type !== "werewolf.started") throw Error("Missing opening");
    await queueEpisodeCopy(db, id);
    let calls = 0;
    await runEpisodeJob(db, async (cast, _signal, kind) => {
      calls++;
      expect(kind).toBe("werewolf");
      expect(cast).toEqual(opening.payload.players.map(p => ({ name: p.name, personality: p.personality })));
      expect(JSON.stringify(cast)).not.toContain("SECRET_");
      return { title: "Company by Candlelight", description: "Contrasting personalities gather beneath the village lanterns." };
    });
    await runEpisodeJob(db, async () => { throw Error("Must not repeat a completed job"); });
    expect(calls).toBe(1);
    const [row] = await db.select().from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, id));
    expect(row).toMatchObject({ status: "ready", title: "Company by Candlelight" });
    expect(await db.select().from(schema.gamePlayers)).toHaveLength(0);
  });

  test("repeated queue requests preserve active work and edits made after a preview", async () => {
    const id = await fixture();
    expect(await queueEpisodeCopy(db, id, true)).toBe(false);
    await runEpisodeJob(db, async () => {
      expect(await queueEpisodeCopy(db, id, true)).toBe(false);
      return { title: "Finished", description: "Finished copy." };
    });
    expect(await queueEpisodeCopy(db, id)).toBe(false);
    await db.update(schema.gameEpisodePresentations).set({ locked: true }).where(eq(schema.gameEpisodePresentations.gameId, id));
    expect(await queueEpisodeCopy(db, id, true)).toBe(false);
  });

  test("Werewolf backfill previews explicit eligible IDs and queues each once", async () => {
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    await db.insert(schema.games).values(ids.map((id, i) => ({ id, slug: id, config: "{}", gameKind: "werewolf" as const, status: i === 1 ? "waiting" as const : "completed" as const, hiddenAt: i === 2 ? new Date().toISOString() : null })));
    await db.insert(schema.gameEpisodePresentations).values({ gameId: ids[3]!, title: "Protected", locked: true, status: "ready" });
    await seedRBAC(db);
    const userId = crypto.randomUUID();
    await db.insert(schema.users).values({ id: userId });
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "admin"));
    await db.insert(schema.userRoles).values({ userId, roleId: role!.id, grantedBy: "test" });
    const token = await createSessionToken(userId, { roles: ["admin"], permissions: ["view_admin", "manage_postgame_media"] });
    const app = createEpisodeRoutes(db);
    const request = (preview: boolean) => app.request("/api/admin/episodes/backfill", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ gameIds: [...ids, ids[0]], regenerate: true, preview }) });
    expect(await (await request(true)).json()).toMatchObject({ gameIds: [ids[0]], calls: 1, skipped: 3, queued: false });
    expect(await db.select().from(schema.gameEpisodePresentations)).toHaveLength(1);
    expect(await (await request(false)).json()).toMatchObject({ gameIds: [ids[0]], calls: 1, queued: true });
    expect(await (await request(false)).json()).toMatchObject({ calls: 0, skipped: 4 });
  });

  test("missing canonical Werewolf cast fails without a provider call", async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "completed", config: "{}" });
    await queueEpisodeCopy(db, id);
    let called = false;
    await runEpisodeJob(db, async () => { called = true; return { title: "Wrong", description: "Wrong" }; });
    expect(called).toBe(false);
    const [row] = await db.select().from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, id));
    expect(row).toMatchObject({ status: "failed", title: null, failure: "Invalid frozen Werewolf cast" });
  });

});
