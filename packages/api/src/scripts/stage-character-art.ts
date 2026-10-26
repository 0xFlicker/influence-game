/** Stage generated character art for review without publishing or changing a profile.
 * Head coordinates must come from inspecting the source image, including any crest.
 * bun packages/api/src/scripts/stage-character-art.ts --source body.png --cutout cutout.png
 *   --head '{"x":0.4,"y":0.02,"width":0.2,"height":0.2}' --out /new/bundle
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { portraitCropFromHead, portraitCropPixels, portraitHeadRectangle, validHeadRectangle } from "@influence/engine/character-portrait";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  source: { type: "string" }, cutout: { type: "string" }, head: { type: "string" }, out: { type: "string" },
}, strict: true });
if (!values.source || !values.cutout || !values.head || !values.out) throw new Error("Required: --source PNG --cutout PNG --head normalized-rectangle-JSON --out NEW-DIRECTORY");
const rect: unknown = JSON.parse(values.head);
if (!validHeadRectangle(rect)) throw new Error("Choose a normalized head rectangle inside the inspected source image");
const [source, cutout] = await Promise.all([readFile(values.source), readFile(values.cutout)]);
const [original, transparent] = await Promise.all([sharp(source).metadata(), sharp(cutout).metadata()]);
if (original.format !== "png" || transparent.format !== "png" || !original.width || !original.height
  || original.width !== transparent.width || original.height !== transparent.height
  || !transparent.hasAlpha || original.orientation && original.orientation !== 1
  || transparent.orientation && transparent.orientation !== 1) throw new Error("Source and cutout must be oriented PNGs of identical dimensions, with cutout alpha");
const alpha = await sharp(cutout).extractChannel("alpha").stats();
if (alpha.channels[0]!.min !== 0 || alpha.channels[0]!.max !== 255) throw new Error("Cutout must contain transparent background and opaque subject pixels");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceHash = hash(source);
// This is a local bundle identity, not a submitted profile URL or user confirmation.
const sourceUrl = "full-body.png";
const headPosition = { sourceUrl, sourceHash, sourceWidth: original.width, sourceHeight: original.height, rect };
const size = { width: original.width, height: original.height };
const portraitCrop = portraitCropFromHead(sourceUrl, size, rect);
if (!portraitHeadRectangle(headPosition, portraitCrop)) throw new Error("Portrait crop excludes part of the head");
const pixels = portraitCropPixels(portraitCrop, size);
const portrait = await sharp(source).extract(pixels).resize(512, 512).webp({ quality: 92 }).toBuffer();
const circular = await sharp(portrait).composite([{ input: Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>'), blend: "dest-in" }]).png().toBuffer();
const files = { "full-body.png": source, "cutout.png": cutout, "portrait.webp": portrait, "portrait-circle.png": circular };
const out = resolve(values.out);
// Refuse an existing destination: preserve all previous assets and review evidence.
await mkdir(out);
for (const [name, bytes] of Object.entries(files)) await writeFile(`${out}/${name}`, bytes, { flag: "wx" });
const manifest = { version: 1, published: false, sourceInputs: { source: resolve(values.source), cutout: resolve(values.cutout) },
  headPosition, portraitCrop, portraitPixels: pixels,
  assets: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { sha256: hash(bytes), byteLength: bytes.length }])),
  publicationNote: "Upload under new immutable keys. Replace sourceUrl with the uploaded full-body URL in both coordinate records; let the submission service assign confirmation. Keep existing game-start references unchanged.",
};
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ out, sourceHash, cutoutHash: hash(cutout), published: false }));
