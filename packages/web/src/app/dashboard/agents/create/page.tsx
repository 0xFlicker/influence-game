import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentCreateContent, type AgentCreateFlow } from "../agent-create-content";

export const metadata = {
  title: "Create Agent — Influence",
};

function createFlow(value: string | undefined): AgentCreateFlow {
  return value === "join_game" || value === "daily_free" ? value : "manage";
}

export default async function AgentCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string; gameId?: string }>;
}) {
  const query = await searchParams;
  const flow = createFlow(query.flow);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-6 sm:py-10">
        <AuthGate>
          <AgentCreateContent flow={flow} gameId={flow === "join_game" ? query.gameId : undefined} />
        </AuthGate>
      </main>
    </div>
  );
}
