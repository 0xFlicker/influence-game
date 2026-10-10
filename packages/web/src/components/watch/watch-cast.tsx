"use client";
import type {ReactNode} from "react";
export interface WatchCastCard { id:string; name:string; isSelected:boolean; statusLabel:string; statusClass:string; portrait:ReactNode; smallPortrait:ReactNode; tags?:ReactNode; owner?:ReactNode }
export interface WatchCastModel {players:WatchCastCard[]; counts:{totalPlayers:number}; phaseLabel:string}
export function MobileContextPanel({
  model,
  onSelectPlayer,
}: {
  model: WatchCastModel;
  onSelectPlayer: (playerId: string) => void;
}) {
  return (
    <section className="flex shrink-0 flex-col rounded-md border border-white/10 bg-black/45 px-2 py-1.5 shadow-panel backdrop-blur-glass xl:hidden">
      <div className="flex items-center gap-1.5 overflow-x-auto" aria-label="Cast selection">
        <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[0.16em] text-white/40">
          Cast
        </span>
        {model.players.map((card) => (
          <div
            key={card.id}
            className={`flex shrink-0 items-center gap-0.5 rounded-md border pl-0.5 pr-1.5 ${
              card.isSelected
                ? "border-phase/40 bg-phase/[0.12]"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            {card.smallPortrait}
            <button
              type="button"
              aria-label={`Inspect ${card.name}`}
              aria-pressed={card.isSelected}
              onClick={() => onSelectPlayer(card.id)}
              className="max-w-16 truncate py-1 text-left text-[10px] font-medium text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-phase/70"
            >
              {card.name}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CastRail({
  model,
  onSelectPlayer,
}: {
  model: WatchCastModel;
  onSelectPlayer: (playerId: string) => void;
}) {
  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/45 shadow-panel backdrop-blur-glass xl:flex">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85">
          Cast & Status
        </h2>
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-white/35">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {model.counts.totalPlayers} total
        </span>
      </div>

      <div className="grid grid-cols-1 gap-px border-b border-white/10 bg-white/10">
        <CastMetric label="Phase" value={model.phaseLabel} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {model.players.map((card) => (
          <div
            key={card.id}
            className={`grid w-full grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-1 rounded-md border px-1 py-1 transition-colors ${
              card.isSelected
                ? "border-phase/40 bg-phase/[0.12] shadow-phase-sm"
                : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
            }`}
          >
            {card.portrait}
            <div className="min-w-0">
              <button
                type="button"
                aria-label={`Inspect ${card.name}`}
                aria-pressed={card.isSelected}
                onClick={() => onSelectPlayer(card.id)}
                className="grid min-h-11 w-full min-w-0 grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-2 rounded px-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-phase/70"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white/90">
                    {card.name}
                  </span>
                  {card.tags}
                </span>
                <span className={`justify-self-end rounded px-1.5 py-1 text-[9px] uppercase tracking-[0.12em] ${card.statusClass}`}>
                  {card.statusLabel}
                </span>
              </button>
              {card.owner}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function CastMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white/[0.025] px-3 py-3">
      <div className="text-[8px] uppercase tracking-[0.16em] text-white/30">{label}</div>
      <div className="mt-1 truncate text-[11px] font-medium text-white/75">{value}</div>
    </div>
  );
}

