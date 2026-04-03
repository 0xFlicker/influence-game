"use client";

import { useState, useEffect } from "react";
import {
  joinGame,
  listAgents,
  createAgent,
  getAuthToken,
  type GameSummary,
  type PersonaKey,
  type SavedAgent,
  type CreateAgentParams,
} from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { AgentForm } from "./agents/agent-form";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface JoinGameModalProps {
  game: GameSummary;
  onClose: () => void;
  onSuccess: (gameId: string) => void;
}

// ---------------------------------------------------------------------------
// Agent picker
// ---------------------------------------------------------------------------

function AgentPicker({
  agents,
  selectedId,
  onSelect,
  onClear,
  onCreateNew,
}: {
  agents: SavedAgent[];
  selectedId: string | null;
  onSelect: (agent: SavedAgent) => void;
  onClear: () => void;
  onCreateNew: () => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="border border-dashed border-white/10 rounded-lg p-3 text-center">
        <p className="text-white/30 text-xs mb-1">No saved agents yet</p>
        <button
          type="button"
          onClick={onCreateNew}
          className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
        >
          Create an agent →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => {
          const persona = agent.personaKey
            ? PERSONAS.find((p) => p.key === agent.personaKey)
            : undefined;
          const isSelected = selectedId === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => (isSelected ? onClear() : onSelect(agent))}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
                isSelected
                  ? "border-indigo-500 bg-indigo-600/20 text-white"
                  : "border-white/10 text-white/50 hover:border-white/20 hover:text-white/70"
              }`}
            >
              <span>{persona?.icon ?? "?"}</span>
              <span>{agent.name}</span>
              {agent.gamesPlayed > 0 && (
                <span className="text-white/25">
                  {agent.gamesWon}W/{agent.gamesPlayed - agent.gamesWon}L
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCreateNew}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-white/10 text-white/30 hover:border-white/20 hover:text-white/50 text-xs transition-all"
        >
          <span>+</span>
          <span>New Agent</span>
        </button>
      </div>
      {selectedId && (
        <p className="text-white/25 text-xs">
          Joining with this saved agent. You can deselect to customize instead.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JoinGameModal({ game, onClose, onSuccess }: JoinGameModalProps) {
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [agentsFetchError, setAgentsFetchError] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");
  const [personality, setPersonality] = useState("");
  const [strategyHints, setStrategyHints] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<PersonaKey>("strategic");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);

  useEffect(() => {
    if (!getAuthToken()) return;
    listAgents()
      .then(setAgents)
      .catch((err) => {
        console.warn("[JoinGameModal] Failed to load saved agents:", err);
        setAgentsFetchError(true);
      });
  }, []);

  async function handleCreateAgent(params: CreateAgentParams) {
    const newAgent = await createAgent(params);
    setAgents((prev) => [...prev, newAgent]);
    setCreatingAgent(false);
    handleSelectAgent(newAgent);
  }

  function handleSelectAgent(agent: SavedAgent) {
    setSelectedAgentId(agent.id);
    setAgentName(agent.name);
    setPersonality(agent.personality);
    setStrategyHints(agent.strategyStyle ?? "");
    setSelectedPersona(agent.personaKey ?? "strategic");
    setError(null);
  }

  function handleClearAgent() {
    setSelectedAgentId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // If a saved agent is selected, join with just the profile ID
    if (selectedAgentId) {
      setSubmitting(true);
      setError(null);
      try {
        await joinGame(game.id, { agentProfileId: selectedAgentId });
        onSuccess(game.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to join game.");
        setSubmitting(false);
      }
      return;
    }

    // Otherwise, join with inline config
    if (!agentName.trim()) {
      setError("Agent name is required.");
      return;
    }
    if (!personality.trim()) {
      setError("Personality description is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await joinGame(game.id, {
        agentName: agentName.trim(),
        personality: personality.trim(),
        strategyHints: strategyHints.trim() || undefined,
        personaKey: selectedPersona,
      });
      onSuccess(game.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join game.");
      setSubmitting(false);
    }
  }

  const selectedPersonaInfo = PERSONAS.find((p) => p.key === selectedPersona)!;

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[#111] border border-white/15 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">Join Game #{game.gameNumber}</h2>
              <p className="text-white/40 text-sm mt-1">
                {game.playerCount}-player · {game.modelTier.charAt(0).toUpperCase() + game.modelTier.slice(1)} tier
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white/70 transition-colors text-xl leading-none"
            >
              ×
            </button>
          </div>

          {creatingAgent ? (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setCreatingAgent(false)}
                  className="text-white/30 hover:text-white/60 text-sm transition-colors"
                >
                  ← Back
                </button>
                <h3 className="text-sm font-semibold text-white">Create New Agent</h3>
              </div>
              <AgentForm
                onSubmit={handleCreateAgent}
                onCancel={() => setCreatingAgent(false)}
                submitLabel="Create & Select"
              />
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Saved agent picker */}
            <div>
              <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                Select Agent
              </label>
              {agentsFetchError ? (
                <div className="border border-yellow-900/40 bg-yellow-900/10 rounded-lg p-3 text-center">
                  <p className="text-yellow-400/80 text-xs">
                    Could not load saved agents. You can still join manually below.
                  </p>
                </div>
              ) : (
                <AgentPicker
                  agents={agents}
                  selectedId={selectedAgentId}
                  onSelect={handleSelectAgent}
                  onClear={handleClearAgent}
                  onCreateNew={() => setCreatingAgent(true)}
                />
              )}
            </div>

            {/* Manual config — hidden when a saved agent is selected */}
            {!selectedAgentId && (
              <>
                {/* Agent name */}
                <div>
                  <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g. ShadowPlay-7"
                    maxLength={32}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors"
                  />
                  <p className="text-white/25 text-xs mt-1">
                    The name your agent uses in the game. Other players will see this.
                  </p>
                </div>

                {/* Persona selection */}
                <div>
                  <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                    Base Persona
                  </label>
                  <div className="grid grid-cols-5 gap-2 mb-2">
                    {PERSONAS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setSelectedPersona(p.key)}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-all ${
                          selectedPersona === p.key
                            ? "border-indigo-500 bg-indigo-600/20 text-white"
                            : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                        }`}
                      >
                        <span className="text-base">{p.icon}</span>
                        <span className="text-[10px] leading-tight text-center">{p.name}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-white/30 text-xs italic">
                    {selectedPersonaInfo.icon} {selectedPersonaInfo.name}: {selectedPersonaInfo.description}
                  </p>
                </div>

                {/* Personality description */}
                <div>
                  <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                    Personality Description
                  </label>
                  <textarea
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    placeholder="Describe how your agent should behave, speak, and make decisions..."
                    rows={3}
                    maxLength={500}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors resize-none"
                  />
                  <p className="text-white/25 text-xs mt-1 text-right">{personality.length}/500</p>
                </div>

                {/* Strategy hints */}
                <div>
                  <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                    Strategy Hints{" "}
                    <span className="text-white/25 normal-case font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={strategyHints}
                    onChange={(e) => setStrategyHints(e.target.value)}
                    placeholder="Any specific tactics or priorities for this game..."
                    rows={2}
                    maxLength={300}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors resize-none"
                  />
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <p className="text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-2.5">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-lg font-medium transition-colors"
              >
                {submitting ? "Joining..." : "Join Game"}
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}
