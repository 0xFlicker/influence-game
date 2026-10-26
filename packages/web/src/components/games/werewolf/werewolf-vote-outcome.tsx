"use client";
import {useEffect, useState} from "react";
import type {WerewolfWatchCue} from "./werewolf-watch-model";
import {WEREWOLF_ROOMS} from "./werewolf-rooms";

export function villageEliminationFrame(elapsedMs: number, reduced: boolean) {
  const grayscale = reduced ? 1 : Math.max(0, Math.min(1, (elapsedMs - 250) / 900));
  return {filter: `grayscale(${grayscale}) brightness(${1 - .45 * grayscale})`};
}

/** Only the actual outcome cue owns this treatment, never individual ballot receipts. */
export function WerewolfVoteOutcome({cue, elapsed, reduced, hideCaption = false, onReady}: {
  cue: WerewolfWatchCue; elapsed: number; reduced: boolean; hideCaption?: boolean; onReady?: (ready: boolean) => void;
}) {
  const entry = cue.moment.entry;
  if (entry.kind !== "vote" || !entry.result.eliminatedId || cue.ballot) throw new Error("Vote elimination requires the recorded outcome reveal");
  const victim = cue.moment.snapshot.players.find(player => player.id === entry.result.eliminatedId)!;
  const source = victim.fullBodyReferenceUrl ?? victim.avatarUrl;
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {if (!source) onReady?.(true);}, [source,onReady]);
  return <section data-village-elimination className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-white"
    style={{backgroundImage:`linear-gradient(#0008,#000a),url("${WEREWOLF_ROOMS.vote}")`,backgroundSize:"cover",backgroundPosition:"top"}}>
    <div className="relative min-h-0 w-full max-w-sm flex-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- same immutable character artwork as night elimination */}
      {source && failed !== source && <img src={source} alt={victim.name} onLoad={()=>onReady?.(true)} onError={()=>{setFailed(source);onReady?.(true);}} className="h-full w-full object-contain" style={villageEliminationFrame(elapsed,reduced)} />}
    </div>
    {!hideCaption && <div className="shrink-0"><p className="text-xs uppercase tracking-[.2em] text-rose-200/70">The village has voted</p><h2 className="mt-2 text-xl font-semibold sm:text-2xl">{victim.name} is eliminated.</h2></div>}
  </section>;
}
