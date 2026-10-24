import { GameModelSettings } from "@/components/game-model-settings";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameModelSettings key={id} gameId={id} />;
}
