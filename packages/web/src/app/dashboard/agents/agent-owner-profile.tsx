"use client";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getAgent, type SavedAgent } from "@/lib/api";
import { agentPreparationHref } from "@/lib/agent-entry";
import {
  managementReturnPath,
  withManagementReturn,
} from "./agent-management-navigation";
import { AgentIssueNotice, useAgentIssue } from "./agent-issue";
import styles from "./agent-workspace.module.css";
export function AgentOwnerProfile({
  id,
  returnTo,
}: {
  id: string;
  returnTo?: string;
}) {
  const collectionPath = managementReturnPath(returnTo);
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [error, setError] = useAgentIssue("load");
  useEffect(() => {
    let active = true;
    const read = () =>
      void getAgent(id)
        .then((value) => {
          if (active) setAgent(value);
        })
        .catch((cause) => {
          if (active) setError(cause);
        });
    read();
    const timer = setInterval(read, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, setError]);
  if (error && !agent)
    return (
      <AgentIssueNotice
        issue={error}
        agentId={id}
        onAction={() => window.location.reload()}
      />
    );
  if (!agent) return <p role="status">Loading profile…</p>;
  const content =
    agent.ownerContent?.published ??
    agent.ownerContent?.submitted?.content ??
    agent;
  const state = agent.ownerContent?.reviewState;
  return (
    <section className={styles.workspace}>
      <Link href={collectionPath}>← Agents</Link>
      <header className={styles.heading}>
        <h1>{content.name}</h1>
        <Link
          href={withManagementReturn(
            "/dashboard/agents/" + id + "/edit",
            collectionPath,
          )}
        >
          Edit
        </Link>
      </header>
      {state && state !== "accepted" && (
        <section className={styles.activity} role="status">
          <strong>
            {state === "reviewing" ? "Reviewing" : "Held for moderation"}
          </strong>
          {agent.ownerContent?.reviewMessage && (
            <p>{agent.ownerContent.reviewMessage}</p>
          )}
          <p>
            {agent.contentRevisionId
              ? "Your last accepted version remains public and usable."
              : "Only you can view this submission until it is accepted."}
          </p>
        </section>
      )}
      {state === "accepted" && agent.ownerContent?.entryIntent && (
        <Link
          className="action"
          href={agentPreparationHref(id, agent.ownerContent.entryIntent)}
        >
          Continue
        </Link>
      )}
      <div className={styles.layout}>
        <aside className={styles.art}>
          {(content.fullBodyReferenceUrl || content.avatarUrl) && (
            <OwnedCharacterImage
              src={
                agent.ownerContent?.published
                  ? (agent.transparentBodyUrl ??
                    content.fullBodyReferenceUrl ??
                    content.avatarUrl ??
                    "")
                  : (content.fullBodyReferenceUrl ?? content.avatarUrl ?? "")
              }
              alt={content.name}
            />
          )}
        </aside>
        <section>
          <h2>Personality</h2>
          <p className="whitespace-pre-wrap">{content.personality}</p>
          <h2 className="mt-6">Backstory</h2>
          <p className="whitespace-pre-wrap">{content.backstory}</p>
        </section>
      </div>
    </section>
  );
}
