import { Hydrated, loadPayloads, storeFields } from "../services/payload-storage.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { resolveCharacterVariants } from "../services/visual-character-variants.js";
import { prepareVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { reserveVisualRender, visualImageJournal } from "../services/visual-render-journal.js";
import { prepareCutoutDemands, reserveCutout, claimCutout, acceptCutout, CUTOUT_RECIPE } from "../services/character-cutouts.js";
import { readVisualArtifact } from "../services/visual-scene-store.js";

const originalEnvironment = { ...process.env };
afterEach(() => {
  for (const key of ["CHARACTER_CUTOUT_MODE", "CUTOUT_API_URL", "INFLUENCE_DEPLOYMENT_ENVIRONMENT"] as const) {
    if (originalEnvironment[key] === undefined) delete process.env[key]; else process.env[key] = originalEnvironment[key];
  }
});

let db: DrizzleDB, original: string, generated: Buffer, renders: number;
const head = { x: .3, y: .1, width: .2, height: .2 };
const receipt = { provider: "openai" as const, model: "gpt-image-2", requestHash: "fixture", requestId: "fixture", status: 200, elapsedMs: 1, usage: null, chargeUncertain: false };
const providers: NonNullable<Parameters<Hydrated<typeof resolveCharacterVariants>>[4]> = {
  render: async (_db, input) => { renders++; expect(input.allowFallback).toBe(false); expect(input.request.prompt).toContain("Preserve the source rendering style"); return { image: generated, receipt }; },
  localize: async (_db, input) => { expect(input.transformation).toBe("werewolf"); return { count: 1, verifiedParticipantIds: ["wolf"], anchors: [{ playerId: "wolf", label: 1, confidence: "clear", head }] }; },
};
function plan(generation = "initial") {
  return planVisualScene({ roomId: "mingle-1", backgroundArtifactId: original, cast: [{ id: "wolf", name: "Wolf", performanceInstructions: "", referenceArtifactId: original,
    variant: { kind: "werewolf", sourceArtifactId: original, revision: "v1", generation, resolved: false } }] });
}
beforeEach(async () => {
  db = await setupTestDB(); renders = 0;
  await db.insert(schema.games).values({ id: "variants", slug: "variants", gameKind: "werewolf", status: "completed", config: "{}" });
  original = await storeVisualArtifact(db, "variants", await sharp({ create: { width: 64, height: 96, channels: 3, background: "#aabbcc" } }).png().toBuffer());
  generated = await sharp({ create: { width: 64, height: 96, channels: 3, background: "#112233" } }).png().toBuffer();
});

test("verified forms reuse across scenes and keep original references immutable", async () => {
  const intent = plan();
  const first = await resolveCharacterVariants(db, "variants", intent, {}, providers);
  const second = await resolveCharacterVariants(db, "variants", { ...intent, roomId: "mingle-2" }, {}, providers);
  expect(renders).toBe(1);
  expect(first.cast[0]!.referenceArtifactId).not.toBe(original);
  expect(second.cast).toEqual(first.cast);
  expect(first.cast[0]!.headRectangle).toEqual(head);
  expect(intent.cast[0]!.referenceArtifactId).toBe(original);
  const replacement = await resolveCharacterVariants(db, "variants", plan("operator-request"), {}, providers);
  expect(renders).toBe(2);
  expect(replacement.cast[0]!.variant?.generation).toBe("operator-request");
  expect(await db.select().from(schema.visualCharacterVariants)).toHaveLength(2);
  await expect(db.update(schema.visualCharacterVariants).set({ revision: "overwrite" }).execute()).rejects.toMatchObject({ cause: { message: "Visual character variants are immutable" } });
});

test("unverified transformed identity cannot become a reusable form", async () => {
  await expect(resolveCharacterVariants(db, "variants", plan(), {}, { ...providers,
    localize: async () => ({ count: 1, verifiedParticipantIds: ["someone-else"], anchors: [{ playerId: "wolf", label: 1, confidence: "clear", head }] }),
  })).rejects.toThrow("requested character");
  expect(await db.select().from(schema.visualCharacterVariants)).toHaveLength(0);
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
});

test("reusing a pre-existing wolf form does not backfill a cutout demand", async () => {
  const artifactId = await storeVisualArtifact(db, "variants", generated);
  await db.insert(schema.visualCharacterVariants).values({ id: "historical", gameId: "variants", playerId: "wolf",
    sourceArtifactId: original, artifactId, revision: "v1", generation: "initial", head });
  expect((await resolveCharacterVariants(db, "variants", plan(), {}, providers)).cast[0]!.referenceArtifactId).toBe(artifactId);
  expect(renders).toBe(0);
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
});

test("new wolf forms enqueue one private cutout and cached completion creates game-scoped alpha art", async () => {
  process.env.CHARACTER_CUTOUT_MODE = "local";
  process.env.CUTOUT_API_URL = "http://localhost:3018";
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  const resolved = await resolveCharacterVariants(db, "variants", plan(), {}, providers);
  await resolveCharacterVariants(db, "variants", plan(), {}, providers);
  const demands = await db.select().from(schema.characterCutoutDemands);
  expect(demands).toHaveLength(1);
  expect(demands[0]!.sourceKey).toBe(`/api/games/variants/visual/artifacts/${resolved.cast[0]!.referenceArtifactId}`);
  await prepareCutoutDemands(db);
  const [job] = await db.select().from(schema.characterCutouts);
  const reservation = (await reserveCutout(db, job!.id))!;
  await claimCutout(db, job!.id, reservation.token, CUTOUT_RECIPE);
  const pixels = Buffer.alloc(64 * 96 * 4, 255); pixels[3] = 0;
  const image = await sharp(pixels, { raw: { width: 64, height: 96, channels: 4 } }).png().toBuffer();
  expect(await acceptCutout(db, job!.id, reservation.token, image)).toBe(true);
  const [derivative] = await db.select().from(schema.visualCharacterCutouts);
  expect(derivative!.sourceArtifactId).toBe(resolved.cast[0]!.referenceArtifactId);
  expect((await sharp(await readVisualArtifact(db, "variants", derivative!.artifactId)).stats()).isOpaque).toBe(false);
  expect(await db.select().from(schema.agentContentAssets)).toHaveLength(0);
  // Same generated bytes in another game reuse inference, but get their own
  // private artifact and never borrow an artifact from the first game's scope.
  await db.insert(schema.games).values({ id: "other", slug: "other", gameKind: "werewolf", config: "{}" });
  const otherSource = await storeVisualArtifact(db, "other", generated);
  await db.insert(schema.visualCharacterVariants).values({ id: "other-form", gameId: "other", playerId: "other-wolf", sourceArtifactId: otherSource,
    artifactId: otherSource, revision: "v1", generation: "initial", head });
  await db.insert(schema.characterCutoutDemands).values({ id: "other-demand", gameId: "other", playerId: "other-wolf", sourceKey: `/api/games/other/visual/artifacts/${otherSource}`, recipe: CUTOUT_RECIPE });
  await prepareCutoutDemands(db);
  expect(await db.select().from(schema.characterCutouts)).toHaveLength(1);
  const derivatives = await db.select().from(schema.visualCharacterCutouts);
  expect(derivatives).toHaveLength(2);
  expect(derivatives.find(row => row.sourceArtifactId === otherSource)!.artifactId).not.toBe(derivative!.artifactId);
  expect(await db.select().from(schema.agentContentAssets)).toHaveLength(0);
});

test("new generation cannot bypass a wolf-form request with unknown charge", async () => {
  const operation = await reserveVisualRender(db, "variants", "wolf-form:uncertain", { prompt: "fixture", width: 1024, height: 1536, references: [] });
  await visualImageJournal(db, operation).begin({ provider: "openai", model: "gpt-image-2", requestHash: "fixture" });
  await expect(resolveCharacterVariants(db, "variants", plan("another-click"), {}, providers)).rejects.toThrow("Reconcile");
  expect(renders).toBe(0);
});

test("worker stores resolved references on candidate, never mutates its immutable queued intent", async () => {
  const intent = plan();
  const scene = await prepareVisualScene(db, { gameId: "variants", boundarySequence: 2, plan: intent });
  await db.insert(schema.visualRepairJobs).values(await storeFields({ id: "job", gameId: "variants", sceneId: scene.id, version: 1, operatorId: "producer", mode: "regenerate", plan: intent,
    renderContext: { style: "fixture", roomName: "cellar", roomDirection: "fixture" }, status: "queued", createdAt: new Date().toISOString() }, {"renderContext":"json-gzip"}));
  const job = (await claimVisualMediaJob(db, "worker"))!;
  await executeVisualMediaJob(db, job, new AbortController().signal, async (_db, resolvedScene) => {
    expect(resolvedScene.plan.cast[0]!.variant?.resolved).toBe(true);
    return { imageArtifactId: resolvedScene.plan.cast[0]!.referenceArtifactId, localization: { count: 1, verifiedParticipantIds: ["wolf"], anchors: [{ playerId: "wolf", label: 1, confidence: "clear", head }] } };
  }, (db, game, intent, options) => resolveCharacterVariants(db, game, intent, options, providers));
  const [finished] = await loadPayloads(db.select().from(schema.visualRepairJobs).where(eq(schema.visualRepairJobs.id, job.id)));
  expect(finished!.status).toBe("ready");
  expect(finished!.plan).toEqual(intent);
  const [candidate] = await db.select().from(schema.visualMediaVersions);
  expect(candidate!.plan.cast[0]!.variant?.resolved).toBe(true);
  expect(await db.select().from(schema.visualMediaPublications)).toHaveLength(0);
});
