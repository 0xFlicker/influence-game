import { VisualOperations } from "./visual-operations";
export default async function VisualOperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><div className="mx-auto max-w-6xl px-6 py-10"><VisualOperations gameId={id} /></div></>;
}
