import { beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { cutInfluenceFixture } from "@influence/engine/house-cuts/fixtures";
import { insertGame, insertOwner, insertCanonicalEventRows } from "./durable-run-test-utils";
import { discoverCuts } from "@influence/engine/house-cuts/editorial";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { queueHouseCuts } from "../services/house-cut-queue.js";
import { runHouseCutJob } from "../services/house-cut-worker.js";
import { readHouseCuts } from "../services/house-cut-publication.js";
import { createGameResultsRoutes } from "../routes/game-results.js";
import { houseContent, validateHouseInput } from "../game-mcp/house-contracts.js";
let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });
async function fixture() {
  const id = "cut-job-game", slug = "cut-job-slug";
  const events = await werewolfResultsFixture("village", id);
  await db.insert(schema.games).values({ id, slug, gameKind: "werewolf", status: "completed", config: '{"visibility":"public"}' });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
  return { id, slug };
}
const generate: NonNullable<Parameters<typeof runHouseCutJob>[1]> = async ({ source }) => ({
  report: await discoverCuts(source, async r => ({ decoded: { sourceHash: source.hash, windowId: r.window.id, candidates: [] }, kind: "fixture", costUsd: 0 }), { maxCalls: 100, maxInputBytesPerCall: 32000, maxOutputTokensPerCall: 4000 }), selectedKeys: [],
});
test("completion enqueue is idempotent; direct reads and MCP never queue paid work", async () => {
  const { id, slug } = await fixture();
  const data = await readHouseCuts(db, slug);
  expect(data?.status).toBe("not_prepared");
  houseContent("read_game_cuts", data);
  validateHouseInput("read_game_cuts", { gameIdOrSlug: slug, audience: "mystery" });
  expect((await db.select().from(schema.houseCutJobs))).toHaveLength(0);
  await queueHouseCuts(db, id); await queueHouseCuts(db, id);
  expect((await db.select().from(schema.houseCutJobs)).map(r => r.audience).sort()).toEqual(["mystery", "omniscient"]);
});
test("workers claim serially and publish only after validation, keeping audiences isolated", async () => {
  const { id, slug } = await fixture(); await queueHouseCuts(db, id);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const work = runHouseCutJob(db, async options => { entered(); await gate; return generate(options); });
  await started;
  expect(await runHouseCutJob(db, generate)).toBe(false);
  expect((await readHouseCuts(db, slug))?.publication).toBeNull();
  release(); await work; await runHouseCutJob(db, generate);
  for (const audience of ["mystery", "omniscient"] as const) {
    const result = await readHouseCuts(db, slug, audience);
    expect(result?.status).toBe("ready"); expect(result?.publication?.audience).toBe(audience);
    houseContent("read_game_cuts", result);
    expect(JSON.stringify(result)).not.toMatch(/journal|leaseToken|sourceHash|PRIVATE_|failure/);
  }
  expect(await runHouseCutJob(db, generate)).toBe(false);
  const [media] = await db.select().from(schema.gamePostgameMedia).where(eq(schema.gamePostgameMedia.gameId, id));
  expect(media?.status).toBe("queued");
  expect(media?.musicAssetId).toBe("werewolf-suno-trailer-v1");
});
test("hidden and cross-audience reads fail; linked Unlisted works without generation", async () => {
  const { id, slug } = await fixture();
  const app = createGameResultsRoutes(db);
  await db.update(schema.games).set({ config: '{"visibility":"unlisted"}' }).where(eq(schema.games.id, id));
  const response = await app.request(`/api/games/${slug}/cuts?audience=omniscient`);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await app.request(`/api/games/${slug}/cuts?audience=public`)).status).toBe(404);
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
  expect((await app.request(`/api/games/${slug}/cuts`)).status).toBe(404);
  await queueHouseCuts(db, id);
  expect(await db.select().from(schema.houseCutJobs)).toHaveLength(0);
});
test("hide during generation prevents publication ", async () => {
  const { id } = await fixture(); await queueHouseCuts(db, id);
  await runHouseCutJob(db, async options => {
    await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
    return generate(options);
  });
  const jobs = await db.select().from(schema.houseCutJobs);
  expect(jobs.some(j => j.status === "failed")).toBe(true);
  expect(jobs.every(j => j.publication === null)).toBe(true);
});
test("completion rollback leaves no job, Influence queues only one public job", async () => {
  const { id } = await fixture();
  await expect(db.transaction(async tx => { await queueHouseCuts(tx, id); throw Error("rollback"); })).rejects.toThrow();
  expect(await db.select().from(schema.houseCutJobs)).toHaveLength(0);
  await db.update(schema.games).set({ gameKind: "influence" }).where(eq(schema.games.id, id));
  await queueHouseCuts(db, id);
  expect((await db.select().from(schema.houseCutJobs)).map(j => j.audience)).toEqual(["public"]);
});

test("expired jobs resume saved work; unknown dispatches stop without calling a provider", async () => {
  const { id } = await fixture(); await queueHouseCuts(db, id);
  await runHouseCutJob(db, generate);
  const [ready] = await db.select().from(schema.houseCutJobs).where(eq(schema.houseCutJobs.status, "ready"));
  await db.update(schema.houseCutJobs).set({status:"running",leaseUntil:new Date(0),createdAt:new Date(0)}).where(eq(schema.houseCutJobs.id,ready!.id));
  expect(await runHouseCutJob(db, generate)).toBe(true);
  await db.execute(sql`UPDATE house_cut_jobs SET status = 'running', lease_until = '2000-01-01', journal = jsonb_set(journal, '{attempts}', '[{"windowId":"selection","reservedUsd":0.2}]') WHERE id = ${ready!.id}`);
  let invoked = false;
  await runHouseCutJob(db, async options => { invoked = true; return generate(options); });
  expect(invoked).toBe(false);
  const [failed] = await db.select().from(schema.houseCutJobs).where(eq(schema.houseCutJobs.id,ready!.id));
  expect(failed!.status).toBe("failed");
  expect(failed!.publication).toEqual(ready!.publication);
  expect(failed!.failure).toContain("unknown outcome");
});
test("MCP advertises and reads published Cuts without extra scopes or side effects", async () => {
  const { slug } = await fixture();
  const { ProductionGameMcpJsonRpcServer } = await import("../game-mcp/server");
  const { ProductionGameMcpReadModel } = await import("../game-mcp/read-model");
  const server = new ProductionGameMcpJsonRpcServer(new ProductionGameMcpReadModel(db), db, async () => ({clientScopes:["games:read"],hasProducerRole:false,hasModerationRole:false}));
  const auth = { userId:"cut-reader",clientId:"test",resource:"http://localhost:3000/mcp",scope:"games:read",scopes:["games:read"] as const,authProfile:"subject" as const,expiresAt:1800000000 };
  const listed = await server.handle({jsonrpc:"2.0",id:1,method:"tools/list"}, {...auth,scopes:[...auth.scopes]});
  expect(JSON.stringify(listed)).toContain('"name":"read_game_cuts"');
  const result = await server.handle({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"read_game_cuts",arguments:{gameIdOrSlug:slug,audience:"mystery"}}}, {...auth,scopes:[...auth.scopes]});
  expect(result?.error).toBeUndefined();
  expect(JSON.stringify(result)).toContain('"status":"not_prepared"');
  expect(await db.select().from(schema.houseCutJobs)).toHaveLength(0);
});


test("persisted Influence dialogue uses the same generation and publication path", async () => {
  const { events, dialogue } = cutInfluenceFixture();
  const id = await insertGame(db, { id: events[0]!.gameId, status: "completed" });
  const ownerEpoch = await insertOwner(db, id);
  await insertCanonicalEventRows(db, id, ownerEpoch, events);
  await db.insert(schema.transcripts).values(dialogue.map(entry => ({
    gameId: id, round: entry.round, phase: entry.phase, text: entry.text,
    timestamp: entry.timestamp, scope: entry.scope, speakerPlayerId: entry.speakerPlayerId,
    entrySequence: entry.entrySequence, dialogueKind: entry.dialogueKind,
    thinking: "PRIVATE_THINKING_MUST_NOT_LEAVE",
  })));
  await queueHouseCuts(db, id);
  await runHouseCutJob(db, async options => {
    expect(options.source.game.kind).toBe("influence");
    expect(options.source.audience).toBe("public");
    expect(options.source.evidence.filter(e => e.content.kind === "dialogue")).toHaveLength(2);
    expect(JSON.stringify(options.source)).not.toContain("PRIVATE_THINKING");
    return generate(options);
  });
  const result = await readHouseCuts(db, id);
  expect(result?.status).toBe("ready");
  expect(result?.publication?.audience).toBe("public");
  expect(await readHouseCuts(db, id, "omniscient")).toBeNull();
});
