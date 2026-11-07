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
  searchParams: Promise<{ flow?: string; gameId?: string; seasonId?: string; season?: string; draft?: string }>;
}) {
  const query = await searchParams;
  const savedScope=query.draft?.match(/^create:(join_game|daily_free):(.+)$/);
  const flow = createFlow(query.flow ?? savedScope?.[1]);
  const targetId=savedScope?.[2]==="none"?undefined:savedScope?.[2];

  return (
    <div className="min-h-dvh flex flex-col">
      <Nav />
      <main className="flex min-h-0 w-full flex-1 flex-col">
          <AgentCreateContent draftScope={query.draft?.startsWith("create:") ? query.draft : undefined} flow={flow} gameId={flow === "join_game" ? query.gameId ?? targetId : undefined} seasonId={flow === "daily_free" ? query.seasonId ?? targetId : undefined} seasonSlug={flow === "daily_free" ? query.season : undefined} />
      </main>
    </div>
  );
}
