"use client";

import {FitPresentation} from "./fit-presentation";
import {useState} from "react";
import {AgentAvatar} from "@/components/agent-avatar";
import type {GamePlayer} from "@/lib/api";

export interface NomineeSelectionBeat {
  kind: "nominee-selection";
  chooser: GamePlayer & {fullBodyReferenceUrl?: string | null};
  nominees: GamePlayer[];
  selectedId: string | null;
}

/** Existing art only. Selection is a recorded decision, never a random animation result. */
export function NomineeSelection({beat, elapsedMs, reducedMotion = false}: {
  beat: NomineeSelectionBeat; elapsedMs: number; reducedMotion?: boolean;
}) {
  const [failedBody, setFailedBody] = useState<string | null>(null);
  const body = beat.chooser.fullBodyReferenceUrl;
  const marked = beat.selectedId !== null && (reducedMotion || elapsedMs >= 650);
  const eliminated = marked && (reducedMotion || elapsedMs >= 1600);
  const exitProgress = reducedMotion ? 1 : Math.max(0, Math.min(1, (elapsedMs - 1000) / 600));
  const selected = beat.nominees.find(player => player.id === beat.selectedId);
  return <section data-nominee-selection className="relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 overflow-hidden bg-[radial-gradient(ellipse_at_top,#29211b,#08090c_75%)] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:grid-rows-1 sm:gap-6 sm:p-6">
    <div className="relative flex min-h-0 flex-col items-center justify-center overflow-hidden">
      {body && body !== failedBody ?
        /* eslint-disable-next-line @next/next/no-img-element -- frozen character art with portrait fallback */
        <img src={body} alt={beat.chooser.name} onError={() => setFailedBody(body)} className="min-h-0 w-full flex-1 object-contain" />
        : <div className="flex min-h-0 items-center justify-center"><AgentAvatar {...beat.chooser} size="32" /></div>}
      <p className="mt-3 text-center text-lg font-semibold text-white">{beat.chooser.name}</p>
      <p className="text-xs uppercase tracking-widest text-amber-200">Empowered · deciding vote</p>
    </div>
    <FitPresentation enabled>
      <header><p className="text-xs uppercase tracking-[.2em] text-amber-200">The nominee pool</p>
        <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">{marked && selected ? `${selected.name} is chosen` : `${beat.chooser.name} chooses who leaves`}</h2>
        <p className="mt-1 text-xs text-white/60">{marked ? "The deciding vote" : "These players qualify under this round’s rules."}</p>
      </header>
      <ul className="mt-3 grid gap-3" style={{gridTemplateColumns: `repeat(${Math.min(3, beat.nominees.length)}, minmax(0, 1fr))`}}>
        {beat.nominees.map(player => {
          const chosen = marked && player.id === beat.selectedId;
          return <li key={player.id} data-nominee={player.id} data-selected={chosen} data-eliminated={chosen && eliminated}
            className={`flex min-w-0 flex-col items-center gap-2 rounded-xl border p-3 ${chosen ? "border-red-400 bg-red-950/60" : "border-white/15 bg-white/5"}`}>
            <div className="relative" style={{opacity: chosen ? 1 - .6 * exitProgress : 1, transform: chosen ? `scale(${1 - .06 * exitProgress})` : "none"}}>
              <AgentAvatar {...player} size="16" />
              {chosen && <span style={{opacity: exitProgress, transform: `scale(${.75 + .25 * exitProgress})`}} aria-label={eliminated ? "Eliminated" : "Selected"} className="absolute inset-0 flex items-center justify-center text-6xl font-light text-red-400">×</span>}
            </div>
            <span className="max-w-full truncate text-center text-sm font-semibold text-white" title={player.name}>{player.name}</span>
            <span className={`text-[10px] uppercase tracking-wider ${chosen ? "text-red-300" : "text-amber-100"}`}>{chosen && eliminated ? "Out" : chosen ? "Chosen" : "Nominee"}</span>
          </li>;
        })}
      </ul>
    </FitPresentation>
  </section>;
}
