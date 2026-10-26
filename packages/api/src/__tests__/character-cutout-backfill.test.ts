import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { parseCutoutCommand } from "../scripts/backfill-character-cutouts.js";
import { cutoutProgress, discoverCutoutSources, enqueueCutoutSelection, EXAMPLE_MODEL_AGENTS, inspectCutoutSources, retryCutoutFailures, selectCutoutBatch } from "../services/character-cutout-backfill.js";
import { acceptCutout, claimCutout, CUTOUT_RECIPE, expireCutoutLeases, prepareCutoutDemands, reserveCutout } from "../services/character-cutouts.js";
import { payloadHash, storeBinary, storeJson } from "../services/payload-storage.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { contentImageFixture, headPositionFixture } from "./content-image-fixture.js";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";

let db: DrizzleDB, source: Buffer;
const agentId = EXAMPLE_MODEL_AGENTS[0]!;
const saved = { ...process.env };
beforeEach(async () => {
  db = await setupTestDB();
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  process.env.CHARACTER_CUTOUT_MODE = "local";
  process.env.CUTOUT_API_URL = "http://host.docker.internal:3018";
  source = await sharp({ create: { width: 8, height: 12, channels: 3, background: "red" } }).png().toBuffer();
  await db.insert(schema.users).values({ id: "cutout-owner" });
  await db.insert(schema.agentProfiles).values({ id: agentId, userId: "cutout-owner", name: "Example model", personality: "Strategic", fullBodyReferenceUrl: "/api/uploads/local?key=body" });
  await db.insert(schema.agentContentAssets).values({ hash: payloadHash(source), bytes: await storeBinary(source) });
  await db.insert(schema.agentContentRevisions).values({ id: "revision", agentProfileId: agentId, userId: "cutout-owner", fingerprint: "fixture",
    snapshot: await storeJson({ fullBodyReferenceUrl: "/api/uploads/local?key=body", assets: { "/api/uploads/local?key=body": payloadHash(source) } }) });
  await db.update(schema.agentProfiles).set({ contentRevisionId: "revision" }).where(eq(schema.agentProfiles.id, agentId));
});
afterEach(() => {
  for (const key of ["CHARACTER_CUTOUT_MODE", "CUTOUT_API_URL", "INFLUENCE_DEPLOYMENT_ENVIRONMENT"]) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});
async function inventory() { return inspectCutoutSources(db, (await discoverCutoutSources(db, { agent: agentId })).sources); }
async function complete(id: string) {
  const reservation = (await reserveCutout(db, id))!;
  await claimCutout(db, id, reservation.token, CUTOUT_RECIPE);
  const pixels = Buffer.alloc(8 * 12 * 4, 255); pixels[3] = 0;
  await acceptCutout(db, id, reservation.token, await sharp(pixels, { raw: { width: 8, height: 12, channels: 4 } }).png().toBuffer());
}

test("CLI rejects ambiguous environments, staging, remote URLs and implicit/unbounded writes", () => {
  const parse = (args: string[], env = {}) => parseCutoutCommand(args, env);
  expect(() => parse(["run", "--agent", agentId, "--limit", "1"])).toThrow("Explicit");
  expect(() => parse(["run", "--env", "staging", "--agent", agentId])).toThrow("hard-disabled");
  expect(() => parse(["run", "--env", "local", "--agent", agentId, "--limit", "1"], { INFLUENCE_DEPLOYMENT_ENVIRONMENT: "staging" })).toThrow("hard-disabled");
  expect(() => parse(["run", "--env", "local", "--agent", agentId])).toThrow("--limit");
  expect(() => parse(["run", "--env", "local", "--url", "https://example.com"])).toThrow();
  expect(() => parse(["retry", "--env", "local", "--scope", "example-models"])).toThrow("explicitly selected");
  expect(() => parse(["run", "--env", "local", "--agent", agentId, "--limit", "101"])).toThrow();
  expect(() => parse(["run", "--env", "production", "--agent", agentId, "--limit", "1"], { DATABASE_URL: "postgres://production/db", INFLUENCE_DEPLOYMENT_ENVIRONMENT: "prod" })).toThrow("aws-batch");
  expect(parse(["run", "--env", "production", "--agent", agentId, "--limit", "1"], {
    DATABASE_URL: "postgres://production/db", INFLUENCE_DEPLOYMENT_ENVIRONMENT: "prod", CHARACTER_CUTOUT_MODE: "aws-batch",
    CUTOUT_API_URL: "https://house.example", CUTOUT_BATCH_QUEUE: "queue", CUTOUT_BATCH_JOB_DEFINITION: "definition",
  }).mutate).toBe(true);
  expect(parse(["inventory", "--env", "production", "--agent", agentId], { DATABASE_URL: "postgres://production/db", INFLUENCE_DEPLOYMENT_ENVIRONMENT: "prod" }).mutate).toBe(false);
});

test("dry inventory writes nothing; single-shot and reruns deduplicate; ready jobs are skipped", async () => {
  const rows = await inventory();
  expect(rows[0]?.sourceHash).toBe(payloadHash(source));
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
  expect(await db.select().from(schema.characterCutouts)).toHaveLength(0);
  const ids = await enqueueCutoutSelection(db, selectCutoutBatch(rows, 1));
  const second = await enqueueCutoutSelection(db, selectCutoutBatch(await inventory(), 1));
  expect(second).toEqual(ids);
  expect(await db.select().from(schema.characterCutouts)).toHaveLength(1);
  const progress = await cutoutProgress(db, ids);
  await complete(progress.jobs[0]!.id);
  expect((await cutoutProgress(db, ids)).complete).toBe(true);
  expect(selectCutoutBatch(await inventory(), 1)).toHaveLength(0);
});

test("interrupted demand preparation resumes; active leases are untouched; expired leases can resume", async () => {
  const [row] = await inventory();
  await db.insert(schema.characterCutoutDemands).values({ id: "interrupted", gameId: row!.gameId, agentProfileId: row!.agentProfileId, playerId: row!.playerId, sourceKey: row!.sourceKey, recipe: CUTOUT_RECIPE });
  const ids = await enqueueCutoutSelection(db, selectCutoutBatch(await inventory(), 1));
  expect(ids).toEqual(["interrupted"]);
  const job = (await cutoutProgress(db, ids)).jobs[0]!;
  const reservation = (await reserveCutout(db, job.id))!;
  expect(selectCutoutBatch(await inventory(), 1)).toHaveLength(0);
  await expect(retryCutoutFailures(db, "job", [job.id])).rejects.toThrow("failed and unleased");
  await expireCutoutLeases(db, new Date(), [job.id]);
  expect((await cutoutProgress(db, ids)).jobs[0]?.status).toBe("submitted");
  await expireCutoutLeases(db, new Date(Date.now() + 3600_001), [job.id]);
  expect(await claimCutout(db, job.id, reservation.token, CUTOUT_RECIPE)).toBeUndefined();
  await complete(job.id);
  expect((await cutoutProgress(db, ids)).complete).toBe(true);
});

test("failed jobs need an explicit selected retry; mixed/unknown selections fail atomically", async () => {
  const ids = await enqueueCutoutSelection(db, await inventory());
  const job = (await cutoutProgress(db, ids)).jobs[0]!;
  for (let i = 0; i < 3; i++) { await reserveCutout(db, job.id); await expireCutoutLeases(db, new Date(Date.now() + 3600_001), [job.id]); }
  expect(selectCutoutBatch(await inventory(), 1)).toHaveLength(0);
  await expect(retryCutoutFailures(db, "job", [job.id, "unknown"])).rejects.toThrow();
  expect((await cutoutProgress(db, ids)).jobs[0]?.status).toBe("failed");
  await retryCutoutFailures(db, "job", [job.id]);
  await complete(job.id);
  expect((await cutoutProgress(db, ids)).complete).toBe(true);
});

test("source failure persists, unrelated preparation stays untouched, explicit demand retry recovers", async () => {
  source = await sharp({ create: { width: 8, height: 12, channels: 3, background: "blue" } }).png().toBuffer();
  const rows = await inventory();
  rows[0]!.sourceKey = `sha256:${payloadHash(source)}`;
  const ids = await enqueueCutoutSelection(db, rows);
  expect((await cutoutProgress(db, ids)).failed).toBe(true);
  expect(selectCutoutBatch(await inspectCutoutSources(db, rows), 1)).toHaveLength(0);
  await db.insert(schema.characterCutoutDemands).values({ id: "unrelated", agentProfileId: agentId, playerId: agentId, sourceKey: "https://untrusted.invalid/image.png", recipe: CUTOUT_RECIPE });
  await db.insert(schema.agentContentAssets).values({ hash: payloadHash(source), bytes: await storeBinary(source) });
  await retryCutoutFailures(db, "demand", ids);
  await prepareCutoutDemands(db, ids);
  const [unrelated] = await db.select().from(schema.characterCutoutDemands).where(eq(schema.characterCutoutDemands.id, "unrelated"));
  expect(unrelated?.error).toBeNull(); expect(unrelated?.cutoutId).toBeNull();
  await complete((await cutoutProgress(db, ids)).jobs[0]!.id);
  expect((await cutoutProgress(db, ids)).complete).toBe(true);
});

test("remaining cohort discovers Influence and canonical Werewolf games without substituting current profile art", async () => {
  await db.insert(schema.games).values([{ id: "influence", slug: "influence", config: "{}" }, { id: "werewolf", slug: "werewolf", config: "{}", gameKind: "werewolf" }]);
  await db.insert(schema.gamePlayers).values({ id: "player", gameId: "influence", agentProfileId: agentId, persona: JSON.stringify({ fullBodyReferenceUrl: "/api/uploads/local?key=old" }), agentConfig: "{}" });
  await db.insert(schema.visualArtifacts).values({ id: "frozen", gameId: "influence", image: await storeBinary(source), contentHash: payloadHash(source), width: 8, height: 12 });
  await db.insert(schema.visualGameAssets).values({ gameId: "influence", profiles: [], cast: [{ id: "player", name: "Historical", referenceArtifactId: "frozen", portraitFallback: false, performanceInstructions: "" }] });
  const events = await completedWerewolfResultsFixture("saved", "werewolf");
  const start = events[0]!; if (start.type !== "werewolf.started") throw new Error("No start");
  start.payload.players[0]!.agentProfileId = agentId; start.payload.players[0]!.contentRevisionId = "revision";
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: "werewolf", sequence: event.sequence, event })));
  const { sources } = await discoverCutoutSources(db, { scope: "example-models" });
  expect(sources).toHaveLength(3);
  expect(sources.find(s => s.gameId === "influence")?.sourceKey).toBe("/api/games/influence/visual/artifacts/frozen");
  expect(sources.find(s => s.gameId === "werewolf")?.sourceKey).toBe(`sha256:${payloadHash(source)}`);
  const first = await enqueueCutoutSelection(db, selectCutoutBatch(await inspectCutoutSources(db, sources), 1));
  await complete((await cutoutProgress(db, first)).jobs[0]!.id);
  const remaining = selectCutoutBatch(await inspectCutoutSources(db, sources), 100);
  expect(remaining).toHaveLength(2);
  await enqueueCutoutSelection(db, remaining);
  expect(await db.select().from(schema.characterCutouts)).toHaveLength(1);
  expect(selectCutoutBatch(await inspectCutoutSources(db, sources), 100)).toHaveLength(0);
});

test("ordinary new-agent creation records captured body demand without inference or changing identity", async () => {
  const url = await contentImageFixture("avatars/cutout-new.png");
  const created = await createOwnedAgentProfile(db, { userId: "cutout-owner" }, { name: "New cutout agent", personality: "Patient", fullBodyReferenceUrl: url, headPosition: await headPositionFixture(url) });
  const rows = await db.select().from(schema.characterCutoutDemands);
  expect(rows).toHaveLength(1); expect(rows[0]?.agentProfileId).toBe(created.profile.id);
  expect(rows[0]?.sourceKey).toMatch(/^sha256:/);
  expect(created.profile.fullBodyReferenceUrl).toBe(url);
  expect(await db.select().from(schema.characterCutouts)).toHaveLength(0);
  await prepareCutoutDemands(db);
  expect((await cutoutProgress(db, [rows[0]!.id])).jobs[0]?.status).toBe("pending");
});

test("ordinary agent creation succeeds while cutouts are staging-disabled", async () => {
  process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT = "staging";
  const url = await contentImageFixture("avatars/cutout-staging.png");
  const created = await createOwnedAgentProfile(db, { userId: "cutout-owner" }, { name: "Staging cutout agent", personality: "Patient", fullBodyReferenceUrl: url, headPosition: await headPositionFixture(url) });
  expect(created.profile.fullBodyReferenceUrl).toBe(url);
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
});
