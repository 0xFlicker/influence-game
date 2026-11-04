"use client";
/* eslint-disable @next/next/no-img-element -- Existing account image URLs and local assets. */
import { useState } from "react";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import type { SavedAgent } from "@/lib/api";
import styles from "./seasons.module.css";

export function SeasonAgentPreview({agent}: {agent?: SavedAgent}) {
  const [failed, setFailed] = useState<string[]>([]);
  if (!agent) return <div className={styles.emptyPortrait}><span role="img" aria-label="Choose your first agent">?</span></div>;
  const resolve = (url: string | null | undefined) => resolveAgentAvatarUrl(url, agent.personaKey ?? "", agent.name, agent.personaKey);
  const candidates = [
    ...(agent.transparentBodyUrl ? [{src:resolve(agent.transparentBodyUrl),body:true}] : []),
    ...(agent.avatarUrl ? [{src:resolve(agent.avatarUrl),body:false}] : []),
    {src:resolve(null),body:false},
  ];
  const image = candidates.find(item => !failed.includes(item.src));
  return <div className={styles.agentArt} data-testid="season-agent-preview">
    {image ? <img key={image.src} src={image.src} alt={agent.name} className={image.body ? styles.fullBody : styles.headshot}
      onError={() => setFailed(previous => [...previous, image.src])} />
      : <span role="img" aria-label={`${agent.name}: image unavailable`}>{agent.name.charAt(0)}</span>}
  </div>;
}
