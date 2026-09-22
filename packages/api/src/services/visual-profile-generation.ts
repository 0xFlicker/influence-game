import sharp from "sharp";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import type { DrizzleDB } from "../db/index.js";
import { getStorageBackend, storePublicAvatarImage } from "../lib/storage.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { renderOwnedVisualReference } from "./visual-render-journal.js";

/** Returns a draft asset; the existing profile save owns applying/replacing it. */
export async function generateVisualProfileReference(db: DrizzleDB, userId: string, args: Record<string, unknown>, publicBaseUrl?: string) {
  const { requestId, name, personaKey, avatarUrl, performanceInstructions } = args;
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || typeof name !== "string" || !name.trim() || name.length > AGENT_PROFILE_LIMITS.name
    || typeof personaKey !== "string" || personaKey.length > 40
    || typeof performanceInstructions !== "string" || performanceInstructions.length > AGENT_PROFILE_LIMITS.performanceInstructions
    || (avatarUrl !== null && typeof avatarUrl !== "string")) throw new Error("A request UUID, character name, personaKey, avatarUrl and performanceInstructions are required");
  if (getStorageBackend() === "disabled") throw new Error("Image storage is not configured");
  const reference = await readVisualProfileImage(avatarUrl, { name, personaKey });
  const result = await renderOwnedVisualReference(db, { userId, requestId, request: { width: 1024, height: 1536, references: [reference],
    prompt: `Create a photorealistic full-body reference of this exact contestant, ${name}. Preserve face, hair and distinguishing features. Entire body and shoes visible, neutral standing pose, simple contemporary clothing with a distinct reproducible silhouette and colors, plain warm grey background. No text. Performance direction: ${performanceInstructions}`,
  } });
  const bytes = await sharp(result.image).resize({ width: 1024, height: 1536, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
  const stored = await storePublicAvatarImage(`pfp/generated/${result.operationId}.webp`, "image/webp", new Uint8Array(bytes).buffer, publicBaseUrl);
  return { requestId, fullBodyReferenceUrl: stored.publicUrl };
}
