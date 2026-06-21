import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function resultHref(result: PlayerGameResult): string {
  return `/games/${result.gameSlug ?? result.gameId}`;
}

function placementText(result: PlayerGameResult): string {
  if (result.winner) return "Winner";
  const suffix = result.placement === 2 ? "nd" : result.placement === 3 ? "rd" : "th";
  return `${result.placement}${suffix} of ${result.totalPlayers}`;
}

export function DashboardRecentResult({ result, loading, error }: DashboardRecentResultProps) {
  return (
    <section className="influence-panel rounded-xl p-5" data-testid="dashboard-recent-result">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="influence-section-title">Recent Result</h2>
          <p className="influence-copy-muted mt-1 text-xs">Latest completed match</p>
        </div>
      </div>

      {loading ? (
        <div className="influence-empty-state rounded-lg p-6 text-center text-sm">Loading result...</div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : result ? (
        <div className="influence-panel-muted rounded-lg p-4">
          <p className="text-lg font-semibold text-text-primary">Game #{result.gameNumber}</p>
          <p className="influence-copy mt-1 text-sm">
            {result.agentName} finished {placementText(result)} after {result.rounds} rounds.
          </p>
          <p className="influence-copy-muted mt-1 text-xs">{capitalize(result.modelTier)} tier</p>
          <Link href={resultHref(result)} className="influence-button-secondary mt-4 inline-flex rounded-lg px-4 py-2 text-xs font-medium">
            Replay
          </Link>
        </div>
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
  return (
    <section className="influence-panel rounded-xl p-5" data-testid="dashboard-agent-bench">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="influence-section-title">Agent Bench</h2>
          <p className="influence-copy-muted mt-1 text-xs">Saved competitors</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/dashboard/agents?view=create" className="influence-link text-xs">
            Create
          </Link>
          <Link href="/dashboard/agents" className="influence-link text-xs">
            Manage
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="influence-empty-state rounded-lg p-6 text-center text-sm">Loading agents...</div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : agents.length === 0 ? (
        <div className="influence-panel-dashed rounded-lg p-6 text-center">
          <p className="influence-copy text-sm">No saved agents yet</p>
          <p className="influence-copy-muted mt-1 text-xs">Create a competitor before joining games.</p>
          <Link href="/dashboard/agents?view=create" className="influence-button-primary mt-4 inline-flex rounded-lg px-4 py-2 text-xs font-medium">
            Create an agent
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div key={agent.id} className="influence-panel-muted flex items-center gap-3 rounded-lg p-3">
              <AgentAvatar
                avatarUrl={agent.avatarUrl}
                persona={agent.personaKey ?? "strategic"}
                name={agent.name}
                size="8"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{agent.name}</p>
                <p className="truncate influence-copy-muted text-xs">
                  {agent.gamesPlayed > 0
                    ? `${agent.gamesWon}W / ${agent.gamesPlayed - agent.gamesWon}L`
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
