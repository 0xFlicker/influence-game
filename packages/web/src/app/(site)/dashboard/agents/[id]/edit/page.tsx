import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentEditContent } from "@/app/dashboard/agents/agent-edit-content";
import type { AgentEntryIntent } from "@/lib/agent-entry";

export const metadata = {
  title: "Edit Agent — Influence",
};

export default async function AgentEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string; imageRequest?: string; sourceReviewId?: string; profileRequest?: string; flow?: string; gameId?: string; seasonId?: string; season?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const intent: AgentEntryIntent | undefined = query.flow === "join_game" && query.gameId
    ? { flow: "join_game", gameId: query.gameId }
    : query.flow === "daily_free" ? { flow: "daily_free", seasonId: query.seasonId, season: query.season } : undefined;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="w-full flex-1">
        <AuthGate>
          <AgentEditContent returnTo={query.returnTo} agentId={id} imageRequest={query.imageRequest} sourceReviewId={query.sourceReviewId} profileRequest={query.profileRequest === "1" && !query.sourceReviewId} intent={intent} />
        </AuthGate>
      </main>
    </div>
  );
}
