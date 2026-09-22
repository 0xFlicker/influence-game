import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { assertVisualAnchors, type VisualPlayerAnchor, type VisualRoomId } from "@influence/engine/visual-mode";
import { sameVisualArrangement, type VisualScenePlan } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { sha256StableJson, stableJson } from "./stable-hash.js";
import { annotateVisualScene } from "./visual-scene-localization.js";

const scenes = schema.visualScenes;
const artifacts = schema.visualArtifacts;
export type StoredVisualScene = typeof scenes.$inferSelect;

/** Store immutable normalized PNGs. URLs never enter the renderer's fetch path. */
export async function storeVisualArtifact(db: DrizzleDB, gameId: string, image: Uint8Array): Promise<string> {
  const normalized = await sharp(image, { limitInputPixels: 4096 * 4096 }).rotate().png().toBuffer({ resolveWithObject: true });
  const contentHash = createHash("sha256").update(normalized.data).digest("hex");
  const id = randomUUID();
  await db.insert(artifacts).values({ id, gameId, contentHash, image: normalized.data, width: normalized.info.width, height: normalized.info.height }).onConflictDoNothing();
  const [stored] = await db.select({ id: artifacts.id }).from(artifacts).where(and(eq(artifacts.gameId, gameId), eq(artifacts.contentHash, contentHash)));
  if (!stored) throw new Error("Visual artifact was not stored");
  return stored.id;
}

export async function readVisualArtifact(db: DrizzleDB, gameId: string, artifactId: string): Promise<Buffer> {
  const [artifact] = await db.select({ image: artifacts.image }).from(artifacts).where(and(eq(artifacts.id, artifactId), eq(artifacts.gameId, gameId)));
  if (!artifact) throw new Error("Visual artifact is unavailable for this game");
  return artifact.image;
}

/** Called at a canonical committed boundary. Only a short planning transaction is held. */
export async function prepareVisualScene(db: DrizzleDB, input: {
  gameId: string; boundarySequence: number; afterDialogueSequence?: number; plan: VisualScenePlan; assertBoundary?: VisualBoundaryGuard;
}): Promise<StoredVisualScene> {
  if (!Number.isSafeInteger(input.boundarySequence) || input.boundarySequence < 0) throw new Error("Visual scene requires a canonical boundary sequence");
  const planHash = sha256StableJson(input.plan);
  return db.transaction(async (tx) => {
    await input.assertBoundary?.(tx);
    const [game] = await tx.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, input.gameId)).for("update");
    if (!game) throw new Error("Visual game not found");
    const history = await tx.select().from(scenes).where(and(eq(scenes.gameId, input.gameId), eq(scenes.roomId, input.plan.roomId))).orderBy(desc(scenes.boundarySequence));
    const existing = history.find((scene) => scene.boundarySequence === input.boundarySequence);
    if (existing) {
      if (existing.planHash !== planHash) throw new Error("Visual plan changed at a committed boundary");
      return existing;
    }
    if (history[0] && history[0].boundarySequence > input.boundarySequence) throw new Error("Stale visual scene boundary");
    if (history[0] && sameVisualArrangement(history[0].plan, input.plan)) return history[0];
    const referenceIds = [...new Set([...(input.plan.backgroundArtifactId ? [input.plan.backgroundArtifactId] : []), ...input.plan.cast.map((member) => member.referenceArtifactId)])];
    const references = await tx.select({ id: artifacts.id }).from(artifacts).where(and(eq(artifacts.gameId, input.gameId), inArray(artifacts.id, referenceIds)));
    if (references.length !== referenceIds.length) throw new Error("Scene references must be frozen artifacts belonging to this game");
    const reusable = history.find((scene) => scene.status === "ready" && sameVisualArrangement(scene.plan, input.plan));
    const empty = input.plan.cast.length === 0;
    const [scene] = await tx.insert(scenes).values({
      id: randomUUID(), gameId: input.gameId, roomId: input.plan.roomId, boundarySequence: input.boundarySequence, afterDialogueSequence: input.afterDialogueSequence ?? 0, plan: input.plan, planHash,
      ...(empty ? { status: "ready" as const, imageArtifactId: input.plan.backgroundArtifactId, annotatedArtifactId: input.plan.backgroundArtifactId, anchors: [] }
        : reusable ? { status: "ready" as const, imageArtifactId: reusable.imageArtifactId, annotatedArtifactId: reusable.annotatedArtifactId, anchors: reusable.anchors } : {}),
    }).returning();
    return scene!;
  });
}

/** Localization must describe the final image; intended staging positions are never anchors. */
export async function acceptVisualScene(db: DrizzleDB, input: {
  sceneId: string; planHash: string; renderRevision?: number; verifiedParticipantIds?: readonly string[]; imageArtifactId: string; anchors: readonly VisualPlayerAnchor[]; assertBoundary?: VisualBoundaryGuard;
}): Promise<StoredVisualScene> {
  const [planned] = await db.select().from(scenes).where(eq(scenes.id, input.sceneId));
  if (!planned || planned.planHash !== input.planHash) throw new Error("Visual result does not match its scene plan");
  const ids = planned.plan.cast.map((member) => member.id);
  if (input.anchors.length || ids.length === 0) assertVisualAnchors(input.anchors, ids);
  else if (!input.verifiedParticipantIds || stableJson([...input.verifiedParticipantIds].sort()) !== stableJson([...ids].sort())) throw new Error("Unanchored scenes require verified participant identities");
  const clean = await readVisualArtifact(db, planned.gameId, input.imageArtifactId);
  // CPU image work stays outside the short acceptance transaction as well.
  const annotatedArtifactId = await storeVisualArtifact(db, planned.gameId, await annotateVisualScene(clean, input.anchors));
  return db.transaction(async (tx) => {
    await input.assertBoundary?.(tx);
    await tx.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, planned.gameId)).for("update");
    const [latest] = await tx.select().from(scenes).where(and(eq(scenes.gameId, planned.gameId), eq(scenes.roomId, planned.roomId))).orderBy(desc(scenes.boundarySequence)).limit(1);
    if (!latest || latest.id !== planned.id || (input.renderRevision !== undefined && latest.renderRevision !== input.renderRevision)) throw new Error("Stale visual scene result");
    if (latest.status === "ready") {
      if (latest.imageArtifactId === input.imageArtifactId && stableJson(latest.anchors) === stableJson(input.anchors)) return latest;
      throw new Error("Conflicting accepted visual scene");
    }
    if (latest.status !== "preparing") throw new Error("Visual scene needs an explicit retry");
    const [accepted] = await tx.update(scenes).set({ status: "ready", imageArtifactId: input.imageArtifactId, annotatedArtifactId, anchors: [...input.anchors], failure: null }).where(eq(scenes.id, latest.id)).returning();
    return accepted!;
  });
}

export async function readCurrentVisualScene(db: DrizzleDB, gameId: string, roomId: VisualRoomId): Promise<StoredVisualScene | null> {
  const [scene] = await db.select().from(scenes).where(and(eq(scenes.gameId, gameId), eq(scenes.roomId, roomId))).orderBy(desc(scenes.boundarySequence)).limit(1);
  return scene ?? null;
}

export async function failVisualScene(db: DrizzleDB, sceneId: string, failure: string, assertBoundary?: VisualBoundaryGuard): Promise<void> {
  if (!failure.trim()) throw new Error("Visual failure requires an explanation");
  await db.transaction(async (tx) => {
    await assertBoundary?.(tx);
    await tx.update(scenes).set({ status: "failed", failure }).where(and(eq(scenes.id, sceneId), eq(scenes.status, "preparing")));
  });
}

export async function retryVisualScene(db: DrizzleDB, sceneId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [scene] = await tx.select().from(scenes).where(eq(scenes.id, sceneId));
    if (!scene) throw new Error("Visual scene not found");
    await tx.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, scene.gameId)).for("update");
    const [latest] = await tx.select().from(scenes).where(and(eq(scenes.gameId, scene.gameId), eq(scenes.roomId, scene.roomId))).orderBy(desc(scenes.boundarySequence)).limit(1);
    if (latest?.id !== sceneId || latest.status !== "failed") throw new Error("Only the current failed scene can be retried");
    await tx.update(scenes).set({ status: "preparing", failure: null }).where(eq(scenes.id, sceneId));
  });
}
