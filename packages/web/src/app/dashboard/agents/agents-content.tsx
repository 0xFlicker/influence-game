"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  listAgents,
  deleteAgent,
  getAuthToken,
  type SavedAgent,
} from "@/lib/api";
import { AgentList } from "./agent-list";

export function AgentsContent() {
  const router = useRouter();
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<SavedAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchAgents = useCallback(() => {
    if (!getAuthToken()) return;
    setLoading(true);
    setFetchError(null);
    listAgents()
      .then(setAgents)
      .catch((err) => {
        console.warn("[AgentsContent] Failed to load agents:", err);
        setFetchError("Failed to load agents. Please try again.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    queueMicrotask(fetchAgents);
    window.addEventListener("auth:session-ready", fetchAgents);
    return () => window.removeEventListener("auth:session-ready", fetchAgents);
  }, [fetchAgents]);

  async function handleDelete(agent: SavedAgent) {
    setError(null);
    try {
      await deleteAgent(agent.id);
      setDeleteConfirm(null);
      fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent.");
    }
  }


  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/dashboard" className="influence-copy-muted hover:text-text-primary text-sm transition-colors">
              Dashboard
            </Link>
            <span className="influence-copy-muted opacity-50">/</span>
            <h1 className="text-2xl font-bold text-text-primary">Agents</h1>
          </div>
          <p className="influence-copy text-sm">
            Create and manage your saved agents. Use them to quickly join games.
          </p>
        </div>
        <Link
          href="/dashboard/agents/create"
          className="influence-button-primary text-sm px-4 py-2 rounded-lg font-medium"
        >
          + New Agent
        </Link>
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm rounded-lg px-4 py-2.5 mb-4 border border-red-400/30 bg-red-400/10">
          {error}
        </p>
      )}

      {loading ? (
        <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
          Loading...
        </div>
      ) : fetchError ? (
        <div className="rounded-xl p-8 text-center border border-red-400/30 bg-red-400/10">
          <p className="text-red-400 text-sm">{fetchError}</p>
          <button
            onClick={fetchAgents}
            className="mt-3 text-xs influence-copy hover:text-text-primary underline transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <AgentList
          agents={agents}
          onGenerateAvatar={(agent) => router.push(`/dashboard/agents/${agent.id}/edit`)}
          onEdit={(agent) => router.push(`/dashboard/agents/${agent.id}/edit`)}
          onDelete={(agent) => setDeleteConfirm(agent)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="influence-overlay absolute inset-0"
            onClick={() => setDeleteConfirm(null)}
          />
          <div className="influence-modal relative w-full max-w-sm rounded-2xl p-6">
            <h3 className="text-text-primary font-semibold mb-2">Archive Agent</h3>
            <p className="influence-copy text-sm mb-1">
              Are you sure you want to archive <strong className="text-text-primary">{deleteConfirm.name}</strong>?
            </p>
            <p className="influence-copy-muted text-xs mt-2">An admin can restore this character. Saved revisions and game history are retained.</p>
            {deleteConfirm.gamesPlayed > 0 && (
              <p className="influence-copy-muted text-xs mb-4">
                This agent has played {deleteConfirm.gamesPlayed} game{deleteConfirm.gamesPlayed !== 1 ? "s" : ""}. Game history will be preserved.
              </p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="influence-button-secondary flex-1 text-sm py-2.5 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="influence-button-danger flex-1 text-sm py-2.5 rounded-lg font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
