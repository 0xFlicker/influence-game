import type { CanonicalGameEvent } from "./canonical-events";
import { replayCanonicalEvents, type CanonicalGameProjection } from "./game-projection";
import {
  buildRevealedRoundFacts,
  type RevealedFormatBallotPresentation,
  type RevealedFactsDiagnosticSeverity,
  type RevealedPlayerRef,
  type RevealedRoundFactsRead,
} from "./revealed-round-facts";
import type { LaunchFormatId } from "./formats";
import {
  resolveGameKernel,
  type GameKernel,
} from "./game-kernel";
import type { EndgameStage, UUID } from "./types";

export type CompletedGameResultsSource =
  | "durable_canonical_events"
  | "best_available_terminal_result"
  | "unavailable";

export type CompletedGameResultsAvailabilityStatus =
  | "available"
  | "degraded"
  | "unavailable";

export interface CompletedGameResultsDiagnostic {
  code: string;
  severity: RevealedFactsDiagnosticSeverity;
  message: string;
}

export interface CompletedGameResultsTerminalFallback {
  winnerId: UUID | null;
  winnerName?: string | null;
  roundsPlayed: number;
}

export interface CompletedGameResultsPlayer extends RevealedPlayerRef {
  placement: number | null;
  status: "winner" | "finalist" | "eliminated" | "unknown";
}

export interface CompletedGameResultsElimination {
  player: RevealedPlayerRef;
  round: number;
  source: "council" | "format" | "endgame" | "jury" | "player_eliminated";
  method: string | null;
  juryMember: boolean;
}

export interface CompletedGameResultsEndgameVoteEntry {
  voter: RevealedPlayerRef;
  target: RevealedPlayerRef;
}

export interface CompletedGameResultsEndgameElimination {
  round: number;
  stage: EndgameStage | null;
  ledger: CompletedGameResultsEndgameVoteEntry[];
  juryTiebreakerLedger: CompletedGameResultsEndgameVoteEntry[];
  eliminated: RevealedPlayerRef;
  method: string;
}

export interface CompletedGameResultsJuryVoteEntry {
  juror: RevealedPlayerRef;
  finalist: RevealedPlayerRef;
}

export interface CompletedGameResultsJuryVoteCount {
  finalist: RevealedPlayerRef;
  votes: number;
}

export interface CompletedGameResultsJury {
  status: "available" | "unavailable";
  finalists: RevealedPlayerRef[];
  ledger: CompletedGameResultsJuryVoteEntry[];
  voteCounts: CompletedGameResultsJuryVoteCount[];
  winner: RevealedPlayerRef | null;
  method: string | null;
}

export interface CompletedGameResultsVotePattern {
  player: RevealedPlayerRef;
  signature: string;
  groupKey: string;
}

export interface CompletedGameResultsSaveOrEliminateScore {
  player: RevealedPlayerRef;
  savesReceived: number;
  eliminateReceived: number;
  net: number;
}

export interface CompletedGameResultsVoteBombScore {
  player: RevealedPlayerRef;
  votes: number;
  zeroSafe: boolean;
}

export interface CompletedGameResultsMajorityEliminationScore {
  player: RevealedPlayerRef;
  votes: number;
}

export interface CompletedGameResultsSafetyBounceScore {
  player: RevealedPlayerRef;
  votes: number;
}

export type CompletedGameResultsFormatScoring =
  | {
      kind: "save_or_eliminate";
      rows: CompletedGameResultsSaveOrEliminateScore[];
    }
  | {
      kind: "vote_bomb";
      rows: CompletedGameResultsVoteBombScore[];
    }
  | {
      kind: "majority_elimination";
      rows: CompletedGameResultsMajorityEliminationScore[];
    }
  | {
      kind: "safety_bounce";
      rows: CompletedGameResultsSafetyBounceScore[];
    };

export interface CompletedGameResultsSafetyBounceRecap {
  starter: RevealedPlayerRef | null;
  pointers: Array<{
    actor: RevealedPlayerRef;
    target: RevealedPlayerRef;
    classification: "safe" | "vulnerable";
  }>;
  safe: RevealedPlayerRef[];
  vulnerable: RevealedPlayerRef[];
}

export interface CompletedGameResultsFormatRecap {
  status: "available" | "incomplete";
  offeredFormatIds: [LaunchFormatId, LaunchFormatId] | null;
  selectedFormatId: LaunchFormatId | null;
  resolutionKind: "clear" | "auto" | null;
  eliminated: RevealedPlayerRef | null;
  tied: RevealedPlayerRef[];
  tiebreaker: RevealedPlayerRef | null;
  scoring: CompletedGameResultsFormatScoring | null;
  ballotPresentation: RevealedFormatBallotPresentation;
  safetyBounce: CompletedGameResultsSafetyBounceRecap | null;
}

export interface CompletedGameResultsRound {
  round: number;
  canonicalFacts: RevealedRoundFactsRead;
  endgameEliminations: CompletedGameResultsEndgameElimination[];
  /**
   * Canonical per-round format evidence. Absent from older cached reads and
   * classic/endgame-only rounds.
   */
  formatRecap?: CompletedGameResultsFormatRecap | null;
}

export interface CompletedGameResultsRead {
  schemaVersion: 1;
  source: CompletedGameResultsSource;
  availability: {
    status: CompletedGameResultsAvailabilityStatus;
    eventLogStatus: string;
    projectionStatus: string;
    diagnostics: CompletedGameResultsDiagnostic[];
  };
  summary: {
    winner: RevealedPlayerRef | null;
    winnerMethod: string | null;
    roundsPlayed: number;
    finalists: RevealedPlayerRef[];
    playerCount: number;
    /** Canonical player IDs ordered by placement; tied placements retain roster order. */
    rankedPlayerIds: UUID[];
  };
  players: CompletedGameResultsPlayer[];
  eliminationOrder: CompletedGameResultsElimination[];
  rounds: CompletedGameResultsRound[];
  jury: CompletedGameResultsJury;
  votePatterns: CompletedGameResultsVotePattern[];
}

export interface BuildCompletedGameResultsOptions {
  events: readonly CanonicalGameEvent[];
  eventLogStatus?: string;
  projectionStatus?: string;
  terminalResult?: CompletedGameResultsTerminalFallback | null;
  /** Stored-first kernel authority supplied by callers that have the game row. */
  gameKernel?: GameKernel;
}

type EventOf<TType extends CanonicalGameEvent["type"]> = Extract<CanonicalGameEvent, { type: TType }>;

export function buildCompletedGameResults(
  options: BuildCompletedGameResultsOptions,
): CompletedGameResultsRead {
  const eventLogStatus = options.eventLogStatus ?? (options.events.length === 0 ? "empty" : "complete");
  const projectionStatus = options.projectionStatus ?? (options.events.length === 0 ? "empty" : "complete");
  const diagnostics: CompletedGameResultsDiagnostic[] = [];

  if (eventLogStatus === "empty" || options.events.length === 0) {
    return terminalFallbackRead(options.terminalResult ?? null, eventLogStatus, projectionStatus, diagnostics);
  }

  if (eventLogStatus === "invalid" || projectionStatus === "failed") {
    diagnostics.push({
      code: "canonical_event_log_unavailable",
      severity: "warning",
      message: "Completed-game results are unavailable from the persisted canonical event log.",
    });
    return terminalFallbackRead(options.terminalResult ?? null, eventLogStatus, projectionStatus, diagnostics);
  }

  let projection: CanonicalGameProjection;
  try {
    projection = replayCanonicalEvents(options.events);
  } catch {
    diagnostics.push({
      code: "canonical_event_replay_failed",
      severity: "warning",
      message: "Completed-game results could not replay the persisted canonical event log.",
    });
    return terminalFallbackRead(options.terminalResult ?? null, eventLogStatus, projectionStatus, diagnostics);
  }

  const winnerEvent = latestEvent(options.events, "jury.winner_determined");
  const winnerId = winnerEvent?.payload.winnerId ?? options.terminalResult?.winnerId ?? null;
  const roundsPlayed = Math.max(options.terminalResult?.roundsPlayed ?? 0, latestRound(options.events));
  const finalists = finalistsFor(projection, winnerEvent);
  const eliminationOrder = buildEliminationOrder(options.events, projection, winnerEvent);
  const gameKernel =
    options.gameKernel
    ?? resolveGameKernel({ events: options.events }).kernel;
  const rounds = buildRounds(
    options.events,
    eventLogStatus,
    projectionStatus,
    projection,
    gameKernel,
  );
  const winner = refOrNull(projection, winnerId);
  const jury = buildJury(options.events, projection, winnerEvent, finalists);
  const players = buildPlayers(projection, winnerId, finalists, eliminationOrder);

  return {
    schemaVersion: 1,
    source: "durable_canonical_events",
    availability: {
      status: options.terminalResult?.winnerId && !winnerEvent ? "degraded" : "available",
      eventLogStatus,
      projectionStatus,
      diagnostics,
    },
    summary: {
      winner,
      winnerMethod: winnerEvent?.payload.method ?? null,
      roundsPlayed,
      finalists,
      playerCount: projection.playerOrder.length,
      rankedPlayerIds: [...players]
        .filter((player) => player.placement !== null)
        .sort((left, right) => (left.placement ?? Number.MAX_SAFE_INTEGER) - (right.placement ?? Number.MAX_SAFE_INTEGER))
        .map((player) => player.id),
    },
    players,
    eliminationOrder,
    rounds,
    jury,
    votePatterns: buildVotePatterns(options.events, projection),
  };
}

function terminalFallbackRead(
  terminalResult: CompletedGameResultsTerminalFallback | null,
  eventLogStatus: string,
  projectionStatus: string,
  diagnostics: CompletedGameResultsDiagnostic[],
): CompletedGameResultsRead {
  const winner = terminalResult?.winnerId
    ? { id: terminalResult.winnerId, name: terminalResult.winnerName ?? terminalResult.winnerId }
    : null;
  return {
    schemaVersion: 1,
    source: terminalResult ? "best_available_terminal_result" : "unavailable",
    availability: {
      status: terminalResult ? "degraded" : "unavailable",
      eventLogStatus,
      projectionStatus,
      diagnostics: [
        ...diagnostics,
        {
          code: terminalResult ? "terminal_result_fallback" : "completed_results_unavailable",
          severity: terminalResult ? "info" : "warning",
          message: terminalResult
            ? "Only best-available terminal result fields are available for this game."
            : "No completed-game result facts are available.",
        },
      ],
    },
    summary: {
      winner,
      winnerMethod: null,
      roundsPlayed: terminalResult?.roundsPlayed ?? 0,
      finalists: [],
      playerCount: 0,
      rankedPlayerIds: winner ? [winner.id] : [],
    },
    players: winner ? [{ ...winner, placement: 1, status: "winner" }] : [],
    eliminationOrder: [],
    rounds: [],
    jury: emptyJury(),
    votePatterns: [],
  };
}

function buildRounds(
  events: readonly CanonicalGameEvent[],
  eventLogStatus: string,
  projectionStatus: string,
  projection: CanonicalGameProjection,
  gameKernel: GameKernel,
): CompletedGameResultsRound[] {
  const roundNumbers = [...new Set(events.map((event) => event.round).filter((round) => round > 0))]
    .sort((left, right) => left - right);
  const endgameByRound = groupEndgameEliminations(events, projection);
  return roundNumbers.map((round) => {
    const canonicalFacts = buildRevealedRoundFacts({
      events,
      round,
      eventLogStatus,
      projectionStatus,
      kernel: gameKernel,
    });
    const formatRecap = gameKernel === "format"
      ? buildFormatRecap(canonicalFacts, projection)
      : null;
    return {
      round,
      canonicalFacts,
      endgameEliminations: endgameByRound.get(round) ?? [],
      ...(formatRecap ? { formatRecap } : {}),
    };
  });
}

function buildFormatRecap(
  canonicalFacts: RevealedRoundFactsRead,
  projection: CanonicalGameProjection,
): CompletedGameResultsFormatRecap | null {
  const format = canonicalFacts.roundFacts.format;
  if (format.status !== "available") return null;

  const resolutionTrusted =
    format.ballotPresentation.status === "revealed"
    || format.ballotPresentation.status === "not_applicable";
  const scoring = resolutionTrusted
    ? buildFormatScoring(format, projection)
    : null;
  const hasCompleteResolution =
    format.selectedFormatId !== null
    && format.eliminated !== null
    && scoring !== null
    && resolutionTrusted;

  return {
    status: hasCompleteResolution ? "available" : "incomplete",
    offeredFormatIds: format.offeredFormatIds
      ? [format.offeredFormatIds[0], format.offeredFormatIds[1]]
      : null,
    selectedFormatId: format.selectedFormatId,
    resolutionKind: resolutionTrusted ? format.resolutionKind : null,
    eliminated: resolutionTrusted ? format.eliminated : null,
    tied: resolutionTrusted ? [...format.tied] : [],
    tiebreaker: resolutionTrusted ? format.tiebreaker : null,
    scoring,
    ballotPresentation: {
      status: format.ballotPresentation.status,
      rollCall: format.ballotPresentation.rollCall.map((entry) => ({
        voter: { ...entry.voter },
        target: { ...entry.target },
        polarity: entry.polarity,
      })),
    },
    safetyBounce: format.safetyBounce
      ? {
          starter: format.safetyBounce.starter
            ? { ...format.safetyBounce.starter }
            : null,
          pointers: format.safetyBounce.pointers.map((pointer) => ({
            actor: { ...pointer.actor },
            target: { ...pointer.target },
            classification: pointer.classification,
          })),
          safe: format.safetyBounce.safe.map((player) => ({ ...player })),
          vulnerable: format.safetyBounce.vulnerable.map((player) => ({
            ...player,
          })),
        }
      : null,
  };
}

function buildFormatScoring(
  format: RevealedRoundFactsRead["roundFacts"]["format"],
  projection: CanonicalGameProjection,
): CompletedGameResultsFormatScoring | null {
  if (format.selectedFormatId === "save_or_eliminate" && format.saveOrEliminate) {
    const netsByPlayer = voteCountMap(format.saveOrEliminate.nets);
    const savesByPlayer = voteCountMap(format.saveOrEliminate.savesReceived);
    const eliminatesByPlayer = voteCountMap(
      format.saveOrEliminate.eliminateReceived,
    );
    if (
      !sameMapKeys(netsByPlayer, savesByPlayer)
      || !sameMapKeys(netsByPlayer, eliminatesByPlayer)
    ) {
      return null;
    }
    return {
      kind: "save_or_eliminate",
      rows: projection.playerOrder.flatMap((playerId) => {
        const net = netsByPlayer.get(playerId);
        const savesReceived = savesByPlayer.get(playerId);
        const eliminateReceived = eliminatesByPlayer.get(playerId);
        return net === undefined
          || savesReceived === undefined
          || eliminateReceived === undefined
          ? []
          : [{
              player: playerRef(projection, playerId),
              savesReceived,
              eliminateReceived,
              net,
            }];
      }),
    };
  }
  if (format.selectedFormatId === "vote_bomb" && format.voteBomb) {
    const zeroSafeIds = new Set(format.voteBomb.zeroSafe.map((player) => player.id));
    const totalsByPlayer = voteCountMap(format.voteBomb.totals);
    return {
      kind: "vote_bomb",
      rows: projection.playerOrder.flatMap((playerId) => {
        const votes = totalsByPlayer.get(playerId);
        return votes === undefined
          ? []
          : [{
              player: playerRef(projection, playerId),
              votes,
              zeroSafe: zeroSafeIds.has(playerId),
            }];
      }),
    };
  }
  if (
    format.selectedFormatId === "majority_elimination"
    && format.majorityElimination
  ) {
    const totalsByPlayer = voteCountMap(format.majorityElimination.totals);
    return {
      kind: "majority_elimination",
      rows: projection.playerOrder.flatMap((playerId) => {
        const votes = totalsByPlayer.get(playerId);
        return votes === undefined
          ? []
          : [{ player: playerRef(projection, playerId), votes }];
      }),
    };
  }
  if (format.selectedFormatId === "safety_bounce" && format.safetyBounce) {
    const totalsByPlayer = voteCountMap(format.safetyBounce.voteTotals);
    return {
      kind: "safety_bounce",
      rows: projection.playerOrder.flatMap((playerId) => {
        const votes = totalsByPlayer.get(playerId);
        return votes === undefined
          ? []
          : [{ player: playerRef(projection, playerId), votes }];
      }),
    };
  }
  return null;
}

function voteCountMap(
  counts: readonly { player: RevealedPlayerRef; votes: number }[],
): ReadonlyMap<UUID, number> {
  return new Map(counts.map((entry) => [entry.player.id, entry.votes]));
}

function sameMapKeys(
  left: ReadonlyMap<UUID, number>,
  right: ReadonlyMap<UUID, number>,
): boolean {
  return left.size === right.size
    && [...left.keys()].every((key) => right.has(key));
}

function buildEliminationOrder(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  winnerEvent: EventOf<"jury.winner_determined"> | null,
): CompletedGameResultsElimination[] {
  const resolvedByPlayer = new Map<
    UUID,
    { source: "council" | "format" | "endgame" | "jury"; method: string | null }
  >();
  for (const event of events) {
    if (event.type === "council.elimination_resolved") {
      resolvedByPlayer.set(event.payload.eliminated, { source: "council", method: event.payload.method });
    }
    if (event.type === "format.resolved" && event.payload.eliminatedId) {
      const kind = event.payload.resolutionKind ?? "resolved";
      const method = `${event.payload.formatId}:${kind}`;
      resolvedByPlayer.set(event.payload.eliminatedId, { source: "format", method });
    }
    if (event.type === "endgame.elimination_resolved") {
      resolvedByPlayer.set(event.payload.eliminated, { source: "endgame", method: event.payload.method });
    }
  }
  if (winnerEvent) {
    for (const voteCount of winnerEvent.payload.voteCounts) {
      if (voteCount.id !== winnerEvent.payload.winnerId) {
        resolvedByPlayer.set(voteCount.id, { source: "jury", method: winnerEvent.payload.method });
      }
    }
  }

  return events
    .filter((event): event is EventOf<"player.eliminated"> => event.type === "player.eliminated")
    .map((event) => {
      const resolved = resolvedByPlayer.get(event.payload.playerId);
      return {
        player: playerRef(projection, event.payload.playerId),
        round: event.payload.eliminatedRound,
        source: resolved?.source ?? "player_eliminated",
        method: resolved?.method ?? null,
        juryMember: Boolean(event.payload.juryMember),
      };
    });
}

function groupEndgameEliminations(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
): Map<number, CompletedGameResultsEndgameElimination[]> {
  const byRound = new Map<number, CompletedGameResultsEndgameElimination[]>();
  for (const event of events) {
    if (event.type !== "endgame.elimination_resolved") continue;
    const entries = byRound.get(event.round) ?? [];
    entries.push({
      round: event.round,
      stage: event.payload.stage,
      ledger: sortVoteRecord(event.payload.tally.votes, projection).map(([voter, target]) => ({
        voter: playerRef(projection, voter),
        target: playerRef(projection, target),
      })),
      juryTiebreakerLedger: sortVoteRecord(event.payload.juryTiebreakerVotes ?? {}, projection).map(([voter, target]) => ({
        voter: playerRef(projection, voter),
        target: playerRef(projection, target),
      })),
      eliminated: playerRef(projection, event.payload.eliminated),
      method: event.payload.method,
    });
    byRound.set(event.round, entries);
  }
  return byRound;
}

function buildJury(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  winnerEvent: EventOf<"jury.winner_determined"> | null,
  finalists: RevealedPlayerRef[],
): CompletedGameResultsJury {
  if (!winnerEvent) return { ...emptyJury(), finalists };
  return {
    status: "available",
    finalists,
    ledger: sortVoteRecord(winnerEvent.payload.tally.votes, projection).map(([juror, finalist]) => ({
      juror: playerRef(projection, juror),
      finalist: playerRef(projection, finalist),
    })),
    voteCounts: winnerEvent.payload.voteCounts.map((entry) => ({
      finalist: playerRef(projection, entry.id),
      votes: entry.votes,
    })),
    winner: playerRef(projection, winnerEvent.payload.winnerId),
    method: winnerEvent.payload.method,
  };
}

function buildPlayers(
  projection: CanonicalGameProjection,
  winnerId: UUID | null,
  finalists: readonly RevealedPlayerRef[],
  eliminationOrder: readonly CompletedGameResultsElimination[],
): CompletedGameResultsPlayer[] {
  const eliminatedPlacement = new Map<UUID, number>();
  const totalPlayers = projection.playerOrder.length;
  eliminationOrder.forEach((entry, index) => {
    eliminatedPlacement.set(entry.player.id, Math.max(1, totalPlayers - index));
  });
  const finalistIds = new Set(finalists.map((player) => player.id));

  return projection.playerOrder.map((id) => {
    const isWinner = id === winnerId;
    const isFinalist = finalistIds.has(id);
    const placement = isWinner ? 1 : eliminatedPlacement.get(id) ?? (isFinalist ? 2 : null);
    return {
      ...playerRef(projection, id),
      placement,
      status: isWinner
        ? "winner"
        : isFinalist
          ? "finalist"
          : eliminatedPlacement.has(id)
            ? "eliminated"
            : "unknown",
    };
  });
}

function buildVotePatterns(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
): CompletedGameResultsVotePattern[] {
  const signatures = new Map<UUID, string[]>();
  for (const playerId of projection.playerOrder) signatures.set(playerId, []);

  for (const event of events) {
    if (event.type === "vote.cast") {
      signatures.get(event.payload.voterId)?.push(`r${event.round}:empower=${event.payload.empowerTarget};expose=${event.payload.exposeTarget}`);
    }
    if (event.type === "vote.empower_revote_cast") {
      signatures.get(event.payload.voterId)?.push(`r${event.round}:revote=${event.payload.target}`);
    }
    if (event.type === "council.vote_cast") {
      signatures.get(event.payload.voterId)?.push(`r${event.round}:council=${event.payload.target}`);
    }
    if (event.type === "endgame.elimination_vote_cast") {
      signatures.get(event.payload.voterId)?.push(`r${event.round}:endgame=${event.payload.target}`);
    }
    if (event.type === "jury.vote_cast") {
      signatures.get(event.payload.jurorId)?.push(`r${event.round}:jury=${event.payload.finalistId}`);
    }
    if (event.type === "format.ballot_cast") {
      const polarity = event.payload.polarity
        ? `${event.payload.polarity}:`
        : "";
      signatures.get(event.payload.voterId)?.push(
        `r${event.round}:format=${event.payload.formatId}:${polarity}${event.payload.targetId}`,
      );
    }
  }

  return projection.playerOrder.map((playerId) => {
    const signature = signatures.get(playerId)?.join("|") ?? "";
    return {
      player: playerRef(projection, playerId),
      signature,
      groupKey: signature || `no-votes:${playerId}`,
    };
  });
}

function finalistsFor(
  projection: CanonicalGameProjection,
  winnerEvent: EventOf<"jury.winner_determined"> | null,
): RevealedPlayerRef[] {
  const finalistIds = winnerEvent
    ? winnerEvent.payload.voteCounts.map((entry) => entry.id)
    : projection.playerOrder.filter((id) => projection.players[id]?.status !== "eliminated");
  return finalistIds.map((id) => playerRef(projection, id));
}

function latestRound(events: readonly CanonicalGameEvent[]): number {
  return Math.max(0, ...events.map((event) => event.round));
}

function latestEvent<TType extends CanonicalGameEvent["type"]>(
  events: readonly CanonicalGameEvent[],
  type: TType,
): EventOf<TType> | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type === type) return event as EventOf<TType>;
  }
  return null;
}

function playerRef(projection: CanonicalGameProjection, id: UUID): RevealedPlayerRef {
  return {
    id,
    name: projection.players[id]?.name ?? id,
  };
}

function refOrNull(projection: CanonicalGameProjection, id: UUID | null | undefined): RevealedPlayerRef | null {
  return id ? playerRef(projection, id) : null;
}

function sortVoteRecord(votes: Record<UUID, UUID>, projection: CanonicalGameProjection): Array<[UUID, UUID]> {
  return Object.entries(votes).sort(([left], [right]) => {
    const leftIndex = playerOrderIndex(projection, left);
    const rightIndex = playerOrderIndex(projection, right);
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.localeCompare(right);
  });
}

function playerOrderIndex(projection: CanonicalGameProjection, id: UUID): number {
  const index = projection.playerOrder.indexOf(id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function emptyJury(): CompletedGameResultsJury {
  return {
    status: "unavailable",
    finalists: [],
    ledger: [],
    voteCounts: [],
    winner: null,
    method: null,
  };
}
