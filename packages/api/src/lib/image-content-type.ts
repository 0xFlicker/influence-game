export const IMAGE_SIGNATURE_BYTES = 12;
export type ImageContentType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export function isImageContentType(value: unknown): value is ImageContentType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif";
}

/** Identify the encoded format independently of the filename or supplied headers. */
export function imageContentType(bytes: Uint8Array): ImageContentType | undefined {
  const prefix = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, IMAGE_SIGNATURE_BYTES));
  if (prefix.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (prefix.subarray(0, 3).equals(JPEG_SIGNATURE)) return "image/jpeg";
  if (prefix.length === 12 && prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (prefix.subarray(0, 6).equals(GIF87_SIGNATURE) || prefix.subarray(0, 6).equals(GIF89_SIGNATURE)) return "image/gif";
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_SIGNATURE = Buffer.from("GIF87a");
const GIF89_SIGNATURE = Buffer.from("GIF89a");
