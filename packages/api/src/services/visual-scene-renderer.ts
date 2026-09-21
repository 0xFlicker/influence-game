import sharp from "sharp";
import { VISUAL_HOUSE_STYLE, VISUAL_ROOMS } from "@influence/engine/visual-mode";
import { visualRenderGroups } from "@influence/engine/visual-scene-plan";
import type { DrizzleDB } from "../db/index.js";
import { localizeDurableVisualScene, renderDurableVisualImage } from "./visual-render-journal.js";
import { acceptVisualScene, failVisualScene, readVisualArtifact, storeVisualArtifact, type StoredVisualScene } from "./visual-scene-store.js";

/** All external work occurs between short durable reservations and acceptance. */
export async function renderPlannedVisualScene(db: DrizzleDB, scene: StoredVisualScene, signal?: AbortSignal): Promise<StoredVisualScene> {
  if (scene.status === "ready") return scene;
  if (scene.status !== "preparing") throw new Error("Visual scene needs operator recovery");
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OpenAI scene verification credential");
    const { plan, gameId } = scene;
    const background = await readVisualArtifact(db, gameId, plan.backgroundArtifactId);
    const references = await Promise.all(plan.cast.map(async (member) => ({ member, image: await readVisualArtifact(db, gameId, member.referenceArtifactId) })));
    const groups = visualRenderGroups(plan);
    if (!groups.length) throw new Error("Empty scenes must already reference their saved background");
    const room = VISUAL_ROOMS[plan.roomId];
    const common = `${VISUAL_HOUSE_STYLE}\nSetting: ${room.name}. ${room.direction}\nPreserve the supplied room's architecture, furniture and materials. These contestants are playing a social-strategy game; use believable conversational staging, some seated and some standing as directed. Match each character's face, hair, clothing and body to their reference. No extra people.`;
    const sectionImages: Buffer[] = [];
    for (const [index, group] of groups.entries()) {
      const members = group.map((placement) => {
        const reference = references.find((entry) => entry.member.id === placement.playerId);
        if (!reference) throw new Error("Scene placement has no frozen character reference");
        return { ...reference, placement };
      });
      const width = groups.length === 1 ? 1536 : 512;
      const prompt = `${common}\n${groups.length === 1 ? "Show the entire conversation in a widescreen room shot." : "Render a portrait conversational section, framed to include every listed person and their full posture with headroom. This section will be assembled into a larger room."}\nThe first image is the common empty room. The remaining references correspond IN ORDER to these participants and intended furniture-relative positions: ${JSON.stringify(members.map(({ member, placement }) => ({ id: member.id, name: member.name, section: placement.sectionId, position: placement.position, role: placement.role, performance: member.performanceInstructions })))}\nObservable performance notes: ${JSON.stringify(plan.cues.filter((cue) => group.some((placement) => placement.playerId === cue.playerId)))}\nAll listed people must appear exactly once. Do not render labels or text.`;
      const rendered = await renderDurableVisualImage(db, { gameId, operationKey: `${scene.id}:section:${index}`, request: { prompt, width, height: 864, references: [background, ...members.map((member) => member.image)] }, signal });
      sectionImages.push(rendered.image);
    }
    let finalImage = sectionImages[0]!;
    if (sectionImages.length > 1) {
      const widths = sectionImages.map((_, index) => Math.floor((index + 1) * 1536 / sectionImages.length) - Math.floor(index * 1536 / sectionImages.length));
      const panels = await Promise.all(sectionImages.map(async (image, index) => ({
        input: await sharp(image).resize(widths[index]!, 864, { fit: "contain", background: "#e5ded0" }).png().toBuffer(),
        left: Math.floor(index * 1536 / sectionImages.length), top: 0,
      })));
      const assembly = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#e5ded0" } }).composite(panels).png().toBuffer();
      const castSheet = await createCastReferenceSheet(references.map((reference) => reference.image));
      const rendered = await renderDurableVisualImage(db, { gameId, operationKey: `${scene.id}:harmonize`, signal,
        request: { width: 1536, height: 864, references: [assembly, background, castSheet], prompt: `${common}\nHarmonize the FIRST image's assembled conversation sections into ONE coherent widescreen view. Keep every participant from every section exactly once; remove panel seams and reconcile perspective and lighting. The SECOND image is the empty room architecture. The THIRD is a numbered identity reference sheet: ${JSON.stringify(references.map(({ member }, index) => ({ number: index + 1, id: member.id, name: member.name })))}. Preserve conversational groups and their furniture-relative staging: ${JSON.stringify(plan.placements)}. Keep all ${plan.cast.length} participants and their visible heads in frame. The final image must have no numbers, labels, montage borders or text.` },
      });
      finalImage = rendered.image;
    }
    const imageArtifactId = await storeVisualArtifact(db, gameId, finalImage);
    const localization = await localizeDurableVisualScene(db, { gameId, operationKey: `${scene.id}:localization`, scene: finalImage,
      references: references.map(({ member, image }) => ({ image, players: [{ id: member.id, name: member.name }] })), apiKey, signal });
    return await acceptVisualScene(db, { sceneId: scene.id, planHash: scene.planHash, imageArtifactId, anchors: localization.anchors });
  } catch (error) {
    await failVisualScene(db, scene.id, error instanceof Error ? error.message : "Visual scene preparation failed");
    throw error;
  }
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
