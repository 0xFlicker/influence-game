import { writeLocalUpload } from "../lib/storage.js";
/** Real, provider-free 1x1 PNG so content revisions can retain the submitted bytes. */
export async function contentImageFixture(key: string): Promise<string> {
  const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=", "base64"));
  await writeLocalUpload(key, "image/png", bytes.buffer);
  return `/api/uploads/local?key=${encodeURIComponent(key)}`;
}

export async function headPositionFixture(sourceUrl: string) {
  const { createHash } = await import("node:crypto");
  const { readVisualProfileImage } = await import("../services/visual-game-assets.js");
  const bytes = await readVisualProfileImage(sourceUrl, { name: "", personaKey: "" });
  return { sourceUrl, sourceHash: createHash("sha256").update(bytes).digest("hex"), sourceWidth: 1, sourceHeight: 1, rect: { x: .2, y: .02, width: .2, height: .2 } };
}
