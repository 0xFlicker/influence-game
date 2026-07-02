"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAgent, type CreateAgentParams } from "@/lib/api";
import { AgentForm } from "./agent-form";

export function AgentCreateContent() {
  const router = useRouter();

  async function handleCreate(params: CreateAgentParams) {
    await createAgent(params);
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
          <h1 className="text-2xl font-bold text-text-primary">Create Agent</h1>
        </div>
        <p className="influence-copy text-sm">
          Build a saved competitor you can quickly seat in games.
        </p>
      </div>

      <div className="influence-panel rounded-xl p-6">
        <AgentForm
          onSubmit={handleCreate}
          onCancel={() => router.replace("/dashboard/agents")}
          submitLabel="Create Agent"
        />
      </div>
    </div>
  );
}
