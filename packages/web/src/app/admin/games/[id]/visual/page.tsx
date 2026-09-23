import { AdminGate } from "@/components/admin-gate";
import { Nav } from "@/components/nav";
import { VisualOperations } from "./visual-operations";
export default async function VisualOperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><Nav /><main className="mx-auto max-w-6xl px-6 py-10"><AdminGate><VisualOperations gameId={id} /></AdminGate></main></>;
}
