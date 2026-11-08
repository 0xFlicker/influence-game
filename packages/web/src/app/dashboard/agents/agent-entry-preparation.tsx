"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearAgentEntryIntent,
  getAgent,
  joinFreeQueue,
  joinGame,
  listAgents,
  type SavedAgent,
} from "@/lib/api";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import { getGameEntry } from "@/lib/game-entry";
import { gameHref } from "@/lib/game-links";
import { joinWerewolfLobby } from "@/lib/werewolf-api";
import {
  agentEditForEntryHref,
  agentEntryIntentKey,
  hasFullBodyAgentArt,
  type AgentEntryIntent,
} from "@/lib/agent-entry";
import { AgentIssueNotice, useAgentIssue } from "./agent-issue";
import styles from "./agent-workspace.module.css";

/** Missing artwork opens the same workspace used by creation and ordinary edits. */
export function AgentPreparationHome() {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [error, setError] = useAgentIssue("load");
  useEffect(() => {
    let active = true;
    void listAgents()
      .then((value) => {
        if (active) setAgents(value);
      })
      .catch((cause) => {
        if (active) setError(cause);
      });
    return () => {
      active = false;
    };
  }, [setError]);
  return (
    <section className={styles.collection}>
      <Link href="/dashboard/agents">← Agents</Link>
      <header className={styles.heading}>
        <h1>Choose an agent</h1>
      </header>
      {error && (
        <AgentIssueNotice
          issue={error}
          onAction={() => window.location.reload()}
        />
      )}
      {!agents && !error && <p role="status">Loading agents…</p>}
      {agents?.length === 0 && <Link href="/agents/create">Create</Link>}
      <div className={styles.gallery}>
        {agents?.map((agent) => (
          <article className={styles.card} key={agent.id}>
            {(agent.transparentBodyUrl ||
              agent.fullBodyReferenceUrl ||
              agent.avatarUrl) && (
              <OwnedCharacterImage
                src={
                  agent.transparentBodyUrl ??
                  agent.fullBodyReferenceUrl ??
                  agent.avatarUrl!
                }
                alt={agent.name}
              />
            )}
            <h2>{agent.name}</h2>
            <p className={styles.meta}>
              {hasFullBodyAgentArt(agent)
                ? "Full-body image available"
                : "Full-body image missing"}
            </p>
            <Link
              className="action"
              href={`/dashboard/agents/${encodeURIComponent(agent.id)}/edit`}
            >
              Edit
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AgentEntryPreparation({
  agentId,
  intent,
}: {
  agentId: string;
  intent: AgentEntryIntent;
}) {
  const router = useRouter();
  const [agent, setAgent] = useState<SavedAgent | null>(null),
    [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useAgentIssue("load");
  const [error, setError] = useAgentIssue("entry");
  const joining = useRef(false),
    intentKey = agentEntryIntentKey(agentId, intent);
  const validTarget = intent.flow !== "daily_free" || Boolean(intent.seasonId);
  const destination =
    intent.flow === "join_game"
      ? `/games/${encodeURIComponent(intent.gameId)}`
      : intent.flow === "daily_free"
        ? intent.season
          ? `/seasons?season=${encodeURIComponent(intent.season)}`
          : "/seasons"
        : "/dashboard/agents";
  const accepted = Boolean(
    agent && (agent.contentRevisionId || !agent.latestContentRevisionId),
  );
  const canEnter = Boolean(
    accepted && agent && hasFullBodyAgentArt(agent) && validTarget,
  );
  const enter = useCallback(async () => {
    if (joining.current || !canEnter) return;
    joining.current = true;
    setBusy(true);
    setError(null);
    try {
      if (intent.flow === "join_game") {
        const game = await getGameEntry(intent.gameId);
        if (game.gameKind === "werewolf")
          await joinWerewolfLobby(intent.gameId, agentId);
        else await joinGame(intent.gameId, { agentProfileId: agentId });
        await clearAgentEntryIntent(agentId, intent);
        sessionStorage.removeItem(intentKey);
        router.replace(gameHref(game.slug));
      } else if (intent.flow === "daily_free") {
        await joinFreeQueue(agentId, intent.seasonId);
        await clearAgentEntryIntent(agentId, intent);
        sessionStorage.removeItem(intentKey);
        window.dispatchEvent(new Event("free-queue:changed"));
        router.replace(destination);
      }
    } catch (cause) {
      setError(cause);
    } finally {
      joining.current = false;
      setBusy(false);
    }
  }, [agentId, canEnter, destination, intent, intentKey, router, setError]);
  useEffect(() => {
    const key = intentKey + ":entry-error",
      message = sessionStorage.getItem(key);
    if (message) {
      setError(message);
      sessionStorage.removeItem(key);
    }
  }, [intentKey, setError]);
  useEffect(() => {
    let active = true,
      reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const value = await getAgent(agentId);
        if (active) {
          setAgent(value);
          setLoadError(null);
        }
      } catch (cause) {
        if (active) setLoadError(cause);
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = window.setInterval(() => {
      if (!document.hidden) void read();
    }, 2500);
    window.addEventListener("focus", read);
    window.addEventListener("online", read);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
      window.removeEventListener("online", read);
    };
  }, [agentId, setLoadError]);
  const state = agent?.ownerContent?.reviewState;
  const artwork =
    agent?.transparentBodyUrl ??
    agent?.fullBodyReferenceUrl ??
    agent?.avatarUrl;
  const editHref = validTarget
    ? agentEditForEntryHref(agentId, intent)
    : `/dashboard/agents/${encodeURIComponent(agentId)}/edit`;
  return (
    <section className={styles.workspace} aria-labelledby="prepare-agent-title">
      <Link href={destination}>← Back</Link>
      <header className={styles.heading}>
        <h1 id="prepare-agent-title">{agent?.name ?? "Your agent"}</h1>
      </header>
      <div className={styles.layout}>
        <aside className={styles.art}>
          {artwork && (
            <OwnedCharacterImage
              src={artwork}
              alt={agent?.name ?? "Agent artwork"}
            />
          )}
        </aside>
        <section>
          {!agent && !loadError && <p role="status">Loading agent…</p>}
          {state === "reviewing" && (
            <div className={styles.activity} role="status">
              <h2>Reviewing</h2>
              <p>
                {accepted
                  ? "The last accepted version remains available."
                  : "Entry opens after acceptance."}
              </p>
            </div>
          )}
          {state === "held" && (
            <div className={styles.attention} role="status">
              <h2>Held for moderation</h2>
              <p>
                {agent?.ownerContent?.reviewMessage ??
                  "Open the editor to revise the submission."}
              </p>
            </div>
          )}
          {agent && !hasFullBodyAgentArt(agent) && (
            <p className="mt-5">
              Add a full-body image in the editor, select the artwork, then
              review and save it before entering.
            </p>
          )}
          {!validTarget && !error && !loadError && (
            <p role="alert" className="mt-5">
              Choose a season before entering.{" "}
              <Link href="/seasons">Choose</Link>
            </p>
          )}
          {(error || loadError) && (
            <AgentIssueNotice
              issue={(error ?? loadError)!}
              agentId={agentId}
              onAction={() => {
                if (error) void enter();
                else window.location.reload();
              }}
            />
          )}
          <div className={styles.artActions}>
            <Link className="action" href={editHref}>
              Edit
            </Link>
            {intent.flow !== "update" && (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !canEnter}
                onClick={() => void enter()}
              >
                {busy
                  ? "Joining…"
                  : intent.flow === "join_game"
                    ? "Join"
                    : "Enter"}
              </button>
            )}
            <Link
              className="action"
              href={`/dashboard/agents/${encodeURIComponent(agentId)}/profile`}
            >
              View
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}
