import { AuthGate } from "@/components/auth-gate";
import { Nav } from "@/components/nav";
import { OwnerLearningReviewWorkspace } from "../owner-learning-workspace";

export const metadata = {
  title: "Owner Review — Influence",
};

export default async function OwnerLearningReviewPage({
  params,
}: {
  params: Promise<{ id: string; reviewId: string }>;
}) {
  const { id, reviewId } = await params;
  return (
    <div className="olm-page min-h-screen">
      <Nav />
      <main className="olm-shell">
        <AuthGate><OwnerLearningReviewWorkspace agentId={id} reviewId={reviewId} /></AuthGate>
      </main>
    </div>
  );
}
