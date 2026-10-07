"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { completedGameModeHref } from "@/lib/game-links";
export interface WatchHeaderModel {
 matchTitle: string; roundLabel: string; connectionLabel: string;
 counts: { alivePlayers: number; eliminatedPlayers: number };
}
export function WatchShell({mode, header, cast, mobileCast, theater, inspector, footer}: {
 mode: string; header: ReactNode; cast: ReactNode; mobileCast: ReactNode;
 theater: ReactNode; inspector: ReactNode; footer?: ReactNode;
}) {
 return <main className="fixed inset-0 z-30 flex min-h-0 flex-col overflow-hidden influence-shell" style={{backgroundColor: "#08080b"}} data-testid="match-watch-shell" data-watch-mode={mode}>
  <div className="pointer-events-none absolute inset-0 influence-phase-atmosphere" />
  <div className="pointer-events-none absolute inset-0 influence-phase-vignette" />
  {header}<McpBanner />
  <div className="relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-2 pb-2 pt-1.5 lg:gap-3 lg:px-3 lg:pb-3 lg:pt-2 xl:grid xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
   {cast}{mobileCast}{theater}{inspector}
  </div>{footer}
 </main>;
}
function McpBanner() {
  return (
    <Link
      href="/get-mcp"
      className="relative mx-2 mt-1.5 flex h-8 shrink-0 items-center justify-between gap-2 overflow-hidden rounded-md border border-cyan-200/35 bg-cyan-300/[0.09] px-2.5 text-cyan-50 shadow-[0_0_28px_rgba(103,232,249,0.08)] transition-colors hover:border-cyan-100/65 hover:bg-cyan-300/[0.16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 lg:mx-3 lg:h-auto lg:gap-4 lg:px-3 lg:py-2.5"
    >
      <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-cyan-200 lg:w-1" />
      <span className="min-w-0 pl-1 lg:pl-1.5">
        <span className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-100/65 lg:block">Game challenge</span>
        <span className="block truncate text-[11px] font-semibold tracking-tight text-cyan-50 lg:text-sm">
          <span className="lg:hidden">Cross-examine with AI</span>
          <span className="hidden lg:inline">Don&apos;t just watch. Cross-examine this game with your AI.</span>
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-100">
        <span className="lg:hidden" aria-hidden="true">→</span>
        <span className="hidden lg:inline">Analyze this game <span aria-hidden="true">→</span></span>
      </span>
    </Link>
  );
}

export function ShellHeader({
  model,
  gamePath,
  showResultsCta,
  exitHref = "/games",
  brand = "INFLUENCE",
}: {
  model: WatchHeaderModel;
  gamePath: string;
  showResultsCta: boolean;
  exitHref?: string;
  brand?: string;
}) {
  return (
    <header className="relative mx-2 mt-2 flex h-11 shrink-0 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-2 shadow-panel backdrop-blur-glass lg:mx-3 lg:mt-3 lg:grid lg:h-auto lg:min-h-14 lg:grid-cols-[18rem_minmax(0,1fr)_22rem] lg:items-center lg:gap-3 lg:rounded-lg lg:px-4 lg:py-0">
      {/* Compact (< lg): single dense row — no stacked brand/slug/actions */}
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
        <Link
          href={exitHref}
          aria-label="Exit watch room"
          title="Exit"
          className="inline-flex h-8 shrink-0 items-center rounded-md border border-white/10 bg-white/[0.03] px-2 text-[9px] uppercase tracking-[0.12em] text-white/55 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/60"
        >
          Exit
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold tracking-wide text-white/90">
            {model.matchTitle}
          </div>
          <div className="truncate text-[9px] uppercase tracking-[0.12em] text-white/35">
            {model.roundLabel} · {model.connectionLabel}
          </div>
        </div>
        {showResultsCta ? (
          <Link
            href={completedGameModeHref(gamePath, "results")}
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 text-[9px] uppercase tracking-[0.12em] text-cyan-100/80"
          >
            Results
          </Link>
        ) : null}
        <span
          aria-label={`${model.counts.alivePlayers} In`}
          data-testid="match-watch-count-alive"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-1.5 text-[9px] uppercase tracking-[0.1em] text-white/55"
        >
          <strong className="text-[10px] text-white/95">{model.counts.alivePlayers}</strong>
          <span className="text-white/35">In</span>
        </span>
        <span
          aria-label={`${model.counts.eliminatedPlayers} Out`}
          data-testid="match-watch-count-out"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-1.5 text-[9px] uppercase tracking-[0.1em] text-white/55"
        >
          <strong className="text-[10px] text-white/95">{model.counts.eliminatedPlayers}</strong>
          <span className="text-white/35">O</span>
        </span>
      </div>

      {/* Desktop (lg+): multi-column chrome with room for brand + actions */}
      <div className="hidden min-w-0 items-center gap-4 lg:flex">
        <div className="text-sm font-medium tracking-[0.45em] text-white/90">{brand}</div>
        <div className="h-5 w-px bg-white/10" />
        <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">Watch Room</div>
      </div>

      <div className="hidden min-w-0 text-center lg:block">
        <div className="truncate text-sm font-semibold tracking-[0.18em] text-white/90">
          {model.matchTitle}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/35">
          {model.roundLabel} {model.connectionLabel}
        </div>
      </div>

      <div className="hidden min-w-0 flex-wrap items-center justify-end gap-2 lg:flex">
        {showResultsCta ? (
          <Link
            href={completedGameModeHref(gamePath, "results")}
            className="inline-flex h-8 items-center rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 text-[10px] uppercase tracking-[0.14em] text-cyan-100/80 transition-colors hover:border-cyan-200/45 hover:bg-cyan-400/15 hover:text-cyan-50"
          >
            Full Results
          </Link>
        ) : null}
        <Link
          href={exitHref}
          aria-label="Exit watch room"
          title="Exit"
          className="inline-flex h-8 items-center rounded-md border border-white/10 bg-white/[0.03] px-3 text-[10px] uppercase tracking-[0.14em] text-white/55 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/60"
        >
          Exit
        </Link>
        <StatusPill value={model.counts.alivePlayers} label="In" />
        <StatusPill value={model.counts.eliminatedPlayers} label="Out" />
        <span className="inline-flex h-8 items-center gap-2 rounded-md border border-phase/30 bg-phase/10 px-3 text-[10px] uppercase tracking-[0.14em] text-white/80">
          <span className="h-1.5 w-1.5 rounded-full bg-phase shadow-phase-sm" />
          {model.connectionLabel}
        </span>
      </div>
    </header>
  );
}

function StatusPill({ value, label }: { value: number; label: string }) {
  return (
    <span
      aria-label={`${value} ${label}`}
      data-testid={`match-watch-count-${label.toLowerCase()}`}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-[10px] uppercase tracking-[0.14em] text-white/55"
    >
      <strong className="text-xs text-white/95">{value}</strong>
      {label}
    </span>
  );
}

