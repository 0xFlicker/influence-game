import { notFound } from "next/navigation";
import { parseReplaySequenceParam } from "@/lib/game-links";
import { HouseGameRoute } from "@/app/games/[slug]/house-route";
import {getPlayerCardMetadata} from "@/lib/server-player-card";
import type {ReplaySearch} from "@/lib/player-card";
export async function generateMetadata({params,searchParams}:{params:Promise<{slug:string;sequence:string}>;searchParams:Promise<ReplaySearch>}) {
  const {slug,sequence} = await params;
  return getPlayerCardMetadata(slug,await searchParams,sequence);
}
export default async function GameReplayAtSequencePage({params}: {params:Promise<{slug:string;sequence:string}>}) {
  const {slug,sequence} = await params;
  const startSequence = parseReplaySequenceParam(sequence);
  if (startSequence === undefined) notFound();
  return <HouseGameRoute slug={slug} mode="replay" startSequence={startSequence} />;
}
