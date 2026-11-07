"use client";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import Link from "next/link";
import Image from "next/image";
import { PLAYER_VOICES } from "@influence/engine/voice-catalog";
import type { SavedAgent } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { AgentModelLabel } from "@/components/agent-model-label";
import { withManagementReturn } from "./agent-management-navigation";
import styles from "./agent-workspace.module.css";
export function agentActivity(agent: SavedAgent) {
  if (agent.reviewState === "reviewing") return "Reviewing";
  if (agent.reviewState === "held") return "Held for moderation";
  if (agent.visualActivity?.status === "ready") return "Artwork ready";
  if (agent.visualActivity?.status === "failed") return "Image failed";
  if (agent.visualActivity?.status === "conflict") return "Artwork needs review";
  if (["queued", "processing"].includes(agent.visualActivity?.status ?? ""))
    return (
      (
        {
          background: "Removing background",
          portrait: "Preparing portrait",
          waiting: "Queued",
          image: "Generating image",
        } as Record<string, string>
      )[agent.visualActivity?.stage ?? ""] ?? "Preparing images"
    );
  if (!agent.fullBodyReferenceUrl) return "Full-body image missing";
  return null;
}
export function agentNeedsAttention(agent: SavedAgent) {
  return (
    agent.reviewState === "held" ||
    ["ready", "failed", "conflict"].includes(
      agent.visualActivity?.status ?? "",
    ) ||
    !agent.fullBodyReferenceUrl
  );
}
export function AgentList({
  agents,
  onEdit,
  onDelete,
  returnPath,
  archivePending = false,
}: {
  archivePending?: boolean;
  returnPath?: (id: string) => string;
  agents: SavedAgent[];
  onEdit: (agent: SavedAgent) => void;
  onDelete: (agent: SavedAgent) => void;
}) {
  if (!agents.length) return <p>No agents found.</p>;
  return (
    <div className={styles.gallery}>
      {agents.map((agent) => {
        const persona = PERSONAS.find((option) => option.key === agent.personaKey);
        const voice = PLAYER_VOICES.find((option) => option.id === agent.voiceId);
        const activity = agentActivity(agent);
        const imageWorking = ["queued", "processing"].includes(
          agent.visualActivity?.status ?? "",
        );
        const reviewing = agent.reviewState === "reviewing";
        const held = agent.reviewState === "held";
        const working = reviewing || (!held && imageWorking);
        const failed = !reviewing && !held && agent.visualActivity?.status === "failed";
        const stillUsable = !!agent.contentRevisionId && (reviewing || held);
        const image = agent.transparentBodyUrl ?? agent.fullBodyReferenceUrl ?? agent.avatarUrl;
        return (
          <article
            id={"agent-" + agent.id}
            data-review-state={agent.reviewState}
            key={agent.id}
            className={styles.agentCard}
          >
            <Link
              className={styles.cardProfile}
              data-image-updating={imageWorking || undefined}
              href={withManagementReturn(
                "/dashboard/agents/" + agent.id + "/profile",
                returnPath?.(agent.id) ?? "/dashboard/agents",
              )}
              aria-label={"View " + agent.name}
            >
              <h3 className={styles.cardName}>{agent.name}</h3>
              <div className={styles.cardArtwork}>
                {image ? (
                  <OwnedCharacterImage className={styles.cardImage} src={image} alt={agent.name} />
                ) : (
                  <Image className={styles.cardImage} src="/logo.png" alt="The House" width={512} height={512} unoptimized />
                )}
                {imageWorking && <span className={styles.cardScan} aria-hidden="true" />}
                {activity && (
                  <div className={styles.cardStatus} role="status">
                    <span
                      className={styles.cardBadge}
                      data-tone={failed ? "error" : "activity"}
                    >
                      <span
                        aria-hidden="true"
                        className={working ? styles.cardSpinner : styles.cardStateMark}
                      >
                        {working ? null : agent.visualActivity?.status === "ready" && !held ? "✓" : "!"}
                      </span>
                      <span>{activity}</span>
                    </span>
                    {stillUsable && (
                      <span className={styles.cardBadge} data-tone="muted">Still usable</span>
                    )}
                  </div>
                )}
                <div className={styles.cardBadges} role="group" aria-label="Agent details">
                  <span className={styles.cardBadge}>
                    <span aria-hidden="true" className={styles.cardPersonaIcon}>{persona?.icon ?? "♟"}</span>
                    <span>{persona?.name ?? "Agent"}</span>
                  </span>
                  <span className={styles.cardBadge}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                      <rect x="9" y="9" width="6" height="6" rx="1" />
                      <path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" />
                    </svg>
                    {!agent.modelPreference || agent.modelPreference === "default" ? (
                      <span>House model</span>
                    ) : (
                      <AgentModelLabel preference={agent.modelPreference} className={styles.cardModelName} />
                    )}
                  </span>
                  <span className={styles.cardBadge}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4" />
                    </svg>
                    <span>{voice?.name ?? agent.voiceId ?? "Automatic voice"}</span>
                    {voice && (
                      <span className={styles.cardVoiceGender} aria-label={`${voice.gender === "male" ? "Male" : "Female"} voice`}>
                        {voice.gender === "male" ? "M" : "F"}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </Link>
            <div className={styles.cardActions}>
              <button
                type="button"
                onClick={() => onEdit(agent)}
                aria-label={"Edit " + agent.name}
              >
                Edit
              </button>
              <Link
                className="action"
                href={"/dashboard/agents/" + agent.id}
                aria-label={"Analyze " + agent.name}
              >
                Analyze
              </Link>
              <button
                type="button"
                onClick={() => onDelete(agent)}
                aria-label={"Archive " + agent.name}
                disabled={archivePending}
              >
                Archive
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
