import { Nav } from "@/components/nav";
import { AgentCreateContent, type AgentCreateFlow } from "@/app/dashboard/agents/agent-create-content";

export const metadata = {
  title: "Create your Agent — The House",
  description: "Meet The House and shape an Influence character. Your first message is free; create an account to keep building and bring them to life.",
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
      <main className="w-full flex-1 px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
          <AgentCreateContent flow={flow} gameId={flow === "join_game" ? query.gameId : undefined} />
      </main>
    </div>
  );
}
