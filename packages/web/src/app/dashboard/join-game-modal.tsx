"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken, joinGame, listAgents, type GameSummary, type SavedAgent } from "@/lib/api";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { gameDisplayName } from "@/lib/game-identity";
import { getPersonaLabel } from "@/lib/personas";
import "./join-game-modal.css";

interface JoinGameModalProps {
  game: GameSummary;
  onClose: () => void;
  onSuccess: (gameId: string) => void;
}

export function JoinGameModal({ game, onClose, onSuccess }: JoinGameModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitPending = useRef(false);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createHref = `/agents/create?flow=join_game&gameId=${encodeURIComponent(game.id)}`;
  const selectedAgent = agents.find(agent => agent.id === selectedAgentId);
  const query = search.trim().toLocaleLowerCase();
  const visibleAgents = agents.filter(agent => `${agent.name} ${getPersonaLabel(agent.personaKey)}`.toLocaleLowerCase().includes(query));

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        if (!getAuthToken()) throw new Error("Sign in to choose a saved agent.");
        const next = await listAgents();
        if (!active) return;
        if (next.length === 0) {
          router.push(createHref);
          return;
        }
        setAgents(next);
      } catch (loadError) {
        if (active) setFetchError(loadError instanceof Error ? loadError.message : "Your agents could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [createHref, loadAttempt, router]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function close() {
    if (!submitPending.current) onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAgent || submitPending.current) return;
    submitPending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await joinGame(game.id, { agentProfileId: selectedAgent.id });
      onSuccess(game.id);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join game.");
    } finally {
      submitPending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="agent-selector" aria-labelledby="join-game-title" aria-describedby="join-game-description"
      onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <form onSubmit={handleSubmit} className="agent-selector-form">
        <header className="agent-selector-header">
          <div>
            <p className="agent-selector-eyebrow">Your cast of characters</p>
            <h2 id="join-game-title" className="agent-selector-title">Who will you <em>send in?</em></h2>
            <p id="join-game-description" className="agent-selector-description">Join {gameDisplayName(game)} · {game.playerCount}-player · {game.modelLabel}</p>
          </div>
          <button type="button" onClick={close} disabled={submitting} className="agent-selector-close" aria-label="Close agent selector">×</button>
        </header>

        <div className="agent-selector-toolbar">
          <button type="button" disabled={submitting} onClick={() => router.push(createHref)} className="agent-selector-create"><span aria-hidden="true">＋</span> Create new agent <span aria-hidden="true">↗</span></button>
          {agents.length > 0 && <label className="agent-selector-search"><span className="sr-only">Search your agents</span><input type="search" placeholder="Search name or role…" value={search} disabled={submitting} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></label>}
        </div>

        <div className="agent-selector-body" aria-busy={loading}>
          {loading ? <div className="agent-selector-loading" role="status">Loading your agents…<div aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</div></div>
            : fetchError ? <div className="agent-selector-message" role="alert"><p>We couldn’t load your agents.</p><p>{fetchError}</p><button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Try again ↗</button></div>
              : agents.length === 0 ? <p className="agent-selector-message" role="status">Opening the agent creator…</p>
                : <fieldset disabled={submitting}>
                  <legend className="agent-selector-count">{query ? `${visibleAgents.length} of ${agents.length}` : agents.length} {agents.length === 1 ? "saved agent" : "saved agents"} <span>Choose one for this game</span></legend>
                  {visibleAgents.length === 0 ? <div className="agent-selector-message"><p>No agents match “{search}”.</p><button type="button" onClick={() => setSearch("")}>Clear search ↗</button></div>
                    : <div className="agent-selector-grid">
                      {visibleAgents.map(agent => <label key={agent.id} className="agent-selector-card" data-selected={selectedAgentId === agent.id}>
                        <input type="radio" name="agent" value={agent.id} checked={selectedAgentId === agent.id} aria-label={agent.name} onChange={() => { setSelectedAgentId(agent.id); setError(null); }} />
                        <span className="agent-selector-portrait"><Image src={resolveAgentAvatarUrl(agent.avatarUrl, agent.personaKey ?? "", agent.name, agent.personaKey)} alt="" fill sizes="(max-width: 639px) 42vw, 190px" unoptimized /><span className="agent-selector-check" aria-hidden="true">{selectedAgentId === agent.id ? "✓" : "＋"}</span></span>
                        <span className="agent-selector-card-copy"><span className="agent-selector-role">{getPersonaLabel(agent.personaKey)}</span><strong>{agent.name}</strong><span className="agent-selector-record">{agent.gamesPlayed ? `${agent.gamesWon} ${agent.gamesWon === 1 ? "win" : "wins"} / ${agent.gamesPlayed} ${agent.gamesPlayed === 1 ? "game" : "games"}` : "First appearance"}</span></span>
                      </label>)}
                    </div>}
                </fieldset>}
        </div>

        <footer className="agent-selector-footer">
          {error && <p role="alert" className="agent-selector-error">{error}</p>}
          <div className="agent-selector-submit-row"><p aria-live="polite">{selectedAgent ? <><span>Taking the next seat</span><strong>{selectedAgent.name}</strong></> : "Choose an agent to take the next seat."}</p><button type="submit" className="agent-selector-submit" disabled={loading || !!fetchError || submitting || !selectedAgent}>{submitting ? "Joining…" : "Join game"}<span aria-hidden="true">↗</span></button></div>
        </footer>
      </form>
    </dialog>
  );
}
