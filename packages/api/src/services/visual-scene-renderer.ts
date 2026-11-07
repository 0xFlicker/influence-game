import sharp from "sharp";
import { VisualIdentityFailure } from "@influence/engine/visual-localization";
import { recordVisualOperationEvent, visualFailureEvidence } from "./visual-diagnostics.js";
import { and, eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { annotateVisualScene, VISUAL_LOCALIZATION_VERSION } from "./visual-scene-localization.js";
import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
import { assertVisualShot, VISUAL_HOUSE_STYLE, VISUAL_ROOMS, type StoredVisualShot, type VisualShotPresentation } from "@influence/engine/visual-mode";
import { cropVisualScene, splitVisualBackground } from "./visual-scene-crops.js";
import { visualRoomCropGroups } from "@influence/engine/visual-scene-plan";
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
  sourcePanels?: StoredVisualShot[];
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
    const room = VISUAL_ROOMS[plan.roomId];
    const direction = plan.direction ?? options.renderContext;
    const common = `${direction?.style ?? VISUAL_HOUSE_STYLE}\nSetting: ${direction?.roomName ?? room.name}.\n${plan.direction ? `Staging direction: ${plan.direction.roomDirection}\n` : ""}One continuous room photographed from one camera, with consistent perspective and lighting. Preserve the room's architecture and each character's face, hair, clothing and body. Every face must be visible from the front or three-quarter view. No extra people, reflections of people, repeated furniture, panels, borders, labels or text.`;
    const ids = references.map(r => r.member.id);
    // Both automatic and producer-requested stitching reuse immutable verified views.
    const harmonize = async (sourcePanels: StoredVisualShot[]) => {
      if (sourcePanels.length < 2) throw new Error("Harmonization requires at least two saved panels");
      for (const panel of sourcePanels) assertVisualShot(panel, ids);
      const panels = await Promise.all(sourcePanels.map(panel => readVisualArtifact(db, gameId, panel.imageArtifactId)));
      const shots: VisualShotPresentation<StoredVisualShot> = { mode: "groups", overview: null, groups: sourcePanels };
      const width = 3072, height = 1536;
      const ordered = await Promise.all(panels.map(async (image, index) => {
        const left = Math.floor(index * width / panels.length);
        const next = Math.floor((index + 1) * width / panels.length);
        return { input: await sharp(image).resize(next - left, height, { fit: "contain", background: "#e5ded0" }).png().toBuffer(), left, top: 0 };
      }));
      const assembly = await sharp({ create: { width, height, channels: 3, background: "#e5ded0" } }).composite(ordered).png().toBuffer();
      try {
        await options.onStep?.("harmonizing");
        const rendered = await renderDurableVisualImage(db, {
          gameId, sceneId: scene.id, repairJobId: options.jobId,
          operationKey: `${renderKey}:harmonization:v2`, reuseOperationKey: reuse("harmonization:v2"),
          allowFallback: options.jobId ? true : scene.renderRevision === 0, signal, beforeDispatch,
          request: { operation: "edit", background: "opaque", width, height, references: [assembly, ...panels],
            prompt: `${common}\nStitch these views into one continuous wide room. The FIRST reference is their ordered assembly; the remaining references are the original views in left-to-right order. Preserve EVERY original person, face, clothing, pose, and left-to-right position from the assembly. Unify architecture, lighting and perspective at the seams without deleting, merging, replacing or duplicating anyone. The final image must contain exactly ${ids.length} distinct contestants, each once. Source-view cast counts and identities: ${JSON.stringify(sourcePanels.map(panel => panel.visibleParticipantIds.map(id => ({ id, name: plan.cast.find(member => member.id === id)?.name })) ))}. Keep all faces visible. No panel borders or collage seams.` },
        });
        await options.onImage?.(await storeVisualArtifact(db, gameId, rendered.image));
        await options.onStep?.("verifying harmonization");
        const localized = await localize(rendered.image, references, "harmonization-localization:v2", false);
        shots.overview = await shot(rendered.image, ids, localized);
        shots.mode = "scene";
        return { imageArtifactId: shots.overview.imageArtifactId, shots, localization: localized };
      } catch (error) {
        signal?.throwIfAborted();
        await beforeDispatch?.();
        if (!(error instanceof VisualIdentityFailure)) throw error;
        await recordVisualOperationEvent(db, gameId, `${renderKey}:rejected-harmonization:v2`, {
          sceneId: scene.id, kind: "failure", outcome: "failed", message: "Harmonized image rejected; retaining verified original panels",
        }, visualFailureEvidence(error, "identity"));
        const visible = [...new Set(shots.groups.flatMap(s => s.visibleParticipantIds))];
        return { imageArtifactId: shots.groups[0]!.imageArtifactId, shots, localization: { count: visible.length, anchors: [], verifiedParticipantIds: visible } };
      }
    };
    if (options.sourcePanels) return harmonize(options.sourcePanels);
    if (scene.repairMode !== "verify" || !scene.candidateArtifactId) {
      const plannedGroups = visualRoomCropGroups(plan);
      const groups = plannedGroups.length ? plannedGroups : [[]];
      let roomImage = background;
      if (!roomImage && groups.length > 1) {
        await options.onStep?.("room-panorama");
        const rendered = await renderDurableVisualImage(db, { gameId, sceneId: scene.id, repairJobId: options.jobId,
          operationKey: `${renderKey}:room-panorama:v1`, reuseOperationKey: reuse("room-panorama:v1"), signal, beforeDispatch,
          allowFallback: options.jobId ? true : scene.renderRevision === 0,
          request: { operation: "create", background: "opaque", width: 3072, height: 1536, references: [], prompt: `${common}\nRoom design: ${direction?.roomDirection ?? room.direction}. Show an empty wide room, exactly zero people. Distinct furniture and architecture across the left, middle and right of one continuous space.` } });
        roomImage = await readVisualArtifact(db, gameId, await storeVisualArtifact(db, gameId, rendered.image));
      }
      const backgrounds = roomImage && groups.length > 1 ? await splitVisualBackground(roomImage, groups.length) : [];
      const playable: StoredVisualShot[] = [];
      for (const [index, group] of groups.entries()) {
        const members = group.map(placement => {
          const reference = references.find(r => r.member.id === placement.playerId);
          if (!reference) throw new Error("Scene placement has no frozen character reference");
          return { ...reference, placement };
        });
        const crop = backgrounds[index];
        const backdrop = crop ? await readVisualArtifact(db, gameId, await storeVisualArtifact(db, gameId, crop.image)) : roomImage;
        await options.onStep?.(`section:${index + 1}`);
        const rendered = await renderDurableVisualImage(db, { gameId, sceneId: scene.id, repairJobId: options.jobId,
          operationKey: `${renderKey}:room-crop:v1:${index}`, reuseOperationKey: reuse(`room-crop:v1:${index}`), signal, beforeDispatch,
          allowFallback: options.jobId ? true : scene.renderRevision === 0,
          request: { operation: "create", background: "opaque", width: crop?.width ?? 1536, height: crop?.height ?? 864,
            references: [...(backdrop ? [backdrop] : []), ...members.map(r => r.image)],
            prompt: `${common}\n${backdrop ? "" : direction?.roomDirection ?? room.direction}\n${crop ? `This is view ${index + 1} of ${groups.length}: the first image is ONLY this distinct region cropped from a wide room. Preserve this region's camera, architecture and furniture. Do not reconstruct the entire room or add furniture from other regions. Place the characters naturally within THIS view, with every face visible and headroom.` : "Show the whole conversation in one wide view."} ${backdrop ? "The remaining references" : "The references"} identify IN ORDER: ${JSON.stringify(members.map(({ member, placement }) => ({ id: member.id, name: member.name, role: placement.role, ...(plan.direction ? { position: placement.position } : {}), performance: member.performanceInstructions })))}. Exactly ${members.length} people, each character exactly once. No additional conversation partners. Observable performance notes: ${JSON.stringify(plan.cues.filter(cue => members.some(r => r.member.id === cue.playerId)))}.` },
        });
        const candidateId = await storeVisualArtifact(db, gameId, rendered.image);
        await options.onImage?.(candidateId);
        try {
          await options.onStep?.(`verifying:section:${index + 1}`);
          const localized = await localize(rendered.image, members, `room-crop-localization:v1:${index}`);
          playable.push(await shot(rendered.image, members.map(r => r.member.id), localized));
        } catch (error) {
          signal?.throwIfAborted();
          await beforeDispatch?.();
          if (!options.allowMissing || !(error instanceof VisualIdentityFailure)) throw error;
          await recordVisualOperationEvent(db, gameId, `${renderKey}:rejected-room-crop:v1:${index}`, {
            sceneId: scene.id, kind: "failure", outcome: "failed", message: `Room view ${index + 1} rejected; retaining other verified views`,
          }, visualFailureEvidence(error, "identity"));
        }
      }
      if (!playable.length) throw new VisualIdentityFailure("No usable room view survived verification");
      if (groups.length > 1 && playable.length === groups.length) return harmonize(playable);
      const shots: VisualShotPresentation<StoredVisualShot> = { mode: groups.length === 1 ? "scene" : "groups", overview: groups.length === 1 ? playable[0]! : null, groups: playable };
      const visible = [...new Set(playable.flatMap(s => s.visibleParticipantIds))];
      return { imageArtifactId: playable[0]!.imageArtifactId, shots, localization: { count: visible.length, anchors: shots.overview?.anchors ?? [], verifiedParticipantIds: visible } };
    }
    const image = await readVisualArtifact(db, gameId, scene.candidateArtifactId);
    const imageArtifactId = await storeVisualArtifact(db, gameId, image);
    await options.onImage?.(imageArtifactId);
    await options.onStep?.("verifying");
    const localization = await localize(image, references, "panorama-localization:v1");
    const overview = await shot(image, ids, localization);
    // Crops inherit verified geometry; no more paid calls can invalidate this scene.
    const crops = localization.anchors.length === overview.visibleParticipantIds.length
      ? await cropVisualScene(image, localization.anchors) : [];
    const groups = await Promise.all(crops.map(crop => {
      const visible = crop.anchors.map(a => a.playerId);
      return shot(crop.image, visible, { count: visible.length, anchors: crop.anchors, verifiedParticipantIds: visible });
    }));
    const shots: VisualShotPresentation<StoredVisualShot> = { mode: groups.length > 1 ? "groups" : "scene", overview, groups };
    return { imageArtifactId, localization, shots };
}
