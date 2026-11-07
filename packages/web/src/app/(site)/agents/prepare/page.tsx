import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentEntryPreparation, AgentPreparationHome } from "@/app/dashboard/agents/agent-entry-preparation";

export const metadata = { title: "Prepare Agent — The House" };

export default async function PrepareAgentPage({ searchParams }: {
  searchParams: Promise<{ agentId?: string; flow?: string; gameId?: string; seasonId?: string; season?: string }>;
}) {
  const query = await searchParams;
  const intent = query.flow === "join_game" && query.gameId
    ? { flow: "join_game" as const, gameId: query.gameId }
    : query.flow === "daily_free"
      ? { flow: "daily_free" as const, seasonId: query.seasonId, season: query.season }
      : query.flow === "update" ? { flow: "update" as const } : null;
  return <div className="min-h-screen flex flex-col"><Nav /><main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
    <AuthGate>{query.agentId && intent ? <AgentEntryPreparation agentId={query.agentId} intent={intent} /> : <AgentPreparationHome />}</AuthGate>
  </main></div>;
}
