import { and, eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { VISUAL_LOCALIZATION_VERSION } from "./visual-scene-localization.js";
import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
import sharp from "sharp";
import { VISUAL_HOUSE_STYLE, VISUAL_ROOMS } from "@influence/engine/visual-mode";
import { visualRenderGroups } from "@influence/engine/visual-scene-plan";
import type { DrizzleDB } from "../db/index.js";
import { localizeDurableVisualScene, renderDurableVisualImage } from "./visual-render-journal.js";
import { acceptVisualScene, failVisualScene, readVisualArtifact, storeVisualArtifact, type StoredVisualScene } from "./visual-scene-store.js";

/** All external work occurs between short durable reservations and acceptance. */
export async function renderPlannedVisualScene(db: DrizzleDB, scene: StoredVisualScene, signal?: AbortSignal, assertBoundary?: VisualBoundaryGuard): Promise<StoredVisualScene> {
  const beforeDispatch: VisualBoundaryGuard = async (tx) => {
    signal?.throwIfAborted();
    await assertBoundary?.(tx);
  };
  await beforeDispatch();
  if (scene.status === "ready") return scene;
  if (scene.status !== "preparing") throw new Error("Visual scene needs operator recovery");
  try {
    const { imageArtifactId, localization } = await renderVisualCandidate(db, scene, signal, beforeDispatch, {
      onImage: async (candidateArtifactId) => { await db.transaction(async (tx) => {
        await beforeDispatch(tx);
        await tx.update(schema.visualScenes).set({ candidateArtifactId }).where(and(eq(schema.visualScenes.id, scene.id), eq(schema.visualScenes.renderRevision, scene.renderRevision), eq(schema.visualScenes.status, "preparing")));
      }); },
    });
    await beforeDispatch();
    return await acceptVisualScene(db, { sceneId: scene.id, planHash: scene.planHash, renderRevision: scene.renderRevision, imageArtifactId, anchors: localization.anchors, verifiedParticipantIds: localization.verifiedParticipantIds, assertBoundary: beforeDispatch });
  } catch (error) {
    // A former owner may retain its paid receipt, but cannot change scene state.
    await assertBoundary?.();
    await failVisualScene(db, scene.id, error instanceof Error ? error.message : "Visual scene preparation failed", assertBoundary);
    throw error;
  }
}

/** Shared paid stages, with acceptance owned separately by gameplay or the repair worker. */
export async function renderVisualCandidate(db: DrizzleDB, scene: StoredVisualScene, signal?: AbortSignal, beforeDispatch?: VisualBoundaryGuard, options: {
  renderContext?: { style: string; roomName: string; roomDirection: string };
  operationPrefix?: string; reusePrefix?: string; jobId?: string;
  onStep?: (step: string) => Promise<void>; onImage?: (id: string) => Promise<void>;
} = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OpenAI scene verification credential");
    const { plan, gameId } = scene;
    const renderKey = options.operationPrefix ?? `${scene.id}:render:${scene.renderRevision}`;
    const reuse = (suffix: string) => options.reusePrefix ? `${options.reusePrefix}:${suffix}` : undefined;
    const background = plan.backgroundArtifactId ? await readVisualArtifact(db, gameId, plan.backgroundArtifactId) : null;
    const references = await Promise.all(plan.cast.map(async (member) => ({ member, image: await readVisualArtifact(db, gameId, member.referenceArtifactId) })));
    let finalImage: Buffer;
    if (scene.repairMode === "verify" && scene.candidateArtifactId) {
      finalImage = await readVisualArtifact(db, gameId, scene.candidateArtifactId);
    } else {
    const groups = visualRenderGroups(plan);

    const room = VISUAL_ROOMS[plan.roomId];
    const common = `${options.renderContext?.style ?? VISUAL_HOUSE_STYLE}\nSetting: ${options.renderContext?.roomName ?? room.name}. ${options.renderContext?.roomDirection ?? room.direction}\nPreserve the supplied room's architecture, furniture and materials. These contestants are playing a social-strategy game; use believable conversational staging, some seated and some standing as directed. Match each character's face, hair, clothing and body to their reference. No extra people.`;
    const sectionImages: Buffer[] = [];
    for (const [index, group] of groups.entries()) {
      const members = group.map((placement) => {
        const reference = references.find((entry) => entry.member.id === placement.playerId);
        if (!reference) throw new Error("Scene placement has no frozen character reference");
        return { ...reference, placement };
      });
      const width = groups.length === 1 ? 1536 : 768;
      const height = groups.length === 1 ? 864 : 1152;
      const prompt = `${common}\n${groups.length === 1 ? "Show the entire conversation in a widescreen room shot." : "Render a portrait conversational section, framed to include every listed person and their full posture with headroom. This section will be assembled into a larger room."}\n${background ? "The first image is the common empty room. The remaining references" : "The supplied character references"} correspond IN ORDER to these participants and intended furniture-relative positions: ${JSON.stringify(members.map(({ member, placement }) => ({ id: member.id, name: member.name, section: placement.sectionId, position: placement.position, role: placement.role, performance: member.performanceInstructions })))}\nObservable performance notes: ${JSON.stringify(plan.cues.filter((cue) => group.some((placement) => placement.playerId === cue.playerId)))}\nRender EXACTLY ${members.length} people total, one per character reference. All listed people must appear exactly once. Do not add conversation partners, reflections, background people or duplicate versions of a character. Do not render labels or text.`;
      await options.onStep?.(`section:${index + 1}`);
      const rendered = await renderDurableVisualImage(db, { gameId, sceneId: scene.id, repairJobId: options.jobId, operationKey: `${renderKey}:section:v2:${index}`, reuseOperationKey: reuse(`section:v2:${index}`), allowFallback: options.jobId ? true : scene.renderRevision === 0, request: { prompt, width, height, references: [...(background ? [background] : []), ...members.map((member) => member.image)] }, signal, beforeDispatch });
      sectionImages.push(rendered.image);
    }
    if (!groups.length) {
      await options.onStep?.("empty-room");
      const rendered = await renderDurableVisualImage(db, { gameId, sceneId: scene.id, repairJobId: options.jobId, operationKey: `${renderKey}:empty-room`, reuseOperationKey: reuse("empty-room"), allowFallback: options.jobId ? true : scene.renderRevision === 0, signal, beforeDispatch,
        request: { width: 1536, height: 864, references: background ? [background] : [], prompt: `${common}\nShow the empty room in widescreen. Exactly zero people, including reflections. No labels or text.` } });
      sectionImages.push(rendered.image);
    }
    finalImage = sectionImages[0]!;
    if (sectionImages.length > 1) {
      const widths = sectionImages.map((_, index) => Math.floor((index + 1) * 1536 / sectionImages.length) - Math.floor(index * 1536 / sectionImages.length));
      const panels = await Promise.all(sectionImages.map(async (image, index) => ({
        input: await sharp(image).resize(widths[index]!, 864, { fit: "contain", background: "#e5ded0" }).png().toBuffer(),
        left: Math.floor(index * 1536 / sectionImages.length), top: 0,
      })));
      const assembly = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#e5ded0" } }).composite(panels).png().toBuffer();
      const castSheet = await createCastReferenceSheet(references.map((reference) => reference.image));
      await options.onStep?.("harmonize");
      const rendered = await renderDurableVisualImage(db, { gameId, sceneId: scene.id, repairJobId: options.jobId, operationKey: `${renderKey}:harmonize`, reuseOperationKey: reuse("harmonize"), allowFallback: options.jobId ? true : scene.renderRevision === 0, signal, beforeDispatch,
        request: { width: 1536, height: 864, references: [assembly, ...(background ? [background] : []), castSheet], prompt: `${common}\nHarmonize the FIRST image's assembled conversation sections into ONE coherent widescreen view. Keep every participant from every section exactly once; remove panel seams and reconcile perspective and lighting. ${background ? "The SECOND image is the empty room architecture. The THIRD" : "The SECOND image"} is a numbered identity reference sheet: ${JSON.stringify(references.map(({ member }, index) => ({ number: index + 1, id: member.id, name: member.name })))}. Preserve conversational groups and their furniture-relative staging: ${JSON.stringify(plan.placements)}. Keep all ${plan.cast.length} participants and their visible heads in frame. The final image must have no numbers, labels, montage borders or text.` },
      });
      finalImage = rendered.image;
    }
    }
    const imageArtifactId = await storeVisualArtifact(db, gameId, finalImage);
    await options.onImage?.(imageArtifactId);
    await options.onStep?.("verifying");
    const localization = await localizeDurableVisualScene(db, { gameId, sceneId: scene.id, repairJobId: options.jobId, onStep: options.onStep, operationKey: `${renderKey}:localization:${VISUAL_LOCALIZATION_VERSION}`, reuseOperationKey: reuse(`localization:${VISUAL_LOCALIZATION_VERSION}`), scene: finalImage,
      references: references.map(({ member, image }) => ({ image, players: [{ id: member.id, name: member.name }] })), apiKey, signal, beforeDispatch });
    return { imageArtifactId, localization };
}

/** Numbers exist only on this model-facing reference, never on the viewer scene. */
async function createCastReferenceSheet(images: readonly Uint8Array[]): Promise<Buffer> {
  const columns = Math.min(4, images.length);
  const width = columns * 256;
  const height = Math.ceil(images.length / columns) * 512;
  const panels = await Promise.all(images.map(async (image, index) => ({
    input: await sharp(image).resize(256, 480, { fit: "contain", background: "#eeeeee" }).png().toBuffer(),
    left: index % columns * 256, top: Math.floor(index / columns) * 512 + 32,
  })));
  const labels = images.map((_, index) => `<text x="${index % columns * 256 + 128}" y="${Math.floor(index / columns) * 512 + 24}" text-anchor="middle" font-family="sans-serif" font-size="22">${index + 1}</text>`).join("");
  return sharp({ create: { width, height, channels: 3, background: "#eeeeee" } }).composite([
    ...panels, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`), left: 0, top: 0 },
  ]).png().toBuffer();
}
