"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getAgent,
  getAuthToken,
  updateAgent,
  type CreateAgentParams,
  type SavedAgent,
} from "@/lib/api";
import { AgentForm } from "./agent-form";

interface AgentEditContentProps {
  agentId: string;
}

export function AgentEditContent({ agentId }: AgentEditContentProps) {
  const router = useRouter();
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchAgent = useCallback((showLoading = true) => {
    if (!getAuthToken()) return;
    if (showLoading) {
      setLoading(true);
      setFetchError(null);
    }
    getAgent(agentId)
      .then(setAgent)
      .catch((err) => {
        console.warn("[AgentEditContent] Failed to load agent:", err);
        setFetchError("Failed to load agent. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    const handleSessionReady = () => fetchAgent();

    queueMicrotask(() => fetchAgent(false));
    window.addEventListener("auth:session-ready", handleSessionReady);
    return () => window.removeEventListener("auth:session-ready", handleSessionReady);
  }, [fetchAgent]);

  async function handleUpdate(params: CreateAgentParams) {
    await updateAgent(agentId, params);
    router.replace("/dashboard/agents");
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/dashboard" className="influence-copy-muted hover:text-text-primary text-sm transition-colors">
            Dashboard
          </Link>
          <span className="influence-copy-muted opacity-50">/</span>
          <Link href="/dashboard/agents" className="influence-copy-muted hover:text-text-primary text-sm transition-colors">
            Agents
          </Link>
          <span className="influence-copy-muted opacity-50">/</span>
          <h1 className="text-2xl font-bold text-text-primary">Edit Agent</h1>
        </div>
        <p className="influence-copy text-sm">
          Update this saved competitor&apos;s profile and avatar.
        </p>
      </div>

      {loading ? (
        <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
          Loading...
        </div>
      ) : fetchError ? (
        <div className="rounded-xl p-8 text-center border border-red-400/30 bg-red-400/10">
          <p className="text-red-400 text-sm">{fetchError}</p>
          <button
            onClick={() => fetchAgent()}
            className="mt-3 text-xs influence-copy hover:text-text-primary underline transition-colors"
          >
            Retry
          </button>
        </div>
      ) : agent ? (
        <div className="influence-panel rounded-xl p-6">
          <AgentForm
            initial={agent}
            onSubmit={handleUpdate}
            onCancel={() => router.replace("/dashboard/agents")}
            submitLabel="Save Changes"
          />
        </div>
      ) : (
        <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
          Agent not found.
        </div>
      )}
    </div>
  );
}
