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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
        <AuthGate>
          <DashboardContent />
        </AuthGate>
      </main>
    </div>
  );
}
