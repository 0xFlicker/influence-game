"use client";

import type { SavedAgent } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { AgentAvatar } from "@/components/agent-avatar";

interface AgentListProps {
  agents: SavedAgent[];
  onEdit: (agent: SavedAgent) => void;
  onDelete: (agent: SavedAgent) => void;
}

function getPersonaInfo(key: string | null) {
  if (!key) return undefined;
  return PERSONAS.find((p) => p.key === key);
}

function WinRate({ agent }: { agent: SavedAgent }) {
  if (agent.gamesPlayed === 0) {
    return <span className="text-white/25 text-xs">No games yet</span>;
  }
  const losses = agent.gamesPlayed - agent.gamesWon;
  const rate = Math.round((agent.gamesWon / agent.gamesPlayed) * 100);
  return (
    <span className="text-xs text-white/50">
      {agent.gamesWon}W / {losses}L
      <span className="text-white/25 ml-1">({rate}%)</span>
    </span>
  );
}

export function AgentList({ agents, onEdit, onDelete }: AgentListProps) {
  if (agents.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/30 text-sm">
        No saved agents yet. Create one to get started.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {agents.map((agent) => {
        const persona = getPersonaInfo(agent.personaKey);
        return (
          <div
            key={agent.id}
            className="border border-white/10 rounded-xl p-4 hover:border-white/20 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                {/* Agent avatar with persona badge */}
                <AgentAvatar
                  avatarUrl={agent.avatarUrl}
                  persona={agent.personaKey ?? "strategic"}
                  name={agent.name}
                  size="10"
                />

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-white font-medium text-sm truncate">{agent.name}</h3>
                    {persona && (
                      <span className="text-white/30 text-xs shrink-0">{persona.name}</span>
                    )}
                  </div>
                  <p className="text-white/40 text-xs mt-0.5 line-clamp-1">{agent.backstory}</p>
                  <div className="mt-1.5">
                    <WinRate agent={agent} />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => onEdit(agent)}
                  className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(agent)}
                  className="text-xs text-red-400/60 hover:text-red-400 border border-white/10 hover:border-red-900/40 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
