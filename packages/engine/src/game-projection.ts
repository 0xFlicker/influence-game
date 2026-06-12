import type { CanonicalGameEvent } from "./canonical-events";
import type {
  CouncilVoteTally,
  EndgameEliminationTally,
  EndgameStage,
  JuryMember,
  JuryVoteTally,
  Phase,
  PlayerStatus,
  PowerAction,
  RoomAllocation,
  RoundResult,
  UUID,
  VoteTally,
} from "./types";

export interface ProjectedPlayer {
  id: UUID;
  name: string;
  status: PlayerStatus;
  shielded: boolean;
  lastMessage?: string;
}

export interface ProjectedRoomAllocation {
  rooms: RoomAllocation[];
  excluded: UUID[];
  lastSessionExcluded: UUID[];
}

export interface CanonicalGameProjection {
  gameId: UUID;
  lastSequence: number;
  round: number;
  phase: Phase | null;
  playerOrder: UUID[];
  players: Record<UUID, ProjectedPlayer>;
  currentVoteTally: VoteTally;
  currentCouncilTally: CouncilVoteTally;
  empoweredId: UUID | null;
  councilCandidates: [UUID, UUID] | null;
  powerAction: PowerAction | null;
  roomAllocations: Record<number, ProjectedRoomAllocation>;
  jury: JuryMember[];
  endgameStage: EndgameStage | null;
  cumulativeEmpowerVotes: Record<UUID, number>;
  endgameEliminationTally: EndgameEliminationTally;
  juryVoteTally: JuryVoteTally;
  lastEmpoweredFromRegularRounds: UUID | null;
  roundResults: RoundResult[];
  acceptedOutcomes: {
    councilEliminations: Array<{ round: number; eliminated: UUID; method: string }>;
    endgameEliminations: Array<{ round: number; eliminated: UUID; method: string }>;
    juryWinner: { winnerId: UUID; method: string } | null;
  };
}

export function createEmptyProjection(gameId: UUID): CanonicalGameProjection {
  return {
    gameId,
    lastSequence: 0,
    round: 0,
    phase: null,
    playerOrder: [],
    players: {},
    currentVoteTally: { empowerVotes: {}, exposeVotes: {} },
    currentCouncilTally: { votes: {} },
    empoweredId: null,
    councilCandidates: null,
    powerAction: null,
    roomAllocations: {},
    jury: [],
    endgameStage: null,
    cumulativeEmpowerVotes: {},
    endgameEliminationTally: { votes: {} },
    juryVoteTally: { votes: {} },
    lastEmpoweredFromRegularRounds: null,
    roundResults: [],
    acceptedOutcomes: {
      councilEliminations: [],
      endgameEliminations: [],
      juryWinner: null,
    },
  };
}

function cloneVoteTally(tally: VoteTally): VoteTally {
  return {
    empowerVotes: { ...tally.empowerVotes },
    exposeVotes: { ...tally.exposeVotes },
  };
}

function cloneCouncilTally(tally: CouncilVoteTally): CouncilVoteTally {
  return { votes: { ...tally.votes } };
}

function cloneEndgameTally(tally: EndgameEliminationTally): EndgameEliminationTally {
  return { votes: { ...tally.votes } };
}

function cloneJuryTally(tally: JuryVoteTally): JuryVoteTally {
  return { votes: { ...tally.votes } };
}

function applyRoundReset(projection: CanonicalGameProjection, round: number): void {
  projection.round = round;
  projection.currentVoteTally = { empowerVotes: {}, exposeVotes: {} };
  projection.currentCouncilTally = { votes: {} };
  projection.empoweredId = null;
  projection.councilCandidates = null;
  projection.powerAction = null;
  projection.endgameEliminationTally = { votes: {} };
  projection.juryVoteTally = { votes: {} };
}

export function applyCanonicalEvent(
  projection: CanonicalGameProjection,
  event: CanonicalGameEvent,
): CanonicalGameProjection {
  if (event.payloadVersion !== 1) {
    throw new Error(`Unsupported canonical event payload version ${event.payloadVersion} for ${event.type}`);
  }
  if (projection.gameId !== event.gameId) {
    throw new Error(`Cannot apply event for game ${event.gameId} to projection ${projection.gameId}`);
  }
  const expectedSequence = projection.lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new Error(`Canonical events must be contiguous and ordered; expected ${expectedSequence} but got ${event.sequence}`);
  }

  projection.lastSequence = event.sequence;
  projection.phase = event.phase;

  switch (event.type) {
    case "game.roster_initialized": {
      projection.playerOrder = event.payload.players.map((player) => player.id);
      projection.players = Object.fromEntries(
        event.payload.players.map((player) => [player.id, { ...player }]),
      );
      for (const player of event.payload.players) {
        projection.cumulativeEmpowerVotes[player.id] = 0;
      }
      break;
    }
    case "round.started": {
      applyRoundReset(projection, event.payload.round);
      break;
    }
    case "shields.expired": {
      for (const playerId of event.payload.expiredPlayerIds) {
        const player = projection.players[playerId];
        if (player) projection.players[playerId] = { ...player, shielded: false };
      }
      break;
    }
    case "mingle.rooms_allocated": {
      projection.roomAllocations[event.payload.round] = {
        rooms: event.payload.rooms.map((room) => ({ ...room, playerIds: [...room.playerIds] })),
        excluded: [...event.payload.excluded],
        lastSessionExcluded: [...event.payload.lastSessionExcluded],
      };
      break;
    }
    case "vote.cast": {
      projection.currentVoteTally.empowerVotes[event.payload.voterId] = event.payload.empowerTarget;
      projection.currentVoteTally.exposeVotes[event.payload.voterId] = event.payload.exposeTarget;
      break;
    }
    case "vote.empower_vote_cleared": {
      delete projection.currentVoteTally.empowerVotes[event.payload.voterId];
      break;
    }
    case "vote.empower_revote_cast": {
      projection.currentVoteTally.empowerVotes[event.payload.voterId] = event.payload.target;
      break;
    }
    case "vote.empower_tally_resolved": {
      projection.cumulativeEmpowerVotes = { ...event.payload.cumulativeEmpowerVotes };
      if (event.payload.tied === null) {
        projection.empoweredId = event.payload.empowered;
      }
      break;
    }
    case "vote.empowered_set": {
      projection.empoweredId = event.payload.empowered;
      break;
    }
    case "power.action_set": {
      projection.powerAction = { ...event.payload.action };
      break;
    }
    case "power.candidates_resolved": {
      projection.councilCandidates = event.payload.candidates ? [...event.payload.candidates] : null;
      if (event.payload.shieldGranted) {
        const player = projection.players[event.payload.shieldGranted];
        if (player) projection.players[event.payload.shieldGranted] = { ...player, shielded: true };
      }
      break;
    }
    case "council.vote_cast": {
      projection.currentCouncilTally.votes[event.payload.voterId] = event.payload.target;
      break;
    }
    case "council.elimination_resolved": {
      projection.acceptedOutcomes.councilEliminations.push({
        round: event.round,
        eliminated: event.payload.eliminated,
        method: event.payload.method,
      });
      break;
    }
    case "player.last_message_recorded": {
      const player = projection.players[event.payload.playerId];
      if (player) projection.players[event.payload.playerId] = { ...player, lastMessage: event.payload.message };
      break;
    }
    case "player.eliminated": {
      const player = projection.players[event.payload.playerId];
      if (player) {
        projection.players[event.payload.playerId] = { ...player, status: "eliminated" as PlayerStatus };
      }
      if (!projection.jury.some((juror) => juror.playerId === event.payload.juryMember.playerId)) {
        projection.jury.push({ ...event.payload.juryMember });
      }
      break;
    }
    case "endgame.stage_set": {
      projection.endgameStage = event.payload.stage;
      projection.lastEmpoweredFromRegularRounds = event.payload.lastEmpoweredFromRegularRounds;
      break;
    }
    case "endgame.elimination_vote_cast": {
      projection.endgameEliminationTally.votes[event.payload.voterId] = event.payload.target;
      break;
    }
    case "endgame.elimination_resolved": {
      projection.endgameEliminationTally = cloneEndgameTally(event.payload.tally);
      projection.acceptedOutcomes.endgameEliminations.push({
        round: event.round,
        eliminated: event.payload.eliminated,
        method: event.payload.method,
      });
      break;
    }
    case "jury.vote_cast": {
      projection.juryVoteTally.votes[event.payload.jurorId] = event.payload.finalistId;
      break;
    }
    case "jury.winner_determined": {
      projection.juryVoteTally = cloneJuryTally(event.payload.tally);
      projection.acceptedOutcomes.juryWinner = {
        winnerId: event.payload.winnerId,
        method: event.payload.method,
      };
      break;
    }
    case "round.result_recorded": {
      projection.roundResults.push({ ...event.payload.result });
      break;
    }
    default: {
      const unsupported = event as { type?: unknown };
      throw new Error(`Unsupported canonical event type ${String(unsupported.type)}`);
    }
  }

  projection.currentVoteTally = cloneVoteTally(projection.currentVoteTally);
  projection.currentCouncilTally = cloneCouncilTally(projection.currentCouncilTally);
  return projection;
}

export function replayCanonicalEvents(events: readonly CanonicalGameEvent[]): CanonicalGameProjection {
  const first = events[0];
  if (!first) {
    throw new Error("Cannot replay an empty canonical event log");
  }

  const projection = createEmptyProjection(first.gameId);
  for (const event of events) {
    applyCanonicalEvent(projection, event);
  }
  return projection;
}
