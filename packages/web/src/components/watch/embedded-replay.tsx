"use client";
import dynamic from "next/dynamic";
import {useEffect, useState} from "react";
import {anonymousApiFetch, type GameDetail, type TranscriptEntry, type GameWatchReplayFrame} from "@/lib/api";
import type {PlayerCardGame} from "@/lib/player-card";
import type {WerewolfAudience} from "@influence/engine/werewolf/observation";
import {WatchWaiting} from "./watch-waiting";
const InfluencePlayer = dynamic(() => import("@/app/games/[slug]/components/dramatic-replay-viewer").then(m => m.DramaticReplayViewer), {loading:() => <WatchWaiting label="Loading player…" />});
const WerewolfPlayer = dynamic(() => import("@/components/games/werewolf/werewolf-viewer").then(m => m.WerewolfViewer), {loading:() => <WatchWaiting label="Loading player…" />});
export function EmbeddedReplay({game,audience,onAudienceChange,startCursor,startSequence,contained = false}: {game:Pick<PlayerCardGame,"id"|"slug"|"gameKind"|"status"|"title">;audience:WerewolfAudience;onAudienceChange?:(audience:WerewolfAudience)=>void;startCursor?:number;startSequence?:number;contained?:boolean}) {
  if (game.gameKind === "werewolf") return <WerewolfPlayer slug={game.slug} title={game.title} audience={audience} onAudienceChange={onAudienceChange} startCursor={startCursor} contained={contained} embedded />;
  return <InfluenceReplay contained={contained} key={game.id} slug={game.slug} startSequence={startSequence} />;
}
function InfluenceReplay({slug,startSequence,contained}: {slug:string;startSequence?:number;contained:boolean}) {
  const [data,setData] = useState<{game:GameDetail;messages:TranscriptEntry[];frames:GameWatchReplayFrame[]}>();
  const [error,setError] = useState<string>();
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const options = {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)]),cache:"no-store" as const};
    const path = `/api/games/${encodeURIComponent(slug)}`;
    void Promise.all([
      anonymousApiFetch<GameDetail>(path,options),
      anonymousApiFetch<TranscriptEntry[]>(`${path}/transcript`,options),
      anonymousApiFetch<GameWatchReplayFrame[]>(`${path}/replay-watch-frames`,options),
    ]).then(([game,messages,frames]) => {
      if (controller.signal.aborted) return;
      if (game.status !== "completed") throw new Error("This replay is not available yet.");
      setData({game,messages,frames});
    }).catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load replay.");});
    return () => controller.abort();
  },[slug,attempt]);
  if (error) return <div role="alert" className="p-6">Could not load this replay. <button type="button" onClick={() => {setError(undefined);setAttempt(value => value+1);}}>Try again</button></div>;
  if (!data) return <WatchWaiting label="Loading replay…" />;
  return <div className={`${contained ? "relative h-full" : "fixed inset-0"} overflow-hidden bg-black`} data-watch-mode="embed"><InfluencePlayer game={data.game} messages={data.messages} players={data.game.players} replayFrames={data.frames} startSequence={startSequence} embedded anonymous /></div>;
}
