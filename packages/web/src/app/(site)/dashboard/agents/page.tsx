import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentsContent } from "@/app/dashboard/agents/agents-content";

export const metadata = {
  title: "Agents — Influence",
};

export default function AgentsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 py-8 w-full">
        <AuthGate>
          <Suspense fallback={<p role="status">Loading agents…</p>}><AgentsContent /></Suspense>
        </AuthGate>
      </main>
    </div>
  );
}
