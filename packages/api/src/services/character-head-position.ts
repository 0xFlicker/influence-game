import sharp from "sharp";
import { createHash } from "node:crypto";
import { parseCharacterHeadPosition, portraitHeadRectangle, type PortraitCrop, type CharacterHeadPosition } from "@influence/engine/character-portrait";
import type { ContentAssetEvidence } from "./agent-content-submissions.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { AgentProfileManagementError } from "./agent-profile-management.js";

type HeadProfile = { fullBodyReferenceUrl?: string | null; headPosition?: CharacterHeadPosition | null; portraitCrop?: PortraitCrop | null };
/** Explicitly supplied geometry is confirmation; actor/time are owned by this service. */
export async function confirmProfileHead(next: HeadProfile, previous: HeadProfile | null, userId: string, evidence?: ContentAssetEvidence): Promise<CharacterHeadPosition | null> {
  const fail = (message: string): never => { throw new AgentProfileManagementError("invalid_agent_input", message, 400); };
  if (!next.fullBodyReferenceUrl) return null;
  if (!next.headPosition) {
    if (next.fullBodyReferenceUrl !== previous?.fullBodyReferenceUrl || previous?.headPosition) fail("Confirm the head position for the selected full-body image before saving.");
    return null; // Unrelated edits to existing, unlocalized characters remain valid.
  }
  const head = parseCharacterHeadPosition(next.headPosition);
  const sourceIdentity = (url: string) => {
    try { return new URL(url, new URL(next.fullBodyReferenceUrl!, "http://character.invalid")).href; }
    catch { return fail("The head position must reference a valid source image URL."); }
  };
  if (sourceIdentity(head.sourceUrl) !== sourceIdentity(next.fullBodyReferenceUrl)) fail("The head position belongs to a different image. Confirm the new image's head position.");
  head.sourceUrl = next.fullBodyReferenceUrl;
  if (next.portraitCrop && sourceIdentity(next.portraitCrop.sourceUrl) === sourceIdentity(head.sourceUrl)
    && !portraitHeadRectangle(head, { ...next.portraitCrop, sourceUrl: head.sourceUrl })) fail("Include the entire head box inside the portrait crop.");
  const bytes = evidence?.[head.sourceUrl]?.bytes ?? await readVisualProfileImage(head.sourceUrl, { name: "", personaKey: "" });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const size = await sharp(await sharp(bytes).rotate().toBuffer()).metadata();
  if (hash !== head.sourceHash || size.width !== head.sourceWidth || size.height !== head.sourceHeight) fail("The source image changed. Reopen Character images and confirm its head position.");
  if (previous?.headPosition?.confirmation && JSON.stringify(parseCharacterHeadPosition(previous.headPosition)) === JSON.stringify(head)) return previous.headPosition;
  return { ...head, confirmation: { userId, at: new Date().toISOString() } };
}
