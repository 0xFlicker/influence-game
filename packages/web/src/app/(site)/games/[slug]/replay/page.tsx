import { HouseGameRoute } from "@/app/games/[slug]/house-route";
import {getPlayerCardMetadata} from "@/lib/server-player-card";
import type {ReplaySearch} from "@/lib/player-card";
type Props = {params:Promise<{slug:string}>;searchParams:Promise<ReplaySearch>};
export async function generateMetadata({params,searchParams}:Props) { return getPlayerCardMetadata((await params).slug,await searchParams); }
export default async function GameReplayPage({params,searchParams}:Props) {
  const {slug} = await params;
  return <HouseGameRoute slug={slug} mode="replay" {...await searchParams} />;
}
