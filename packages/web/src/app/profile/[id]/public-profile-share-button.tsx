"use client";
import type { PublicPlayerIdentityRef } from "@/lib/api";
import { playerProfileHref } from "@/lib/player-profile-links";
import { HouseShareButton } from "@/components/house-share-button";
import styles from "@/components/public-profile.module.css";

export function PublicProfileShareButton({identity}: {identity: PublicPlayerIdentityRef}) {
  return <HouseShareButton buttonText="Share" className={styles.action} href={playerProfileHref(identity)} label={`Share ${identity.displayName} profile`} title={`${identity.displayName} — The House`} text={`View ${identity.displayName}'s profile in the House.`} />;
}
