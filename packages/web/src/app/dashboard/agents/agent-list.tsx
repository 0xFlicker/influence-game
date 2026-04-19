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
    return <span className="influence-copy-muted text-xs">No games yet</span>;
  }
  const losses = agent.gamesPlayed - agent.gamesWon;
  const rate = Math.round((agent.gamesWon / agent.gamesPlayed) * 100);
  return (
    <span className="text-xs influence-copy">
      {agent.gamesWon}W / {losses}L
      <span className="influence-copy-muted ml-1">({rate}%)</span>
    </span>
  );
}

export function AgentList({ agents, onEdit, onDelete }: AgentListProps) {
  if (agents.length === 0) {
    return (
      <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
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
            className="influence-panel rounded-xl p-4 transition-colors"
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
                    <h3 className="text-text-primary font-medium text-sm truncate">{agent.name}</h3>
                    {persona && (
                      <span className="influence-copy-muted text-xs shrink-0">{persona.name}</span>
                    )}
                  </div>
                  <p className="influence-copy text-xs mt-0.5 line-clamp-1">{agent.backstory}</p>
                  <div className="mt-1.5">
                    <WinRate agent={agent} />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => onEdit(agent)}
                  className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(agent)}
                  className="influence-button-danger text-xs px-3 py-1.5 rounded-lg"
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
