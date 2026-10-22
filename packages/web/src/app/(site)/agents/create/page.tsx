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
    <div className="min-h-dvh flex flex-col">
      <Nav />
      <main className="flex min-h-0 w-full flex-1 flex-col">
          <AgentCreateContent flow={flow} gameId={flow === "join_game" ? query.gameId : undefined} />
      </main>
    </div>
  );
}
