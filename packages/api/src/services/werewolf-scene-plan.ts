import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { planVisualScene, type VisualScenePlan, type VisualSceneDirection, type VisualCastMember } from "@influence/engine/visual-scene-plan";
import type { WerewolfSceneDescriptor } from "@influence/engine/werewolf/visual-scenes";
import { schema, type DrizzleDB } from "../db/index.js";
import { storeVisualArtifact } from "./visual-scene-store.js";

export const WEREWOLF_ART_REVISION = "lantern-village-v1";
export const WEREWOLF_FORM_REVISION = "wolf-form-v1";
const style = "Rustic medieval Lantern Village, weathered stone and hand-hewn timber, tactile materials, restrained lantern light. Preserve each referenced character's own rendering style, including illustration, anime and stylized 3D. No modern furniture, text or watermarks.";
const locations = {
  village: { file: "round-table.png", roomName: "Village round table", roomDirection: "A rough circular timber table in a rustic village hall. Seat everyone around the far semicircle with the near half open to camera. All faces must remain front or three-quarter facing the camera." },
  pack: { file: "pack-cellar.png", roomName: "Private pack cellar", roomDirection: "Ruined moonlit medieval cellar, rough timber and stone seats built into the wall foundations, with a low worn stone slab. Two separated sitting positions face the camera. Keep the supplied masonry, broken opening and amber lantern. No freestanding matching chairs." },
  hunt: { file: "moonlit-lane.png", roomName: "Moonlit village lane", roomDirection: "A rustic moonlit village lane. The separate non-wolf character is large in the foreground left, walking toward the near end of the alley, looking ahead or concerned. The wolf characters are smaller together in the background right at the far end of the alley, walking in the same direction behind that character. Keep a long clear stretch of alley between them, with all faces readable in front or three-quarter view. Quiet atmospheric staging, no physical contact, injury, blood or attack depiction." },
} as const;

/** Planning only: copies approved backgrounds, never dispatches a provider. */
export async function planWerewolfScene(db: DrizzleDB, gameId: string, descriptor: WerewolfSceneDescriptor,
  originalCast: readonly VisualCastMember[], regenerateForms?: string): Promise<VisualScenePlan> {
  const location = locations[descriptor.purpose];
  const bytes = await readFile(process.env.WEREWOLF_ASSET_DIR ? join(process.env.WEREWOLF_ASSET_DIR, location.file) : new URL(`../../assets/werewolf/${location.file}`, import.meta.url));
  const backgroundArtifactId = await storeVisualArtifact(db, gameId, bytes);
  const cast = await werewolfVariantCast(db, gameId, descriptor.wolfIds, originalCast, regenerateForms);
  const plan = planVisualScene({ roomId: descriptor.roomId, backgroundArtifactId, cast });
  const direction: VisualSceneDirection = { purpose: `werewolf-${descriptor.purpose}`, revision: WEREWOLF_ART_REVISION, style,
    roomName: location.roomName, roomDirection: location.roomDirection };
  return { ...plan, direction, placements: cast.map((member, index) => ({ playerId: member.id, role: "participant", sectionId: plan.placements[index]!.sectionId,
    position: descriptor.purpose === "hunt" ? member.id === descriptor.targetId ? "foreground left, large and nearest camera, walking toward the near end of the alley, face visible" : `background right at the far end of the alley, smaller wolf position ${index + 1}, following behind the foreground character with wide separation, face visible`
      : descriptor.purpose === "pack" ? `${index === 0 ? "left" : "right"} built-in masonry seat, facing camera`
      : `far semicircle position ${index + 1} of ${cast.length}, facing camera, near half of table empty` })) };
}

/** Also used for a lone wolf, which has no pack meeting to trigger preparation. */
export async function werewolfVariantCast(db: DrizzleDB, gameId: string, wolfIds: readonly string[], originalCast: readonly VisualCastMember[], regenerateForms?: string) {
  return Promise.all(originalCast.map(async member => {
    if (!wolfIds.includes(member.id)) return member;
    const [selected] = regenerateForms ? [] : await db.select().from(schema.visualCharacterVariants).where(and(
      eq(schema.visualCharacterVariants.gameId, gameId), eq(schema.visualCharacterVariants.playerId, member.id),
      eq(schema.visualCharacterVariants.sourceArtifactId, member.referenceArtifactId), eq(schema.visualCharacterVariants.revision, WEREWOLF_FORM_REVISION),
    )).orderBy(desc(schema.visualCharacterVariants.createdAt)).limit(1);
    return { ...member, referenceArtifactId: selected?.artifactId ?? member.referenceArtifactId,
      headRectangle: selected?.head ?? undefined,
      variant: { kind: "werewolf" as const, sourceArtifactId: member.referenceArtifactId, revision: WEREWOLF_FORM_REVISION,
        generation: regenerateForms ?? selected?.generation ?? "initial", resolved: Boolean(selected) } };
  }));
}
