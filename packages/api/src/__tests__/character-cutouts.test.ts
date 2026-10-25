import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { acceptCutout, claimCutout, cutoutMode, CUTOUT_RECIPE, enqueueCutout, expireCutoutLeases, prepareCutoutDemands, readyCharacterCutoutUrls, readyCutoutsByHash, requestCharacterCutouts, reserveCutout } from "../services/character-cutouts.js";
import { createCharacterCutoutRoutes } from "../routes/character-cutouts.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
import { createSessionToken } from "../middleware/auth.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { storeBinary, storeJson } from "../services/payload-storage.js";
import { createVisualRoutes } from "../routes/visual.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { readWerewolfWatch } from "../services/werewolf-presentation.js";
import { readWerewolfProductionCharacter, readWerewolfProductionSource } from "../services/werewolf-production-source.js";

let db: DrizzleDB;
let source: Buffer, cutout: Buffer;
const saved = { ...process.env };
beforeEach(async () => {
  db = await setupTestDB();
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  process.env.CHARACTER_CUTOUT_MODE = "local";
  process.env.CUTOUT_API_URL = "http://host.docker.internal:3018";
  source = await sharp({ create: { width: 8, height: 12, channels: 3, background: "red" } }).png().toBuffer();
  const pixels = Buffer.alloc(8 * 12 * 4, 255); pixels[3] = 0;
  cutout = await sharp(pixels, { raw: { width: 8, height: 12, channels: 4 } }).png().toBuffer();
  await db.insert(schema.games).values({ id: "cutouts-game", slug: "cutouts-game", status: "completed", config: "{}" });
});
afterEach(() => {
  for (const key of ["CHARACTER_CUTOUT_MODE", "CUTOUT_API_URL", "INFLUENCE_DEPLOYMENT_ENVIRONMENT", "JWT_SECRET"]) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

test("sources deduplicate; duplicate workers and stale leases cannot publish", async () => {
  const first = await enqueueCutout(db, source), second = await enqueueCutout(db, source);
  expect(second.id).toBe(first.id);
  const reservation = (await reserveCutout(db, first.id))!;
  expect(await reserveCutout(db, first.id)).toBeNull();
  expect(await claimCutout(db, first.id, "wrong", CUTOUT_RECIPE)).toBeUndefined();
  expect(await claimCutout(db, first.id, reservation.token, "wrong-recipe")).toBeUndefined();
  expect(await claimCutout(db, first.id, reservation.token, CUTOUT_RECIPE)).toBeDefined();
  expect(await claimCutout(db, first.id, reservation.token, CUTOUT_RECIPE)).toBeUndefined();
  await expect(acceptCutout(db, first.id, reservation.token, source)).rejects.toThrow("RGBA PNG");
  const wrongDimensions = await sharp(cutout).resize(4, 6).png().toBuffer();
  await expect(acceptCutout(db, first.id, reservation.token, wrongDimensions)).rejects.toThrow("source dimensions");
  const opaque = await sharp(source).ensureAlpha().png().toBuffer();
  await expect(acceptCutout(db, first.id, reservation.token, opaque)).rejects.toThrow("foreground and transparent background");
  await expireCutoutLeases(db, new Date(Date.now() + 2 * 3600_000));
  expect(await acceptCutout(db, first.id, reservation.token, cutout)).toBe(false);
  const retry = (await reserveCutout(db, first.id))!;
  expect(await claimCutout(db, first.id, reservation.token, CUTOUT_RECIPE)).toBeUndefined();
  await claimCutout(db, first.id, retry.token, CUTOUT_RECIPE);
  expect(await acceptCutout(db, first.id, retry.token, cutout)).toBe(true);
  expect(await acceptCutout(db, first.id, retry.token, cutout)).toBe(false);
});

test("playback keeps original until ready; exact binding and hidden-game checks protect output", async () => {
  const job = await enqueueCutout(db, source);
  await db.insert(schema.agentContentAssets).values({ hash: job.sourceHash, bytes: await storeBinary(source) });
  const sources = { p1: `sha256:${job.sourceHash}` };
  expect(await requestCharacterCutouts(db, "cutouts-game", sources)).toEqual({});
  await prepareCutoutDemands(db);
  const reservation = (await reserveCutout(db, job.id))!;
  const app = createCharacterCutoutRoutes(db);
  const auth = { Authorization: `Bearer ${reservation.token}` };
  expect((await app.request(`/api/internal/cutouts/${job.id}/source`, { headers: auth })).status).toBe(404);
  expect(await (await app.request(`/api/internal/cutouts/${job.id}/claim`, { method: "POST", headers: auth, body: JSON.stringify({ recipe: CUTOUT_RECIPE }) })).json()).toEqual({ claimed: true, sourceHash: job.sourceHash });
  expect(Buffer.from(await (await app.request(`/api/internal/cutouts/${job.id}/source`, { headers: auth })).arrayBuffer())).toEqual(Buffer.from(source));
  expect((await app.request(`/api/internal/cutouts/${job.id}/result`, { method: "PUT", headers: auth, body: cutout })).status).toBe(200);
  const ready = await requestCharacterCutouts(db, "cutouts-game", sources);
  expect(ready.p1).toContain("/cutouts/");
  expect(await requestCharacterCutouts(db, "cutouts-game", { p1: "changed-source" })).toEqual({});
  const response = await app.request(ready.p1!);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(cutout));
  process.env.CHARACTER_CUTOUT_MODE = "disabled";
  expect(await requestCharacterCutouts(db, "cutouts-game", sources)).toEqual(ready);
  expect(Buffer.from(await (await app.request(ready.p1!)).arrayBuffer())).toEqual(Buffer.from(cutout));
  const existingDemands = await db.select().from(schema.characterCutoutDemands);
  expect(await requestCharacterCutouts(db, "cutouts-game", { p2: "unprepared-source" })).toEqual({});
  expect(await db.select().from(schema.characterCutoutDemands)).toEqual(existingDemands);
  expect((await app.request(ready.p1!.replace("cutouts-game", "another-game"))).status).toBe(404);
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, "cutouts-game"));
  expect((await app.request(ready.p1!)).status).toBe(404);
});

test("Influence metadata adopts a cutout while fixed snapshots retain their original", async () => {
  await db.insert(schema.visualArtifacts).values({ id: "body-art", gameId: "cutouts-game", image: await storeBinary(source), contentHash: "source", width: 8, height: 12 });
  await db.insert(schema.visualGameAssets).values({ gameId: "cutouts-game", profiles: [], cast: [{ id: "p1", name: "Example", referenceArtifactId: "body-art", performanceInstructions: "", portraitFallback: false }] });
  const route = createVisualRoutes(db);
  const read = async (path: string) => (await (await route.request(path)).json()) as { fullBodies: Record<string, string> };
  const before = await read("/api/games/cutouts-game/visual");
  expect(before.fullBodies.p1).toBe("/api/games/cutouts-game/visual/artifacts/body-art");
  await prepareCutoutDemands(db);
  const [job] = await db.select().from(schema.characterCutouts);
  const reservation = (await reserveCutout(db, job!.id))!;
  await claimCutout(db, job!.id, reservation.token, CUTOUT_RECIPE);
  await acceptCutout(db, job!.id, reservation.token, cutout);
  expect((await read("/api/games/cutouts-game/visual")).fullBodies.p1).toContain("/cutouts/");
  expect((await read("/api/games/cutouts-game/visual?snapshot=%7B%7D")).fullBodies.p1).toBe(before.fullBodies.p1);
});

test("disabled generation preserves authorized producer cutout reads while hidden games stay private", async () => {
  const job = await enqueueCutout(db, source);
  await db.insert(schema.agentContentAssets).values({ hash: job.sourceHash, bytes: await storeBinary(source) });
  const sources = { p1: `sha256:${job.sourceHash}` };
  await requestCharacterCutouts(db, "cutouts-game", sources);
  await prepareCutoutDemands(db);
  const reserved = (await reserveCutout(db, job.id))!;
  await claimCutout(db, job.id, reserved.token, CUTOUT_RECIPE);
  await acceptCutout(db, job.id, reserved.token, cutout);
  const ready = await readyCharacterCutoutUrls(db, "cutouts-game", sources);
  const url = ready.p1!.replace("/api/games/", "/api/admin/production/games/");
  await db.insert(schema.users).values({ id: "cutout-producer" });
  await grantTestAuthority(db, "cutout-producer", [], "producer");
  process.env.JWT_SECRET = "cutout-producer-regression";
  const token = await createSessionToken("cutout-producer");
  const app = createVisualReplayProductionRoutes(db);
  process.env.CHARACTER_CUTOUT_MODE = "disabled";
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, "cutouts-game"));
  expect((await createCharacterCutoutRoutes(db).request(ready.p1!)).status).toBe(404);
  expect((await app.request(url)).status).toBe(401);
  const headers = { Authorization: `Bearer ${token}` };
  expect((await app.request(url.replace("cutouts-game", "other-game"), { headers })).status).toBe(404);
  const response = await app.request(url, { headers });
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(cutout));
});

test("live cutout reads include an accepted result within the current JavaScript millisecond", async () => {
  const job = await enqueueCutout(db, source);
  await db.insert(schema.agentContentAssets).values({ hash: job.sourceHash, bytes: await storeBinary(source) });
  const sources = { p1: `sha256:${job.sourceHash}` };
  await requestCharacterCutouts(db, "cutouts-game", sources);
  await prepareCutoutDemands(db);
  const reserved = (await reserveCutout(db, job.id))!;
  expect((await claimCutout(db, job.id, reserved.token, CUTOUT_RECIPE))?.status).toBe("running");
  expect(await acceptCutout(db, job.id, reserved.token, cutout)).toBe(true);
  // Keep a half-millisecond that Date cannot represent, safely before the real
  // acceptance time so the database clock never sees a future fixture result.
  const [ready] = await db.update(schema.characterCutouts)
    .set({ readyAt: sql`date_trunc('milliseconds', ready_at) - interval '500 microseconds'` })
    .where(eq(schema.characterCutouts.id, job.id)).returning();
  expect(ready!.status).toBe("ready");
  const [demand] = await db.select().from(schema.characterCutoutDemands);
  expect(demand!.cutoutId).toBe(job.id);
  const cutoff = ready!.readyAt!;
  setSystemTime(cutoff);
  try {
    expect((await readyCharacterCutoutUrls(db, "cutouts-game", sources)).p1).toContain("/cutouts/");
    expect(await readyCharacterCutoutUrls(db, "cutouts-game", sources, cutoff)).toEqual({});
    expect((await readyCharacterCutoutUrls(db, "cutouts-game", sources, new Date(cutoff.getTime() + 1))).p1).toContain("/cutouts/");
  } finally { setSystemTime(); }
});

test("failed jobs stop after three leases and viewers do not reset retry budgets", async () => {
  const job = await enqueueCutout(db, source);
  for (let i = 0; i < 3; i++) {
    expect(await reserveCutout(db, job.id)).not.toBeNull();
    await expireCutoutLeases(db, new Date(Date.now() + 2 * 3600_000));
  }
  expect(await reserveCutout(db, job.id)).toBeNull();
  const [failed] = await db.select().from(schema.characterCutouts).where(eq(schema.characterCutouts.id, job.id));
  expect(failed!.status).toBe("failed"); expect(failed!.attempts).toBe(3);
});

test("completion cutoff pins both absent and ready cutouts for production exports", async () => {
  const before = new Date(Date.now() - 1000);
  const job = await enqueueCutout(db, source);
  await db.insert(schema.agentContentAssets).values({ hash: job.sourceHash, bytes: await storeBinary(source) });
  const sources = { p1: `sha256:${job.sourceHash}` };
  await requestCharacterCutouts(db, "cutouts-game", sources);
  await prepareCutoutDemands(db);
  const reserved = (await reserveCutout(db, job.id))!;
  await claimCutout(db, job.id, reserved.token, CUTOUT_RECIPE);
  await acceptCutout(db, job.id, reserved.token, cutout);
  expect(await readyCharacterCutoutUrls(db, "cutouts-game", sources, before)).toEqual({});
  expect((await readyCutoutsByHash(db, [job.sourceHash], before.toISOString())).size).toBe(0);
  const after = new Date(Date.now() + 1000);
  expect((await readyCharacterCutoutUrls(db, "cutouts-game", sources, after)).p1).toContain("/cutouts/");
  expect((await readyCutoutsByHash(db, [job.sourceHash], after.toISOString())).get(job.sourceHash)?.image?.sha256).toBeDefined();
});

async function werewolfCutoutFixture() {
  const job = await enqueueCutout(db, source);
  const events = await completedWerewolfResultsFixture("saved", "cutouts-game");
  const started = events[0]!;
  if (started.type !== "werewolf.started") throw new Error("Expected fixture start");
  const player = started.payload.players[0]!;
  player.agentProfileId = "example-profile"; player.contentRevisionId = "example-revision";
  await db.insert(schema.users).values({ id: "owner" });
  await db.insert(schema.agentContentRevisions).values({ id: "example-revision", agentProfileId: "example-profile", userId: "owner", fingerprint: "fixture",
    snapshot: await storeJson({ avatarUrl: "portrait", fullBodyReferenceUrl: "body", assets: { portrait: job.sourceHash, body: job.sourceHash } }) });
  await db.insert(schema.agentContentAssets).values({ hash: job.sourceHash, bytes: await storeBinary(source) });
  await db.update(schema.games).set({ gameKind: "werewolf", startedAt: "2026-09-01T00:00:00.000Z" }).where(eq(schema.games.id, "cutouts-game"));
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: "cutouts-game", sequence: event.sequence, event })));
  return { job, player };
}

test("Werewolf fixed windows and character bytes stay pinned while a fresh cutoff adopts ready cutouts", async () => {
  const { job, player } = await werewolfCutoutFixture();
  const cutoff = new Date(Date.now() - 2000).toISOString();
  const watch = await readWerewolfWatch(db, "cutouts-game", "mystery", 1, 64, cutoff);
  expect(watch.players[0]!.fullBodyReferenceUrl).toContain("image=body");
  const route = createWerewolfRoutes(db);
  const body = async (url: string) => {
    const response = await route.request(url);
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  expect(await body(watch.players[0]!.fullBodyReferenceUrl!)).toEqual(Buffer.from(source));
  const pinned = await readWerewolfProductionSource(db, "cutouts-game", { audience: "mystery", thinking: false });
  await prepareCutoutDemands(db);
  const reserved = (await reserveCutout(db, job.id))!;
  await claimCutout(db, job.id, reserved.token, CUTOUT_RECIPE);
  await acceptCutout(db, job.id, reserved.token, cutout);
  expect(await readWerewolfWatch(db, "cutouts-game", "mystery", 1, 64, cutoff)).toEqual(watch);
  expect(await body(watch.players[0]!.fullBodyReferenceUrl!)).toEqual(Buffer.from(source));
  const live = await readWerewolfWatch(db, "cutouts-game", "mystery", 1, 64, new Date(Date.now() + 1000).toISOString());
  expect(await body(live.players[0]!.fullBodyReferenceUrl!)).toEqual(Buffer.from(cutout));
  expect(await body(live.players[0]!.avatarUrl!)).toEqual(Buffer.from(source));
  expect(live.players[0]!.avatarUrl?.split("?")[0]).toBe(watch.players[0]!.avatarUrl?.split("?")[0]);
  const reread = await readWerewolfProductionSource(db, "cutouts-game", { audience: "mystery", thinking: false, snapshot: pinned.snapshot });
  expect(reread.snapshot).toEqual(pinned.snapshot);
  expect((await readWerewolfProductionCharacter(db, "cutouts-game", player.id, { snapshot: pinned.snapshot, image: "body" })).bytes).toEqual(new Uint8Array(source));
  const refreshed = await readWerewolfProductionSource(db, "cutouts-game", { audience: "mystery", thinking: false, snapshot: pinned.snapshot, refreshVisuals: true });
  expect((await readWerewolfProductionCharacter(db, "cutouts-game", player.id, { snapshot: refreshed.snapshot, image: "body" })).bytes).toEqual(new Uint8Array(cutout));
  expect((await readWerewolfProductionCharacter(db, "cutouts-game", player.id, { snapshot: refreshed.snapshot, image: "portrait" })).bytes).toEqual(new Uint8Array(source));
});

test("Werewolf uses a preexisting ready cutout before and after asynchronous demand association", async () => {
  const { job } = await werewolfCutoutFixture();
  const reserved = (await reserveCutout(db, job.id))!;
  await claimCutout(db, job.id, reserved.token, CUTOUT_RECIPE);
  await acceptCutout(db, job.id, reserved.token, cutout);
  const cutoff = new Date(Date.now() + 1000).toISOString();
  const watch = await readWerewolfWatch(db, "cutouts-game", "mystery", 1, 64, cutoff);
  const [pending] = await db.select().from(schema.characterCutoutDemands);
  expect(pending!.cutoutId).toBeNull();
  const route = createWerewolfRoutes(db);
  const response = await route.request(watch.players[0]!.fullBodyReferenceUrl!);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(cutout));
  await prepareCutoutDemands(db);
  const [linked] = await db.select().from(schema.characterCutoutDemands);
  expect(linked!.cutoutId).toBe(job.id);
  expect(await readWerewolfWatch(db, "cutouts-game", "mystery", 1, 64, cutoff)).toEqual(watch);
});

test("disabling generation preserves frozen Werewolf bytes, source hashes and cutoff exclusions", async () => {
  const { job, player } = await werewolfCutoutFixture();
  const original = await readWerewolfProductionSource(db, "cutouts-game", { audience: "mystery", thinking: false });
  const reserved = (await reserveCutout(db, job.id))!;
  await claimCutout(db, job.id, reserved.token, CUTOUT_RECIPE);
  await acceptCutout(db, job.id, reserved.token, cutout);
  const pinned = await readWerewolfProductionSource(db, "cutouts-game", { audience: "mystery", thinking: false });
  const watch = await readWerewolfWatch(db, "cutouts-game", "mystery", 1, 64, pinned.snapshot.publicationCutoff);
  const route = createWerewolfRoutes(db);
  const url = watch.players[0]!.fullBodyReferenceUrl!;
  const body = async () => {
    const response = await route.request(url);
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  expect(await body()).toEqual(Buffer.from(cutout));
  const demands = await db.select().from(schema.characterCutoutDemands);
  for (const environment of ["disabled", "staging"] as const) {
    process.env.CHARACTER_CUTOUT_MODE = "disabled";
    if (environment === "staging") process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT = "staging";
    expect(await body()).toEqual(Buffer.from(cutout));
    const reread = await readWerewolfProductionSource(db, "cutouts-game", { audience: "mystery", thinking: false, snapshot: pinned.snapshot });
    expect(reread.snapshot).toEqual(pinned.snapshot);
    expect(await readWerewolfWatch(db, "cutouts-game", "mystery", 1, 64, pinned.snapshot.publicationCutoff)).toEqual(watch);
    expect((await readWerewolfProductionCharacter(db, "cutouts-game", player.id, { snapshot: pinned.snapshot, image: "body" })).bytes).toEqual(new Uint8Array(cutout));
    expect((await readWerewolfProductionCharacter(db, "cutouts-game", player.id, { snapshot: original.snapshot, image: "body" })).bytes).toEqual(new Uint8Array(source));
    expect(await db.select().from(schema.characterCutoutDemands)).toEqual(demands);
  }
});

test("staging is disabled even when AWS configuration is present", async () => {
  expect(cutoutMode({ CHARACTER_CUTOUT_MODE: "aws-batch", INFLUENCE_DEPLOYMENT_ENVIRONMENT: "staging" })).toBe("disabled");
  expect(cutoutMode({ CHARACTER_CUTOUT_MODE: "local", NODE_ENV: "staging" })).toBe("disabled");
  expect(() => cutoutMode({ CHARACTER_CUTOUT_MODE: "local", CUTOUT_API_URL: "http://example.com" })).toThrow("localhost");
  process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT = "staging";
  expect(await requestCharacterCutouts(db, "cutouts-game", { p: "ignored" })).toEqual({});
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
  expect((await createCharacterCutoutRoutes(db).request("/api/internal/cutouts/test/source")).status).toBe(404);
});

test("failed derivatives preserve original playback and fixed export references", async () => {
  await db.insert(schema.visualArtifacts).values({ id: "failed-body", gameId: "cutouts-game", image: await storeBinary(source), contentHash: "source", width: 8, height: 12 });
  await db.insert(schema.visualGameAssets).values({ gameId: "cutouts-game", profiles: [], cast: [{ id: "p1", name: "Example", referenceArtifactId: "failed-body", performanceInstructions: "", portraitFallback: false }] });
  const route = createVisualRoutes(db);
  const read = async (suffix = "") => (await (await route.request(`/api/games/cutouts-game/visual${suffix}`)).json()) as { fullBodies: Record<string, string> };
  const original = (await read()).fullBodies.p1;
  await prepareCutoutDemands(db);
  const [job] = await db.select().from(schema.characterCutouts);
  for (let i = 0; i < 3; i++) { await reserveCutout(db, job!.id); await expireCutoutLeases(db, new Date(Date.now() + 3600_001)); }
  expect((await read()).fullBodies.p1).toBe(original);
  expect((await read("?snapshot=%7B%7D")).fullBodies.p1).toBe(original);
  const [failed] = await db.select().from(schema.characterCutouts);
  expect(failed?.status).toBe("failed"); expect(failed?.attempts).toBe(3);
});
