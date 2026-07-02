"use client";

import Link from "next/link";
import type { DashboardMissionControl, DashboardPrimaryAction } from "./dashboard-mission-control";

export interface MissionControlUser {
  email?: { address?: string | null } | null;
  wallet?: { address?: string | null } | null;
}

interface MissionControlOverviewProps {
  control: DashboardMissionControl;
  user: MissionControlUser | null;
  loading: boolean;
  errors: string[];
  onJoinPrimary: (action: DashboardPrimaryAction) => void;
}

function userLabel(user: MissionControlUser | null): string {
  return user?.email?.address ?? user?.wallet?.address?.slice(0, 10) ?? "Player";
}

function PrimaryActionButton({
  action,
  onJoinPrimary,
}: {
  action: DashboardPrimaryAction;
  onJoinPrimary: (action: DashboardPrimaryAction) => void;
}) {
  const className = "influence-button-primary inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold";

  if (action.kind === "join") {
    return (
      <button
        type="button"
        onClick={() => onJoinPrimary(action)}
        className={className}
        data-testid="dashboard-primary-action"
      >
        {action.label}
      </button>
    );
  }

  return (
    <Link href={action.href ?? "/games"} className={className} data-testid="dashboard-primary-action">
      {action.label}
    </Link>
  );
}

export function MissionControlOverview({
  control,
  user,
  loading,
  errors,
  onJoinPrimary,
}: MissionControlOverviewProps) {
  const stats = control.stats;

  return (
    <section className="influence-panel rounded-xl p-4 sm:p-5 lg:p-6" data-testid="mission-control-overview">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="influence-section-title mb-2">Mission Control</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary mb-2">
            {userLabel(user)}
          </h1>
          <p className="influence-copy text-sm max-w-2xl">
            {loading ? "Syncing your current game, agent, and queue state." : control.primaryAction.description}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-48">
          <PrimaryActionButton action={control.primaryAction} onJoinPrimary={onJoinPrimary} />
          {control.primaryAction.kind !== "browse-games" && (
            <Link href="/games" className="influence-button-secondary rounded-lg px-5 py-2 text-center text-xs font-medium">
              Browse games
            </Link>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="influence-panel-muted rounded-lg p-4">
          <p className="text-2xl font-bold text-text-primary">{stats.agentCount}</p>
          <p className="influence-copy-muted text-xs">Saved agents</p>
        </div>
        <div className="influence-panel-muted rounded-lg p-4">
          <p className="text-2xl font-bold text-text-primary">{stats.gamesPlayed}</p>
          <p className="influence-copy-muted text-xs">Games played</p>
        </div>
        <div className="influence-panel-muted rounded-lg p-4">
          <p className="text-2xl font-bold text-yellow-400">{stats.wins}</p>
          <p className="influence-copy-muted text-xs">Wins</p>
        </div>
        <div className="influence-panel-muted rounded-lg p-4">
          <p className="text-2xl font-bold text-text-primary">{stats.liveGames + stats.openGames}</p>
          <p className="influence-copy-muted text-xs">Live or open games</p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3">
          <p className="text-xs text-amber-200">
            Some dashboard data did not load. The next action is based on the state available now.
          </p>
        </div>
      )}
    </section>
  );
}
