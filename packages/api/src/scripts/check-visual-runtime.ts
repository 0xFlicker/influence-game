import sharp from "sharp";
import { readdir } from "node:fs/promises";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import { HOUSE_PORTRAIT_KEYS } from "@influence/engine/house-personas";
import { HOUSE_BODY_ART } from "@influence/engine/house-character-art";

// Run from the final API image, with no provider credentials or database.
const directory = process.env.INFLUENCE_PERSONA_ASSET_DIR;
if (!directory) throw new Error("INFLUENCE_PERSONA_ASSET_DIR must identify the deployed persona assets");
const files = (await readdir(directory)).filter((name) => name.endsWith(".png"));
if (files.length !== HOUSE_PORTRAIT_KEYS.length) throw new Error(`Expected ${HOUSE_PORTRAIT_KEYS.length} persona images, found ${files.length}`);
for (const file of files) {
  const image = await readVisualProfileImage(null, { name: "Runtime check", personaKey: file.slice(0, -4) });
  const { info } = await sharp(image).resize(32, 32).png().toBuffer({ resolveWithObject: true });
  if (info.width !== 32 || info.height !== 32) throw new Error(`Image processing failed for ${file}`);
}
for (const [key, art] of Object.entries(HOUSE_BODY_ART)) {
  const bytes = await readVisualProfileImage(art.url, { name: key, personaKey: key });
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== art.width || metadata.height !== art.height || !metadata.hasAlpha || metadata.channels !== 4) throw new Error(`Invalid bundled full-body image: ${key}`);
}
console.log(`Visual runtime verified: ${files.length} portraits, ${Object.keys(HOUSE_BODY_ART).length} transparent full-bodies and Sharp ${sharp.versions.sharp}`);
