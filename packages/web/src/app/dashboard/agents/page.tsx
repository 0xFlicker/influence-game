import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentsContent } from "./agents-content";

export const metadata = {
  title: "Agents — Influence",
};

export default function AgentsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <AuthGate>
          <AgentsContent />
        </AuthGate>
      </main>
    </div>
  );
}
