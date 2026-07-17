import type { PublicPlayerIdentityRef } from "./api";

export function playerProfileHref(identity: PublicPlayerIdentityRef): string {
  return `/profile/${encodeURIComponent(identity.handle ?? identity.publicId)}`;
}
