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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-6 sm:py-10">
        <AuthGate>
          <AgentEditContent agentId={id} sourceReviewId={sourceReviewId} />
        </AuthGate>
      </main>
    </div>
  );
}
