"use client";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import Link from "next/link";
import type { SavedAgent } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { AgentModelLabel } from "@/components/agent-model-label";
import { withManagementReturn } from "./agent-management-navigation";
import styles from "./agent-workspace.module.css";
export function agentActivity(agent: SavedAgent) {
  if (agent.reviewState === "reviewing") return "Reviewing";
  if (agent.reviewState === "held") return "Held for moderation";
  if (agent.visualActivity?.status === "ready") return "Artwork ready";
  if (agent.visualActivity?.status === "failed") return "Preparation failed";
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
  return "Accepted";
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
}: {
  returnPath?: (id: string) => string;
  agents: SavedAgent[];
  onEdit: (agent: SavedAgent) => void;
  onDelete: (agent: SavedAgent) => void;
}) {
  if (!agents.length) return <p>No agents found.</p>;
  return (
    <div className={styles.gallery}>
      {agents.map((agent) => (
        <article
          id={"agent-" + agent.id}
          data-review-state={agent.reviewState}
          key={agent.id}
          className={styles.card}
        >
          <OwnedCharacterImage
            src={
              agent.transparentBodyUrl ??
              agent.fullBodyReferenceUrl ??
              agent.avatarUrl ??
              "/logo.png"
            }
            alt={agent.name}
          />
          <h3>{agent.name}</h3>
          <p className={styles.status}>{agentActivity(agent)}</p>
          <p
            className={styles.acceptedVersion}
            aria-hidden={
              !agent.contentRevisionId || agent.reviewState === "accepted"
            }
            data-visible={Boolean(
              agent.contentRevisionId && agent.reviewState !== "accepted",
            )}
          >
            Accepted version available
          </p>
          <div className={styles.meta}>
            <p>
              {
                PERSONAS.find((persona) => persona.key === agent.personaKey)
                  ?.name
              }
            </p>
            {!agent.modelPreference || agent.modelPreference === "default" ? (
              <p>House model</p>
            ) : (
              <AgentModelLabel preference={agent.modelPreference} />
            )}
            <p>{agent.voiceId ?? "Automatic voice"}</p>
          </div>
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
              href={withManagementReturn(
                "/dashboard/agents/" + agent.id + "/profile",
                returnPath?.(agent.id) ?? "/dashboard/agents",
              )}
              aria-label={"View " + agent.name}
            >
              View
            </Link>
          </div>
          <details className={styles.hint}>
            <summary>More</summary>
            <Link href={"/dashboard/agents/" + agent.id}>Analyze</Link>
            <button type="button" onClick={() => onDelete(agent)}>
              Archive
            </button>
          </details>
        </article>
      ))}
    </div>
  );
}
