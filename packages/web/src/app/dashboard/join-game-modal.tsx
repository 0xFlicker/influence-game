"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAuthToken,
  joinGame,
  listAgents,
  type GameSummary,
  type SavedAgent,
} from "@/lib/api";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";

interface JoinGameModalProps {
  game: GameSummary;
  onClose: () => void;
  onSuccess: (gameId: string) => void;
}

export function JoinGameModal({ game, onClose, onSuccess }: JoinGameModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentsFetchError, setAgentsFetchError] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAuthToken()) return;
    listAgents()
      .then((next) => {
        setAgents(next);
        setSelectedAgentId(next[0]?.id ?? null);
      })
      .catch((fetchError) => {
        console.warn("[JoinGameModal] Failed to load saved Agents:", fetchError);
        setAgentsFetchError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const focusFrame = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, submitting]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAgentId) {
      setError("Choose a saved Agent or create a new one.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await joinGame(game.id, { agentProfileId: selectedAgentId });
      onSuccess(game.id);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join game.");
      setSubmitting(false);
    }
  }

  function createAgent() {
    router.push(`/dashboard/agents/create?flow=join_game&gameId=${encodeURIComponent(game.id)}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close join game" className="influence-overlay absolute inset-0" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="join-game-title" tabIndex={-1} className="influence-modal relative w-full max-w-lg rounded-2xl p-6 outline-none sm:p-7">
        <header className="flex items-start justify-between gap-5">
          <div>
            <p className="influence-section-title">Choose a competitor</p>
            <h2 id="join-game-title" className="mt-2 text-xl font-semibold tracking-tight text-text-primary">Join {game.slug}</h2>
            <p className="mt-1 text-sm text-white/45">{game.playerCount}-player · {game.modelLabel}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-11 min-w-11 rounded-lg text-xl text-white/40 transition-colors hover:bg-white/5 hover:text-white" aria-label="Close">×</button>
        </header>

        <form onSubmit={handleSubmit} className="mt-6">
          {loading ? (
            <div className="animate-pulse rounded-xl bg-white/5 p-5 text-sm text-white/35">Loading saved Agents…</div>
          ) : agentsFetchError ? (
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100/80">Saved Agents could not be loaded. Close this window and try again.</div>
          ) : agents.length === 0 ? (
            <div className="rounded-xl bg-black/20 p-5 text-center">
              <p className="text-sm text-white/55">Create a saved Agent before joining a game.</p>
              <button type="button" onClick={createAgent} className="influence-button-primary mt-4 min-h-11 rounded-lg px-5 text-sm font-semibold">Create an Agent</button>
            </div>
          ) : (
            <fieldset>
              <legend className="sr-only">Choose a saved Agent</legend>
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {agents.map((agent) => (
                  <button key={agent.id} type="button" role="radio" aria-checked={selectedAgentId === agent.id} data-selected={selectedAgentId === agent.id} onClick={() => { setSelectedAgentId(agent.id); setError(null); }} className="influence-selection-card flex min-h-16 items-center gap-3 rounded-xl p-3 text-left data-[selected=true]:text-text-primary">
                    <AgentAvatarPreview avatarUrl={agent.avatarUrl} personaKey={agent.personaKey} name={agent.name} gamesPlayed={agent.gamesPlayed} gamesWon={agent.gamesWon} size="10" />
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-text-primary">{agent.name}</span><span className="mt-0.5 block text-xs text-white/40">{agent.gamesPlayed ? `${agent.gamesWon}W/${agent.gamesPlayed - agent.gamesWon}L` : "Ready for a first game"}</span></span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={createAgent} className="mt-3 min-h-11 w-full rounded-lg border border-dashed border-white/15 text-sm text-white/50 transition-colors hover:border-white/25 hover:bg-white/5 hover:text-white">+ Create a new Agent</button>
            </fieldset>
          )}

          {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}
          {agents.length > 0 && !agentsFetchError && (
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={onClose} disabled={submitting} className="influence-button-secondary min-h-11 flex-1 rounded-lg text-sm">Cancel</button>
              <button type="submit" disabled={submitting || !selectedAgentId} className="influence-button-primary min-h-11 flex-1 rounded-lg text-sm font-semibold">{submitting ? "Joining…" : "Join game"}</button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
