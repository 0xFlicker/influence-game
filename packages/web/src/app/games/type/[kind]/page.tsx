import { notFound } from "next/navigation";
import { enabledGameKinds } from "@influence/engine/game-availability";
import { CollectionPage } from "../../collection-page";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: `${kind === "werewolf" ? "Werewolf" : "Influence"} games — The House` };
}

export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if ((kind !== "werewolf" && kind !== "influence") || !enabledGameKinds().includes(kind)) notFound();
  return <CollectionPage collection={{ kind: "game", game: kind }} title={kind === "werewolf" ? "Werewolf games" : "Influence games"} />;
}
