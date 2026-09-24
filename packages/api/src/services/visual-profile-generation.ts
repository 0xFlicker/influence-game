import sharp from "sharp";
import { createHash } from "node:crypto";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import { portraitCropFromHead, portraitCropPixels, portraitHeadRectangle, validHeadRectangle, type CharacterHeadPosition, type PortraitCrop } from "@influence/engine/character-portrait";
import type { DrizzleDB } from "../db/index.js";
import { getStorageBackend, storePublicAvatarImage } from "../lib/storage.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { localizeOwnedVisualReference, renderOwnedVisualReference } from "./visual-render-journal.js";

/** Crop original pixels without a second image generation or another allowance charge. */
export async function exportCharacterPortrait(crop: PortraitCrop, publicBaseUrl?: string, headRectangle?: unknown) {
  if (!crop || typeof crop.sourceUrl !== "string" || crop.sourceUrl.length > 2048 || Object.keys(crop).sort().join(",") !== "height,sourceUrl,width,x,y") throw new Error("A source image and crop are required");
  const source = await readVisualProfileImage(crop.sourceUrl, { name: "", personaKey: "" });
  const image = sharp(source).rotate();
  const normalized = await image.toBuffer();
  const { width, height } = await sharp(normalized).metadata();
  if (!width || !height) throw new Error("Image dimensions are unavailable");
  if (headRectangle !== undefined && !validHeadRectangle(headRectangle)) throw new Error("Choose a head box inside the source image");
  const headPosition: CharacterHeadPosition | null = headRectangle === undefined ? null : { sourceUrl: crop.sourceUrl, sourceHash: createHash("sha256").update(source).digest("hex"), sourceWidth: width, sourceHeight: height, rect: headRectangle as CharacterHeadPosition["rect"] };
  if (headPosition && !portraitHeadRectangle(headPosition, crop)) throw new Error("Include the entire head box inside the portrait crop.");
  const pixels = portraitCropPixels(crop, { width, height });
  const bytes = await sharp(normalized).extract(pixels).resize(512, 512).webp({ quality: 92 }).toBuffer();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const stored = await storePublicAvatarImage(`pfp/crops/${hash}.webp`, "image/webp", new Uint8Array(bytes).buffer, publicBaseUrl);
  return { avatarUrl: stored.publicUrl, portraitCrop: crop, headPosition };
}

/** One full-body generation, followed by observed head localization and a pixel crop. All output remains draft-only. */
export async function generateVisualProfileReference(db: DrizzleDB, userId: string, args: Record<string, unknown>, publicBaseUrl?: string) {
  const { requestId, name, personaKey, avatarUrl, performanceInstructions } = args;
  const visualDesign = args.visualDesign ?? "";
  const fullBodyReferenceUrl = args.fullBodyReferenceUrl ?? null;
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || typeof name !== "string" || !name.trim() || name.length > AGENT_PROFILE_LIMITS.name
    || typeof personaKey !== "string" || personaKey.length > 40
    || typeof performanceInstructions !== "string" || performanceInstructions.length > AGENT_PROFILE_LIMITS.performanceInstructions
    || typeof visualDesign !== "string" || visualDesign.length > 8_000
    || (fullBodyReferenceUrl !== null && typeof fullBodyReferenceUrl !== "string")
    || (avatarUrl !== null && typeof avatarUrl !== "string")) throw new Error("A request UUID and valid character fields are required");
  if (getStorageBackend() === "disabled") throw new Error("Image storage is not configured");
  const sourceUrl = fullBodyReferenceUrl || avatarUrl;
  const reference = sourceUrl ? await sharp(await readVisualProfileImage(sourceUrl, { name, personaKey })).rotate().png().toBuffer() : null;
  const result = await renderOwnedVisualReference(db, { userId, requestId, request: { width: 1024, height: 1536, references: reference ? [reference] : [],
    prompt: `Create a photorealistic full-body character reference for the adult Influence contestant ${name}. ${reference ? "Preserve the reference character's species or object form, face and distinguishing features." : "Design a unique character from the supplied visual design, honoring any non-human or anthropomorphic form instead of defaulting to a human."} Exactly one character. Show the entire character and feet when applicable, with defining features unobscured and facing toward camera in a natural neutral pose. Use a distinct reproducible silhouette and colors, plain warm grey background. No text, panels, additional characters or headshot inset. Visual design: ${visualDesign || personaKey}. Performance direction: ${performanceInstructions}`,
  } });
  const bytes = await sharp(result.image).rotate().resize({ width: 1024, height: 1536, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
  const stored = await storePublicAvatarImage(`pfp/generated/${result.operationId}.webp`, "image/webp", new Uint8Array(bytes).buffer, publicBaseUrl);
  const { width, height } = await sharp(bytes).metadata();
  if (!width || !height) throw new Error("Generated image dimensions are unavailable");
  const base = { requestId, fullBodyReferenceUrl: stored.publicUrl, width, height };
  let headSuggestion: CharacterHeadPosition | null = null;
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("Portrait localization is not configured");
    const localization = await localizeOwnedVisualReference(db, { userId, requestId, scene: bytes, apiKey: process.env.OPENAI_API_KEY });
    const anchor = localization.anchors[0];
    const head = localization.anchors.length === 1 && anchor?.confidence === "clear" ? anchor.head : null;
    if (!validHeadRectangle(head)) throw new Error("No clear head was located");
    headSuggestion = { sourceUrl: stored.publicUrl, sourceHash: createHash("sha256").update(bytes).digest("hex"), sourceWidth: width, sourceHeight: height, rect: head };
    const crop = portraitCropFromHead(stored.publicUrl, { width, height }, head);
    return { ...base, ...await exportCharacterPortrait(crop, publicBaseUrl), headSuggestion, cropWarning: null };
  } catch (error) {
    // Paid localization failures retain their journal receipt. Never silently guess a face crop.
    console.warn("[character-portrait] Manual crop required", { requestId, error: error instanceof Error ? error.message : String(error) });
    return { ...base, headSuggestion, avatarUrl: null, portraitCrop: null, cropWarning: "The full-body image is ready. Choose a portrait crop to finish the character." };
  }
}
