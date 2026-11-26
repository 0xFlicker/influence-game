"use client";

import Image from "next/image";
import { useState } from "react";
import { useAgentAvatarUrl } from "@/components/agent-avatar";
import type { PublicAgentProfile } from "@/lib/api";
import styles from "@/components/public-profile.module.css";

type Artwork = Pick<PublicAgentProfile, "name" | "avatarUrl" | "fullBodyImageUrl" | "role">;

export function ProfileArtwork({
  name, avatarUrl, fullBodyImageUrl, role, decorative = false, fetchPriority = decorative ? "auto" : "high", onSettled,
}: Artwork & { decorative?: boolean; fetchPriority?: "high" | "auto" | "low"; onSettled?: (image: HTMLImageElement) => void }) {
  const [failedBody, setFailedBody] = useState<string | null>(null);
  const [failedPortrait, setFailedPortrait] = useState<string | null>(null);
  const avatar = useAgentAvatarUrl();
  const portrait = avatar(avatarUrl, "", name, role?.key);
  const fallback = avatar(null, "", name, role?.key);
  const portraitSource = failedPortrait === portrait ? fallback : portrait;
  return (
    <div className={styles.artwork}>
      {fullBodyImageUrl && fullBodyImageUrl !== failedBody ? (
        <Image
          key={`full-body:${fullBodyImageUrl}`}
          src={fullBodyImageUrl}
          alt={decorative ? "" : `Full-body portrait of ${name}`}
          fill
          unoptimized
          loading="eager"
          fetchPriority={fetchPriority}
          className={styles.bodyImage}
          onLoad={event => onSettled?.(event.currentTarget)}
          onError={() => setFailedBody(fullBodyImageUrl)}
        />
      ) : (
        <Image
          key={`portrait:${portraitSource}`}
          data-profile-portrait
          src={portraitSource}
          alt={decorative ? "" : `Portrait of ${name}`}
          width={512}
          height={512}
          unoptimized
          loading="eager"
          fetchPriority={fetchPriority}
          className={styles.portraitImage}
          onLoad={event => onSettled?.(event.currentTarget)}
          onError={event => {
            if (portraitSource === fallback) onSettled?.(event.currentTarget);
            else setFailedPortrait(portrait);
          }}
        />
      )}
    </div>
  );
}
