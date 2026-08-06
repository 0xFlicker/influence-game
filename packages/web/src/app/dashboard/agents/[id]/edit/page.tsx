import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentEditContent } from "../../agent-edit-content";

export const metadata = {
  title: "Edit Agent — Influence",
};

export default async function AgentEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sourceReviewId?: string }>;
}) {
  const { id } = await params;
  const { sourceReviewId } = await searchParams;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <AuthGate>
          <AgentEditContent agentId={id} sourceReviewId={sourceReviewId} />
        </AuthGate>
      </main>
    </div>
  );
}
