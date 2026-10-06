import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { advanceWerewolf, replayWerewolf, nextWerewolfStep, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore, readWerewolfEvents } from "../services/werewolf-games.js";
import { createWerewolfVisualPreparation } from "../services/werewolf-visual-runtime.js";
import { pauseWerewolfForVisuals, readWerewolfVisualPause, resumeWerewolfVisualGame, queueWerewolfFormRepair, WerewolfVisualBlocked } from "../services/werewolf-visual-policy.js";
import { setVisualFailurePolicy } from "../services/visual-policy.js";
import { readReplayVisualProduction, renderMissingReplayScene, listReplayVisualGames } from "../services/visual-replay-production.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { controlVisualMedia, readVisualMedia } from "../services/visual-media-repair.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
import { readWerewolfWatch } from "../services/werewolf-presentation.js";
import { createWerewolfLobby } from "../services/werewolf-lobbies.js";
import { createSessionToken } from "../middleware/auth.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
let db: DrizzleDB;
const secret = process.env.JWT_SECRET;
afterEach(() => { if (secret === undefined)
  delete process.env.JWT_SECRET;
else
  process.env.JWT_SECRET = secret; });
beforeEach(async () => { process.env.JWT_SECRET = "w7-test-secret"; db = await setupTestDB(); await db.insert(schema.users).values({ id: "operator" }); });
const agent: WerewolfAgent = { async decide({ request }) {
    if (request.action === "open_thread")
      return { kind: "opening", text: null, cue: null, recipientIds: [] };
    if (request.legalTargetIds.length)
      return { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" };
    return { kind: "speech", text: "Fixture contribution", cue: null };
  } };
async function fixture(preset: "one_wolf" | "two_wolves" = "two_wolves", policy = "require_visuals") {
  const game = await createWerewolfGame(db, "operator", { preset, maxDays: 1, agentProfileIds: [] });
  const [row] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
  await db.update(schema.games).set({ config: JSON.stringify({ ...JSON.parse(row!.config), visualMode: true, visualFailurePolicy: policy }) }).where(eq(schema.games.id, game.id));
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok)
    throw Error(claim.error);
  const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
  return { game, store, epoch: claim.claim.ownerEpoch };
}
async function at(f: Awaited<ReturnType<typeof fixture>>, action: "pack_talk" | "attack" | "open_thread") {
  for (let i = 0; i < 200; i++) {
    const state = replayWerewolf(await f.store.read()), step = nextWerewolfStep(state);
    if (step.kind === "action" && step.request.action === action)
      return { state, request: step.request };
    await advanceWerewolf(f.store, agent);
  }
  throw Error(`Never reached ${action}`);
}
const noForms: NonNullable<Parameters<typeof createWerewolfVisualPreparation>[5]> = async (_db, _id, plan) => plan;
async function fail(f: Awaited<ReturnType<typeof fixture>>, action: "pack_talk" | "attack" = "pack_talk", beforeScene = false) {
  const pending = await at(f, action);
  const prepare = createWerewolfVisualPreparation(db, f.game.id, f.epoch, new AbortController().signal, async () => null, beforeScene ? async () => { throw Error("Form unavailable"); } : noForms);
  await expect(prepare(pending.state, pending.request)).rejects.toBeInstanceOf(WerewolfVisualBlocked);
  return pending;
}
async function resolveForms(...[database, gameId, plan, options]: Parameters<NonNullable<Parameters<typeof createWerewolfVisualPreparation>[5]>>) {
  const bytes = await sharp({ create: { width: 64, height: 96, channels: 3, background: "#334455" } }).png().toBuffer();
  const artifactId = await storeVisualArtifact(database, gameId, bytes);
  const cast = [];
  for (const member of plan.cast) {
    if (!member.variant) {
      cast.push(member);
      continue;
    }
    await options?.guard?.();
    await database.insert(schema.visualCharacterVariants).values({ id: crypto.randomUUID(), gameId, playerId: member.id, sourceArtifactId: member.variant.sourceArtifactId, artifactId, revision: member.variant.revision, generation: member.variant.generation, head: { x: .3, y: .05, width: .3, height: .2 } });
    cast.push({ ...member, referenceArtifactId: artifactId, variant: { ...member.variant, resolved: true } });
  }
  return { ...plan, cast };
}
async function finishRepair(gameId: string) {
  const job = await claimVisualMediaJob(db, "repair-worker");
  if (!job)
    throw Error("Missing job");
  await executeVisualMediaJob(db, job, new AbortController().signal, async () => {
    const artifactId = await storeVisualArtifact(db, gameId, await sharp({ create: { width: 160, height: 90, channels: 3, background: "#334455" } }).png().toBuffer());
    const ids = job.plan.cast.map(m => m.id);
    return { imageArtifactId: artifactId, localization: { count: ids.length, verifiedParticipantIds: ids, anchors: [] }, shots: { mode: "scene", groups: [], overview: { imageArtifactId: artifactId, annotatedArtifactId: artifactId, participantIds: ids, visibleParticipantIds: ids, anchors: [], pointers: [] } } };
  }, resolveForms);
  expect((await readVisualMedia(db, gameId)).jobs.find(j => j.id === job.id)?.status).toBe("ready");
  return job;
}
for (const beforeScene of [false, true])
  test(`require visuals pauses ${beforeScene ? "before a scene exists" : "on a null renderer"}, repairs, publishes, and resumes the exact boundary`, async () => {
    const f = await fixture();
    const pending = await fail(f, "pack_talk", beforeScene);
    const accepted = await f.store.read();
    const pause = await readWerewolfVisualPause(db, f.game.id);
    expect(pause?.boundarySequence).toBe(pending.state.sequence);
    expect((await claimWerewolfGame(db, f.game.id)).ok).toBe(false);
    expect((await listReplayVisualGames(db)).map(g => g.id)).toContain(f.game.id);
    expect((await readWerewolfWatch(db, f.game.id, "mystery", 1, 64)).visualPaused).toBe(true);
    await expect(resumeWerewolfVisualGame(db, f.game.id, "operator")).rejects.toThrow("publish");
    const inventory = await readReplayVisualProduction(db, f.game.id);
    expect(inventory.scenes).toHaveLength(1);
    const scene = inventory.scenes[0]!;
    const queued = scene.sceneId ? await controlVisualMedia(db, f.game.id, "operator", { action: "regenerate", requestId: "repair", sceneId: scene.sceneId, expectedVersion: 0 })
      : await renderMissingReplayScene(db, f.game.id, "operator", { key: scene.key, previewHash: scene.previewHash, requestId: "repair" });
    expect(queued.accepted).toBe(true);
    const job = await finishRepair(f.game.id);
    await expect(resumeWerewolfVisualGame(db, f.game.id, "operator")).rejects.toThrow("publish");
    expect(await controlVisualMedia(db, f.game.id, "operator", { action: "publish", audience: "public", requestId: "publish", sceneId: job.sceneId!, expectedVersion: 1, expectedPublication: 0, versionId: job.id })).toMatchObject({ accepted: true });
    expect((await claimWerewolfGame(db, f.game.id)).ok).toBe(false);
    await resumeWerewolfVisualGame(db, f.game.id, "operator");
    expect(await f.store.read()).toEqual(accepted);
    await expect(resumeWerewolfVisualGame(db, f.game.id, "operator")).rejects.toThrow("not paused");
    const next = await claimWerewolfGame(db, f.game.id);
    if (!next.ok)
      throw Error(next.error);
    let calls = 0;
    const prepare = createWerewolfVisualPreparation(db, f.game.id, next.claim.ownerEpoch, new AbortController().signal, async () => { calls++; throw Error("Must reuse published repair"); }, noForms);
    await prepare(pending.state, pending.request);
    expect(calls).toBe(0);
    const store = createWerewolfStore(db, f.game.id, next.claim.ownerEpoch);
    await advanceWerewolf(store, agent);
    expect((await readWerewolfWatch(db, f.game.id, "omniscient", 1, 64, "2000-01-01T00:00:00.000Z")).media).not.toEqual({});
    expect((await store.read()).length).toBeGreaterThan(accepted.length);
  });
test("lone-wolf form recovery uses a scene-less idempotent job and preserves accepted decisions", async () => {
  const f = await fixture("one_wolf"), pending = await fail(f, "attack", true), accepted = await f.store.read();
  const pause = (await readWerewolfVisualPause(db, f.game.id))!;
  expect(pause.work.kind).toBe("form");
  expect((await readReplayVisualProduction(db, f.game.id)).scenes).toHaveLength(0);
  const first = await queueWerewolfFormRepair(db, f.game.id, "operator", pause.id, "form-repair");
  expect(await queueWerewolfFormRepair(db, f.game.id, "operator", pause.id, "form-repair")).toEqual(first);
  await expect(queueWerewolfFormRepair(db, f.game.id, "operator", pause.id, "duplicate")).rejects.toThrow("already running");
  const job = await finishRepair(f.game.id);
  expect(job.sceneId).toBeNull();
  expect(await db.select().from(schema.visualScenes)).toHaveLength(0);
  await resumeWerewolfVisualGame(db, f.game.id, "operator");
  const claim = await claimWerewolfGame(db, f.game.id);
  if (!claim.ok)
    throw Error(claim.error);
  let missing = 0;
  const prepare = createWerewolfVisualPreparation(db, f.game.id, claim.claim.ownerEpoch, new AbortController().signal, async () => null, async (_db, _id, plan) => { missing += plan.cast.filter(m => !m.variant?.resolved).length; return plan; });
  await prepare(pending.state, pending.request);
  expect(missing).toBe(0);
  expect(await f.store.read()).toEqual(accepted);
});
test("changing policy does not resume; explicit Best effort resume needs no repair", async () => {
  const f = await fixture();
  await fail(f);
  const accepted = await f.store.read();
  await setVisualFailurePolicy(db, f.game.id, "best_effort", "operator");
  expect((await readWerewolfVisualPause(db, f.game.id))?.kind).toBe("werewolf");
  expect((await claimWerewolfGame(db, f.game.id)).ok).toBe(false);
  await resumeWerewolfVisualGame(db, f.game.id, "operator");
  expect(await f.store.read()).toEqual(accepted);
  expect((await claimWerewolfGame(db, f.game.id)).ok).toBe(true);
});
test("in-flight policy changes and stale owners cannot produce an unwanted suspension", async () => {
  const f = await fixture(), pending = await at(f, "pack_talk");
  const prepare = createWerewolfVisualPreparation(db, f.game.id, f.epoch, new AbortController().signal, async () => { await setVisualFailurePolicy(db, f.game.id, "best_effort", "operator"); return null; }, noForms);
  await prepare(pending.state, pending.request);
  expect(await readWerewolfVisualPause(db, f.game.id)).toBeNull();
  await setVisualFailurePolicy(db, f.game.id, "require_visuals", "operator");
  await db.update(schema.gameRunOwners).set({ status: "expired" }).where(eq(schema.gameRunOwners.gameId, f.game.id));
  await expect(createWerewolfVisualPreparation(db, f.game.id, f.epoch, new AbortController().signal, async () => null, noForms)(pending.state, pending.request)).rejects.toThrow();
  expect(await readWerewolfVisualPause(db, f.game.id)).toBeNull();
});
test("creation validates and persists both policy choices", async () => {
  for (const policy of ["best_effort", "require_visuals"]) {
    const game = await createWerewolfLobby(db, "operator", { preset: "one_wolf", visualMode: true, visualFailurePolicy: policy });
    const [row] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
    expect(JSON.parse(row!.config).visualFailurePolicy).toBe(policy);
  }
  await expect(createWerewolfLobby(db, "operator", { preset: "one_wolf", visualFailurePolicy: "ignore" })).rejects.toThrow("Invalid visual");
});
test("producer can inspect and repair but cannot change policy or resume without start_game", async () => {
  const f = await fixture();
  await fail(f);
  await db.insert(schema.roles).values({ id: "producer", name: "producer" });
  await db.insert(schema.userRoles).values({ userId: "operator", roleId: "producer" });
  const headers = { Authorization: `Bearer ${await createSessionToken("operator", { roles: ["producer"], permissions: [] })}`, "Content-Type": "application/json" };
  const app = createVisualReplayProductionRoutes(db), root = `/api/admin/production/games/${f.game.id}/visual`;
  expect((await app.request(root, { headers })).status).toBe(200);
  expect((await app.request(`${root}/control`, { headers, method: "POST", body: JSON.stringify({ action: "resume" }) })).status).toBe(403);
  expect((await app.request(`${root}/control`, { headers, method: "POST", body: JSON.stringify({ action: "policy", policy: "best_effort" }) })).status).toBe(403);
  expect((await app.request(root)).status).toBe(401);
});
for (const scenario of ["saved", "wolves"] as const)
  test(`committed ${scenario} night pauses before the next transition and survives process recovery`, async () => {
    const { werewolfResultsFixture } = await import("@influence/engine/fixtures/werewolf-results");
    const id = `night-${scenario}`, events = await werewolfResultsFixture(scenario, id);
    const index = scenario === "wolves" ? events.findLastIndex(event => event.type === "werewolf.night_resolved") : events.findIndex(event => event.type === "werewolf.night_resolved");
    const prefix = events.slice(0, index + 1), before = replayWerewolf(prefix.slice(0, -1)), committed = replayWerewolf(prefix), night = prefix.at(-1)!;
    expect(committed.outcome).toBeNull();
    await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "in_progress", startedAt: new Date().toISOString(), config: JSON.stringify({ visualMode: true, visualFailurePolicy: "require_visuals" }) });
    await db.insert(schema.werewolfEvents).values(prefix.map(event => ({ gameId: id, sequence: event.sequence, event })));
    const claim = await claimWerewolfGame(db, id);
    if (!claim.ok)
      throw Error(claim.error);
    const prepare = createWerewolfVisualPreparation(db, id, claim.claim.ownerEpoch, new AbortController().signal, async () => null, noForms);
    await expect(prepare.night(before, night, committed)).rejects.toBeInstanceOf(WerewolfVisualBlocked);
    expect((await readWerewolfVisualPause(db, id))?.work).toMatchObject({ kind: "scene", descriptor: { purpose: "hunt", boundarySequence: night.sequence - 1 } });
    expect((await readReplayVisualProduction(db, id)).scenes).toHaveLength(1);
    await setVisualFailurePolicy(db, id, "best_effort", "operator");
    await resumeWerewolfVisualGame(db, id, "operator");
    const next = await claimWerewolfGame(db, id);
    if (!next.ok)
      throw Error(next.error);
    const recovered = createWerewolfVisualPreparation(db, id, next.claim.ownerEpoch, new AbortController().signal, async () => null, noForms);
    await recovered.night(before, night, committed);
    expect(await readWerewolfEvents(db, id)).toEqual(prefix);
    await advanceWerewolf(createWerewolfStore(db, id, next.claim.ownerEpoch), agent);
    expect((await readWerewolfEvents(db, id)).filter(e => e.type === "werewolf.night_resolved")).toHaveLength(prefix.filter(e => e.type === "werewolf.night_resolved").length);
  });


test("cancellation while reaching the pause transaction leaves the game adoptable", async () => {
  const f = await fixture("one_wolf");
  const {state,request} = await at(f,"attack");
  const controller = new AbortController();
  controller.abort(new Error("Worker stopping"));
  await expect(pauseWerewolfForVisuals(db, new WerewolfVisualBlocked(f.game.id,f.epoch,state.sequence,{kind:"form",playerId:request.actorId},"Fixture"),controller.signal)).rejects.toThrow("Worker stopping");
  expect(await readWerewolfVisualPause(db,f.game.id)).toBeNull();
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id,f.game.id));
  expect(game!.status).toBe("in_progress");
});
