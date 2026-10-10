import { notFound } from "next/navigation";
import { parseReplaySequenceParam } from "@/lib/game-links";
import { HouseGameRoute } from "../../house-route";
export const metadata = {title:"Replay moment — The House"};
export default async function GameReplayAtSequencePage({params}: {params:Promise<{slug:string;sequence:string}>}) {
  const {slug,sequence} = await params;
  const startSequence = parseReplaySequenceParam(sequence);
  if (startSequence === undefined) notFound();
  return <HouseGameRoute slug={slug} mode="replay" startSequence={startSequence} />;
}
