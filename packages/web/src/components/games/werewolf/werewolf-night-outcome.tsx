"use client";
import {useState} from "react";
import type {WerewolfWatchCue} from "./werewolf-watch-model";
import {nightClawFrame} from "./werewolf-night-motion";

/** The accent is part of the recorded death outcome, never a standalone flash frame. */
export function WerewolfNightOutcome({cue, elapsed, reduced}: {cue: WerewolfWatchCue; elapsed: number; reduced: boolean}) {
  const entry = cue.moment.entry;
  if (entry.kind !== "night" || !entry.killedId) throw new Error("Night elimination requires a recorded victim");
  const victim = cue.moment.snapshot.players.find(player => player.id === entry.killedId)!;
  const source = victim.fullBodyReferenceUrl ?? victim.avatarUrl;
  const [failed, setFailed] = useState<string | null>(null);
  const frame = nightClawFrame(elapsed, reduced);
  return <section data-night-elimination className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-[#100f16] p-6 text-center text-white">
    <div className="relative min-h-0 w-full max-w-sm flex-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- original victim art, available in the public dawn outcome */}
      {source && failed !== source && <img src={source} alt={victim.name} onError={() => setFailed(source)} className="h-full w-full object-contain" style={{filter: frame.settled ? "grayscale(1) brightness(.55)" : "none"}} />}
      <svg aria-hidden="true" data-night-claw className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 400" style={{opacity: frame.opacity}}>
        {frame.strokes.map((progress, index) => <g key={index} transform={`translate(${index * 45 - 45} 0)`}>
          <path d="M 225 105 Q 165 205 80 295" fill="none" stroke="#ad2838" strokeWidth="14" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
          <path d="M 225 105 Q 165 205 80 295" fill="none" stroke="#fff3e9" strokeWidth="4" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
        </g>)}
      </svg>
    </div>
    <div className="shrink-0"><p className="text-xs uppercase tracking-[.2em] text-rose-200/70">At dawn</p><h2 className="mt-2 text-xl font-semibold sm:text-2xl">{victim.name} died during the night.</h2></div>
  </section>;
}
