"use client";
import {AgentAvatar} from "@/components/agent-avatar";
import {characterImageError} from "@/components/character/image-error";
import {WEREWOLF_ROOMS} from "./werewolf-rooms";
import {useState} from "react";
import type {WerewolfWatchCue} from "./werewolf-watch-model";
import {nightClawFrame} from "./werewolf-night-motion";

/** The accent is part of the recorded death outcome, never a standalone flash frame. */
export function WerewolfNightOutcome({cue, elapsed, reduced, compact = false, hideCaption = false}: {cue: WerewolfWatchCue; elapsed: number; reduced: boolean; compact?:boolean; hideCaption?: boolean}) {
  const entry = cue.moment.entry;
  if (entry.kind !== "night" || (!entry.killedId && !entry.snipeKilledId)) throw new Error("Night elimination requires a recorded victim");
  const victims = [entry.killedId, entry.snipeKilledId].filter((id, index, ids): id is string => Boolean(id) && ids.indexOf(id) === index)
    .map((id) => cue.moment.snapshot.players.find(player => player.id === id)!);
  const frame = nightClawFrame(elapsed, reduced);
  return <section style={{backgroundImage: `linear-gradient(#0008, #000a), url("${WEREWOLF_ROOMS.village}")`, backgroundSize: "cover", backgroundPosition: "top"}} data-night-elimination className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-[#100f16] p-6 text-center text-white">
    <div className={`flex min-h-0 w-full flex-1 justify-center gap-4 ${victims.length > 1 ? "max-w-2xl" : "max-w-sm"}`}>
      {victims.map((victim) => <NightVictim key={victim.id} victim={victim} compact={compact} settled={frame.settled} opacity={frame.opacity} strokes={frame.strokes} />)}
    </div>
    {!hideCaption && <div className="shrink-0"><p className="text-xs uppercase tracking-[.2em] text-rose-200/70">At dawn</p><h2 className="mt-2 text-xl font-semibold sm:text-2xl">{victims.map((victim) => victim.name).join(" and ")} died during the night.</h2></div>}
  </section>;
}

function NightVictim({victim, compact, settled, opacity, strokes}: {victim: {id: string; name: string; personaKey: string | null; avatarUrl: string | null; fullBodyReferenceUrl?: string | null}; compact: boolean; settled: boolean; opacity: number; strokes: readonly number[]}) {
  const source = victim.fullBodyReferenceUrl ?? victim.avatarUrl;
  const [failed, setFailed] = useState<string | null>(null);
  return <div className="relative min-h-0 max-w-sm flex-1">
    {compact && (!source || failed === source) && <div className="flex h-full items-center justify-center"><AgentAvatar name={victim.name} persona="" personaKey={victim.personaKey} avatarUrl={victim.avatarUrl ?? undefined} size="16" /></div>}
    {/* eslint-disable-next-line @next/next/no-img-element -- original victim art, available in the public dawn outcome */}
    {source && failed !== source && <img src={source} alt={victim.name} onError={event => void characterImageError(event, () => setFailed(source))} className="h-full w-full object-contain" style={{filter: settled ? "grayscale(1) brightness(.55)" : "none"}} />}
    <svg aria-hidden="true" data-night-claw className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 400" style={{opacity}}>
      {strokes.map((progress, index) => <g key={index} transform={`translate(${index * 45 - 45} 0)`}>
        <path d="M 225 105 Q 165 205 80 295" fill="none" stroke="#ad2838" strokeWidth="14" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
        <path d="M 225 105 Q 165 205 80 295" fill="none" stroke="#fff3e9" strokeWidth="4" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
      </g>)}
    </svg>
  </div>;
}
