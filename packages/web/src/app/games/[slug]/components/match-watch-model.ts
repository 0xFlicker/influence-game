import type {
  GameDetail,
  GamePlayer,
  GameWatchPlayerStatus,
  GameWatchState,
  PhaseKey,
  PlayerState,
} from "@/lib/api";

export function shouldApplyWatchStateUpdate(
  currentSequence: number,
  state: GameWatchState,
  currentStatus?: GameDetail["status"],
  currentFinalStatus?: GameWatchState["final"]["status"],
): boolean {
  if (state.eventCursor.sequence > currentSequence) return true;
  if (state.eventCursor.sequence < currentSequence) return false;
  if (currentStatus === undefined && currentFinalStatus === undefined) return false;
  return state.status !== currentStatus || state.final.status !== currentFinalStatus;
}

export function watchStatusToPlayerState(
  status: GameWatchPlayerStatus,
  fallback: PlayerState = "unknown",
): PlayerState {
  return status === "unknown" ? fallback : status;
}

export function applyWatchStateToGameDetail(
  game: GameDetail,
  state: GameWatchState,
): GameDetail {
  const existingPlayers = new Map(game.players.map((player) => [player.id, player]));
  const watchPlayerIds = new Set(state.players.map((player) => player.id));
  const players: GamePlayer[] = state.players.map((player) => {
    const existing = existingPlayers.get(player.id);
    return {
      id: player.id,
      name: player.name,
      persona: player.persona || existing?.persona || "Unknown",
      status: watchStatusToPlayerState(player.status, existing?.status),
      shielded: player.shielded,
      ...(player.avatarUrl || existing?.avatarUrl
        ? { avatarUrl: player.avatarUrl ?? existing?.avatarUrl }
        : {}),
    };
  });

  for (const player of game.players) {
    if (!watchPlayerIds.has(player.id)) {
      players.push(player);
    }
  }

  return {
    ...game,
    ...(state.slug ? { slug: state.slug } : {}),
    status: state.status,
    currentRound: state.currentRound,
    currentPhase: state.currentPhase as PhaseKey,
    maxRounds: state.maxRounds,
    players,
    watchState: state,
    ...(state.winner ? { winner: state.winner.name } : {}),
  };
}
