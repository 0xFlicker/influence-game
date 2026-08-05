import { randomUUID } from "node:crypto";

export type AvatarStorageKind = "uploaded" | "generated";

const AVATAR_EXTENSION = /^(?:png|jpe?g|webp)$/;
const OPAQUE_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OPAQUE_AVATAR_KEY = new RegExp(`^pfp/(?:generated/)?${OPAQUE_ID}\\.(?:png|jpe?g|webp)$`, "i");
const LEGACY_UPLOADED_AVATAR_KEY = /^pfp\/(?!generated\/)[^/]+\/[^/]+\.(?:png|jpe?g|webp)$/i;
const LEGACY_GENERATED_AVATAR_KEY = /^pfp\/generated\/[^/]+\/[^/]+\/[^/]+\.(?:png|jpe?g|webp)$/i;

export function createOpaqueAvatarStorageKey(
  kind: AvatarStorageKind,
  extension: string,
): string {
  const normalizedExtension = extension.toLowerCase();
  if (!AVATAR_EXTENSION.test(normalizedExtension)) {
    throw new Error(`Unsupported avatar file extension: ${extension}`);
  }
  const prefix = kind === "generated" ? "pfp/generated" : "pfp";
  return `${prefix}/${randomUUID()}.${normalizedExtension}`;
}

export function isOpaqueAvatarStorageKey(key: string): boolean {
  return OPAQUE_AVATAR_KEY.test(key);
}

export function isLegacyIdentityBearingAvatarStorageKey(key: string): boolean {
  return LEGACY_UPLOADED_AVATAR_KEY.test(key)
    || LEGACY_GENERATED_AVATAR_KEY.test(key);
}

export function opaqueReplacementAvatarStorageKey(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase();
  if (!extension || !AVATAR_EXTENSION.test(extension)) {
    throw new Error(`Cannot preserve avatar extension for key: ${key}`);
  }
  return createOpaqueAvatarStorageKey(
    key.startsWith("pfp/generated/") ? "generated" : "uploaded",
    extension,
  );
}
