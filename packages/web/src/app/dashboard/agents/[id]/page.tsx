import { AuthGate } from "@/components/auth-gate";
import { Nav } from "@/components/nav";
import { AgentSeasonAnalysisView } from "./agent-season-analysis";

export const metadata = {
  title: "Agent Analysis — Influence",
};

export default async function AgentAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <AuthGate>
          <AgentSeasonAnalysisView agentId={id} />
        </AuthGate>
      </main>
    </div>
  );
}
