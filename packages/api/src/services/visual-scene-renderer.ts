import { VisualImageFailure } from "./visual-image-provider.js";
import { VisualIdentityFailure } from "@influence/engine/visual-localization";
import { recordVisualOperationEvent, visualFailureEvidence } from "./visual-diagnostics.js";
import { and, eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { annotateVisualScene, VISUAL_LOCALIZATION_VERSION } from "./visual-scene-localization.js";
import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
import sharp from "sharp";
import { VISUAL_HOUSE_STYLE, VISUAL_ROOMS, type StoredVisualShot, type VisualShotPresentation } from "@influence/engine/visual-mode";
import { visualRenderGroups } from "@influence/engine/visual-scene-plan";
import type { DrizzleDB } from "../db/index.js";
import { localizeDurableVisualScene, renderDurableVisualImage } from "./visual-render-journal.js";
import { acceptVisualScene, failVisualScene, readVisualArtifact, storeVisualArtifact, type StoredVisualScene } from "./visual-scene-store.js";

/** All external work occurs between short durable reservations and acceptance. */
export async function renderPlannedVisualScene(db: DrizzleDB, scene: StoredVisualScene, signal?: AbortSignal, assertBoundary?: VisualBoundaryGuard, bestEffort = false): Promise<StoredVisualScene> {
  const beforeDispatch: VisualBoundaryGuard = async (tx) => {
    signal?.throwIfAborted();
    await assertBoundary?.(tx);
  };
  await beforeDispatch();
  if (scene.status === "ready") return scene;
  if (scene.status !== "preparing") throw new Error("Visual scene needs operator recovery");
  try {
    const { imageArtifactId, localization, shots } = await renderVisualCandidate(db, scene, signal, beforeDispatch, {
      allowMissing: bestEffort,
      onImage: async (candidateArtifactId) => { await db.transaction(async (tx) => {
        await beforeDispatch(tx);
        await tx.update(schema.visualScenes).set({ candidateArtifactId }).where(and(eq(schema.visualScenes.id, scene.id), eq(schema.visualScenes.renderRevision, scene.renderRevision), eq(schema.visualScenes.status, "preparing")));
      }); },
    });
    await beforeDispatch();
    return await acceptVisualScene(db, { sceneId: scene.id, planHash: scene.planHash, renderRevision: scene.renderRevision, imageArtifactId, shots, anchors: localization.anchors, verifiedParticipantIds: localization.verifiedParticipantIds, assertBoundary: beforeDispatch });
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
  allowMissing?: boolean;
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
    const localize = (image: Buffer, members: typeof references, suffix: string, allowMissing = options.allowMissing) => localizeDurableVisualScene(db, {
      gameId, sceneId: scene.id, repairJobId: options.jobId, onStep: options.onStep,
      operationKey: `${renderKey}:${suffix}:${VISUAL_LOCALIZATION_VERSION}${allowMissing ? ":partial-v1" : ""}`,
      reuseOperationKey: reuse(`${suffix}:${VISUAL_LOCALIZATION_VERSION}${allowMissing ? ":partial-v1" : ""}`), scene: image,
      references: members.map(({ member, image }) => ({ image, players: [{ id: member.id, name: member.name }] })),
      allowMissing: allowMissing && members.length > 0, apiKey, signal, beforeDispatch,
    });
    const shot = async (image: Buffer, ids: string[], localization: Awaited<ReturnType<typeof localize>>): Promise<StoredVisualShot> => ({
      imageArtifactId: await storeVisualArtifact(db, gameId, image),
      annotatedArtifactId: await storeVisualArtifact(db, gameId, await annotateVisualScene(image, localization.anchors)),
      participantIds: ids, visibleParticipantIds: localization.verifiedParticipantIds ?? localization.anchors.map(a => a.playerId), anchors: localization.anchors, pointers: [],
    });
    let finalImage: Buffer;
    let shots: VisualShotPresentation<StoredVisualShot> | undefined;
    if (scene.repairMode === "verify" && scene.candidateArtifactId) {
      finalImage = await readVisualArtifact(db, gameId, scene.candidateArtifactId);
    } else {
    const groups = visualRenderGroups(plan);

    const room = VISUAL_ROOMS[plan.roomId];
    const direction = plan.direction ?? options.renderContext;
    const common = `${direction?.style ?? VISUAL_HOUSE_STYLE}\nSetting: ${direction?.roomName ?? room.name}. ${direction?.roomDirection ?? room.direction}\nPreserve the supplied room's architecture, furniture and materials. These contestants are playing a social-strategy game; follow the intended scene positions exactly. Match each character's face, hair, clothing and body to their reference. Keep every face clearly visible to the camera in a front or three-quarter view, including seated people. Nobody may face away, hide behind another person, or have their face obscured by hair or furniture. No extra people.`;
    const sectionImages: Buffer[] = [];
    const sectionMembers: Array<typeof references> = [];
    for (const [index, group] of groups.entries()) {
      const members = group.map((placement) => {
        const reference = references.find((entry) => entry.member.id === placement.playerId);
        if (!reference) throw new Error("Scene placement has no frozen character reference");
        return { ...reference, placement };
      });
      const width = groups.length === 1 ? 1536 : 768;
      const height = groups.length === 1 ? 864 : 1152;
      const prompt = `${common}\n${groups.length === 1 ? "Show the entire scene in a widescreen shot." : "Render a portrait conversational section, framed to include every listed person and their full posture with headroom. This section will be assembled into a larger room."}\n${background ? "The first image is the common empty room. The remaining references" : "The supplied character references"} correspond IN ORDER to these participants and intended furniture-relative positions: ${JSON.stringify(members.map(({ member, placement }) => ({ id: member.id, name: member.name, section: placement.sectionId, position: placement.position, role: placement.role, performance: member.performanceInstructions })))}\nObservable performance notes: ${JSON.stringify(plan.cues.filter((cue) => group.some((placement) => placement.playerId === cue.playerId)))}\nRender EXACTLY ${members.length} people total, one per character reference. All listed people must appear exactly once. Do not add conversation partners, reflections, background people or duplicate versions of a character. Do not render labels or text.`;
      await options.onStep?.(`section:${index + 1}`);
      const rendered = await renderDurableVisualImage(db, { gameId, sceneId: scene.id, repairJobId: options.jobId, operationKey: `${renderKey}:section:v2:${index}`, reuseOperationKey: reuse(`section:v2:${index}`), allowFallback: options.jobId ? true : scene.renderRevision === 0, request: { prompt, width, height, references: [...(background ? [background] : []), ...members.map((member) => member.image)] }, signal, beforeDispatch });
      sectionImages.push(rendered.image);
      sectionMembers.push(members);
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
      finalImage = assembly;
    }
    await options.onImage?.(await storeVisualArtifact(db, gameId, finalImage));
    const playable: StoredVisualShot[] = [];
    for (const [index, image] of sectionImages.entries()) {
      const members = sectionMembers[index] ?? [];
      try {
        const localized = await localize(image, members, `section-localization:${index}`);
        playable.push(await shot(image, members.map(m => m.member.id), localized));
      } catch (error) {
        signal?.throwIfAborted();
        await beforeDispatch?.();
        if (!options.allowMissing || !(error instanceof VisualIdentityFailure)) throw error;
        await recordVisualOperationEvent(db, gameId, `${renderKey}:rejected-section:${index}`, {
          sceneId: scene.id, kind: "failure", outcome: "failed", message: `Group shot ${index + 1} rejected; retaining the other usable shots`,
        }, visualFailureEvidence(error, "identity"));
      }
    }
    if (!playable.length) throw new VisualIdentityFailure("No usable group shot survived verification");
    shots = { mode: playable.length === 1 && groups.length <= 1 ? "scene" : "groups", overview: null, groups: playable };
    if (shots.mode === "scene") shots.overview = playable[0]!;
    // Originals remain reviewable/playable even when the optional composite is rejected.
    if (sectionImages.length > 1 && playable.length === sectionImages.length) {
      await options.onStep?.("harmonizing");
      try {
        const harmonized = await renderDurableVisualImage(db, {
          gameId, sceneId: scene.id, repairJobId: options.jobId,
          operationKey: `${renderKey}:harmonization:v1`, reuseOperationKey: reuse("harmonization:v1"),
          allowFallback: options.jobId ? true : scene.renderRevision === 0, signal, beforeDispatch,
          request: { width: 1536, height: 864, references: [finalImage, ...sectionImages],
            prompt: `${common}\nHarmonize these conversation panels into one continuous widescreen room. The first reference is their ordered assembly; the remaining references are the original panels. Preserve every character exactly once, including their face, clothing and relative position. Unify lighting, perspective, furniture and background across the seams. Keep all ${references.length} faces visible with headroom. Do not add, duplicate, replace or remove any person. No borders, labels or text.` },
        });
        await options.onImage?.(await storeVisualArtifact(db, gameId, harmonized.image));
        await options.onStep?.("verifying harmonization");
        // A composite must verify the entire cast, even when individual panels allow missing people.
        const localized = await localize(harmonized.image, references, "harmonization-localization:v1", false);
        shots.overview = await shot(harmonized.image, references.map(r => r.member.id), localized);
        shots.mode = "scene";
      } catch (error) {
        signal?.throwIfAborted();
        await beforeDispatch?.();
        if (!(error instanceof VisualIdentityFailure) && !(error instanceof VisualImageFailure)) throw error;
        await recordVisualOperationEvent(db, gameId, `${renderKey}:rejected-harmonization:v1`, {
          sceneId: scene.id, kind: "failure", outcome: "failed", message: "Harmonized image rejected; retaining verified original panels",
        }, visualFailureEvidence(error, error instanceof VisualIdentityFailure ? "identity" : "response"));
      }
    }
    }
    const imageArtifactId = shots ? (shots.overview ?? shots.groups[0])!.imageArtifactId : await storeVisualArtifact(db, gameId, finalImage);
    if (!shots) await options.onImage?.(imageArtifactId);
    await options.onStep?.("verifying");
    if (shots) {
      const visible = shots.overview?.visibleParticipantIds ?? [...new Set(shots.groups.flatMap(s => s.visibleParticipantIds))];
      return { imageArtifactId, shots, localization: { count: visible.length, anchors: shots.mode === "scene" ? shots.overview!.anchors : [], verifiedParticipantIds: visible } };
    }
    const localization = await localize(finalImage, references, "localization");
    const single = await shot(finalImage, plan.cast.map(m => m.id), localization);
    shots = { mode: "scene", overview: single, groups: [] };
    return { imageArtifactId, localization, shots };
}
