import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentEditContent } from "@/app/dashboard/agents/agent-edit-content";

export const metadata = {
  title: "Edit Agent — Influence",
};

export default async function AgentEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sourceReviewId?: string; profileRequest?: string }>;
}) {
  const { id } = await params;
  const { sourceReviewId, profileRequest } = await searchParams;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="w-full flex-1 px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        <AuthGate>
          <AgentEditContent agentId={id} sourceReviewId={sourceReviewId} profileRequest={profileRequest === "1" && !sourceReviewId} />
        </AuthGate>
      </main>
    </div>
  );
}
