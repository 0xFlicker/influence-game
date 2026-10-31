import { resolveEmpowerRevoteVersion, type EmpowerRevoteVersion } from "./empower-revote-rules";
import { resolveInfluenceGameSchemaVersion, type InfluenceGameSchemaVersion } from "./influence-game-schema";
import {
  decodeLegacyAllianceHuddleOutcomeV1,
  withParticipantSnapshotFromSession,
} from "./alliance-huddle-outcome";
import { assertCanonicalGameEvent, isSupportedCanonicalPayloadVersion, type CanonicalGameEvent } from "./canonical-events";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { applyRetrospectiveRecord, type RetrospectiveOutcomeSource, type RetrospectiveStateV1 } from "./retrospective";
import {
  LEGACY_FORMAT_MANIFEST,
  resolveFormatManifest,
  type LaunchFormatId,
} from "./formats";
import type {
  AllianceHuddleOutcome,
  AllianceHuddleScheduleRecord,
  AllianceHuddleSessionRecord,
  AllianceProposalLineage,
  AllianceRecord,
  CouncilVoteTally,
  EndgameEliminationTally,
  EndgameStage,
  JuryMember,
  JuryVoteTally,
  Phase,
  PlayerStatus,
  PowerAction,
  RoomAllocation,
  MingleCoordinationReceiptRecord,
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
  retrospectiveOutcomeSource: RetrospectiveOutcomeSource | null;
  retrospective: RetrospectiveStateV1 | null;
  gameId: UUID;
  lastSequence: number;
  round: number;
  phase: Phase | null;
  playerOrder: UUID[];
  players: Record<UUID, ProjectedPlayer>;
  formatManifest: LaunchFormatId[];
  empowerRevoteVersion: EmpowerRevoteVersion;
  gameSchemaVersion?: InfluenceGameSchemaVersion;
  currentVoteTally: VoteTally;
  currentCouncilTally: CouncilVoteTally;
  empoweredId: UUID | null;
  selectedFormatId: LaunchFormatId | null;
  formatMenu: {
    empoweredId: UUID;
    offeredFormatIds: [LaunchFormatId, LaunchFormatId];
    selectedFormatId: LaunchFormatId | null;
  } | null;
  councilCandidates: [UUID, UUID] | null;
  candidateResolution: {
    exposeScores: Record<UUID, number>;
    candidates: [UUID, UUID] | null;
    autoEliminated: UUID | null;
    shieldGranted: UUID | null;
    method: "two_player" | "auto_eliminate" | "expose_scores" | "exposure_bench" | "exposure_bench_protect" | "insufficient_candidates";
    initialResolution?: Record<string, unknown>;
    shieldReplacement?: Record<string, unknown>;
  } | null;
  powerAction: PowerAction | null;
  roomAllocations: Record<number, ProjectedRoomAllocation>;
  mingleCoordinationReceipts: Record<UUID, MingleCoordinationReceiptRecord>;
  allianceOrder: UUID[];
  alliances: Record<UUID, AllianceRecord>;
  allianceProposalLineageOrder: UUID[];
  allianceProposalLineages: Record<UUID, AllianceProposalLineage>;
  allianceHuddleSchedules: AllianceHuddleScheduleRecord[];
  allianceHuddleSessions: Record<UUID, AllianceHuddleSessionRecord>;
  allianceHuddleOutcomes: Record<UUID, AllianceHuddleOutcome>;
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
    retrospectiveOutcomeSource: null,
    retrospective: null,
    gameId,
    lastSequence: 0,
    round: 0,
    phase: null,
    playerOrder: [],
    players: {},
    formatManifest: [...LEGACY_FORMAT_MANIFEST],
    empowerRevoteVersion: 1,
    currentVoteTally: { empowerVotes: {}, exposeVotes: {} },
    currentCouncilTally: { votes: {} },
    empoweredId: null,
    selectedFormatId: null,
    formatMenu: null,
    councilCandidates: null,
    candidateResolution: null,
    powerAction: null,
    roomAllocations: {},
    mingleCoordinationReceipts: {},
    allianceOrder: [],
    alliances: {},
    allianceProposalLineageOrder: [],
    allianceProposalLineages: {},
    allianceHuddleSchedules: [],
    allianceHuddleSessions: {},
    allianceHuddleOutcomes: {},
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

function cloneAllianceRecord(alliance: AllianceRecord): AllianceRecord {
  return structuredClone(alliance) as AllianceRecord;
}

function cloneAllianceProposalLineage(lineage: AllianceProposalLineage): AllianceProposalLineage {
  return structuredClone(lineage) as AllianceProposalLineage;
}

function cloneAllianceHuddleSchedule(schedule: AllianceHuddleScheduleRecord): AllianceHuddleScheduleRecord {
  return structuredClone(schedule) as AllianceHuddleScheduleRecord;
}

function cloneMingleCoordinationReceipt(receipt: MingleCoordinationReceiptRecord): MingleCoordinationReceiptRecord {
  return { ...receipt, audiencePlayerIds: [...receipt.audiencePlayerIds] };
}

function cloneAllianceHuddleSession(session: AllianceHuddleSessionRecord): AllianceHuddleSessionRecord {
  return structuredClone(session) as AllianceHuddleSessionRecord;
}

function cloneAllianceHuddleOutcome(outcome: AllianceHuddleOutcome): AllianceHuddleOutcome {
  return structuredClone(outcome) as AllianceHuddleOutcome;
}

function upsertAllianceProjection(projection: CanonicalGameProjection, alliance: AllianceRecord): void {
  if (!projection.alliances[alliance.id]) {
    projection.allianceOrder.push(alliance.id);
  }
  projection.alliances[alliance.id] = cloneAllianceRecord(alliance);
}

function upsertAllianceLineageProjection(projection: CanonicalGameProjection, lineage: AllianceProposalLineage): void {
  if (!projection.allianceProposalLineages[lineage.id]) {
    projection.allianceProposalLineageOrder.push(lineage.id);
  }
  projection.allianceProposalLineages[lineage.id] = cloneAllianceProposalLineage(lineage);
}

function applyRoundReset(projection: CanonicalGameProjection, round: number): void {
  projection.round = round;
  projection.currentVoteTally = { empowerVotes: {}, exposeVotes: {} };
  projection.currentCouncilTally = { votes: {} };
  projection.empoweredId = null;
  projection.selectedFormatId = null;
  projection.formatMenu = null;
  projection.councilCandidates = null;
  projection.candidateResolution = null;
  projection.powerAction = null;
  projection.endgameEliminationTally = { votes: {} };
  projection.juryVoteTally = { votes: {} };
}

export function applyCanonicalEvent(
  projection: CanonicalGameProjection,
  event: CanonicalGameEvent,
): CanonicalGameProjection {
  if (!isSupportedCanonicalPayloadVersion(event.type, event.payloadVersion)) {
    throw new Error(`Unsupported canonical event payload version ${event.payloadVersion} for ${event.type}`);
  }
  assertCanonicalGameEvent(event);
  if (projection.gameId !== event.gameId) {
    throw new Error(`Cannot apply event for game ${event.gameId} to projection ${projection.gameId}`);
  }
  const expectedSequence = projection.lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new Error(`Canonical events must be contiguous and ordered; expected ${expectedSequence} but got ${event.sequence}`);
  }

  const boundary = { outcome: projection.retrospectiveOutcomeSource, rosterIds: projection.playerOrder, eventSequence: event.sequence };
  let retrospective = projection.retrospective;
  switch (event.type) {
    case "retrospective.started": retrospective = applyRetrospectiveRecord(retrospective, { kind: "started", payload: event.payload }, boundary); break;
    case "retrospective.statement_recorded": retrospective = applyRetrospectiveRecord(retrospective, { kind: "statement", payload: event.payload }, boundary); break;
    case "retrospective.completed": retrospective = applyRetrospectiveRecord(retrospective, { kind: "completed", payload: event.payload }, boundary); break;
    default:
      if (retrospective && event.type !== "visual.operation_recorded" && event.type !== "visual.cue_recorded"
        && !(event.type === "game.phase_entered" && (event.payload.phase === "RETROSPECTIVE"
          || retrospective.completedAtEventSequence !== null && event.payload.phase === "END"))) {
        throw new Error("Gameplay cannot resume after retrospective initialization");
      }
  }
  projection.retrospective = retrospective;
  projection.lastSequence = event.sequence;
  projection.phase = event.phase;

  switch (event.type) {
    case "game.phase_entered": {
      break;
    }
    case "game.roster_initialized": {
      projection.empowerRevoteVersion = resolveEmpowerRevoteVersion(event.payload.empowerRevoteVersion);
      // Historical checkpoint hashes include this exact projection document.
      // An absent root field must stay absent when replaying old events.
      if (event.payload.gameSchemaVersion !== undefined) projection.gameSchemaVersion = resolveInfluenceGameSchemaVersion(event.payload.gameSchemaVersion);
      projection.formatManifest = event.payload.formatManifest === undefined
        ? [...LEGACY_FORMAT_MANIFEST]
        : resolveFormatManifest(event.payload.formatManifest);
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
    case "mingle.coordination_receipt_recorded": {
      projection.mingleCoordinationReceipts[event.payload.receipt.id] = cloneMingleCoordinationReceipt(event.payload.receipt);
      break;
    }
    case "vote.cast": {
      projection.currentVoteTally.empowerVotes[event.payload.voterId] = event.payload.empowerTarget;
      if (event.payload.exposeTarget) {
        projection.currentVoteTally.exposeVotes[event.payload.voterId] = event.payload.exposeTarget;
      } else {
        delete projection.currentVoteTally.exposeVotes[event.payload.voterId];
      }
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
    case "format.menu_offered": {
      projection.formatMenu = {
        empoweredId: event.payload.empoweredId,
        offeredFormatIds: [event.payload.offeredFormatIds[0], event.payload.offeredFormatIds[1]],
        selectedFormatId: null,
      };
      break;
    }
    case "format.selected": {
      projection.selectedFormatId = event.payload.formatId;
      if (projection.formatMenu) {
        projection.formatMenu = { ...projection.formatMenu, selectedFormatId: event.payload.formatId };
      }
      break;
    }
    case "format.ballot_cast":
    case "format.ballot_forfeited":
    case "format.two_names_setup":
    case "format.two_names_mingle_completed":
    case "format.two_names_override_declined":
    case "format.two_names_override_used":
    case "format.two_names_replacement_named":
    case "format.two_names_plea_recorded":
    case "format.safety_bounce_started":
    case "format.safety_bounce_pointer":
    case "format.resolved": {
      // Public bounce/resolution facts are read from the event log / round facts;
      // projection keeps only the live format menu + selected format for MCP.
      break;
    }
    case "power.action_set": {
      projection.powerAction = { ...event.payload.action };
      break;
    }
    case "power.candidates_resolved": {
      projection.councilCandidates = event.payload.candidates ? [...event.payload.candidates] : null;
      projection.candidateResolution = {
        exposeScores: { ...event.payload.exposeScores },
        candidates: event.payload.candidates ? [...event.payload.candidates] : null,
        autoEliminated: event.payload.autoEliminated,
        shieldGranted: event.payload.shieldGranted,
        method: event.payload.method,
        ...(event.payload.initialResolution ? { initialResolution: { ...event.payload.initialResolution } } : {}),
        ...(event.payload.shieldReplacement ? { shieldReplacement: { ...event.payload.shieldReplacement } } : {}),
      };
      if (event.payload.shieldGranted) {
        const player = projection.players[event.payload.shieldGranted];
        if (player) projection.players[event.payload.shieldGranted] = { ...player, shielded: true };
      }
      break;
    }
    case "alliance.proposal_submitted":
    case "alliance.counter_submitted":
    case "alliance.proposal_expired": {
      upsertAllianceLineageProjection(projection, event.payload.lineage);
      break;
    }
    case "alliance.response_recorded": {
      upsertAllianceLineageProjection(projection, event.payload.lineage);
      break;
    }
    case "alliance.activated":
    case "alliance.amendment_resolved": {
      upsertAllianceLineageProjection(projection, event.payload.lineage);
      upsertAllianceProjection(projection, event.payload.alliance);
      break;
    }
    case "alliance.closed":
    case "alliance.archived": {
      upsertAllianceProjection(projection, event.payload.alliance);
      break;
    }
    case "alliance.huddle_scheduled":
    case "alliance.huddle_skipped": {
      projection.allianceHuddleSchedules.push(cloneAllianceHuddleSchedule(event.payload.schedule));
      break;
    }
    case "alliance.huddle_completed": {
      projection.allianceHuddleSessions[event.payload.session.id] = cloneAllianceHuddleSession(event.payload.session);
      break;
    }
    case "alliance.huddle_outcome_recorded": {
      const session = projection.allianceHuddleSessions[event.payload.outcome.sessionId];
      const outcome = event.payloadVersion === 1
        ? decodeLegacyAllianceHuddleOutcomeV1(event.payload.outcome, session?.speakerIds)
        : withParticipantSnapshotFromSession(event.payload.outcome, session?.speakerIds);
      projection.allianceHuddleOutcomes[outcome.id] = cloneAllianceHuddleOutcome(outcome);
      if (event.payload.alliance) {
        upsertAllianceProjection(projection, event.payload.alliance);
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
    case "player.last_message_recorded":
    case "player.elimination_message_recorded": {
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
      if (Object.values(projection.players).filter(player => player.status === "alive").length === 1) {
        projection.retrospectiveOutcomeSource = { gameId: event.gameId, gameKind: "influence", eventSequence: event.sequence, eventHash: hashCanonicalJson(event) };
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
      projection.retrospectiveOutcomeSource = { gameId: event.gameId, gameKind: "influence", eventSequence: event.sequence, eventHash: hashCanonicalJson(event) };
      break;
    }
    case "retrospective.started":
    case "retrospective.statement_recorded":
    case "retrospective.completed": {
      // Already validated above, before any projection mutation.
      break;
    }
    case "judgment.speech_recorded": {
      // Accepted public speech fact — no board mutation.
      break;
    }
    case "visual.operation_recorded":
    case "visual.cue_recorded":
    case "endgame.speech_recorded": {
      // Accepted public Reckoning/Tribunal speech fact — no board mutation.
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
