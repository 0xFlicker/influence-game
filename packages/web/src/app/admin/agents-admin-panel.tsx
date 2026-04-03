"use client";

import { useState, useEffect, useCallback } from "react";
import { listAdminAgents, type AdminAgent } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { TruncatedAddress } from "@/components/truncated-address";

function getPersonaInfo(key: string | null) {
  if (!key) return undefined;
  return PERSONAS.find((p) => p.key === key);
}

// ---------------------------------------------------------------------------
// Agent detail modal
// ---------------------------------------------------------------------------

function AgentDetailModal({
  agent,
  onClose,
}: {
  agent: AdminAgent;
  onClose: () => void;
}) {
  const persona = getPersonaInfo(agent.personaKey);
  const winRate =
    agent.gamesPlayed > 0
      ? Math.round((agent.gamesWon / agent.gamesPlayed) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-[#111] border border-white/15 rounded-2xl w-full max-w-lg shadow-2xl p-6 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-12 h-12 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xl shrink-0">
              {persona?.icon ?? "?"}
            </div>
            <div className="min-w-0">
              <h2 className="text-white font-semibold text-lg truncate">
                {agent.name}
              </h2>
              {persona && (
                <span className="text-white/40 text-sm">{persona.name}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white text-xl transition-colors shrink-0"
          >
            &times;
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="text-white font-semibold text-lg">
              {agent.gamesPlayed}
            </div>
            <div className="text-white/40 text-xs">Games</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="text-white font-semibold text-lg">
              {agent.gamesWon}
            </div>
            <div className="text-white/40 text-xs">Wins</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="text-white font-semibold text-lg">
              {agent.gamesPlayed > 0 ? `${winRate}%` : "—"}
            </div>
            <div className="text-white/40 text-xs">Win Rate</div>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-4">
          {agent.backstory && (
            <div>
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">
                Backstory
              </h3>
              <p className="text-white/70 text-sm">{agent.backstory}</p>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">
              Personality
            </h3>
            <p className="text-white/70 text-sm">{agent.personality}</p>
          </div>

          {agent.strategyStyle && (
            <div>
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">
                Strategy
              </h3>
              <p className="text-white/70 text-sm">{agent.strategyStyle}</p>
            </div>
          )}

          {/* Owner info */}
          <div className="border-t border-white/10 pt-4">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
              Owner
            </h3>
            <div className="text-sm space-y-1">
              {agent.ownerDisplayName && (
                <div className="text-white/60">
                  {agent.ownerDisplayName.startsWith("0x") ? (
                    <TruncatedAddress
                      address={agent.ownerDisplayName}
                      maxWidth="16ch"
                    />
                  ) : (
                    agent.ownerDisplayName
                  )}
                </div>
              )}
              {agent.ownerWallet && (
                <div className="text-white/40 font-mono text-xs">
                  <TruncatedAddress
                    address={agent.ownerWallet}
                    maxWidth="16ch"
                  />
                </div>
              )}
              {agent.ownerEmail && (
                <div className="text-white/40 text-xs">{agent.ownerEmail}</div>
              )}
            </div>
          </div>

          {/* Timestamps */}
          <div className="text-xs text-white/25">
            Created:{" "}
            {new Date(agent.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {" | "}Updated:{" "}
            {new Date(agent.updatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent row
// ---------------------------------------------------------------------------

function AgentRow({
  agent,
  onClick,
}: {
  agent: AdminAgent;
  onClick: () => void;
}) {
  const persona = getPersonaInfo(agent.personaKey);
  const winRate =
    agent.gamesPlayed > 0
      ? Math.round((agent.gamesWon / agent.gamesPlayed) * 100)
      : null;

  return (
    <tr
      onClick={onClick}
      className="border-t border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer"
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="text-base">{persona?.icon ?? "?"}</span>
          <span className="text-white text-sm font-medium">{agent.name}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-white/50 text-sm">
        {persona?.name ?? "—"}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm">
        {agent.ownerDisplayName || agent.ownerEmail ? (
          <div className="flex flex-col">
            <span className="text-white/70">{agent.ownerDisplayName ?? agent.ownerEmail}</span>
            {agent.ownerWallet && (
              <span className="text-white/25 text-xs font-mono">
                <TruncatedAddress address={agent.ownerWallet} maxWidth="10ch" />
              </span>
            )}
          </div>
        ) : agent.ownerWallet ? (
          <span className="font-mono">
            <TruncatedAddress address={agent.ownerWallet} maxWidth="10ch" />
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm text-center">
        {agent.gamesPlayed}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm text-center">
        {agent.gamesWon}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm text-center">
        {winRate !== null ? `${winRate}%` : "—"}
      </td>
      <td className="py-3 px-4 text-center">
        <span className="text-white/20 text-xs">—</span>
      </td>
      <td className="py-3 px-4 text-white/40 text-xs">
        {new Date(agent.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AgentsAdminPanel() {
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AdminAgent | null>(null);
  const [search, setSearch] = useState("");

  const fetchAgents = useCallback(async () => {
    setError(null);
    try {
      const all = await listAdminAgents();
      setAgents(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const filtered = search
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          (a.personaKey?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          (a.ownerWallet?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          (a.ownerDisplayName?.toLowerCase().includes(search.toLowerCase()) ?? false),
      )
    : agents;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
            All Agents ({agents.length})
          </h2>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500 w-64"
        />
      </div>

      {error && (
        <div className="mb-6 border border-red-900/40 bg-red-900/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
          {search ? "No agents match your search." : "No agents created yet."}
        </div>
      ) : (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                {["Agent", "Archetype", "Owner", "Games", "Wins", "Win %", "ELO", "Created"].map(
                  (h) => (
                    <th
                      key={h}
                      className={`text-left py-3 px-4 text-xs text-white/30 font-medium ${
                        ["Games", "Wins", "Win %", "ELO"].includes(h) ? "text-center" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  onClick={() => setSelectedAgent(agent)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
