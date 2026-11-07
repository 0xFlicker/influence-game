import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentOwnerProfile } from "@/app/dashboard/agents/agent-owner-profile";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 py-8">
        <AuthGate>
          <AgentOwnerProfile id={id} returnTo={returnTo} />
        </AuthGate>
      </main>
    </div>
  );
}
