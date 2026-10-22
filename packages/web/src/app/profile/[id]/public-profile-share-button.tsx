"use client";
import type { PublicPlayerIdentityRef } from "@/lib/api";
import { playerProfileHref } from "@/lib/player-profile-links";
import { HouseShareButton } from "@/components/house-share-button";

export function PublicProfileShareButton({identity}: {identity: PublicPlayerIdentityRef}) {
  return <HouseShareButton href={playerProfileHref(identity)} label={`Share ${identity.displayName} profile`} title={`${identity.displayName} — The House`} text={`View ${identity.displayName}'s profile in the House.`} />;
}
