import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { DashboardContent } from "./dashboard-content";

export const metadata = {
  title: "Dashboard — Influence",
};

export default function DashboardPage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <AuthGate>
          <DashboardContent />
        </AuthGate>
      </main>
    </div>
  );
}
