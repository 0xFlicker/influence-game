import Ajv from "ajv";
import { and, eq } from "drizzle-orm";
import { assertVisualShot, type StoredVisualShot, type VisualShotContent, type VisualShotPresentation } from "@influence/engine/visual-mode";
import { visualLocalizationSchema } from "@influence/engine/visual-localization";
import { visualRenderGroups } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import type { VisualTransaction } from "./visual-execution-boundary.js";
import { annotateVisualScene } from "./visual-scene-localization.js";
import { readVisualArtifact, storeVisualArtifact, type StoredVisualScene } from "./visual-scene-store.js";

export interface VisualShotReview {
  expectedRevision: number;
  planHash: string;
  mode: VisualShotPresentation<StoredVisualShot>["mode"];
  shots: Array<VisualShotContent & { sourceId: string; role: "overview" | "group" }>;
}
export interface ReviewSource {
  id: string; kind: "artifact" | "attempt"; imageId: string; label: string; participantIds: string[];
  anchors: VisualShotContent["anchors"]; pointers: VisualShotContent["pointers"];
}
const coordinate = { type: "number", minimum: 0, maximum: 1 };
export function decodeVisualShotReview(value: unknown): VisualShotReview {
  const anchor = visualLocalizationSchema(["placeholder"]).properties.anchors.items;
  const validate = new Ajv().compile<VisualShotReview>({ type: "object", additionalProperties: false, required: ["mode", "shots", "expectedRevision", "planHash"], properties: {
    expectedRevision: { type: "integer", minimum: 0 }, planHash: { type: "string", minLength: 1, maxLength: 200 },
    mode: { enum: ["scene", "establishing", "groups", "portraits"] },
    shots: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false,
      required: ["sourceId", "role", "participantIds", "visibleParticipantIds", "anchors", "pointers"], properties: {
        sourceId: { type: "string", minLength: 1, maxLength: 250 }, role: { enum: ["overview", "group"] },
        participantIds: { type: "array", maxItems: 12, uniqueItems: true, items: { type: "string" } },
        visibleParticipantIds: { type: "array", maxItems: 12, uniqueItems: true, items: { type: "string" } },
        anchors: { type: "array", maxItems: 12, items: { ...anchor, properties: { ...anchor.properties, playerId: { type: "string" }, label: { type: "integer", minimum: 1, maximum: 12 } } } },
        pointers: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["playerId", "x", "y"], properties: { playerId: { type: "string" }, x: coordinate, y: coordinate } } },
      } } },
  } });
  if (!validate(value)) throw new Error("Invalid image review");
  const overviews = value.shots.filter(s => s.role === "overview").length;
  const groups = value.shots.filter(s => s.role === "group").length;
  if (new Set(value.shots.map(s => s.sourceId)).size !== value.shots.length || overviews > 1
    || value.mode === "scene" && overviews !== 1 || value.mode === "establishing" && (overviews !== 1 || !groups)
    || value.mode === "groups" && (!groups || overviews !== 0) || value.mode === "portraits" && value.shots.length !== 0) throw new Error("Choose images for the selected presentation");
  return value;
}

/** All returned sources belong to this exact scene, including rejected paid pixels. */
export async function readVisualReviewSources(db: DrizzleDB | VisualTransaction, scene: StoredVisualScene): Promise<ReviewSource[]> {
  const [attempts, versions, jobs] = await Promise.all([
    db.select({ id: schema.visualRenderAttempts.id, key: schema.visualRenderOperations.operationKey, hash: schema.visualRenderAttempts.imageHash })
      .from(schema.visualRenderAttempts).innerJoin(schema.visualRenderOperations, eq(schema.visualRenderAttempts.operationId, schema.visualRenderOperations.id))
      .where(and(eq(schema.visualRenderOperations.gameId, scene.gameId), eq(schema.visualRenderOperations.sceneId, scene.id))),
    db.select().from(schema.visualMediaVersions).where(eq(schema.visualMediaVersions.sceneId, scene.id)),
    db.select().from(schema.visualRepairJobs).where(eq(schema.visualRepairJobs.sceneId, scene.id)),
  ]);
  const sources = new Map<string, ReviewSource>();
  const ids = scene.plan.cast.map(m => m.id);
  const addArtifact = (id: string | null, label: string, shot?: StoredVisualShot) => {
    if (id) sources.set(`artifact:${id}`, { id: `artifact:${id}`, kind: "artifact", imageId: id, label, participantIds: shot?.participantIds ?? ids, anchors: shot?.anchors ?? [], pointers: shot?.pointers ?? [] });
  };
  addArtifact(scene.imageArtifactId, "Original image");
  addArtifact(scene.candidateArtifactId, "Original candidate");
  for (const job of jobs) addArtifact(job.candidateArtifactId, `Candidate v${job.version}`);
  for (const version of versions) addArtifact(version.imageArtifactId, `Version ${version.version}`);
  for (const [label, presentation] of [["Original", scene.shots], ...versions.map(v => [`v${v.version}`, v.shots] as const)] as const) {
    if (presentation?.overview) addArtifact(presentation.overview.imageArtifactId, `${label} overview`, presentation.overview);
    presentation?.groups.forEach((shot, i) => addArtifact(shot.imageArtifactId, `${label} group ${i + 1}`, shot));
  }
  const groups = visualRenderGroups(scene.plan);
  for (const attempt of attempts) {
    if (!attempt.hash) continue;
    const match = /:section:v2:(\d+)$/.exec(attempt.key);
    sources.set(`attempt:${attempt.id}`, { id: `attempt:${attempt.id}`, kind: "attempt", imageId: attempt.id,
      label: match ? `Saved group ${Number(match[1]) + 1} · ${attempt.id.slice(0, 8)}` : `Saved composition · ${attempt.id.slice(0, 8)}`,
      participantIds: match ? groups[Number(match[1])]?.map(p => p.playerId) ?? ids : ids, anchors: [], pointers: [],
    });
  }
  return [...sources.values()];
}

export async function saveReviewedShots(db: DrizzleDB | VisualTransaction, scene: StoredVisualScene, review: VisualShotReview): Promise<VisualShotPresentation<StoredVisualShot>> {
  if (review.expectedRevision !== scene.renderRevision || review.planHash !== scene.planHash) throw new Error("Scene changed. Close and reopen the image editor before saving.");
  const sources = await readVisualReviewSources(db, scene);
  const shots: VisualShotPresentation<StoredVisualShot> = { mode: review.mode, overview: null, groups: [] };
  for (const selection of review.shots) {
    const source = sources.find(s => s.id === selection.sourceId);
    if (!source) throw new Error("Review image does not belong to this scene");
    assertVisualShot(selection, scene.plan.cast.map(m => m.id));
    // Manual visible identities require a marked head, never an inferred seating position.
    if (selection.visibleParticipantIds.length !== selection.anchors.length) throw new Error("Mark each visible person's head");
    let image: Buffer;
    if (source.kind === "artifact") image = await readVisualArtifact(db, scene.gameId, source.imageId);
    else {
      const [attempt] = await db.select({ image: schema.visualRenderAttempts.image }).from(schema.visualRenderAttempts).where(eq(schema.visualRenderAttempts.id, source.imageId));
      if (!attempt?.image) throw new Error("Saved image is unavailable");
      image = attempt.image;
    }
    const shot: StoredVisualShot = { imageArtifactId: await storeVisualArtifact(db, scene.gameId, image),
      annotatedArtifactId: await storeVisualArtifact(db, scene.gameId, await annotateVisualScene(image, selection.anchors)),
      participantIds: selection.participantIds, visibleParticipantIds: selection.visibleParticipantIds, anchors: selection.anchors, pointers: selection.pointers };
    if (selection.role === "overview") shots.overview = shot; else shots.groups.push(shot);
  }
  return shots;
}
