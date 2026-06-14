import {
  applyCanonicalEvent,
  type CanonicalGameProjection,
  createEmptyProjection,
} from "@influence/engine";
import type {
  PersistedEventDiagnostic,
  PersistedGameEventsRead,
} from "./game-event-read-model.js";

export type ProjectionReplayStatus = "empty" | "complete" | "incomplete" | "failed";

export interface ProjectionReplayDiagnostic {
  code: "projection_replay_failed";
  severity: "error";
  message: string;
  sequence?: number;
}

export interface DurablePlayerStatusSummary {
  totalCount: number;
  aliveCount: number;
  eliminatedCount: number;
  aliveIds: string[];
  eliminatedIds: string[];
  aliveNames: string[];
  eliminatedNames: string[];
}

export interface DurableVoteStateSummary {
  empowerVotes: Record<string, string>;
  exposeVotes: Record<string, string>;
  councilVotes: Record<string, string>;
  endgameEliminationVotes: Record<string, string>;
  juryVotes: Record<string, string>;
  empoweredId: string | null;
  empoweredName: string | null;
  councilCandidates: [string, string] | null;
  councilCandidateNames: [string, string] | null;
  powerAction: CanonicalGameProjection["powerAction"];
}

export interface DurableProjectionSummary {
  gameId: string;
  lastSequence: number;
  round: number;
  phase: CanonicalGameProjection["phase"];
  players: DurablePlayerStatusSummary;
  voteState: DurableVoteStateSummary;
  acceptedOutcomes: CanonicalGameProjection["acceptedOutcomes"];
  winner: {
    id: string;
    name: string;
    method: string;
  } | null;
}

export interface PersistedGameProjectionRead {
  status: ProjectionReplayStatus;
  summary: DurableProjectionSummary | null;
  replayedEventCount: number;
  diagnostics: Array<PersistedEventDiagnostic | ProjectionReplayDiagnostic>;
}

function nameFor(projection: CanonicalGameProjection, playerId: string | null): string | null {
  if (!playerId) return null;
  return projection.players[playerId]?.name ?? playerId;
}

function summarizePlayers(projection: CanonicalGameProjection): DurablePlayerStatusSummary {
  const players = Object.values(projection.players);
  const alive = players.filter((player) => player.status !== "eliminated");
  const eliminated = players.filter((player) => player.status === "eliminated");

  return {
    totalCount: players.length,
    aliveCount: alive.length,
    eliminatedCount: eliminated.length,
    aliveIds: alive.map((player) => player.id),
    eliminatedIds: eliminated.map((player) => player.id),
    aliveNames: alive.map((player) => player.name),
    eliminatedNames: eliminated.map((player) => player.name),
  };
}

export function summarizeCanonicalProjection(
  projection: CanonicalGameProjection,
): DurableProjectionSummary {
  const councilCandidates = projection.councilCandidates
    ? [projection.councilCandidates[0], projection.councilCandidates[1]] satisfies [string, string]
    : null;
  const councilCandidateNames = councilCandidates
    ? [
        nameFor(projection, councilCandidates[0]) ?? councilCandidates[0],
        nameFor(projection, councilCandidates[1]) ?? councilCandidates[1],
      ] satisfies [string, string]
    : null;
  const winnerId = projection.acceptedOutcomes.juryWinner?.winnerId ?? null;

  return {
    gameId: projection.gameId,
    lastSequence: projection.lastSequence,
    round: projection.round,
    phase: projection.phase,
    players: summarizePlayers(projection),
    voteState: {
      empowerVotes: { ...projection.currentVoteTally.empowerVotes },
      exposeVotes: { ...projection.currentVoteTally.exposeVotes },
      councilVotes: { ...projection.currentCouncilTally.votes },
      endgameEliminationVotes: { ...projection.endgameEliminationTally.votes },
      juryVotes: { ...projection.juryVoteTally.votes },
      empoweredId: projection.empoweredId,
      empoweredName: nameFor(projection, projection.empoweredId),
      councilCandidates,
      councilCandidateNames,
      powerAction: projection.powerAction ? { ...projection.powerAction } : null,
    },
    acceptedOutcomes: {
      councilEliminations: projection.acceptedOutcomes.councilEliminations.map((outcome) => ({ ...outcome })),
      endgameEliminations: projection.acceptedOutcomes.endgameEliminations.map((outcome) => ({ ...outcome })),
      juryWinner: projection.acceptedOutcomes.juryWinner
        ? { ...projection.acceptedOutcomes.juryWinner }
        : null,
    },
    winner: winnerId
      ? {
          id: winnerId,
          name: nameFor(projection, winnerId) ?? winnerId,
          method: projection.acceptedOutcomes.juryWinner?.method ?? "unknown",
        }
      : null,
  };
}

export function getPersistedGameProjection(
  persistedEvents: PersistedGameEventsRead,
): PersistedGameProjectionRead {
  const diagnostics: Array<PersistedEventDiagnostic | ProjectionReplayDiagnostic> = [
    ...persistedEvents.diagnostics,
  ];

  if (persistedEvents.status === "empty") {
    return {
      status: "empty",
      summary: null,
      replayedEventCount: 0,
      diagnostics,
    };
  }

  if (persistedEvents.events.length === 0) {
    return {
      status: "failed",
      summary: null,
      replayedEventCount: 0,
      diagnostics,
    };
  }

  let projection = createEmptyProjection(persistedEvents.gameId);
  let replayedEventCount = 0;

  try {
    for (const event of persistedEvents.events) {
      projection = applyCanonicalEvent(projection, event.envelope);
      replayedEventCount += 1;
    }
    return {
      status: persistedEvents.status === "complete" ? "complete" : "incomplete",
      summary: summarizeCanonicalProjection(projection),
      replayedEventCount,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push({
      code: "projection_replay_failed",
      severity: "error",
      message,
      sequence: persistedEvents.events[replayedEventCount]?.sequence,
    });
    return {
      status: "failed",
      summary: null,
      replayedEventCount,
      diagnostics,
    };
  }
}
