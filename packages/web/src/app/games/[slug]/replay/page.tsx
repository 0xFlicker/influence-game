import { HouseGameRoute } from "../house-route";
export const metadata = { title: "Replay — The House", description: "Watch the game in the House player." };
export default async function GameReplayPage({params,searchParams}: {params:Promise<{slug:string}>;searchParams:Promise<{audience?:string|string[];cursor?:string|string[]}>}) {
  const {slug} = await params;
  return <HouseGameRoute slug={slug} mode="replay" {...await searchParams} />;
}
