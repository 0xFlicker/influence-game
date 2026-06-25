import type {
  GameDetail,
  GamePlayer,
  GameWatchPlayerPressureStatus,
  GameWatchPlayerStatus,
  GameWatchState,
  PhaseKey,
  PlayerState,
  TranscriptEntry,
} from "@/lib/api";
import { PHASE_LABELS } from "./constants";
import {
  parseEmpowered,
  parsePowerAction,
  parseReVoteResolved,
  parseVoteMsg,
  parseWheelDecides,
} from "./message-parsing";
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
const PRESSURE_PLAYBACK_PHASES = new Set<PhaseKey>([
  "VOTE",
  "MINGLE",
  "POWER",
  "REVEAL",
  "COUNCIL",
]);

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

export type MatchWatchPlayerStatusTagKind =
  | GameWatchPlayerPressureStatus
  | "shielded";

export interface MatchWatchPlayerStatusTag {
  kind: MatchWatchPlayerStatusTagKind;
  label: string;
  icon: string;
  title: string;
}

export interface MatchWatchPlayerCard {
  player: GamePlayer;
  statusLabel: string;
  statusTags: MatchWatchPlayerStatusTag[];
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
      ...(player.personaKey || existing?.personaKey
        ? { personaKey: player.personaKey ?? existing?.personaKey }
        : {}),
      status: watchStatusToPlayerState(player.status, existing?.status),
      shielded: player.shielded,
      ...(player.pressureStatus ? { pressureStatus: player.pressureStatus } : {}),
      ...(player.exposeScore !== undefined ? { exposeScore: player.exposeScore } : {}),
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
  const modelPlayers = playbackState
    ? applyReplayPressureToPlayers(playbackState.players, playbackState.visibleMessages, playbackState.round, playbackState.phase)
    : game.players;
  const counts = playbackState
    ? deriveMatchWatchCountsFromPlayers(modelPlayers)
    : deriveMatchWatchCounts(game);
  const visibleMessages = playbackState?.visibleMessages ?? messages;
  const selectedPlayer = resolveSelectedPlayer(modelPlayers, selectedPlayerId);
  const players = modelPlayers.map((player) => {
    const statusLabel = getPlayerStatusLabel(player.status);
    const statusTags = buildPlayerStatusTags(player);
    return {
      player,
      statusLabel,
      statusTags,
      isSelected: selectedPlayer?.id === player.id,
      isAlive: player.status === "alive",
      detail: statusTags.map((tag) => tag.label).join(" / "),
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

function buildPlayerStatusTags(player: GamePlayer): MatchWatchPlayerStatusTag[] {
  const tags: MatchWatchPlayerStatusTag[] = [];

  if (player.pressureStatus === "empowered") {
    tags.push({
      kind: "empowered",
      icon: "👑",
      label: "Empowered",
      title: "Empowered by the vote",
    });
  } else if (player.pressureStatus === "locked_at_risk") {
    const exposeLabel = buildExposeLabel(player.exposeScore);
    tags.push({
      kind: "locked_at_risk",
      icon: "⚡",
      label: exposeLabel,
      title: player.exposeScore
        ? `${player.exposeScore} expose vote${player.exposeScore === 1 ? "" : "s"} locked this Council danger`
        : "Vote-derived Council danger",
    });
  } else if (player.pressureStatus === "empowered_selected") {
    tags.push({
      kind: "empowered_selected",
      icon: "⚠",
      label: player.exposeScore && player.exposeScore > 0
        ? `Selected x${player.exposeScore}`
        : "Selected",
      title: player.exposeScore && player.exposeScore > 0
        ? "Selected by the empowered player from unresolved exposed pressure"
        : "Selected by the empowered player, not from expose votes",
    });
  } else if (player.pressureStatus === "selectable_exposed") {
    tags.push({
      kind: "selectable_exposed",
      icon: "⚡",
      label: buildExposeLabel(player.exposeScore),
      title: player.exposeScore
        ? `${player.exposeScore} expose vote${player.exposeScore === 1 ? "" : "s"} and still selectable`
        : "Selectable exposed pressure",
    });
  } else if (player.pressureStatus === "replacement_risk") {
    tags.push({
      kind: "replacement_risk",
      icon: "↗",
      label: player.exposeScore && player.exposeScore > 0
        ? `Bench Risk x${player.exposeScore}`
        : "Bench Risk",
      title: "Could be pulled up from the remaining exposure bench",
    });
  } else if (player.pressureStatus === "fallback_risk") {
    tags.push({
      kind: "fallback_risk",
      icon: "⚠",
      label: "Fallback Risk",
      title: "Could be pulled up only through all-player fallback, not expose votes",
    });
  }

  if (player.shielded && player.status === "alive") {
    tags.push({
      kind: "shielded",
      icon: "🛡",
      label: "Shielded",
      title: "Protected from Council candidacy",
    });
  }

  if (tags.length > 0) return tags;
  return [];
}

function buildExposeLabel(exposeScore?: number): string {
  return exposeScore && exposeScore > 1
    ? `Exposed x${exposeScore}`
    : "Exposed";
}

function applyReplayPressureToPlayers(
  players: readonly GamePlayer[],
  visibleMessages: readonly TranscriptEntry[],
  round: number,
  phase: PhaseKey,
): GamePlayer[] {
  const pressure = deriveReplayPressure(visibleMessages, players, round, phase);
  const clearedPlayers = players.map(clearPressureFields);
  if (!pressure) return clearedPlayers;

  return clearedPlayers.map((player) => {
    const pressureStatus = pressure.statusByName.get(player.name);
    const exposeScore = pressure.exposeScoresByName.get(player.name);
    return {
      ...player,
      shielded: player.shielded || pressure.shieldedNames.has(player.name),
      ...(pressureStatus ? { pressureStatus } : {}),
      ...(exposeScore !== undefined && exposeScore > 0 ? { exposeScore } : {}),
    };
  });
}

function clearPressureFields(player: GamePlayer): GamePlayer {
  return {
    id: player.id,
    name: player.name,
    persona: player.persona,
    ...(player.personaKey ? { personaKey: player.personaKey } : {}),
    status: player.status,
    shielded: player.shielded,
    ...(player.avatarUrl ? { avatarUrl: player.avatarUrl } : {}),
  };
}

function deriveReplayPressure(
  visibleMessages: readonly TranscriptEntry[],
  players: readonly GamePlayer[],
  round: number,
  phase: PhaseKey,
): {
  statusByName: Map<string, GameWatchPlayerPressureStatus>;
  exposeScoresByName: Map<string, number>;
  shieldedNames: Set<string>;
} | null {
  if (!PRESSURE_PLAYBACK_PHASES.has(phase)) return null;

  const roundMessages = visibleMessages.filter((message) => message.round === round);
  if (roundMessages.some(isResolvedCouncilOrPowerElimination)) return null;

  let empoweredName: string | null = null;
  let currentAtRisk: Array<{ name: string; exposeScore?: number }> = [];
  let initialCurrentAtRisk: Array<{ name: string; exposeScore?: number }> = [];
  const exposeScoresByName = new Map<string, number>();
  const shieldedNames = new Set<string>();

  for (const message of roundMessages) {
    const vote = parseVoteMsg(message.text);
    if (vote) {
      exposeScoresByName.set(vote.expose, (exposeScoresByName.get(vote.expose) ?? 0) + 1);
    }

    const empowered = parseEmpowered(message.text)
      ?? parseReVoteResolved(message.text)
      ?? parseWheelDecides(message.text);
    if (empowered) {
      empoweredName = empowered.name;
    }

    const pressureSummary = parsePostVotePressureSummary(message.text);
    if (pressureSummary) {
      empoweredName = pressureSummary.empoweredName;
      currentAtRisk = pressureSummary.currentAtRisk;
      if (initialCurrentAtRisk.length === 0) {
        initialCurrentAtRisk = pressureSummary.currentAtRisk;
      }
    }

    const initialPair = parseInitialCouncilPair(message.text);
    if (initialPair) {
      currentAtRisk = initialPair.map((name) => ({
        name,
        exposeScore: exposeScoresByName.get(name),
      }));
      if (initialCurrentAtRisk.length === 0) {
        initialCurrentAtRisk = currentAtRisk;
      }
    }

    const powerLobbyPair = parsePowerLobbyPair(message.text);
    if (powerLobbyPair) {
      currentAtRisk = powerLobbyPair.map((name) => ({
        name,
        exposeScore: exposeScoresByName.get(name),
      }));
    }

    const powerAction = parsePowerAction(message.text);
    if (powerAction?.action === "protect") {
      shieldedNames.add(powerAction.target);
    }

    const shieldGrant = parseShieldGrant(message.text);
    if (shieldGrant) {
      shieldedNames.add(shieldGrant);
    }

    const revealPair = parseRevealCouncilPair(message.text);
    if (revealPair) {
      currentAtRisk = revealPair.map((name) => ({
        name,
        exposeScore: exposeScoresByName.get(name),
      }));
    }
  }

  if (!empoweredName) return null;

  const aliveNames = new Set(
    players
      .filter((player) => player.status === "alive")
      .map((player) => player.name),
  );
  if (!aliveNames.has(empoweredName)) return null;

  const statusByName = deriveReplayPressureStatuses({
    aliveNames,
    empoweredName,
    currentAtRiskNames: currentAtRisk.map((entry) => entry.name),
    initialCurrentAtRiskNames: initialCurrentAtRisk.map((entry) => entry.name),
    exposeScoresByName,
    shieldedNames,
  });

  return {
    statusByName,
    exposeScoresByName,
    shieldedNames,
  };
}

function byScoreThenName(
  [nameA, scoreA]: [string, number],
  [nameB, scoreB]: [string, number],
): number {
  return scoreB - scoreA || nameA.localeCompare(nameB);
}

function deriveReplayPressureStatuses({
  aliveNames,
  empoweredName,
  currentAtRiskNames,
  initialCurrentAtRiskNames,
  exposeScoresByName,
  shieldedNames,
}: {
  aliveNames: Set<string>;
  empoweredName: string;
  currentAtRiskNames: string[];
  initialCurrentAtRiskNames: string[];
  exposeScoresByName: Map<string, number>;
  shieldedNames: Set<string>;
}): Map<string, GameWatchPlayerPressureStatus> {
  const statusByName = new Map<string, GameWatchPlayerPressureStatus>();
  statusByName.set(empoweredName, "empowered");

  const rawExposureBench = [...exposeScoresByName.entries()]
    .filter(([name, score]) => score > 0 && name !== empoweredName && aliveNames.has(name))
    .sort(byScoreThenName)
    .map(([name]) => name);
  const exposureBench = rawExposureBench.filter((name) => !shieldedNames.has(name));
  const currentCandidates = currentAtRiskNames
    .filter((name) => aliveNames.has(name) && name !== empoweredName && !shieldedNames.has(name));
  const effectiveCandidates = currentCandidates.length > 0
    ? currentCandidates.slice(0, 2)
    : exposureBench.slice(0, 2);
  const candidateSet = new Set(effectiveCandidates);
  const initialCandidateNames = initialCurrentAtRiskNames.length > 0
    ? initialCurrentAtRiskNames.filter((name) => aliveNames.has(name) && name !== empoweredName)
    : effectiveCandidates;
  const initialCandidateSet = new Set(initialCandidateNames);
  const lockedNames = new Set(
    resolveLockedExposedNames(rawExposureBench, exposeScoresByName)
      .filter((name) => initialCandidateSet.has(name)),
  );
  const shieldedInitialCandidate = initialCandidateNames.some((name) => shieldedNames.has(name));
  const benchCanFillShieldReplacement = exposureBench.some((name) => !candidateSet.has(name));

  for (const name of effectiveCandidates) {
    const exposeScore = exposeScoresByName.get(name) ?? 0;
    const pressureStatus: GameWatchPlayerPressureStatus =
      lockedNames.has(name) && exposeScore > 0
        ? "locked_at_risk"
        : shieldedInitialCandidate && !initialCandidateSet.has(name) && exposeScore === 0 && !benchCanFillShieldReplacement
          ? "fallback_risk"
          : shieldedInitialCandidate && !initialCandidateSet.has(name) && exposeScore > 0
            ? "replacement_risk"
            : "empowered_selected";
    statusByName.set(name, pressureStatus);
  }

  for (const name of exposureBench) {
    if (statusByName.has(name)) continue;
    statusByName.set(name, candidateSet.size >= 2 ? "replacement_risk" : "selectable_exposed");
  }

  if (!shieldedInitialCandidate && !benchCanFillShieldReplacement && candidateSet.size > 0) {
    for (const name of aliveNames) {
      if (
        name !== empoweredName &&
        !statusByName.has(name) &&
        !shieldedNames.has(name)
      ) {
        statusByName.set(name, "fallback_risk");
      }
    }
  }

  return statusByName;
}

function resolveLockedExposedNames(
  exposureBench: readonly string[],
  exposeScoresByName: ReadonlyMap<string, number>,
): string[] {
  if (exposureBench.length === 0) return [];
  if (exposureBench.length === 1) return [exposureBench[0]!];
  if (exposureBench.length === 2) return [...exposureBench];

  const lockedNames: string[] = [];
  let remainingSlots = 2;
  let index = 0;
  while (index < exposureBench.length && remainingSlots > 0) {
    const score = exposeScoresByName.get(exposureBench[index]!) ?? 0;
    const tier = exposureBench
      .slice(index)
      .filter((name) => (exposeScoresByName.get(name) ?? 0) === score);
    if (tier.length <= remainingSlots) {
      lockedNames.push(...tier);
      remainingSlots -= tier.length;
      index += tier.length;
      continue;
    }
    break;
  }
  return lockedNames;
}

function isResolvedCouncilOrPowerElimination(message: TranscriptEntry): boolean {
  return message.scope === "system" && (
    message.text.startsWith("ELIMINATED: ") ||
    message.text.startsWith("AUTO-ELIMINATE: ")
  );
}

function parsePostVotePressureSummary(text: string): {
  empoweredName: string;
  currentAtRisk: Array<{ name: string; exposeScore?: number }>;
} | null {
  const match = text.match(/^Post-vote pressure: (.+?) is empowered\. Current at-risk: (.+?)\. Replacement risk if a shield is granted: .+\.$/);
  if (!match) return null;
  return {
    empoweredName: match[1]!,
    currentAtRisk: parseNameScoreList(match[2]!),
  };
}

function parseNameScoreList(text: string): Array<{ name: string; exposeScore?: number }> {
  if (text === "none") return [];
  return text.split(", ").map((entry) => {
    const match = entry.match(/^(.+?) \((\d+)\)$/);
    if (!match) return { name: entry };
    return {
      name: match[1]!,
      exposeScore: Number.parseInt(match[2]!, 10),
    };
  });
}

function parseInitialCouncilPair(text: string): [string, string] | null {
  const match = text.match(/^Initial Council pair resolved before Mingle: (.+?) and (.+?) \(.+\)$/);
  return match ? [match[1]!, match[2]!] : null;
}

function parsePowerLobbyPair(text: string): [string, string] | null {
  const match = text.match(/^POWER LOBBY: .+? Provisional council pressure falls on (.+?) and (.+?)\. Top expose pressure: .+?\. Protect can still change the final reveal\.$/);
  return match ? [match[1]!, match[2]!] : null;
}

function parseShieldGrant(text: string): string | null {
  const match = text.match(/^(.+?) is protected \(shield granted\)$/);
  return match ? match[1]! : null;
}

function parseRevealCouncilPair(text: string): [string, string] | null {
  const match = text.match(/^=== REVEAL PHASE === Council candidates: (.+?) vs (.+?)$/);
  return match ? [match[1]!, match[2]!] : null;
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
