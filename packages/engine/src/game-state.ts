/**
 * Influence Game - Game State Manager
 *
 * Handles all mutable game state: players, votes, shields, elimination,
 * jury tracking, and endgame vote tallying.
 * Pure TypeScript — no xstate, no ElizaOS.
 */

import { randomUUID } from "crypto";
import { CanonicalEventLog, type CanonicalEventListener, type CanonicalEventSubscriptionOptions } from "./canonical-event-log";
import type { CanonicalEventSource, CanonicalEventVisibility, CanonicalGameEvent, CanonicalGameEventType, CanonicalSourcePointer } from "./canonical-events";
import {
  resolveInitialExposureBench,
  resolveShieldReplacement,
  type InitialExposureBenchResolution,
  type ShieldReplacementResolution,
} from "./exposure-bench";
import { replayCanonicalEvents, type CanonicalGameProjection } from "./game-projection";
import type {
  AllianceArchiveReason,
  AllianceAmendmentInput,
  AllianceCloseReason,
  AllianceCounterInput,
  AllianceHuddleOutcome,
  AllianceHuddleScheduleRecord,
  AllianceHuddleSessionRecord,
  AllianceProposalInput,
  AllianceProposalLineage,
  AllianceProposalResponse,
  AllianceProposalVersion,
  AllianceRecord,
  AllianceResponseInput,
  AllianceTerms,
  UUID,
  Player,
  VoteTally,
  CouncilVoteTally,
  RoundResult,
  PowerAction,
  JuryMember,
  EndgameStage,
  EndgameEliminationTally,
  JuryVoteTally,
  RoomAllocation,
} from "./types";
import { Phase, PlayerStatus } from "./types";

export function createUUID(): UUID {
  return randomUUID();
}

export interface GameStateOptions {
  gameId?: UUID;
  now?: () => number;
}

export interface AllianceMutationOptions {
  phase?: Phase;
  sourcePointers?: CanonicalSourcePointer[];
}

interface AppendCanonicalEventOptions {
  phase?: Phase | null;
  round?: number;
  source?: CanonicalEventSource;
  visibility?: CanonicalEventVisibility;
  sourcePointers?: CanonicalSourcePointer[];
}

const ALLIANCE_COUNTER_LIMIT = 2;

function serializeInitialCandidateResolution(resolution: InitialExposureBenchResolution): Record<string, unknown> {
  return {
    mode: resolution.mode,
    alivePlayers: resolution.alivePlayers.map((player) => ({ ...player })),
    empoweredId: resolution.empoweredId,
    exposeScores: { ...resolution.exposeScores },
    exposureBench: resolution.exposureBench.map((entry) => ({ ...entry })),
    rawExposePressure: resolution.rawExposePressure.map((entry) => ({ ...entry })),
    lockedCandidates: [...resolution.lockedCandidates],
    choice: { ...resolution.choice, eligibleCandidateIds: [...resolution.choice.eligibleCandidateIds] },
    eligibleCandidateIds: [...resolution.choice.eligibleCandidateIds],
    requiredCount: resolution.choice.requiredCount,
    choiceReason: resolution.choice.reason,
    selectedCandidateIds: [...resolution.selectedCandidateIds],
    candidates: resolution.candidates ? [...resolution.candidates] : null,
    fallbackApplied: resolution.fallbackApplied,
    fallbackReason: resolution.fallbackReason,
  };
}

function serializeShieldReplacementResolution(resolution: ShieldReplacementResolution): Record<string, unknown> {
  return {
    mode: resolution.mode,
    alivePlayers: resolution.alivePlayers.map((player) => ({ ...player })),
    empoweredId: resolution.empoweredId,
    exposeScores: { ...resolution.exposeScores },
    exposureBench: resolution.exposureBench.map((entry) => ({ ...entry })),
    rawExposePressure: resolution.rawExposePressure.map((entry) => ({ ...entry })),
    protectedCandidateId: resolution.protectedCandidateId,
    remainingCandidateIds: [...resolution.remainingCandidateIds],
    lockedCandidates: [...resolution.lockedCandidates],
    choice: { ...resolution.choice, eligibleCandidateIds: [...resolution.choice.eligibleCandidateIds] },
    eligibleCandidateIds: [...resolution.choice.eligibleCandidateIds],
    requiredCount: resolution.choice.requiredCount,
    choiceReason: resolution.choice.reason,
    selectedCandidateIds: [...resolution.selectedCandidateIds],
    candidates: resolution.candidates ? [...resolution.candidates] : null,
    fallbackApplied: resolution.fallbackApplied,
    fallbackReason: resolution.fallbackReason,
  };
}

function cloneAllianceTerms(terms: AllianceTerms): AllianceTerms {
  return {
    name: terms.name,
    memberIds: [...terms.memberIds],
    purpose: terms.purpose,
    timebox: terms.timebox,
  };
}

function cloneAllianceProposalVersion(version: AllianceProposalVersion): AllianceProposalVersion {
  return {
    versionId: version.versionId,
    proposerId: version.proposerId,
    terms: cloneAllianceTerms(version.terms),
    ...(version.requiredConsentMemberIds ? { requiredConsentMemberIds: [...version.requiredConsentMemberIds] } : {}),
    counterIndex: version.counterIndex,
    createdRound: version.createdRound,
    createdAt: version.createdAt,
  };
}

function cloneAllianceProposalLineage(lineage: AllianceProposalLineage): AllianceProposalLineage {
  return {
    id: lineage.id,
    allianceId: lineage.allianceId,
    status: lineage.status,
    currentVersionId: lineage.currentVersionId,
    versions: lineage.versions.map(cloneAllianceProposalVersion),
    responsesByVersion: Object.fromEntries(
      Object.entries(lineage.responsesByVersion).map(([versionId, responses]) => [
        versionId,
        { ...responses },
      ]),
    ),
    createdRound: lineage.createdRound,
    createdAt: lineage.createdAt,
    resolvedRound: lineage.resolvedRound,
    resolvedAt: lineage.resolvedAt,
  };
}

function cloneAllianceRecord(alliance: AllianceRecord): AllianceRecord {
  return {
    id: alliance.id,
    name: alliance.name,
    memberIds: [...alliance.memberIds],
    purpose: alliance.purpose,
    timebox: alliance.timebox,
    status: alliance.status,
    createdRound: alliance.createdRound,
    createdAt: alliance.createdAt,
    updatedRound: alliance.updatedRound,
    updatedAt: alliance.updatedAt,
    lineageIds: [...alliance.lineageIds],
    huddleOutcomeIds: [...alliance.huddleOutcomeIds],
    ...(alliance.closedReason ? { closedReason: alliance.closedReason } : {}),
    ...(alliance.archivedReason ? { archivedReason: alliance.archivedReason } : {}),
  };
}

function cloneAllianceHuddleSchedule(schedule: AllianceHuddleScheduleRecord): AllianceHuddleScheduleRecord {
  return structuredClone(schedule) as AllianceHuddleScheduleRecord;
}

function cloneAllianceHuddleSession(session: AllianceHuddleSessionRecord): AllianceHuddleSessionRecord {
  return structuredClone(session) as AllianceHuddleSessionRecord;
}

function cloneAllianceHuddleOutcome(outcome: AllianceHuddleOutcome): AllianceHuddleOutcome {
  return structuredClone(outcome) as AllianceHuddleOutcome;
}

function responsesForLineageVersion(
  lineage: AllianceProposalLineage,
  versionId: UUID,
): Record<UUID, AllianceProposalResponse> {
  return { ...(lineage.responsesByVersion[versionId] ?? {}) };
}

export class GameState {
  readonly gameId: UUID;
  private readonly canonicalEvents = new CanonicalEventLog();
  private readonly now: () => number;
  private _players = new Map<UUID, Player>();
  private _round = 0;
  private _roundResults: RoundResult[] = [];

  // Current round state
  private _currentVoteTally: VoteTally = {
    empowerVotes: {},
    exposeVotes: {},
  };
  private _currentCouncilTally: CouncilVoteTally = { votes: {} };
  private _empoweredId: UUID | null = null;
  private _initialCandidateResolution: InitialExposureBenchResolution | null = null;
  private _councilCandidates: [UUID, UUID] | null = null;
  private _powerAction: PowerAction | null = null;

  // --- Room allocation history ---
  private _roomAllocations = new Map<
    number,
    { rooms: RoomAllocation[]; excluded: UUID[]; lastSessionExcluded: UUID[] }
  >();

  // --- Named alliance state ---
  private _allianceOrder: UUID[] = [];
  private _alliances = new Map<UUID, AllianceRecord>();
  private _allianceProposalLineageOrder: UUID[] = [];
  private _allianceProposalLineages = new Map<UUID, AllianceProposalLineage>();
  private _allianceHuddleSchedules: AllianceHuddleScheduleRecord[] = [];
  private _allianceHuddleSessions = new Map<UUID, AllianceHuddleSessionRecord>();
  private _allianceHuddleOutcomes = new Map<UUID, AllianceHuddleOutcome>();

  // --- Endgame state ---
  private _jury: JuryMember[] = [];
  private _endgameStage: EndgameStage | null = null;
  private _cumulativeEmpowerVotes = new Map<UUID, number>();
  private _endgameEliminationTally: EndgameEliminationTally = { votes: {} };
  private _juryVoteTally: JuryVoteTally = { votes: {} };
  /** Saved from the last normal round for endgame tiebreakers */
  private _lastEmpoweredFromRegularRounds: UUID | null = null;

  constructor(players: { id: UUID; name: string }[], options: GameStateOptions = {}) {
    this.gameId = options.gameId ?? createUUID();
    this.now = options.now ?? Date.now;
    for (const p of players) {
      this._players.set(p.id, {
        id: p.id,
        name: p.name,
        status: PlayerStatus.ALIVE,
        shielded: false,
      });
      this._cumulativeEmpowerVotes.set(p.id, 0);
    }
    this.appendCanonicalEvent("game.roster_initialized", {
      players: this.getAllPlayers().map((player) => ({
        id: player.id,
        name: player.name,
        status: player.status,
        shielded: player.shielded,
      })),
    }, { phase: Phase.INIT, visibility: "system" });
  }

  static fromCanonicalEvents(events: readonly CanonicalGameEvent[], options: Pick<GameStateOptions, "now"> = {}): GameState {
    const projection = replayCanonicalEvents(events);
    const players = projection.playerOrder.map((id) => {
      const player = projection.players[id];
      if (!player) throw new Error(`Canonical projection missing player ${id}`);
      return { id: player.id, name: player.name };
    });
    const state = new GameState(players, { gameId: projection.gameId, ...options });
    state.canonicalEvents.replaceAll(events);
    state._players = new Map(
      projection.playerOrder.map((id) => {
        const player = projection.players[id]!;
        return [id, { ...player }];
      }),
    );
    state._round = projection.round;
    state._roundResults = projection.roundResults.map((result) => ({ ...result }));
    state._currentVoteTally = {
      empowerVotes: { ...projection.currentVoteTally.empowerVotes },
      exposeVotes: { ...projection.currentVoteTally.exposeVotes },
    };
    state._currentCouncilTally = { votes: { ...projection.currentCouncilTally.votes } };
    state._empoweredId = projection.empoweredId;
    state._initialCandidateResolution = null;
    state._councilCandidates = projection.councilCandidates ? [...projection.councilCandidates] : null;
    state._powerAction = projection.powerAction ? { ...projection.powerAction } : null;
    state._roomAllocations = new Map(
      Object.entries(projection.roomAllocations).map(([round, allocation]) => [
        Number(round),
        {
          rooms: allocation.rooms.map((room) => ({ ...room, playerIds: [...room.playerIds] })),
          excluded: [...allocation.excluded],
          lastSessionExcluded: [...allocation.lastSessionExcluded],
        },
      ]),
    );
    state._allianceOrder = [...projection.allianceOrder];
    state._alliances = new Map(
      projection.allianceOrder.map((id) => {
        const alliance = projection.alliances[id];
        if (!alliance) throw new Error(`Canonical projection missing alliance ${id}`);
        return [id, cloneAllianceRecord(alliance)];
      }),
    );
    state._allianceProposalLineageOrder = [...projection.allianceProposalLineageOrder];
    state._allianceProposalLineages = new Map(
      projection.allianceProposalLineageOrder.map((id) => {
        const lineage = projection.allianceProposalLineages[id];
        if (!lineage) throw new Error(`Canonical projection missing alliance proposal lineage ${id}`);
        return [id, cloneAllianceProposalLineage(lineage)];
      }),
    );
    state._allianceHuddleSchedules = projection.allianceHuddleSchedules.map(cloneAllianceHuddleSchedule);
    state._allianceHuddleSessions = new Map(
      Object.entries(projection.allianceHuddleSessions).map(([id, session]) => [
        id,
        cloneAllianceHuddleSession(session),
      ]),
    );
    state._allianceHuddleOutcomes = new Map(
      Object.entries(projection.allianceHuddleOutcomes).map(([id, outcome]) => [
        id,
        cloneAllianceHuddleOutcome(outcome),
      ]),
    );
    state._jury = projection.jury.map((juror) => ({ ...juror }));
    state._endgameStage = projection.endgameStage;
    state._cumulativeEmpowerVotes = new Map(
      Object.entries(projection.cumulativeEmpowerVotes).map(([id, count]) => [id, count]),
    );
    state._endgameEliminationTally = { votes: { ...projection.endgameEliminationTally.votes } };
    state._juryVoteTally = { votes: { ...projection.juryVoteTally.votes } };
    state._lastEmpoweredFromRegularRounds = projection.lastEmpoweredFromRegularRounds;
    return state;
  }

  private appendCanonicalEvent<
    TType extends CanonicalGameEventType,
    TPayload extends Record<string, unknown>,
  >(
    type: TType,
    payload: TPayload,
    options: AppendCanonicalEventOptions = {},
  ): CanonicalGameEvent {
    return this.canonicalEvents.append({
      gameId: this.gameId,
      round: options.round ?? this._round,
      phase: options.phase ?? null,
      type,
      payload,
      timestamp: new Date(this.now()).toISOString(),
      source: options.source,
      visibility: options.visibility,
      sourcePointers: options.sourcePointers,
    });
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private assertAllianceMutationPhase(options: AllianceMutationOptions): Phase {
    const phase = options.phase ?? Phase.MINGLE_I;
    if (phase !== Phase.MINGLE_I) {
      throw new Error("Alliance mutations are only legal during Mingle I");
    }
    return phase;
  }

  private setAllianceLineage(lineage: AllianceProposalLineage): void {
    if (!this._allianceProposalLineages.has(lineage.id)) {
      this._allianceProposalLineageOrder.push(lineage.id);
    }
    this._allianceProposalLineages.set(lineage.id, cloneAllianceProposalLineage(lineage));
  }

  private setAlliance(alliance: AllianceRecord): void {
    if (!this._alliances.has(alliance.id)) {
      this._allianceOrder.push(alliance.id);
    }
    this._alliances.set(alliance.id, cloneAllianceRecord(alliance));
  }

  private normalizeAllianceTerms(input: Pick<AllianceProposalInput, "proposerId" | "name" | "memberIds" | "purpose" | "timebox">): AllianceTerms {
    const proposer = this._players.get(input.proposerId);
    if (!proposer || proposer.status !== PlayerStatus.ALIVE) {
      throw new Error(`Alliance proposer must be an alive player: ${input.proposerId}`);
    }

    const memberIds = Array.from(new Set(input.memberIds));
    if (!memberIds.includes(input.proposerId)) {
      throw new Error("Alliance proposer must be included in the member roster");
    }
    if (memberIds.length < 2) {
      throw new Error("Alliance must include at least two live players");
    }
    for (const memberId of memberIds) {
      const member = this._players.get(memberId);
      if (!member || member.status !== PlayerStatus.ALIVE) {
        throw new Error(`Alliance member must be an alive player: ${memberId}`);
      }
    }

    const name = input.name.trim();
    if (name.length === 0) throw new Error("Alliance name is required");
    const purpose = input.purpose.trim();
    if (purpose.length === 0) throw new Error("Alliance purpose is required");

    return {
      name,
      memberIds,
      purpose,
      timebox: input.timebox ?? null,
    };
  }

  private activeAllianceWithSameRoster(
    memberIds: readonly UUID[],
    excludeAllianceId?: UUID,
  ): AllianceRecord | undefined {
    const roster = new Set(memberIds);
    return Array.from(this._alliances.values()).find((alliance) => {
      if (alliance.status !== "active") return false;
      if (excludeAllianceId && alliance.id === excludeAllianceId) return false;
      if (alliance.memberIds.length !== roster.size) return false;
      return alliance.memberIds.every((memberId) => roster.has(memberId));
    });
  }

  private assertNoDuplicateActiveAllianceRoster(
    memberIds: readonly UUID[],
    excludeAllianceId?: UUID,
  ): void {
    const duplicate = this.activeAllianceWithSameRoster(memberIds, excludeAllianceId);
    if (duplicate) {
      throw new Error(`Active alliance already has the same member roster: ${duplicate.id}`);
    }
  }

  private findAllianceVersion(
    lineage: AllianceProposalLineage,
    versionId: UUID,
  ): AllianceProposalVersion | undefined {
    return lineage.versions.find((version) => version.versionId === versionId);
  }

  private currentAllianceVersion(lineage: AllianceProposalLineage): AllianceProposalVersion {
    const version = this.findAllianceVersion(lineage, lineage.currentVersionId);
    if (!version) throw new Error(`Alliance proposal lineage ${lineage.id} has no current version`);
    return version;
  }

  private allMembersAcceptedCurrentAllianceVersion(lineage: AllianceProposalLineage): boolean {
    const version = this.currentAllianceVersion(lineage);
    const responses = responsesForLineageVersion(lineage, version.versionId);
    const requiredMemberIds = version.requiredConsentMemberIds ?? version.terms.memberIds;
    return requiredMemberIds.every((memberId) => {
      const response = responses[memberId];
      return response === "accepted" || response === "trial";
    });
  }

  private requiredConsentForAllianceVersion(
    alliance: AllianceRecord | undefined,
    terms: AllianceTerms,
  ): UUID[] | undefined {
    if (!alliance || alliance.status !== "active") return undefined;
    const liveExistingMemberIds = alliance.memberIds.filter((memberId) => {
      const player = this._players.get(memberId);
      return player?.status === PlayerStatus.ALIVE;
    });
    return Array.from(new Set([...liveExistingMemberIds, ...terms.memberIds]));
  }

  private activateAllianceFromLineage(
    lineage: AllianceProposalLineage,
    options: Required<Pick<AllianceMutationOptions, "phase">> & Pick<AllianceMutationOptions, "sourcePointers">,
  ): AllianceRecord {
    const version = this.currentAllianceVersion(lineage);
    const now = this.nowIso();
    const activatedLineage: AllianceProposalLineage = {
      ...cloneAllianceProposalLineage(lineage),
      status: "activated",
      resolvedRound: this._round,
      resolvedAt: now,
    };
    const existing = this._alliances.get(lineage.allianceId);
    const lineageIds = existing
      ? Array.from(new Set([...existing.lineageIds, lineage.id]))
      : [lineage.id];
    const alliance: AllianceRecord = {
      id: lineage.allianceId,
      name: version.terms.name,
      memberIds: [...version.terms.memberIds],
      purpose: version.terms.purpose,
      timebox: version.terms.timebox,
      status: "active",
      createdRound: existing?.createdRound ?? lineage.createdRound,
      createdAt: existing?.createdAt ?? lineage.createdAt,
      updatedRound: this._round,
      updatedAt: now,
      lineageIds,
      huddleOutcomeIds: existing ? [...existing.huddleOutcomeIds] : [],
    };

    this.appendCanonicalEvent(existing ? "alliance.amendment_resolved" : "alliance.activated", {
      lineage: activatedLineage,
      alliance,
    }, {
      phase: options.phase,
      visibility: "producer",
      sourcePointers: options.sourcePointers,
    });
    this.setAllianceLineage(activatedLineage);
    this.setAlliance(alliance);
    return cloneAllianceRecord(alliance);
  }

  private isUniversalAlliance(alliance: AllianceRecord): boolean {
    const aliveIds = this.getAlivePlayerIds();
    const liveMemberIds = alliance.memberIds.filter((memberId) => {
      const player = this._players.get(memberId);
      return player?.status === PlayerStatus.ALIVE;
    });
    return aliveIds.length > 0
      && liveMemberIds.length === aliveIds.length
      && aliveIds.every((id) => liveMemberIds.includes(id));
  }

  private liveAllianceMemberCount(alliance: AllianceRecord): number {
    return alliance.memberIds.filter((memberId) => {
      const player = this._players.get(memberId);
      return player?.status === PlayerStatus.ALIVE;
    }).length;
  }

  getCanonicalEvents(): readonly CanonicalGameEvent[] {
    return this.canonicalEvents.list();
  }

  subscribeCanonicalEvents(
    listener: CanonicalEventListener,
    options: CanonicalEventSubscriptionOptions = {},
  ): () => void {
    return this.canonicalEvents.subscribe(listener, options);
  }

  // ---------------------------------------------------------------------------
  // Read-only accessors
  // ---------------------------------------------------------------------------

  get round(): number {
    return this._round;
  }

  get roundResults(): readonly RoundResult[] {
    return this._roundResults;
  }

  getPlayer(id: UUID): Player | undefined {
    return this._players.get(id);
  }

  getPlayerName(id: UUID): string {
    return this._players.get(id)?.name ?? id;
  }

  getAlivePlayers(): Player[] {
    return Array.from(this._players.values()).filter(
      (p) => p.status === PlayerStatus.ALIVE,
    );
  }

  getAlivePlayerIds(): UUID[] {
    return this.getAlivePlayers().map((p) => p.id);
  }

  getAllPlayers(): Player[] {
    return Array.from(this._players.values());
  }

  get empoweredId(): UUID | null {
    return this._empoweredId;
  }

  get councilCandidates(): [UUID, UUID] | null {
    return this._councilCandidates;
  }

  get currentVoteTally() {
    return this._currentVoteTally;
  }

  get currentCouncilTally() {
    return this._currentCouncilTally;
  }

  get endgameEliminationTally() {
    return this._endgameEliminationTally;
  }

  isGameOver(): boolean {
    return this.getAlivePlayers().length <= 1;
  }

  getWinner(): Player | undefined {
    const alive = this.getAlivePlayers();
    return alive.length === 1 ? alive[0] : undefined;
  }

  // --- Endgame accessors ---

  get jury(): readonly JuryMember[] {
    return this._jury;
  }

  get endgameStage(): EndgameStage | null {
    return this._endgameStage;
  }

  get lastEmpoweredFromRegularRounds(): UUID | null {
    return this._lastEmpoweredFromRegularRounds;
  }

  getCumulativeEmpowerVotes(playerId: UUID): number {
    return this._cumulativeEmpowerVotes.get(playerId) ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Round management
  // ---------------------------------------------------------------------------

  startRound(): void {
    const nextRound = this._round + 1;
    this.appendCanonicalEvent("round.started", { round: nextRound }, {
      phase: Phase.LOBBY,
      round: nextRound,
      visibility: "system",
    });
    this._round = nextRound;
    // Reset round-specific state
    this._currentVoteTally = { empowerVotes: {}, exposeVotes: {} };
    this._currentCouncilTally = { votes: {} };
    this._empoweredId = null;
    this._initialCandidateResolution = null;
    this._councilCandidates = null;
    this._powerAction = null;
    this._endgameEliminationTally = { votes: {} };
    this._juryVoteTally = { votes: {} };
  }

  expireShields(): void {
    const expiredPlayerIds = Array.from(this._players.values())
      .filter((player) => player.shielded)
      .map((player) => player.id);
    if (expiredPlayerIds.length > 0) {
      this.appendCanonicalEvent("shields.expired", { expiredPlayerIds }, {
        phase: Phase.LOBBY,
        visibility: "system",
      });
    }
    for (const player of this._players.values()) {
      if (player.shielded) {
        this._players.set(player.id, { ...player, shielded: false });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Room allocation tracking
  // ---------------------------------------------------------------------------

  recordRoomAllocations(
    rooms: RoomAllocation[],
    excluded: UUID[],
    lastSessionExcluded = excluded,
    phase: Phase.MINGLE | Phase.POST_VOTE_MINGLE = Phase.MINGLE,
  ): void {
    this.appendCanonicalEvent("mingle.rooms_allocated", {
      round: this._round,
      rooms: rooms.map((room) => ({ ...room, playerIds: [...room.playerIds] })),
      excluded: [...excluded],
      lastSessionExcluded: [...lastSessionExcluded],
    }, {
      phase,
      visibility: "producer",
    });
    this._roomAllocations.set(this._round, { rooms, excluded, lastSessionExcluded });
  }

  getRoomAllocations(round: number):
    | { rooms: RoomAllocation[]; excluded: UUID[]; lastSessionExcluded: UUID[] }
    | undefined {
    return this._roomAllocations.get(round);
  }

  // ---------------------------------------------------------------------------
  // Named alliance tracking
  // ---------------------------------------------------------------------------

  getAlliance(id: UUID): AllianceRecord | undefined {
    const alliance = this._alliances.get(id);
    return alliance ? cloneAllianceRecord(alliance) : undefined;
  }

  getAllianceRecords(): AllianceRecord[] {
    return this._allianceOrder
      .map((id) => this._alliances.get(id))
      .filter((alliance): alliance is AllianceRecord => Boolean(alliance))
      .map(cloneAllianceRecord);
  }

  getAllianceProposalLineage(id: UUID): AllianceProposalLineage | undefined {
    const lineage = this._allianceProposalLineages.get(id);
    return lineage ? cloneAllianceProposalLineage(lineage) : undefined;
  }

  getAllianceProposalLineages(): AllianceProposalLineage[] {
    return this._allianceProposalLineageOrder
      .map((id) => this._allianceProposalLineages.get(id))
      .filter((lineage): lineage is AllianceProposalLineage => Boolean(lineage))
      .map(cloneAllianceProposalLineage);
  }

  getHuddleEligibleAlliances(): AllianceRecord[] {
    return this.getAllianceRecords().filter((alliance) =>
      alliance.status === "active"
      && this.liveAllianceMemberCount(alliance) >= 2
      && !this.isUniversalAlliance(alliance)
    );
  }

  recordAllianceProposal(
    input: AllianceProposalInput,
    options: AllianceMutationOptions = {},
  ): AllianceProposalVersion {
    const phase = this.assertAllianceMutationPhase(options);
    const allianceId = input.allianceId ?? createUUID();
    const lineageId = input.lineageId ?? createUUID();
    const versionId = input.versionId ?? createUUID();
    if (this._allianceProposalLineages.has(lineageId)) {
      throw new Error(`Alliance proposal lineage already exists: ${lineageId}`);
    }
    if (this._alliances.has(allianceId)) {
      throw new Error(`Alliance already exists: ${allianceId}`);
    }

    const terms = this.normalizeAllianceTerms(input);
    this.assertNoDuplicateActiveAllianceRoster(terms.memberIds);
    const now = this.nowIso();
    const version: AllianceProposalVersion = {
      versionId,
      proposerId: input.proposerId,
      terms,
      counterIndex: 0,
      createdRound: this._round,
      createdAt: now,
    };
    const lineage: AllianceProposalLineage = {
      id: lineageId,
      allianceId,
      status: "open",
      currentVersionId: versionId,
      versions: [version],
      responsesByVersion: {
        [versionId]: { [input.proposerId]: "accepted" },
      },
      createdRound: this._round,
      createdAt: now,
      resolvedRound: null,
      resolvedAt: null,
    };

    this.appendCanonicalEvent("alliance.proposal_submitted", { lineage }, {
      phase,
      visibility: "producer",
      sourcePointers: options.sourcePointers,
    });
    this.setAllianceLineage(lineage);
    return cloneAllianceProposalVersion(version);
  }

  recordAllianceAmendment(
    input: AllianceAmendmentInput,
    options: AllianceMutationOptions = {},
  ): AllianceProposalVersion {
    const phase = this.assertAllianceMutationPhase(options);
    const alliance = this._alliances.get(input.allianceId);
    if (!alliance || alliance.status !== "active") {
      throw new Error(`Alliance amendment requires an active alliance: ${input.allianceId}`);
    }
    const lineageId = input.lineageId ?? createUUID();
    const versionId = input.versionId ?? createUUID();
    if (this._allianceProposalLineages.has(lineageId)) {
      throw new Error(`Alliance amendment lineage already exists: ${lineageId}`);
    }

    const terms = this.normalizeAllianceTerms(input);
    this.assertNoDuplicateActiveAllianceRoster(terms.memberIds, alliance.id);
    const requiredConsentMemberIds = this.requiredConsentForAllianceVersion(alliance, terms);
    const now = this.nowIso();
    const version: AllianceProposalVersion = {
      versionId,
      proposerId: input.proposerId,
      terms,
      ...(requiredConsentMemberIds ? { requiredConsentMemberIds } : {}),
      counterIndex: 0,
      createdRound: this._round,
      createdAt: now,
    };
    const lineage: AllianceProposalLineage = {
      id: lineageId,
      allianceId: input.allianceId,
      status: "open",
      currentVersionId: versionId,
      versions: [version],
      responsesByVersion: {
        [versionId]: { [input.proposerId]: "accepted" },
      },
      createdRound: this._round,
      createdAt: now,
      resolvedRound: null,
      resolvedAt: null,
    };

    this.appendCanonicalEvent("alliance.proposal_submitted", { lineage }, {
      phase,
      visibility: "producer",
      sourcePointers: options.sourcePointers,
    });
    this.setAllianceLineage(lineage);
    return cloneAllianceProposalVersion(version);
  }

  recordAllianceResponse(
    input: AllianceResponseInput,
    options: AllianceMutationOptions = {},
  ): AllianceRecord | null {
    const phase = this.assertAllianceMutationPhase(options);
    const existing = this._allianceProposalLineages.get(input.lineageId);
    if (!existing) throw new Error(`Unknown alliance proposal lineage: ${input.lineageId}`);
    if (existing.status !== "open") return null;
    if (input.versionId !== existing.currentVersionId) {
      throw new Error(`Alliance response must target current proposal version ${existing.currentVersionId}`);
    }
    const version = this.currentAllianceVersion(existing);
    const requiredConsentMemberIds = version.requiredConsentMemberIds ?? version.terms.memberIds;
    if (!requiredConsentMemberIds.includes(input.playerId)) {
      throw new Error(`Alliance response player is not invited to the current version: ${input.playerId}`);
    }

    const player = this._players.get(input.playerId);
    if (!player || player.status !== PlayerStatus.ALIVE) {
      throw new Error(`Alliance response player must be alive: ${input.playerId}`);
    }

    const lineage = cloneAllianceProposalLineage(existing);
    lineage.responsesByVersion[input.versionId] = {
      ...responsesForLineageVersion(lineage, input.versionId),
      [input.playerId]: input.response,
    };
    if (input.response === "declined") {
      lineage.status = "declined";
      lineage.resolvedRound = this._round;
      lineage.resolvedAt = this.nowIso();
    }

    this.appendCanonicalEvent("alliance.response_recorded", {
      lineage,
      playerId: input.playerId,
      response: input.response,
      versionId: input.versionId,
    }, {
      phase,
      visibility: "producer",
      sourcePointers: options.sourcePointers,
    });
    this.setAllianceLineage(lineage);

    if (lineage.status === "open" && this.allMembersAcceptedCurrentAllianceVersion(lineage)) {
      return this.activateAllianceFromLineage(lineage, { phase, sourcePointers: options.sourcePointers });
    }

    return null;
  }

  recordAllianceCounter(
    input: AllianceCounterInput,
    options: AllianceMutationOptions = {},
  ): AllianceProposalVersion | null {
    const phase = this.assertAllianceMutationPhase(options);
    const existing = this._allianceProposalLineages.get(input.lineageId);
    if (!existing) throw new Error(`Unknown alliance proposal lineage: ${input.lineageId}`);
    if (existing.status !== "open") return null;
    const currentVersion = this.currentAllianceVersion(existing);
    const currentRequiredConsentMemberIds = currentVersion.requiredConsentMemberIds ?? currentVersion.terms.memberIds;
    if (!currentRequiredConsentMemberIds.includes(input.proposerId)) {
      throw new Error(`Alliance counter proposer is not invited to the current version: ${input.proposerId}`);
    }
    const counterCount = existing.versions.filter((version) => version.counterIndex > 0).length;
    if (counterCount >= ALLIANCE_COUNTER_LIMIT) return null;

    const terms = this.normalizeAllianceTerms(input);
    this.assertNoDuplicateActiveAllianceRoster(terms.memberIds, existing.allianceId);
    const versionId = input.versionId ?? createUUID();
    if (this.findAllianceVersion(existing, versionId)) {
      throw new Error(`Alliance proposal version already exists: ${versionId}`);
    }

    const requiredConsentMemberIds = this.requiredConsentForAllianceVersion(this._alliances.get(existing.allianceId), terms);
    const version: AllianceProposalVersion = {
      versionId,
      proposerId: input.proposerId,
      terms,
      ...(requiredConsentMemberIds ? { requiredConsentMemberIds } : {}),
      counterIndex: counterCount + 1,
      createdRound: this._round,
      createdAt: this.nowIso(),
    };
    const lineage = cloneAllianceProposalLineage(existing);
    lineage.currentVersionId = versionId;
    lineage.versions.push(version);
    lineage.responsesByVersion[versionId] = { [input.proposerId]: "accepted" };

    this.appendCanonicalEvent("alliance.counter_submitted", { lineage }, {
      phase,
      visibility: "producer",
      sourcePointers: options.sourcePointers,
    });
    this.setAllianceLineage(lineage);
    return cloneAllianceProposalVersion(version);
  }

  expireAllianceProposal(lineageId: UUID, options: AllianceMutationOptions = {}): AllianceProposalLineage | null {
    const phase = this.assertAllianceMutationPhase(options);
    const existing = this._allianceProposalLineages.get(lineageId);
    if (!existing || existing.status !== "open") return null;
    const lineage: AllianceProposalLineage = {
      ...cloneAllianceProposalLineage(existing),
      status: "expired",
      resolvedRound: this._round,
      resolvedAt: this.nowIso(),
    };
    this.appendCanonicalEvent("alliance.proposal_expired", { lineage }, {
      phase,
      visibility: "producer",
      sourcePointers: options.sourcePointers,
    });
    this.setAllianceLineage(lineage);
    return cloneAllianceProposalLineage(lineage);
  }

  closeUniversalAlliancesBeforeMingle(phase: Phase.MINGLE_I | Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE = Phase.MINGLE_I): UUID[] {
    const closedIds: UUID[] = [];
    for (const alliance of this.getAllianceRecords()) {
      if (alliance.status !== "active" || !this.isUniversalAlliance(alliance)) continue;
      const closed: AllianceRecord = {
        ...alliance,
        status: "closed",
        updatedRound: this._round,
        updatedAt: this.nowIso(),
        closedReason: "universal_all_alive_before_mingle",
      };
      this.appendCanonicalEvent("alliance.closed", { alliance: closed }, {
        phase,
        visibility: "producer",
      });
      this.setAlliance(closed);
      closedIds.push(closed.id);
    }
    return closedIds;
  }

  closeAlliance(id: UUID, reason: AllianceCloseReason, phase: Phase | null = null): AllianceRecord | null {
    const alliance = this._alliances.get(id);
    if (!alliance || alliance.status !== "active") return null;
    const closed: AllianceRecord = {
      ...cloneAllianceRecord(alliance),
      status: "closed",
      updatedRound: this._round,
      updatedAt: this.nowIso(),
      closedReason: reason,
    };
    this.appendCanonicalEvent("alliance.closed", { alliance: closed }, {
      phase,
      visibility: "producer",
    });
    this.setAlliance(closed);
    return cloneAllianceRecord(closed);
  }

  archiveAlliance(id: UUID, reason: AllianceArchiveReason, phase: Phase | null = null): AllianceRecord | null {
    const alliance = this._alliances.get(id);
    if (!alliance || alliance.status !== "active") return null;
    const archived: AllianceRecord = {
      ...cloneAllianceRecord(alliance),
      status: "archived",
      updatedRound: this._round,
      updatedAt: this.nowIso(),
      archivedReason: reason,
    };
    this.appendCanonicalEvent("alliance.archived", { alliance: archived }, {
      phase,
      visibility: "producer",
    });
    this.setAlliance(archived);
    return cloneAllianceRecord(archived);
  }

  refreshAllianceMembershipForAlivePlayers(): UUID[] {
    const archivedIds: UUID[] = [];
    for (const alliance of this.getAllianceRecords()) {
      if (alliance.status !== "active" || this.liveAllianceMemberCount(alliance) >= 2) continue;
      const archived = this.archiveAlliance(alliance.id, "fewer_than_two_live_members");
      if (archived) archivedIds.push(archived.id);
    }
    return archivedIds;
  }

  recordAllianceHuddleSchedule(schedule: AllianceHuddleScheduleRecord): void {
    this.appendCanonicalEvent(
      schedule.decision === "scheduled" ? "alliance.huddle_scheduled" : "alliance.huddle_skipped",
      { schedule: cloneAllianceHuddleSchedule(schedule) },
      {
        phase: schedule.window === "pre_vote" ? Phase.PRE_VOTE_HUDDLE : Phase.PRE_COUNCIL_HUDDLE,
        visibility: "producer",
      },
    );
    this._allianceHuddleSchedules.push(cloneAllianceHuddleSchedule(schedule));
  }

  recordAllianceHuddleCompleted(session: AllianceHuddleSessionRecord): void {
    this.appendCanonicalEvent("alliance.huddle_completed", { session: cloneAllianceHuddleSession(session) }, {
      phase: session.window === "pre_vote" ? Phase.PRE_VOTE_HUDDLE : Phase.PRE_COUNCIL_HUDDLE,
      visibility: "producer",
    });
    this._allianceHuddleSessions.set(session.id, cloneAllianceHuddleSession(session));
  }

  recordAllianceHuddleOutcome(outcome: AllianceHuddleOutcome): AllianceRecord {
    const alliance = this._alliances.get(outcome.allianceId);
    if (!alliance) throw new Error(`Cannot record huddle outcome for unknown alliance ${outcome.allianceId}`);
    const updatedAlliance: AllianceRecord = {
      ...cloneAllianceRecord(alliance),
      updatedRound: this._round,
      updatedAt: outcome.createdAt,
      huddleOutcomeIds: Array.from(new Set([...alliance.huddleOutcomeIds, outcome.id])),
    };
    this.appendCanonicalEvent("alliance.huddle_outcome_recorded", {
      outcome: cloneAllianceHuddleOutcome(outcome),
      alliance: updatedAlliance,
    }, {
      phase: outcome.window === "pre_vote" ? Phase.PRE_VOTE_HUDDLE : Phase.PRE_COUNCIL_HUDDLE,
      visibility: "producer",
    });
    this._allianceHuddleOutcomes.set(outcome.id, cloneAllianceHuddleOutcome(outcome));
    this.setAlliance(updatedAlliance);
    return cloneAllianceRecord(updatedAlliance);
  }

  getAllianceHuddleSchedules(): AllianceHuddleScheduleRecord[] {
    return this._allianceHuddleSchedules.map(cloneAllianceHuddleSchedule);
  }

  getAllianceHuddleOutcomes(): AllianceHuddleOutcome[] {
    return Array.from(this._allianceHuddleOutcomes.values()).map(cloneAllianceHuddleOutcome);
  }

  // ---------------------------------------------------------------------------
  // VOTE phase
  // ---------------------------------------------------------------------------

  recordVote(
    voterId: UUID,
    empowerTarget: UUID,
    exposeTarget: UUID,
    sourcePointers: CanonicalSourcePointer[] = [],
  ): void {
    const voter = this._players.get(voterId);
    if (!voter || voter.status !== PlayerStatus.ALIVE) return;

    this.appendCanonicalEvent("vote.cast", { voterId, empowerTarget, exposeTarget }, {
      phase: Phase.VOTE,
      visibility: "producer",
      sourcePointers,
    });
    this._currentVoteTally.empowerVotes[voterId] = empowerTarget;
    this._currentVoteTally.exposeVotes[voterId] = exposeTarget;
  }

  recordLastMessage(playerId: UUID, message: string): void {
    const player = this._players.get(playerId);
    if (!player) return;
    this.appendCanonicalEvent("player.last_message_recorded", { playerId, message }, {
      phase: this.canonicalEvents.list().at(-1)?.phase ?? null,
      visibility: "public",
    });
    this._players.set(playerId, { ...player, lastMessage: message });
  }

  /**
   * Tally votes and determine the empowered agent.
   * Also increments cumulative empower votes for endgame tiebreakers.
   * Returns the empowered player ID and tied array if a tie occurred.
   */
  tallyEmpowerVotes(): { empowered: UUID; tied: UUID[] | null } {
    const alive = this.getAlivePlayerIds();
    const counts: Record<UUID, number> = {};
    for (const id of alive) counts[id] = 0;

    for (const [, target] of Object.entries(
      this._currentVoteTally.empowerVotes,
    )) {
      if (target in counts) counts[target] = (counts[target] ?? 0) + 1;
    }

    // Accumulate for endgame tiebreaker
    for (const [id, count] of Object.entries(counts)) {
      const prev = this._cumulativeEmpowerVotes.get(id) ?? 0;
      this._cumulativeEmpowerVotes.set(id, prev + count);
    }
    const cumulativeEmpowerVotes = Object.fromEntries(this._cumulativeEmpowerVotes);

    const maxVotes = Math.max(...Object.values(counts), 0);

    if (maxVotes === 0) {
      // Zero empower votes — pick randomly ("the wheel")
      const empowered = alive[Math.floor(Math.random() * alive.length)];
      if (!empowered) throw new Error("No alive players to empower");
      this.appendCanonicalEvent("vote.empower_tally_resolved", {
        counts,
        empowered,
        tied: null,
        method: "wheel",
        cumulativeEmpowerVotes,
      }, {
        phase: Phase.VOTE,
        visibility: "producer",
      });
      this._empoweredId = empowered;
      return { empowered, tied: null };
    }

    const tied = alive.filter((id) => counts[id] === maxVotes);
    if (tied.length === 1) {
      const empowered = tied[0]!;
      this.appendCanonicalEvent("vote.empower_tally_resolved", {
        counts,
        empowered,
        tied: null,
        method: "plurality",
        cumulativeEmpowerVotes,
      }, {
        phase: Phase.VOTE,
        visibility: "producer",
      });
      this._empoweredId = empowered;
      return { empowered, tied: null };
    }

    // Tie detected — return tied players for re-vote by the runner
    this.appendCanonicalEvent("vote.empower_tally_resolved", {
      counts,
      empowered: tied[0]!,
      tied,
      method: "tie_pending",
      cumulativeEmpowerVotes,
    }, {
      phase: Phase.VOTE,
      visibility: "producer",
    });
    return { empowered: tied[0]!, tied };
  }

  /**
   * Record an empower re-vote (used when initial empower votes tie).
   * Voters choose among tied candidates only.
   */
  recordEmpowerReVote(voterId: UUID, target: UUID, sourcePointers: CanonicalSourcePointer[] = []): void {
    this.appendCanonicalEvent("vote.empower_revote_cast", { voterId, target }, {
      phase: Phase.VOTE,
      visibility: "producer",
      sourcePointers,
    });
    this._currentVoteTally.empowerVotes[voterId] = target;
  }

  /**
   * Clear a voter's empower vote (used before re-vote to prevent stale votes).
   */
  clearEmpowerVote(voterId: UUID): void {
    this.appendCanonicalEvent("vote.empower_vote_cleared", { voterId }, {
      phase: Phase.VOTE,
      visibility: "producer",
    });
    delete this._currentVoteTally.empowerVotes[voterId];
  }

  /**
   * Set the empowered player directly (after re-vote or wheel).
   */
  setEmpowered(id: UUID, method: "initial" | "revote" | "wheel" | "manual" = "manual"): void {
    this.appendCanonicalEvent("vote.empowered_set", { empowered: id, method }, {
      phase: Phase.VOTE,
      visibility: "producer",
    });
    this._empoweredId = id;
  }

  /**
   * Tally expose votes and determine the top two candidates.
   * Returns sorted [(most exposed), (second most exposed)].
   */
  getExposeScores(): Record<UUID, number> {
    const alive = this.getAlivePlayerIds();
    const counts: Record<UUID, number> = {};
    for (const id of alive) counts[id] = 0;

    for (const [, target] of Object.entries(
      this._currentVoteTally.exposeVotes,
    )) {
      if (target in counts) counts[target] = (counts[target] ?? 0) + 1;
    }
    return counts;
  }

  get initialCandidateResolution(): InitialExposureBenchResolution | null {
    return this._initialCandidateResolution;
  }

  previewInitialCandidateResolution(selectedCandidateIds: UUID[] = []): InitialExposureBenchResolution | null {
    if (!this._empoweredId) return null;
    return resolveInitialExposureBench({
      alivePlayers: this.getAlivePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        shielded: player.shielded,
      })),
      empoweredId: this._empoweredId,
      exposeScores: this.getExposeScores(),
      selectedCandidateIds,
    });
  }

  resolveInitialCandidates(selectedCandidateIds: UUID[] = []): InitialExposureBenchResolution | null {
    const resolution = this.previewInitialCandidateResolution(selectedCandidateIds);
    if (!resolution) return null;
    this._initialCandidateResolution = resolution;
    this._councilCandidates = resolution.candidates;
    return resolution;
  }

  previewShieldReplacement(
    protectedCandidateId: UUID,
    selectedCandidateIds: UUID[] = [],
  ): ShieldReplacementResolution | null {
    const initialResolution = this._initialCandidateResolution ?? this.previewInitialCandidateResolution();
    if (!initialResolution) return null;
    return resolveShieldReplacement({
      initialResolution,
      protectedCandidateId,
      selectedCandidateIds,
    });
  }

  // ---------------------------------------------------------------------------
  // POWER phase
  // ---------------------------------------------------------------------------

  setPowerAction(action: PowerAction, sourcePointers: CanonicalSourcePointer[] = []): void {
    this.appendCanonicalEvent("power.action_set", { action: { ...action } }, {
      phase: Phase.POWER,
      visibility: "producer",
      sourcePointers,
    });
    this._powerAction = action;
  }

  /**
   * Determine the two council candidates after power action is applied.
   */
  determineCandidates(replacementCandidateIds: UUID[] = []): {
    candidates: [UUID, UUID] | null;
    autoEliminated: UUID | null;
    shieldGranted: UUID | null;
  } {
    const alive = this.getAlivePlayerIds();

    if (alive.length <= 2) {
      // Two-player endgame: empowered chooses directly
      const others = alive.filter((id) => id !== this._empoweredId);
      if (others.length === 1) {
        const onlyOther = others[0];
        if (!onlyOther) throw new Error("Expected one other player but got undefined");
        const candidates: [UUID, UUID] = [onlyOther, onlyOther]; // only one choice
        this.appendCanonicalEvent("power.candidates_resolved", {
          exposeScores: {},
          candidates,
          autoEliminated: null,
          shieldGranted: null,
          method: "two_player",
        }, {
          phase: Phase.POWER,
          visibility: "producer",
        });
        this._councilCandidates = candidates;
        return {
          candidates: this._councilCandidates,
          autoEliminated: null,
          shieldGranted: null,
        };
      }
    }

    const scores = this.getExposeScores();
    const action = this._powerAction?.action ?? "pass";
    const target = this._powerAction?.target;

    if (action === "eliminate" && target) {
      // Auto-eliminate: skip council
      this.appendCanonicalEvent("power.candidates_resolved", {
        exposeScores: scores,
        candidates: null,
        autoEliminated: target,
        shieldGranted: null,
        method: "auto_eliminate",
      }, {
        phase: Phase.POWER,
        visibility: "producer",
      });
      return { candidates: null, autoEliminated: target, shieldGranted: null };
    }

    const initialResolution = this._initialCandidateResolution ?? this.resolveInitialCandidates();
    let shieldGranted: UUID | null = null;
    let shieldReplacement: ShieldReplacementResolution | null = null;
    let candidates = initialResolution?.candidates ?? null;

    if (action === "protect" && target && this._empoweredId) {
      shieldGranted = target;
      if (initialResolution?.candidates?.includes(target)) {
        shieldReplacement = resolveShieldReplacement({
          initialResolution,
          protectedCandidateId: target,
          selectedCandidateIds: replacementCandidateIds,
        });
        candidates = shieldReplacement.candidates;
      }
    }

    if (!candidates) {
      // Not enough candidates; game should end
      this.appendCanonicalEvent("power.candidates_resolved", {
        exposeScores: scores,
        candidates: null,
        autoEliminated: null,
        shieldGranted,
        method: "insufficient_candidates",
        ...(initialResolution ? { initialResolution: serializeInitialCandidateResolution(initialResolution) } : {}),
        ...(shieldReplacement ? { shieldReplacement: serializeShieldReplacementResolution(shieldReplacement) } : {}),
      }, {
        phase: Phase.POWER,
        visibility: "producer",
      });
      if (shieldGranted) {
        const player = this._players.get(shieldGranted);
        if (player) {
          this._players.set(shieldGranted, { ...player, shielded: true });
        }
      }
      return { candidates: null, autoEliminated: null, shieldGranted };
    }

    this.appendCanonicalEvent("power.candidates_resolved", {
      exposeScores: scores,
      candidates,
      autoEliminated: null,
      shieldGranted,
      method: shieldReplacement ? "exposure_bench_protect" : "exposure_bench",
      ...(initialResolution ? { initialResolution: serializeInitialCandidateResolution(initialResolution) } : {}),
      ...(shieldReplacement ? { shieldReplacement: serializeShieldReplacementResolution(shieldReplacement) } : {}),
    }, {
      phase: Phase.POWER,
      visibility: "producer",
    });
    if (shieldGranted) {
      const player = this._players.get(shieldGranted);
      if (player) {
        this._players.set(shieldGranted, { ...player, shielded: true });
      }
    }
    this._councilCandidates = candidates;
    return {
      candidates: this._councilCandidates,
      autoEliminated: null,
      shieldGranted,
    };
  }

  // ---------------------------------------------------------------------------
  // COUNCIL phase
  // ---------------------------------------------------------------------------

  recordCouncilVote(voterId: UUID, target: UUID, sourcePointers: CanonicalSourcePointer[] = []): void {
    this.appendCanonicalEvent("council.vote_cast", { voterId, target }, {
      phase: Phase.COUNCIL,
      visibility: "producer",
      sourcePointers,
    });
    this._currentCouncilTally.votes[voterId] = target;
  }

  /**
   * Tally council votes and eliminate a candidate.
   * Tie -> empowered agent decides.
   * Returns the eliminated player's ID.
   */
  tallyCouncilVotes(empoweredId: UUID): UUID {
    const candidates = this._councilCandidates;
    if (!candidates) throw new Error("No council candidates set");

    const [c1, c2] = candidates;
    let c1Votes = 0;
    let c2Votes = 0;

    for (const [voter, target] of Object.entries(
      this._currentCouncilTally.votes,
    )) {
      if (voter === empoweredId) continue; // empowered doesn't vote normally
      if (target === c1) c1Votes++;
      if (target === c2) c2Votes++;
    }

    if (c1Votes > c2Votes) {
      this.appendCanonicalEvent("council.elimination_resolved", {
        empoweredId,
        candidates,
        tally: { votes: { ...this._currentCouncilTally.votes } },
        eliminated: c1,
        method: "plurality",
      }, {
        phase: Phase.COUNCIL,
        visibility: "producer",
      });
      return c1;
    }
    if (c2Votes > c1Votes) {
      this.appendCanonicalEvent("council.elimination_resolved", {
        empoweredId,
        candidates,
        tally: { votes: { ...this._currentCouncilTally.votes } },
        eliminated: c2,
        method: "plurality",
      }, {
        phase: Phase.COUNCIL,
        visibility: "producer",
      });
      return c2;
    }

    // Tie: empowered decides — use their recorded council vote if any
    const empoweredVote = this._currentCouncilTally.votes[empoweredId];
    if (empoweredVote === c1 || empoweredVote === c2) {
      this.appendCanonicalEvent("council.elimination_resolved", {
        empoweredId,
        candidates,
        tally: { votes: { ...this._currentCouncilTally.votes } },
        eliminated: empoweredVote,
        method: "empowered_tiebreaker",
      }, {
        phase: Phase.COUNCIL,
        visibility: "producer",
      });
      return empoweredVote;
    }

    // Fallback: random
    const eliminated = Math.random() < 0.5 ? c1 : c2;
    this.appendCanonicalEvent("council.elimination_resolved", {
      empoweredId,
      candidates,
      tally: { votes: { ...this._currentCouncilTally.votes } },
      eliminated,
      method: "random_tiebreaker",
    }, {
      phase: Phase.COUNCIL,
      visibility: "producer",
    });
    return eliminated;
  }

  // ---------------------------------------------------------------------------
  // Elimination
  // ---------------------------------------------------------------------------

  eliminatePlayer(id: UUID): void {
    const player = this._players.get(id);
    if (!player) return;
    const juryMember: JuryMember = {
      playerId: id,
      playerName: player.name,
      eliminatedRound: this._round,
    };
    this.appendCanonicalEvent("player.eliminated", {
      playerId: id,
      playerName: player.name,
      eliminatedRound: this._round,
      juryMember,
    }, {
      phase: null,
      visibility: "system",
    });
    this._players.set(id, { ...player, status: PlayerStatus.ELIMINATED });
    // Add to jury
    this.addToJury(id, this._round);
    this.refreshAllianceMembershipForAlivePlayers();
  }

  // ---------------------------------------------------------------------------
  // Endgame: Jury tracking
  // ---------------------------------------------------------------------------

  addToJury(playerId: UUID, round: number): void {
    // Don't add duplicates
    if (this._jury.some((j) => j.playerId === playerId)) return;
    const player = this._players.get(playerId);
    this._jury.push({
      playerId,
      playerName: player?.name ?? playerId,
      eliminatedRound: round,
    });
  }

  setEndgameStage(stage: EndgameStage): void {
    const lastEmpoweredFromRegularRounds = this._lastEmpoweredFromRegularRounds === null
      ? this._empoweredId
      : this._lastEmpoweredFromRegularRounds;
    this.appendCanonicalEvent("endgame.stage_set", {
      stage,
      lastEmpoweredFromRegularRounds,
    }, {
      phase: Phase.LOBBY,
      visibility: "system",
    });
    this._endgameStage = stage;
    // Save last empowered on first endgame entry
    if (this._lastEmpoweredFromRegularRounds === null) {
      this._lastEmpoweredFromRegularRounds = this._empoweredId;
    }
  }

  // ---------------------------------------------------------------------------
  // Endgame: Elimination vote tallying (Reckoning + Tribunal)
  // ---------------------------------------------------------------------------

  recordEndgameEliminationVote(voterId: UUID, target: UUID, sourcePointers: CanonicalSourcePointer[] = []): void {
    this.appendCanonicalEvent("endgame.elimination_vote_cast", { voterId, target }, {
      phase: Phase.VOTE,
      visibility: "producer",
      sourcePointers,
    });
    this._endgameEliminationTally.votes[voterId] = target;
  }

  getTribunalEliminationTieCandidates(): UUID[] {
    const alive = this.getAlivePlayerIds();
    const counts: Record<UUID, number> = {};
    for (const id of alive) counts[id] = 0;

    for (const [, target] of Object.entries(this._endgameEliminationTally.votes)) {
      if (target in counts) counts[target] = (counts[target] ?? 0) + 1;
    }

    const maxVotes = Math.max(...Object.values(counts), 0);
    if (maxVotes === 0) return [];
    const tied = alive.filter((id) => counts[id] === maxVotes);
    return tied.length > 1 ? tied : [];
  }

  /**
   * Tally endgame elimination votes (simple plurality).
   * Tie -> broken by lastEmpoweredFromRegularRounds (they choose).
   * Returns the eliminated player's ID.
   */
  tallyEndgameEliminationVotes(): UUID {
    const alive = this.getAlivePlayerIds();
    const counts: Record<UUID, number> = {};
    for (const id of alive) counts[id] = 0;

    for (const [, target] of Object.entries(this._endgameEliminationTally.votes)) {
      if (target in counts) counts[target] = (counts[target] ?? 0) + 1;
    }

    const maxVotes = Math.max(...Object.values(counts), 0);
    if (maxVotes === 0) {
      // No votes cast — random elimination
      const randomTarget = alive[Math.floor(Math.random() * alive.length)];
      if (!randomTarget) throw new Error("No alive players to eliminate");
      this.appendCanonicalEvent("endgame.elimination_resolved", {
        stage: this._endgameStage,
        tally: { votes: { ...this._endgameEliminationTally.votes } },
        eliminated: randomTarget,
        method: "random_no_votes",
      }, {
        phase: Phase.VOTE,
        visibility: "producer",
      });
      return randomTarget;
    }

    const tied = alive.filter((id) => counts[id] === maxVotes);
    const firstTied = tied[0];
    if (tied.length === 1) {
      if (!firstTied) throw new Error("Expected tied player but got undefined");
      this.appendCanonicalEvent("endgame.elimination_resolved", {
        stage: this._endgameStage,
        tally: { votes: { ...this._endgameEliminationTally.votes } },
        eliminated: firstTied,
        method: "plurality",
      }, {
        phase: Phase.VOTE,
        visibility: "producer",
      });
      return firstTied;
    }

    // Tiebreaker: last empowered from regular rounds picks among tied
    // (In practice, the runner would ask them. For state logic, pick the first tied.)
    const lastEmpowered = this._lastEmpoweredFromRegularRounds;
    if (lastEmpowered && tied.includes(lastEmpowered)) {
      // The last-empowered is tied — they can't eliminate themselves, pick the other
      const others = tied.filter((id) => id !== lastEmpowered);
      const firstOther = others[0];
      if (firstOther) {
        this.appendCanonicalEvent("endgame.elimination_resolved", {
          stage: this._endgameStage,
          tally: { votes: { ...this._endgameEliminationTally.votes } },
          eliminated: firstOther,
          method: "last_empowered_tiebreaker",
        }, {
          phase: Phase.VOTE,
          visibility: "producer",
        });
        return firstOther;
      }
    }

    // Fallback: first tied player
    if (!firstTied) throw new Error("Expected tied player but got undefined");
    this.appendCanonicalEvent("endgame.elimination_resolved", {
      stage: this._endgameStage,
      tally: { votes: { ...this._endgameEliminationTally.votes } },
      eliminated: firstTied,
      method: "fallback_first_tied",
    }, {
      phase: Phase.VOTE,
      visibility: "producer",
    });
    return firstTied;
  }

  /**
   * Tally Tribunal elimination votes (3-player).
   * Tie -> jury casts a collective tiebreaker.
   * If jury also tied -> last-empowered from regular rounds breaks it.
   */
  tallyTribunalVotes(juryTiebreakerVotes?: Record<UUID, UUID>): UUID {
    const alive = this.getAlivePlayerIds();
    const counts: Record<UUID, number> = {};
    for (const id of alive) counts[id] = 0;

    for (const [, target] of Object.entries(this._endgameEliminationTally.votes)) {
      if (target in counts) counts[target] = (counts[target] ?? 0) + 1;
    }

    const maxVotes = Math.max(...Object.values(counts), 0);
    if (maxVotes === 0) {
      const randomTarget = alive[Math.floor(Math.random() * alive.length)];
      if (!randomTarget) throw new Error("No alive players to eliminate in tribunal");
      this.appendCanonicalEvent("endgame.elimination_resolved", {
        stage: this._endgameStage,
        tally: { votes: { ...this._endgameEliminationTally.votes } },
        juryTiebreakerVotes,
        eliminated: randomTarget,
        method: "random_no_votes",
      }, {
        phase: Phase.VOTE,
        visibility: "producer",
      });
      return randomTarget;
    }

    const tied = alive.filter((id) => counts[id] === maxVotes);
    const firstTied = tied[0];
    if (tied.length === 1) {
      if (!firstTied) throw new Error("Expected tied player but got undefined");
      this.appendCanonicalEvent("endgame.elimination_resolved", {
        stage: this._endgameStage,
        tally: { votes: { ...this._endgameEliminationTally.votes } },
        juryTiebreakerVotes,
        eliminated: firstTied,
        method: "plurality",
      }, {
        phase: Phase.VOTE,
        visibility: "producer",
      });
      return firstTied;
    }

    // Tiebreaker: jury collective vote
    if (juryTiebreakerVotes) {
      const juryCounts: Record<UUID, number> = {};
      for (const id of tied) juryCounts[id] = 0;

      for (const [, target] of Object.entries(juryTiebreakerVotes)) {
        if (target in juryCounts) juryCounts[target] = (juryCounts[target] ?? 0) + 1;
      }

      const juryMax = Math.max(...Object.values(juryCounts), 0);
      const juryTied = tied.filter((id) => juryCounts[id] === juryMax);
      const firstJuryTied = juryTied[0];
      if (juryTied.length === 1) {
        if (!firstJuryTied) throw new Error("Expected jury-tied player but got undefined");
        this.appendCanonicalEvent("endgame.elimination_resolved", {
          stage: this._endgameStage,
          tally: { votes: { ...this._endgameEliminationTally.votes } },
          juryTiebreakerVotes,
          eliminated: firstJuryTied,
          method: "jury_tiebreaker",
        }, {
          phase: Phase.VOTE,
          visibility: "producer",
        });
        return firstJuryTied;
      }
    }

    // Final fallback: last empowered from regular rounds
    const lastEmpowered = this._lastEmpoweredFromRegularRounds;
    if (lastEmpowered && tied.includes(lastEmpowered)) {
      const others = tied.filter((id) => id !== lastEmpowered);
      const firstOther = others[0];
      if (firstOther) {
        this.appendCanonicalEvent("endgame.elimination_resolved", {
          stage: this._endgameStage,
          tally: { votes: { ...this._endgameEliminationTally.votes } },
          juryTiebreakerVotes,
          eliminated: firstOther,
          method: "last_empowered_tiebreaker",
        }, {
          phase: Phase.VOTE,
          visibility: "producer",
        });
        return firstOther;
      }
    }

    if (!firstTied) throw new Error("Expected tied player but got undefined");
    this.appendCanonicalEvent("endgame.elimination_resolved", {
      stage: this._endgameStage,
      tally: { votes: { ...this._endgameEliminationTally.votes } },
      juryTiebreakerVotes,
      eliminated: firstTied,
      method: "fallback_first_tied",
    }, {
      phase: Phase.VOTE,
      visibility: "producer",
    });
    return firstTied;
  }

  // ---------------------------------------------------------------------------
  // Endgame: Jury vote tallying (Judgment)
  // ---------------------------------------------------------------------------

  recordJuryVote(jurorId: UUID, finalistId: UUID, sourcePointers: CanonicalSourcePointer[] = []): void {
    this.appendCanonicalEvent("jury.vote_cast", { jurorId, finalistId }, {
      phase: Phase.JURY_VOTE,
      visibility: "producer",
      sourcePointers,
    });
    this._juryVoteTally.votes[jurorId] = finalistId;
  }

  /**
   * Tally jury votes for the Judgment finale.
   * Majority wins. Tie -> finalist with more cumulative empower votes wins.
   * Returns the winner's ID and how the result was determined.
   */
  tallyJuryVotes(): { winnerId: UUID; method: "majority" | "empower_tiebreaker" | "random_tiebreaker"; voteCounts: { id: UUID; name: string; votes: number }[] } {
    const finalists = this.getAlivePlayerIds();
    if (finalists.length !== 2) throw new Error("Judgment requires exactly 2 finalists");

    const f1 = finalists[0];
    const f2 = finalists[1];
    if (!f1 || !f2) throw new Error("Expected 2 finalists but got undefined");

    let f1Votes = 0;
    let f2Votes = 0;

    for (const [, target] of Object.entries(this._juryVoteTally.votes)) {
      if (target === f1) f1Votes++;
      if (target === f2) f2Votes++;
    }

    const voteCounts = [
      { id: f1, name: this.getPlayerName(f1), votes: f1Votes },
      { id: f2, name: this.getPlayerName(f2), votes: f2Votes },
    ];

    if (f1Votes > f2Votes) {
      this.appendCanonicalEvent("jury.winner_determined", {
        tally: { votes: { ...this._juryVoteTally.votes } },
        winnerId: f1,
        method: "majority",
        voteCounts,
      }, {
        phase: Phase.JURY_VOTE,
        visibility: "system",
      });
      return { winnerId: f1, method: "majority", voteCounts };
    }
    if (f2Votes > f1Votes) {
      this.appendCanonicalEvent("jury.winner_determined", {
        tally: { votes: { ...this._juryVoteTally.votes } },
        winnerId: f2,
        method: "majority",
        voteCounts,
      }, {
        phase: Phase.JURY_VOTE,
        visibility: "system",
      });
      return { winnerId: f2, method: "majority", voteCounts };
    }

    // Tiebreaker: cumulative empower votes (social capital)
    const f1Empower = this.getCumulativeEmpowerVotes(f1);
    const f2Empower = this.getCumulativeEmpowerVotes(f2);

    if (f1Empower > f2Empower) {
      this.appendCanonicalEvent("jury.winner_determined", {
        tally: { votes: { ...this._juryVoteTally.votes } },
        winnerId: f1,
        method: "empower_tiebreaker",
        voteCounts,
      }, {
        phase: Phase.JURY_VOTE,
        visibility: "system",
      });
      return { winnerId: f1, method: "empower_tiebreaker", voteCounts };
    }
    if (f2Empower > f1Empower) {
      this.appendCanonicalEvent("jury.winner_determined", {
        tally: { votes: { ...this._juryVoteTally.votes } },
        winnerId: f2,
        method: "empower_tiebreaker",
        voteCounts,
      }, {
        phase: Phase.JURY_VOTE,
        visibility: "system",
      });
      return { winnerId: f2, method: "empower_tiebreaker", voteCounts };
    }

    // Ultimate fallback: random
    const winnerId = Math.random() < 0.5 ? f1 : f2;
    this.appendCanonicalEvent("jury.winner_determined", {
      tally: { votes: { ...this._juryVoteTally.votes } },
      winnerId,
      method: "random_tiebreaker",
      voteCounts,
    }, {
      phase: Phase.JURY_VOTE,
      visibility: "system",
    });
    return { winnerId, method: "random_tiebreaker", voteCounts };
  }

  // ---------------------------------------------------------------------------
  // Round result recording
  // ---------------------------------------------------------------------------

  recordRoundResult(result: RoundResult): void {
    this.appendCanonicalEvent("round.result_recorded", { result: { ...result } }, {
      phase: Phase.COUNCIL,
      visibility: "system",
    });
    this._roundResults.push(result);
  }

  getDomainProjection(): CanonicalGameProjection {
    return replayCanonicalEvents(this.getCanonicalEvents());
  }

  // ---------------------------------------------------------------------------
  // Transcript helpers
  // ---------------------------------------------------------------------------

  describeState(): string {
    const alive = this.getAlivePlayers()
      .map((p) => `${p.name}${p.shielded ? " (shielded)" : ""}`)
      .join(", ");
    const stage = this._endgameStage ? ` [${this._endgameStage.toUpperCase()}]` : "";
    return `Round ${this._round}${stage} | Alive: ${alive}`;
  }
}
