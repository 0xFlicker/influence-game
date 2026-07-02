import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentCreateContent } from "../agent-create-content";

export const metadata = {
  title: "Create Agent — Influence",
};

export default function AgentCreatePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <AuthGate>
          <AgentCreateContent />
        </AuthGate>
      </main>
    </div>
  );
}
