"use client";

import { useState } from "react";
import type { GameSummary, JoinGameConfig, PersonaKey } from "@/lib/api";

// ---------------------------------------------------------------------------
// Persona options
// ---------------------------------------------------------------------------

const PERSONAS: { key: PersonaKey; name: string; icon: string; description: string }[] = [
  { key: "strategic", name: "Atlas", icon: "♟️", description: "Long-game thinker. Forms lasting alliances, plays the board." },
  { key: "deceptive", name: "Vera", icon: "🎭", description: "Master of misdirection. Hard to read, harder to trust." },
  { key: "honest", name: "Finn", icon: "🤝", description: "Plays with integrity. Builds real trust — risky but respected." },
  { key: "paranoid", name: "Lyra", icon: "👁️", description: "Suspects everyone. Sees angles others miss." },
  { key: "social", name: "Mira", icon: "💬", description: "Reads the room. Moves through social dynamics naturally." },
  { key: "aggressive", name: "Rex", icon: "⚡", description: "Pushes hard. Forces decisions before others are ready." },
  { key: "loyalist", name: "Kael", icon: "🛡️", description: "Commits fully to alliances. Rewarded or punished for it." },
  { key: "observer", name: "Echo", icon: "🔍", description: "Watches and waits. Minimal footprint, maximum intel." },
  { key: "diplomat", name: "Sage", icon: "⚖️", description: "Mediates conflicts. Stays central by staying neutral." },
  { key: "wildcard", name: "Jace", icon: "🎲", description: "Unpredictable. Chaos as strategy." },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface JoinGameModalProps {
  game: GameSummary;
  onClose: () => void;
  onSuccess: (gameId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JoinGameModal({ game, onClose, onSuccess }: JoinGameModalProps) {
  const [agentName, setAgentName] = useState("");
  const [personality, setPersonality] = useState("");
  const [strategyHints, setStrategyHints] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<PersonaKey>("strategic");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      // API not yet available — placeholder until INF-42 ships
      // await joinGame(game.id, config);
      const config: JoinGameConfig = {
        agentName: agentName.trim(),
        personality: personality.trim(),
        strategyHints: strategyHints.trim() || undefined,
        personaKey: selectedPersona,
      };
      console.log("Join game config (API pending):", config);
      await new Promise((r) => setTimeout(r, 600)); // simulate async
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

          <form onSubmit={handleSubmit} className="space-y-5">
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
        </div>
      </div>
    </div>
  );
}
