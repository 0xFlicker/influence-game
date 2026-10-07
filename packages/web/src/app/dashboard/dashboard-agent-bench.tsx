import { ParticipationRow } from "@/components/participation-history";
import Link from "next/link";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import type { PlayerGameResult, SavedAgent } from "@/lib/api";

interface DashboardAgentBenchProps {
  agents: SavedAgent[];
  loading: boolean;
  error: string | null;
}

interface DashboardRecentResultProps {
  result: PlayerGameResult | null;
  loading: boolean;
  error: string | null;
}

export function DashboardRecentResult({ result, loading, error }: DashboardRecentResultProps) {
  const showLoading = loading && !result;
  const showError = Boolean(error) && !result;

  return (
    <section className="influence-panel min-w-0 rounded-xl p-5" data-testid="dashboard-recent-result">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="influence-section-title">Recent Result</h2>
          <p className="influence-copy-muted mt-1 text-xs">Latest completed match</p>
        </div>
      </div>

      {showLoading ? (
        <div className="influence-empty-state rounded-lg p-6 text-center text-sm">Loading result...</div>
      ) : showError ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : result ? (
        <ParticipationRow entry={result}/>
      ) : (
        <div className="influence-empty-state rounded-lg p-6 text-center text-sm">
          No completed games yet.
          <div className="mt-2">
            <Link href="/games" className="influence-link text-xs">
              Browse games -&gt;
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

export function DashboardAgentBench({ agents, loading, error }: DashboardAgentBenchProps) {
  const hasAgents = agents.length > 0;
  const showLoading = loading && !hasAgents;
  const showError = Boolean(error) && !hasAgents;

  return (
    <section className="influence-panel min-w-0 rounded-xl p-5" data-testid="dashboard-agent-bench">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="influence-section-title">Agent Bench</h2>
          <p className="influence-copy-muted mt-1 text-xs">Saved competitors</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/agents/create" className="influence-link text-xs">
            Create
          </Link>
          <Link href="/dashboard/agents" className="influence-link text-xs">
            Manage
          </Link>
        </div>
      </div>

      {showLoading ? (
        <div className="influence-empty-state rounded-lg p-6 text-center text-sm">Loading agents...</div>
      ) : showError ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : !hasAgents ? (
        <div className="influence-panel-dashed rounded-lg p-6 text-center">
          <p className="influence-copy text-sm">No saved agents yet</p>
          <p className="influence-copy-muted mt-1 text-xs">Create a competitor before joining games.</p>
          <Link href="/agents/create" className="influence-button-primary mt-4 inline-flex rounded-lg px-4 py-2 text-xs font-medium">
            Create an agent
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div key={agent.id} className="influence-panel-muted flex items-center gap-3 rounded-lg p-3">
              <AgentAvatarPreview
                avatarUrl={agent.avatarUrl}
                personaKey={agent.personaKey}
                name={agent.name}
                gamesPlayed={agent.gamesPlayed}
                gamesWon={agent.gamesWon}
                size="8"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{agent.name}</p>
                <p className="truncate influence-copy-muted text-xs">
                  {agent.gamesPlayed > 0
                    ? `Influence · ${agent.gamesWon}W / ${agent.gamesPlayed - agent.gamesWon}L`
                    : agent.backstory ?? "Ready for a first game"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
