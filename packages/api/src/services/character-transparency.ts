import sharp from "sharp";
/** Test source pixels before resizing can introduce transparent padding. */
export async function hasCharacterTransparency(
  bytes: Uint8Array,
): Promise<boolean> {
  const image = sharp(Buffer.from(bytes));
  if (!(await image.metadata()).hasAlpha) return false;
  const alpha = await image.extractChannel("alpha").raw().toBuffer();
  return (
    alpha.some((value) => value === 0) && alpha.some((value) => value >= 250)
  );
}
