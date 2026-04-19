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
import { AgentAvatar } from "@/components/agent-avatar";
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
      <div className="influence-panel-dashed rounded-lg p-3 text-center">
        <p className="influence-copy-muted text-xs mb-1">No saved agents yet</p>
        <button
          type="button"
          onClick={onCreateNew}
          className="influence-link text-xs"
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
              className={`influence-selection-card flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                isSelected ? "text-text-primary" : "influence-copy"
              }`}
              data-selected={isSelected}
            >
              <AgentAvatar
                avatarUrl={agent.avatarUrl}
                persona={agent.personaKey ?? "strategic"}
                name={agent.name}
                size="6"
              />
              <span>{agent.name}</span>
              {agent.gamesPlayed > 0 && (
                <span className="influence-copy-muted">
                  {agent.gamesWon}W/{agent.gamesPlayed - agent.gamesWon}L
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCreateNew}
          className="influence-panel-dashed flex items-center gap-2 px-3 py-2 rounded-lg influence-copy-muted text-xs transition-all"
        >
          <span>+</span>
          <span>New Agent</span>
        </button>
      </div>
      {selectedId && (
        <p className="influence-copy-muted text-xs">
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
        className="influence-overlay absolute inset-0"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="influence-modal relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-text-primary">Join Game #{game.gameNumber}</h2>
              <p className="influence-copy text-sm mt-1">
                {game.playerCount}-player · {game.modelTier.charAt(0).toUpperCase() + game.modelTier.slice(1)} tier
              </p>
            </div>
            <button
              onClick={onClose}
              className="influence-copy-muted hover:text-text-primary transition-colors text-xl leading-none"
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
                  className="influence-copy-muted hover:text-text-primary text-sm transition-colors"
                >
                  ← Back
                </button>
                <h3 className="text-sm font-semibold text-text-primary">Create New Agent</h3>
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
              <label className="influence-section-title block mb-2">
                Select Agent
              </label>
              {agentsFetchError ? (
                <div className="rounded-lg p-3 text-center border border-yellow-400/30 bg-yellow-400/10">
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
                  <label className="influence-section-title block mb-2">
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g. ShadowPlay-7"
                    maxLength={32}
                    className="influence-field w-full rounded-lg px-4 py-2.5 text-sm"
                  />
                  <p className="influence-copy-muted text-xs mt-1">
                    The name your agent uses in the game. Other players will see this.
                  </p>
                </div>

                {/* Persona selection */}
                <div>
                  <label className="influence-section-title block mb-2">
                    Base Persona
                  </label>
                  <div className="grid grid-cols-5 gap-2 mb-2">
                    {PERSONAS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setSelectedPersona(p.key)}
                        className={`influence-selection-card flex flex-col items-center gap-1 p-2 rounded-lg text-xs transition-all ${
                          selectedPersona === p.key ? "text-text-primary" : "influence-copy"
                        }`}
                        data-selected={selectedPersona === p.key}
                      >
                        <span className="text-base">{p.icon}</span>
                        <span className="text-[10px] leading-tight text-center">{p.name}</span>
                      </button>
                    ))}
                  </div>
                  <p className="influence-copy-muted text-xs italic">
                    {selectedPersonaInfo.icon} {selectedPersonaInfo.name}: {selectedPersonaInfo.description}
                  </p>
                </div>

                {/* Personality description */}
                <div>
                  <label className="influence-section-title block mb-2">
                    Personality Description
                  </label>
                  <textarea
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    placeholder="Describe how your agent should behave, speak, and make decisions..."
                    rows={3}
                    maxLength={500}
                    className="influence-field w-full rounded-lg px-4 py-2.5 text-sm resize-none"
                  />
                  <p className="influence-copy-muted text-xs mt-1 text-right">{personality.length}/500</p>
                </div>

                {/* Strategy hints */}
                <div>
                  <label className="influence-section-title block mb-2">
                    Strategy Hints{" "}
                    <span className="influence-copy-muted normal-case font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={strategyHints}
                    onChange={(e) => setStrategyHints(e.target.value)}
                    placeholder="Any specific tactics or priorities for this game..."
                    rows={2}
                    maxLength={300}
                    className="influence-field w-full rounded-lg px-4 py-2.5 text-sm resize-none"
                  />
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <p className="text-red-400 text-sm rounded-lg px-4 py-2.5 border border-red-400/30 bg-red-400/10">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="influence-button-secondary flex-1 text-sm py-2.5 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="influence-button-primary flex-1 text-sm py-2.5 rounded-lg font-medium"
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
