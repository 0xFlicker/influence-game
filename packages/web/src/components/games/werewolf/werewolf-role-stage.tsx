"use client";
import {useState} from "react";
import type {WerewolfNightAction, WerewolfWatchMoment} from "@influence/engine/werewolf/watch-contract";

type RoleAction = Exclude<WerewolfNightAction, {kind: "hunt"}>;
type Player = WerewolfWatchMoment["snapshot"]["players"][number];

/** Recorded role choices, readable at any seek position without generated art or a second clock. */
export function WerewolfRoleStage({action, players}: {action: RoleAction; players: Player[]}) {
  const actor = players.find(player => player.id === action.actorId);
  const target = players.find(player => player.id === action.targetId);
  if (!actor || !target) throw new Error("Night action references a missing player");
  const doctor = action.kind === "protect", self = actor.id === target.id;
  const title = doctor ? `${actor.name} protects ${self ? "themself" : target.name}` : `${actor.name} investigates ${target.name}`;
  return <section data-night-role={action.kind} className={`flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-4 py-4 sm:py-6 text-center ${doctor ? "bg-[#0b1b19]" : "bg-[#131326]"}`}>
    <div className={doctor ? "shrink-0 text-emerald-200" : "shrink-0 text-indigo-200"}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 size-6">
        {doctor ? <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6L12 3ZM12 8v8m-4-4h8" /> : <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
      </svg>
      <p className="text-xs font-semibold uppercase tracking-[0.18em]">{doctor ? "Doctor’s protection" : "Seer’s investigation"}</p>
    </div>
    <h2 className="max-w-3xl shrink-0 text-balance text-lg font-semibold text-white sm:text-2xl">{title}</h2>
    <div className="flex min-h-0 w-full max-w-2xl flex-1 justify-center gap-4 sm:gap-10">
      <NightPlayer player={actor} label={doctor ? self ? "Doctor · protecting themself" : "Doctor" : "Seer"} />
      {!self && <NightPlayer player={target} label={doctor ? "Protected tonight" : "Investigated tonight"} />}
    </div>
    {action.kind === "investigate" && <p data-investigation-result className={`max-w-xl shrink-0 rounded-xl border px-5 py-3 text-lg font-semibold ${action.isWolf ? "border-red-300/30 bg-red-950/50 text-red-100" : "border-indigo-200/25 bg-indigo-950/50 text-indigo-100"}`}>
      {action.isWolf ? "Werewolf" : "Not a werewolf"}
    </p>}
  </section>;
}

function NightPlayer({player, label}: {player: Player; label: string}) {
  const url = player.fullBodyReferenceUrl ?? player.avatarUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <figure className="flex min-h-0 min-w-0 max-w-64 flex-1 flex-col">
    <div className="relative min-h-12 flex-1 rounded-lg bg-black/20">{url && failedUrl !== url ?
      // eslint-disable-next-line @next/next/no-img-element -- match-frozen original character art
      <img src={url} alt={player.name} onError={() => setFailedUrl(url)} className="absolute inset-0 h-full w-full rounded-lg object-contain" />
      : <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center rounded-lg border border-white/15 bg-white/5 text-4xl text-white/40">{player.name.slice(0, 1)}</div>}</div>
    <figcaption className="mt-3 shrink-0 break-words text-sm font-semibold text-white sm:text-base">{player.name}<span className="mt-1 block text-xs font-normal text-white/60">{label}</span></figcaption>
  </figure>;
}
