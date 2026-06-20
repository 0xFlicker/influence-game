import type {
  GameDetail,
  GamePlayer,
  GameWatchPlayerStatus,
  GameWatchState,
  PhaseKey,
  PlayerState,
  TranscriptEntry,
} from "@/lib/api";
import { PHASE_LABELS } from "./constants";
import type { WatchConnStatus } from "./types";

const MATCH_WATCH_PHASES: readonly PhaseKey[] = [
  "INTRODUCTION",
  "LOBBY",
  "MINGLE",
  "VOTE",
  "POWER",
  "REVEAL",
  "COUNCIL",
  "END",
];
const MATCH_WATCH_WHISPER_PHASES: readonly PhaseKey[] = [
  "INTRODUCTION",
  "LOBBY",
  "WHISPER",
  "VOTE",
  "POWER",
  "REVEAL",
  "COUNCIL",
  "END",
];

export type MatchWatchMode = "live" | "replay";
export type MatchWatchPhaseSegmentState = "past" | "current" | "future";

export interface MatchWatchRouteDecision {
  eligible: boolean;
  mode: MatchWatchMode | null;
  reason: "live_game" | "replay_transcript" | "waiting" | "no_replay_transcript";
}

export interface MatchWatchCounts {
  totalPlayers: number;
  alivePlayers: number;
  eliminatedPlayers: number;
  unknownPlayers: number;
}

export interface MatchWatchPhaseSegment {
  key: PhaseKey;
  label: string;
  state: MatchWatchPhaseSegmentState;
}

export interface MatchWatchPlayerCard {
  player: GamePlayer;
  statusLabel: string;
  isSelected: boolean;
  isAlive: boolean;
  detail: string;
}

export interface MatchWatchModel {
  mode: MatchWatchMode;
  matchTitle: string;
  round: number;
  roundLabel: string;
  phase: PhaseKey;
  phaseLabel: string;
  phaseFeedLabel: string;
  counts: MatchWatchCounts;
  players: MatchWatchPlayerCard[];
  selectedPlayer: MatchWatchPlayerCard | null;
  selectedPlayerId: string | null;
  connectionLabel: string;
  sourceLabel: string;
  phaseSegments: MatchWatchPhaseSegment[];
  latestPublicMessage: TranscriptEntry | null;
}

export interface MatchWatchPlaybackState {
  round: number;
  phase: PhaseKey;
  players: GamePlayer[];
  visibleMessages: TranscriptEntry[];
}

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

export function getMatchWatchRouteDecision(
  game: GameDetail,
  messages: readonly TranscriptEntry[],
): MatchWatchRouteDecision {
  if (game.status === "in_progress") {
    return {
      eligible: true,
      mode: "live",
      reason: "live_game",
    };
  }

  if (game.status === "completed" || game.status === "cancelled" || game.status === "suspended") {
    if (messages.length > 0) {
      return {
        eligible: true,
        mode: "replay",
        reason: "replay_transcript",
      };
    }

    return {
      eligible: false,
      mode: null,
      reason: "no_replay_transcript",
    };
  }

  return {
    eligible: false,
    mode: null,
    reason: "waiting",
  };
}

export function buildMatchWatchModel({
  game,
  messages,
  live,
  connStatus,
  selectedPlayerId,
  playbackState,
}: {
  game: GameDetail;
  messages: readonly TranscriptEntry[];
  live: boolean;
  connStatus?: WatchConnStatus;
  selectedPlayerId?: string | null;
  playbackState?: MatchWatchPlaybackState | null;
}): MatchWatchModel {
  const watchState = game.watchState;
  const phase = playbackState?.phase ?? normalizePhase(watchState?.currentPhase ?? game.currentPhase);
  const round = playbackState?.round ?? watchState?.currentRound ?? game.currentRound;
  const modelPlayers = playbackState?.players ?? game.players;
  const counts = playbackState
    ? deriveMatchWatchCountsFromPlayers(modelPlayers)
    : deriveMatchWatchCounts(game);
  const visibleMessages = playbackState?.visibleMessages ?? messages;
  const selectedPlayer = resolveSelectedPlayer(modelPlayers, selectedPlayerId);
  const players = modelPlayers.map((player) => {
    const statusLabel = getPlayerStatusLabel(player.status);
    return {
      player,
      statusLabel,
      isSelected: selectedPlayer?.id === player.id,
      isAlive: player.status === "alive",
      detail: player.shielded ? `${statusLabel} - shielded` : statusLabel,
    };
  });

  return {
    mode: live ? "live" : "replay",
    matchTitle: game.slug?.toUpperCase() ?? `GAME ${game.gameNumber}`,
    round,
    roundLabel: `Round ${round}`,
    phase,
    phaseLabel: PHASE_LABELS[phase],
    phaseFeedLabel: `${PHASE_LABELS[phase]} Feed`,
    counts,
    players,
    selectedPlayer: players.find((card) => card.player.id === selectedPlayer?.id) ?? null,
    selectedPlayerId: selectedPlayer?.id ?? null,
    connectionLabel: getConnectionLabel(live, connStatus),
    sourceLabel: getSourceLabel(game),
    phaseSegments: buildPhaseSegments(phase),
    latestPublicMessage: findLatestPublicMessage(visibleMessages),
  };
}

function deriveMatchWatchCounts(game: GameDetail): MatchWatchCounts {
  if (game.watchState) {
    return game.watchState.counts;
  }

  return deriveMatchWatchCountsFromPlayers(game.players);
}

function deriveMatchWatchCountsFromPlayers(players: readonly GamePlayer[]): MatchWatchCounts {
  const alivePlayers = players.filter((player) => player.status === "alive").length;
  const eliminatedPlayers = players.filter((player) => player.status === "eliminated").length;
  const unknownPlayers = players.filter((player) => player.status === "unknown").length;

  return {
    totalPlayers: players.length,
    alivePlayers,
    eliminatedPlayers,
    unknownPlayers,
  };
}

function normalizePhase(phase: string): PhaseKey {
  return phase in PHASE_LABELS ? (phase as PhaseKey) : "INIT";
}

function buildPhaseSegments(currentPhase: PhaseKey): MatchWatchPhaseSegment[] {
  const phases = currentPhase === "WHISPER" ? MATCH_WATCH_WHISPER_PHASES : MATCH_WATCH_PHASES;
  const shellPhase = toShellPhaseSegment(currentPhase);
  const currentIndex = phases.indexOf(shellPhase);
  return phases.map((phase, index) => {
    let state: MatchWatchPhaseSegmentState = "future";
    if (currentIndex === -1) {
      state = phase === shellPhase ? "current" : "future";
    } else if (index < currentIndex) {
      state = "past";
    } else if (index === currentIndex) {
      state = "current";
    }

    return {
      key: phase,
      label: PHASE_LABELS[phase],
      state,
    };
  });
}

function toShellPhaseSegment(phase: PhaseKey): PhaseKey {
  switch (phase) {
    case "DIARY_ROOM":
      return "LOBBY";
    case "OPENING_STATEMENTS":
    case "JURY_QUESTIONS":
    case "CLOSING_ARGUMENTS":
    case "JURY_VOTE":
      return "END";
    case "RUMOR":
      return "VOTE";
    case "PLEA":
    case "ACCUSATION":
    case "DEFENSE":
      return "COUNCIL";
    case "INIT":
    case "SUSPENDED":
      return "INTRODUCTION";
    default:
      return phase;
  }
}

function resolveSelectedPlayer(
  players: readonly GamePlayer[],
  selectedPlayerId?: string | null,
): GamePlayer | null {
  return (
    players.find((player) => player.id === selectedPlayerId) ??
    players.find((player) => player.status === "alive") ??
    players[0] ??
    null
  );
}

function getPlayerStatusLabel(status: PlayerState): string {
  switch (status) {
    case "alive":
      return "Alive";
    case "eliminated":
      return "Out";
    case "unknown":
      return "Unknown";
  }
}

function getConnectionLabel(
  live: boolean,
  connStatus?: WatchConnStatus,
): string {
  if (!live) return "Replay";
  switch (connStatus) {
    case "live":
      return "Live";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
    case "replay":
    case undefined:
      return "Live";
  }
}

function getSourceLabel(game: GameDetail): string {
  if (!game.watchState) return "Best Available";
  switch (game.watchState.source) {
    case "durable_projection":
      return "Durable Projection";
    case "best_available_terminal_result":
      return "Best Available";
    case "pre_kernel_empty":
      return "Pre-game";
    case "degraded":
      return "Degraded";
  }
}

function findLatestPublicMessage(
  messages: readonly TranscriptEntry[],
): TranscriptEntry | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.scope !== "thinking") {
      return message;
    }
  }
  return null;
}
