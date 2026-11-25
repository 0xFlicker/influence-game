"use client";

import Image from "next/image";
import { useState } from "react";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import type { PublicAgentProfile } from "@/lib/api";
import styles from "./public-agent-profile.module.css";

type Artwork = Pick<PublicAgentProfile, "name" | "avatarUrl" | "fullBodyImageUrl" | "role" | "competition">;

export function ProfileArtwork({ name, avatarUrl, fullBodyImageUrl, role, competition }: Artwork) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (fullBodyImageUrl && failedImage !== fullBodyImageUrl) {
    return (
      <div className={styles.stage}>
        <Image
          src={fullBodyImageUrl}
          alt={`Full-body portrait of ${name}`}
          fill
          unoptimized
          loading="eager"
          fetchPriority="high"
          className={styles.bodyImage}
          onError={() => setFailedImage(fullBodyImageUrl)}
        />
      </div>
    );
  }
  return (
    <div className={fullBodyImageUrl ? `${styles.stage} ${styles.portrait} ${styles.stagePortrait}` : styles.portrait}>
      <AgentAvatarPreview
        name={name}
        avatarUrl={avatarUrl}
        personaKey={role?.key}
        size="32"
        gamesPlayed={competition.gamesPlayed}
        gamesWon={competition.wins}
      />
    </div>
  );
}
