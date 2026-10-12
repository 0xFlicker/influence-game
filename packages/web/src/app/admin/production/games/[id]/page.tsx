import { Suspense } from "react";
import { ProductionWorkspace } from "../../production-workspace";

export default async function ProductionGamePage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <Suspense fallback={<p role="status">Loading production workspace…</p>}><ProductionWorkspace key={id} gameId={id} /></Suspense>;
}
