"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getAuthToken,
  type SavedAgent,
  type CreateAgentParams,
} from "@/lib/api";
import { AgentForm } from "./agent-form";
import { AgentList } from "./agent-list";

type View = "list" | "create" | "edit";

export function AgentsContent() {
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [editTarget, setEditTarget] = useState<SavedAgent | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<SavedAgent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(() => {
    if (!getAuthToken()) return;
    setLoading(true);
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAgents();
    window.addEventListener("auth:session-ready", fetchAgents);
    return () => window.removeEventListener("auth:session-ready", fetchAgents);
  }, [fetchAgents]);

  async function handleCreate(params: CreateAgentParams) {
    await createAgent(params);
    setView("list");
    fetchAgents();
  }

  async function handleUpdate(params: CreateAgentParams) {
    if (!editTarget) return;
    await updateAgent(editTarget.id, params);
    setEditTarget(null);
    setView("list");
    fetchAgents();
  }

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
            <Link
              href="/dashboard"
              className="text-white/30 hover:text-white/60 text-sm transition-colors"
            >
              Dashboard
            </Link>
            <span className="text-white/15">/</span>
            <h1 className="text-2xl font-bold text-white">Agents</h1>
          </div>
          <p className="text-white/40 text-sm">
            Create and manage your saved agents. Use them to quickly join games.
          </p>
        </div>
        {view === "list" && (
          <button
            onClick={() => setView("create")}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
          >
            + New Agent
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-2.5 mb-4">
          {error}
        </p>
      )}

      {/* Create form */}
      {view === "create" && (
        <div className="border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Create Agent</h2>
          <AgentForm
            onSubmit={handleCreate}
            onCancel={() => setView("list")}
            submitLabel="Create Agent"
          />
        </div>
      )}

      {/* Edit form */}
      {view === "edit" && editTarget && (
        <div className="border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Edit Agent</h2>
          <AgentForm
            initial={editTarget}
            onSubmit={handleUpdate}
            onCancel={() => {
              setEditTarget(null);
              setView("list");
            }}
            submitLabel="Save Changes"
          />
        </div>
      )}

      {/* List view */}
      {view === "list" && (
        <>
          {loading ? (
            <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
              Loading...
            </div>
          ) : (
            <AgentList
              agents={agents}
              onEdit={(agent) => {
                setEditTarget(agent);
                setView("edit");
              }}
              onDelete={(agent) => setDeleteConfirm(agent)}
            />
          )}
        </>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDeleteConfirm(null)}
          />
          <div className="relative bg-[#111] border border-white/15 rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="text-white font-semibold mb-2">Delete Agent</h3>
            <p className="text-white/50 text-sm mb-1">
              Are you sure you want to delete <strong className="text-white">{deleteConfirm.name}</strong>?
            </p>
            {deleteConfirm.gamesPlayed > 0 && (
              <p className="text-white/30 text-xs mb-4">
                This agent has played {deleteConfirm.gamesPlayed} game{deleteConfirm.gamesPlayed !== 1 ? "s" : ""}. Game history will be preserved.
              </p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white text-sm py-2.5 rounded-lg font-medium transition-colors"
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
