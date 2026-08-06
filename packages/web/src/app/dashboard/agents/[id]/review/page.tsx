import { AuthGate } from "@/components/auth-gate";
import { Nav } from "@/components/nav";
import { OwnerLearningEntryWorkspace } from "./owner-learning-workspace";

export const metadata = {
  title: "Agent Review — Influence",
};

export default async function OwnerLearningEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="olm-page min-h-screen">
      <Nav />
      <main className="olm-shell">
        <AuthGate><OwnerLearningEntryWorkspace agentId={id} /></AuthGate>
      </main>
    </div>
  );
}
