import type { FreeQueueStatus, GameSummary, PlayerGameResult, SavedAgent } from "@/lib/api";

export type DashboardPrimaryActionKind =
  | "watch"
  | "queue"
  | "replay"
  | "join"
  | "create-agent"
  | "browse-games";

export interface DashboardPrimaryAction {
  kind: DashboardPrimaryActionKind;
  label: string;
  description: string;
  href?: string;
  game?: GameSummary;
}

export interface DashboardStats {
  gamesPlayed: number;
  wins: number;
  winRate: number;
  agentCount: number;
  openGames: number;
  liveGames: number;
}

export interface DashboardQueueSummary {
  kind: "queued" | "today-game" | "available";
  label: string;
  description: string;
  href: string;
}

export interface DashboardMissionControlInput {
  agents: SavedAgent[];
  games: GameSummary[];
  history: PlayerGameResult[];
  queueStatus?: FreeQueueStatus | null;
}

export interface DashboardMissionControl {
  stats: DashboardStats;
  primaryAction: DashboardPrimaryAction;
  liveGame: GameSummary | null;
  latestResult: PlayerGameResult | null;
  queueSummary: DashboardQueueSummary | null;
  gamePreview: GameSummary[];
  agentPreview: SavedAgent[];
}

const PREVIEW_LIMIT = 3;

function gameHref(game: Pick<GameSummary, "id" | "slug">): string {
  return `/games/${game.slug ?? game.id}`;
}

function resultHref(result: PlayerGameResult): string {
  return `/games/${result.gameSlug ?? result.gameId}`;
}

function newestFirst(a: { createdAt?: string; completedAt?: string }, b: { createdAt?: string; completedAt?: string }): number {
  const aDate = a.createdAt ?? a.completedAt ?? "";
  const bDate = b.createdAt ?? b.completedAt ?? "";
  return new Date(bDate).getTime() - new Date(aDate).getTime();
}

function statusPriority(game: GameSummary): number {
  if (game.status === "in_progress") return 0;
  if (game.status === "waiting") return 1;
  return 2;
}

function sortRelevantGames(games: GameSummary[]): GameSummary[] {
  return games
    .filter((game) => game.status === "in_progress" || game.status === "waiting")
    .sort((a, b) => {
      const priority = statusPriority(a) - statusPriority(b);
      if (priority !== 0) return priority;
      return newestFirst(a, b);
    });
}

function latestCompletedResult(history: PlayerGameResult[]): PlayerGameResult | null {
  return [...history].sort(newestFirst)[0] ?? null;
}

function buildQueueSummary(queueStatus: FreeQueueStatus | null | undefined): DashboardQueueSummary | null {
  if (!queueStatus) return null;

  if (queueStatus.userEntry) {
    return {
      kind: "queued",
      label: "Free queue",
      description: `${queueStatus.userEntry.agentName} is queued for the next free game.`,
      href: "/games/free",
    };
  }

  if (queueStatus.todayGame) {
    const status = queueStatus.todayGame.status === "in_progress" ? "live" : "available";
    return {
      kind: "today-game",
      label: "Today's free game",
      description: `Game #${queueStatus.todayGame.gameNumber} is ${status}.`,
      href: "/games/free",
    };
  }

  return {
    kind: "available",
    label: "Free queue",
    description: `${queueStatus.queuedCount} queued for the next daily game.`,
    href: "/games/free",
  };
}

function choosePrimaryAction(input: {
  agents: SavedAgent[];
  liveGame: GameSummary | null;
  joinableGame: GameSummary | null;
  latestResult: PlayerGameResult | null;
  queueSummary: DashboardQueueSummary | null;
}): DashboardPrimaryAction {
  if (input.liveGame) {
    return {
      kind: "watch",
      label: "Watch live game",
      description: `Game #${input.liveGame.gameNumber} is in progress now.`,
      href: gameHref(input.liveGame),
      game: input.liveGame,
    };
  }

  if (input.queueSummary?.kind === "queued") {
    return {
      kind: "queue",
      label: "View free queue",
      description: input.queueSummary.description,
      href: input.queueSummary.href,
    };
  }

  if (input.latestResult) {
    return {
      kind: "replay",
      label: "Review latest game",
      description: `${input.latestResult.agentName} placed ${input.latestResult.placement} of ${input.latestResult.totalPlayers}.`,
      href: resultHref(input.latestResult),
    };
  }

  if (input.joinableGame && input.agents.length > 0) {
    return {
      kind: "join",
      label: "Join open game",
      description: `Seat an agent in Game #${input.joinableGame.gameNumber}.`,
      game: input.joinableGame,
    };
  }

  if (input.agents.length === 0) {
    return {
      kind: "create-agent",
      label: "Create your first agent",
      description: "Build a competitor before joining games.",
      href: "/dashboard/agents?view=create",
    };
  }

  if (input.queueSummary) {
    return {
      kind: "queue",
      label: "Join free queue",
      description: input.queueSummary.description,
      href: input.queueSummary.href,
    };
  }

  return {
    kind: "browse-games",
    label: "Browse games",
    description: "Find the next match for one of your saved agents.",
    href: "/games",
  };
}

export function buildDashboardMissionControl({
  agents,
  games,
  history,
  queueStatus,
}: DashboardMissionControlInput): DashboardMissionControl {
  const relevantGames = sortRelevantGames([...games]);
  const liveGame = relevantGames.find((game) => game.status === "in_progress") ?? null;
  const joinableGame = relevantGames.find((game) => game.status === "waiting") ?? null;
  const latestResult = latestCompletedResult(history);
  const queueSummary = buildQueueSummary(queueStatus);
  const wins = history.filter((result) => result.winner).length;

  return {
    stats: {
      gamesPlayed: history.length,
      wins,
      winRate: history.length > 0 ? Math.round((wins / history.length) * 100) : 0,
      agentCount: agents.length,
      openGames: games.filter((game) => game.status === "waiting").length,
      liveGames: games.filter((game) => game.status === "in_progress").length,
    },
    primaryAction: choosePrimaryAction({
      agents,
      liveGame,
      joinableGame,
      latestResult,
      queueSummary,
    }),
    liveGame,
    latestResult,
    queueSummary,
    gamePreview: relevantGames.slice(0, PREVIEW_LIMIT),
    agentPreview: agents.slice(0, PREVIEW_LIMIT),
  };
}
