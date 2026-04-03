import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { AgentsContent } from "./agents-content";

export const metadata = {
  title: "Agents — Influence",
};

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialView = params.view === "create" ? "create" : undefined;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <AuthGate>
          <AgentsContent initialView={initialView} />
        </AuthGate>
      </main>
    </div>
  );
}
