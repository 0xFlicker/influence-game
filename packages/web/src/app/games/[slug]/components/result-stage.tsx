"use client";

import type {ReactNode} from "react";
import {AgentAvatar} from "@/components/agent-avatar";
import type {FormatPresentationCue, FormatPresentationRosterPlayer} from "./types";
import {RoomBackdrop} from "./stage-backdrop";
import {INFLUENCE_ROOMS} from "./influence-rooms";

export function ResultStage({children, players = [], background = INFLUENCE_ROOMS.council, label, packed = false, compactCast = false}: {
  children: ReactNode; players?: readonly FormatPresentationRosterPlayer[]; background?: string; label?:string; packed?:boolean; compactCast?:boolean;
}) {
  return <section aria-label={label} data-result-stage className={`relative isolate flex min-h-0 w-full flex-1 flex-col justify-start overflow-auto rounded-2xl ${packed ? "p-1" : compactCast ? "gap-2 p-2" : "gap-3 p-4 sm:p-6"}`}>
    <RoomBackdrop source={background} resilient />
    {players.length > 0 && <div className={compactCast ? "relative grid min-h-0 gap-1" : "relative flex shrink-0 flex-wrap justify-center gap-4"} style={compactCast ? {gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,80px),1fr))"} : undefined} aria-label="Result players">
      {players.map(player => <div key={player.id} className={compactCast ? "flex min-w-0 items-center gap-1 rounded-lg bg-black/60 p-1" : "flex items-center gap-2 rounded-xl bg-black/60 px-3 py-2"}>
        <AgentAvatar name={player.name} persona={player.persona ?? ""} personaKey={player.personaKey} avatarUrl={player.avatarUrl} size={compactCast ? "6" : "10"} />
        <span title={player.name} className={compactCast ? "truncate text-xs text-white" : "text-sm text-white"}>{player.name}</span>
      </div>)}
    </div>}
    <div className={`relative w-full rounded-2xl border border-white/15 bg-black/80 text-white ${packed ? "flex min-h-0 flex-1 flex-col p-2" : compactCast ? "shrink-0 p-2" : "shrink-0 p-3 sm:p-5"}`}>{children}</div>
  </section>;
}

export function formatResultPlayers(cue: FormatPresentationCue, roster: readonly FormatPresentationRosterPlayer[]) {
  const ids = cue.kind === "empowered_tally" ? [cue.empoweredId]
    : cue.kind === "empowered_tie" || cue.kind === "format_tiebreak" ? cue.tiedPlayerIds
    : cue.kind === "format_elimination" ? [cue.eliminatedId]
    : cue.kind === "format_deciding_vote" ? [cue.tiebreakerId, cue.targetId]
    : cue.kind === "format_selected" || cue.kind === "format_menu" ? [cue.empoweredId] : [];
  return roster.filter(player => ids.includes(player.id));
}
