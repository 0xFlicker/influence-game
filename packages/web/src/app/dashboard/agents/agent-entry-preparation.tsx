"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  clearAgentEntryIntent,
  getAgent,
  getGame,
  joinFreeQueue,
  joinGame,
  listAgents,
  updateAgent,
  type AgentProfileWriteParams,
  type SavedAgent,
} from "@/lib/api";
import { OwnedCharacterImage } from "@/components/owned-character-image";
import { getGameEntry } from "@/lib/game-entry";
import { gameDisplayName, gameHref } from "@/lib/game-identity";
import { getWerewolfLobby, joinWerewolfLobby } from "@/lib/werewolf-api";
import {
  agentEditForEntryHref,
  agentEntryIntentKey,
  hasFullBodyAgentArt,
  type AgentEntryIntent,
} from "@/lib/agent-entry";
import { AgentIssueNotice, useAgentIssue } from "./agent-issue";
import { AgentForm } from "./agent-form";
import { AgentOperationActivity } from "./agent-operation-activity";
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

type EntryLobby = Awaited<ReturnType<typeof readLobby>>;

async function readLobby(gameId: string, agentId: string) {
  const identity = await getGameEntry(gameId);
  const game = identity.gameKind === "werewolf"
    ? await getWerewolfLobby(identity.id)
    : await getGame(identity.id);
  const profileHref = `/agents/${encodeURIComponent(agentId)}`;
  const alreadySeated = game.players.some(player =>
    "agentProfileId" in player ? player.agentProfileId === agentId
      : player.currentAgent?.profileHref === profileHref,
  );
  const closed = game.status !== "waiting" || ("castLocked" in game && game.castLocked);
  return {
    ...identity,
    name: gameDisplayName(game),
    status: game.status,
    closed,
    full: game.players.length >= game.playerCount,
    alreadySeated,
  };
}

function entryMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500)
    return cause.message;
  return "We couldn’t confirm entry. Check the result again using the same agent and destination.";
}

export function AgentEntryPreparation({
  agentId,
  intent,
}: {
  agentId: string;
  intent: AgentEntryIntent;
}) {
  const router = useRouter();
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [lobby, setLobby] = useState<EntryLobby | null>(null);
  const [missingLobby, setMissingLobby] = useState(false);
  const [loadError, setLoadError] = useAgentIssue("load");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [submittedHere, setSubmittedHere] = useState(false);
  const joining = useRef(false);
  const tried = useRef(false);
  const cancelling = useRef(false);
  const intentKey = agentEntryIntentKey(agentId, intent);
  const gameId = intent.flow === "join_game" ? intent.gameId : null;
  const seasonId = intent.flow === "daily_free" ? intent.seasonId : null;
  const season = intent.flow === "daily_free" ? intent.season : null;
  const destination = missingLobby ? "/games" : gameId
    ? gameHref(lobby ?? { slug: gameId })
    : intent.flow === "daily_free"
      ? season ? `/seasons?season=${encodeURIComponent(season)}` : "/seasons"
      : "/dashboard/agents";
  const validTarget = intent.flow !== "daily_free" || Boolean(seasonId);
  const reviewState = agent?.receipt?.publication ?? agent?.ownerContent?.reviewState;
  const reviewing = reviewState === "reviewing";
  const held = reviewState === "held";
  const archived = agent?.ownerContent?.availability === "archived";
  const hasArtwork = Boolean(agent && hasFullBodyAgentArt(agent));
  const accepted = Boolean(agent && (agent.contentRevisionId || !agent.latestContentRevisionId));
  const savedIntent = agent?.ownerContent?.entryIntent;
  const requested = submittedHere || (savedIntent && agentEntryIntentKey(agentId, savedIntent) === intentKey);
  const ready = Boolean(accepted && hasArtwork && validTarget && (!gameId || lobby) && !archived && !reviewing && !held && !cancelled);

  const load = useCallback(async () => {
    const [profile, game] = await Promise.allSettled([
      getAgent(agentId),
      gameId ? readLobby(gameId, agentId) : null,
    ]);
    if (profile.status === "rejected") {
      setLoadError(profile.reason);
      return;
    }
    setAgent(profile.value);
    if (game.status === "rejected") {
      const missing = game.reason instanceof ApiError && game.reason.status === 404;
      setMissingLobby(missing);
      setLoadError(missing ? null : game.reason, "entry_load_failed");
      return;
    }
    setLobby(game.value);
    setMissingLobby(false);
    setLoadError(null);
  }, [agentId, gameId, setLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!reviewing || cancelled) return;
    let active = true;
    let reading = false;
    async function checkReview() {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const profile = await getAgent(agentId);
        if (active) {
          setAgent(profile);
          setLoadError(null);
        }
      } catch (cause) {
        if (active) setLoadError(cause);
      } finally {
        reading = false;
      }
    }
    const timer = window.setInterval(() => void checkReview(), 2500);
    window.addEventListener("focus", checkReview);
    document.addEventListener("visibilitychange", checkReview);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkReview);
      document.removeEventListener("visibilitychange", checkReview);
    };
  }, [agentId, cancelled, reviewing, setLoadError]);

  const enter = useCallback(async () => {
    if (!ready || joining.current || cancelling.current || intent.flow === "update") return;
    joining.current = true;
    tried.current = true;
    setActivity(new Date().toISOString());
    setEntryError(null);
    try {
      let nextPath = destination;
      try {
        if (intent.flow === "join_game") {
          if (!lobby) throw new Error("Lobby details are unavailable.");
          if (!lobby.alreadySeated) {
            if (lobby.gameKind === "werewolf") await joinWerewolfLobby(lobby.id, agentId);
            else await joinGame(lobby.id, { agentProfileId: agentId });
          }
        } else {
          await joinFreeQueue(agentId, intent.seasonId);
          window.dispatchEvent(new Event("free-queue:changed"));
        }
      } catch (cause) {
        const current = gameId ? await readLobby(gameId, agentId).catch(error => {
          if (error instanceof ApiError && error.status === 404) {
            setLobby(null);
            setMissingLobby(true);
          } else console.warn("[agent entry] Could not refresh the lobby after a join error", error);
          return null;
        }) : null;
        if (current) setLobby(current);
        if (!current?.alreadySeated) {
          setEntryError(entryMessage(cause));
          return;
        }
        nextPath = gameHref(current);
      }

      // A confirmed admission remains successful if continuation cleanup fails.
      try {
        await clearAgentEntryIntent(agentId, intent);
      } catch (cause) {
        console.warn("[agent entry] Could not clear a completed entry", cause);
      }
      router.replace(nextPath);
    } finally {
      joining.current = false;
      setActivity(null);
    }
  }, [agentId, destination, gameId, intent, lobby, ready, router]);

  useEffect(() => {
    // A URL can be opened without an explicit entry action.
    if (ready && requested && !tried.current) void enter();
  }, [enter, ready, requested]);

  async function saveArtwork(params: AgentProfileWriteParams) {
    if (!agent) throw new Error("The agent is no longer loaded.");
    const saved = await updateAgent(agentId, {
      ...params,
      ...(intent.flow !== "update" ? { entryIntent: intent } : {}),
      ...(agent.profileRevisionId ? { expectedRevisionId: agent.profileRevisionId } : {}),
    });
    setSubmittedHere(intent.flow !== "update");
    setAgent(saved);
    return saved;
  }

  async function cancelPendingEntry() {
    if (intent.flow === "update" || cancelling.current) return;
    cancelling.current = true;
    setEntryError(null);
    try {
      await clearAgentEntryIntent(agentId, intent);
      setCancelled(true);
    } catch (cause) {
      setEntryError(entryMessage(cause));
    } finally {
      cancelling.current = false;
    }
  }

  const lobbyUnavailable = lobby && !lobby.alreadySeated && (lobby.closed || lobby.full);
  const watching = lobby?.status === "in_progress" || lobby?.status === "completed";
  const activityStage = gameId ? "join_game" : "join_queue";
  const target = lobby ? `${lobby.gameKind === "werewolf" ? "Werewolf" : "Influence"} · ${lobby.name}`
    : season ? `Daily Free · ${season.replaceAll("-", " ")}`
      : intent.flow === "update" ? "Agent artwork" : "Daily Free";
  const showArtwork = agent && !hasArtwork && !reviewing && !held && !archived && validTarget && (!gameId || lobby) && !lobbyUnavailable && !cancelled;

  if (showArtwork) {
    return <AgentForm
      key={agentId}
      initial={agent}
      draftScope={`edit:${agentId}`}
      entryArtwork={{ target, destination: gameId ? "lobby" : intent.flow === "daily_free" ? "season" : "agents" }}
      submitLabel={gameId ? "Save image & join" : intent.flow === "update" ? "Save image" : "Save image & enter"}
      onSubmit={saveArtwork}
      onCancel={() => router.replace(destination)}
    />;
  }

  return (
    <section className={`${styles.workspace} ${styles.entryResult}`} aria-labelledby="prepare-agent-title">
      <nav className={styles.entryBack} aria-label="Entry navigation">
        <Link href={destination}>← {missingLobby ? "Back to games" : gameId ? "Back to lobby" : intent.flow === "daily_free" ? "Back to season" : "Back to agents"}</Link>
      </nav>
      <div className={styles.entryCopy}>
        <p className={styles.entryTarget}>{target}</p>
        <h1 id="prepare-agent-title">
          {cancelled ? "Pending entry canceled"
            : activity ? gameId ? `Joining with ${agent?.name ?? "your agent"}` : "Entering Daily Free"
              : missingLobby ? "This game is no longer available"
              : lobbyUnavailable ? lobby.closed ? "This game is no longer accepting players" : "The lobby is full"
                : reviewing ? "Waiting for approval"
                  : held ? "Your agent needs attention"
                    : archived ? "Agent unavailable"
                      : agent ? agent.name : "Getting your agent ready"}
        </h1>
        {!agent && !loadError && <p role="status"><AgentOperationActivity indicator stage="entry_check" startedAt={null} /></p>}
        {activity && <p role="status"><AgentOperationActivity indicator stage={activityStage} startedAt={activity} /></p>}
        {loadError && <AgentIssueNotice issue={loadError} onAction={() => void load()} />}
        {entryError && !missingLobby && !lobbyUnavailable && <p role="alert">{entryError}</p>}
        {missingLobby && <>
          <p>{agent?.name} is saved and can join another game.</p>
          <Link className={styles.entryAction} href="/games">Browse games</Link>
        </>}
        {lobbyUnavailable && (
          <>
            <p role="status">{agent?.name ?? "Your agent"} is saved. {lobby.closed ? "You can open the game to see its current status." : "All seats are taken."}</p>
            <Link className={styles.entryAction} href={destination}>{watching ? "Watch game" : "View lobby"}</Link>
          </>
        )}
        {!missingLobby && !lobbyUnavailable && reviewing && !cancelled && (
          <>
            <p role="status"><AgentOperationActivity indicator stage="entry_review" startedAt={null} /></p>
            <p>{intent.flow === "update" ? "Your artwork was submitted." : gameId
              ? "After approval, this page will try to join the lobby if a seat is still available."
              : "After approval, this page will try to enter Daily Free."}</p>
            {requested && <button type="button" onClick={() => void cancelPendingEntry()}>Cancel pending entry</button>}
          </>
        )}
        {!lobbyUnavailable && held && <p>{agent?.ownerContent?.reviewMessage ?? "Review the submission and make the requested changes to continue."}</p>}
        {!lobbyUnavailable && held && <Link className={styles.entryAction} href={agentEditForEntryHref(agentId, intent)}>Revise agent</Link>}
        {!validTarget && <p role="alert">Choose a season before entering. <Link href="/seasons">Choose season</Link></p>}
        {cancelled && <p>Your agent is still saved.</p>}
        {ready && !activity && !lobbyUnavailable && intent.flow !== "update" && (!requested || entryError) && (
          <button type="button" className={styles.primary} onClick={() => void enter()}>
            {entryError ? "Check entry again" : gameId ? `Join with ${agent?.name}` : `Enter with ${agent?.name}`}
          </button>
        )}
        {ready && intent.flow === "update" && <p>Full-body artwork is saved.</p>}
      </div>
    </section>
  );
}
