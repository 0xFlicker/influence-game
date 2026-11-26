"use client";

import Image from "next/image";
import { useState } from "react";
import { useAgentAvatarUrl } from "@/components/agent-avatar";
import type { PublicAgentProfile } from "@/lib/api";
import styles from "@/components/public-profile.module.css";

type Artwork = Pick<PublicAgentProfile, "name" | "avatarUrl" | "fullBodyImageUrl" | "role">;

export function ProfileArtwork({
  name, avatarUrl, fullBodyImageUrl, role, decorative = false, prioritize = !decorative,
}: Artwork & { decorative?: boolean; prioritize?: boolean }) {
  const [failedBody, setFailedBody] = useState<string | null>(null);
  const [failedPortrait, setFailedPortrait] = useState<string | null>(null);
  const avatar = useAgentAvatarUrl();
  const portrait = avatar(avatarUrl, "", name, role?.key);
  return (
    <div className={styles.artwork}>
      {fullBodyImageUrl && fullBodyImageUrl !== failedBody ? (
        <Image
          key="full-body"
          src={fullBodyImageUrl}
          alt={decorative ? "" : `Full-body portrait of ${name}`}
          fill
          unoptimized
          loading="eager"
          fetchPriority={prioritize ? "high" : "auto"}
          className={styles.bodyImage}
          onError={() => setFailedBody(fullBodyImageUrl)}
        />
      ) : (
        <Image
          key="portrait"
          data-profile-portrait
          src={failedPortrait === portrait ? avatar(null, "", name, role?.key) : portrait}
          alt={decorative ? "" : `Portrait of ${name}`}
          width={512}
          height={512}
          unoptimized
          loading="eager"
          fetchPriority={prioritize ? "high" : "auto"}
          className={styles.portraitImage}
          onError={() => setFailedPortrait(portrait)}
        />
      )}
    </div>
  );
}
