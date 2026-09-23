import sharp from "sharp";
import { readdir } from "node:fs/promises";
import { readVisualProfileImage } from "../services/visual-game-assets.js";

// Run from the final API image, with no provider credentials or database.
const directory = process.env.INFLUENCE_PERSONA_ASSET_DIR;
if (!directory) throw new Error("INFLUENCE_PERSONA_ASSET_DIR must identify the deployed persona assets");
const files = (await readdir(directory)).filter((name) => name.endsWith(".png"));
if (files.length !== 13) throw new Error(`Expected 13 persona images, found ${files.length}`);
for (const file of files) {
  const image = await readVisualProfileImage(null, { name: "Runtime check", personaKey: file.slice(0, -4) });
  const { info } = await sharp(image).resize(32, 32).png().toBuffer({ resolveWithObject: true });
  if (info.width !== 32 || info.height !== 32) throw new Error(`Image processing failed for ${file}`);
}
console.log(`Visual runtime verified: ${files.length} persona images and Sharp ${sharp.versions.sharp}`);
