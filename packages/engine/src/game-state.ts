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
import { replayCanonicalEvents, type CanonicalGameProjection } from "./game-projection";
import type {
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

interface AppendCanonicalEventOptions {
  phase?: Phase | null;
  round?: number;
  source?: CanonicalEventSource;
  visibility?: CanonicalEventVisibility;
  sourcePointers?: CanonicalSourcePointer[];
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
  private _councilCandidates: [UUID, UUID] | null = null;
  private _powerAction: PowerAction | null = null;

  // --- Room allocation history ---
  private _roomAllocations = new Map<
    number,
    { rooms: RoomAllocation[]; excluded: UUID[]; lastSessionExcluded: UUID[] }
  >();

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

  recordRoomAllocations(rooms: RoomAllocation[], excluded: UUID[], lastSessionExcluded = excluded): void {
    this.appendCanonicalEvent("mingle.rooms_allocated", {
      round: this._round,
      rooms: rooms.map((room) => ({ ...room, playerIds: [...room.playerIds] })),
      excluded: [...excluded],
      lastSessionExcluded: [...lastSessionExcluded],
    }, {
      phase: Phase.MINGLE,
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
  determineCandidates(): {
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

    // Empowered player cannot be exposed or considered for council (per rule).
    // Exclude them from eligibility *before* sorting so the top exposed are always
    // chosen from non-empowered players. (Raw expose votes on them are still
    // recorded for memory/transcripts, but do not create council pressure.)
    const empowered = this._empoweredId;
    const eligibleForCouncil = alive.filter((id) => id !== empowered);
    const sorted = eligibleForCouncil.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

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

    // Start with top 2 (guaranteed non-empowered by the eligible sort above)
    let candidateList = [...sorted];

    // Remove shielded players from eligibility
    candidateList = candidateList.filter(
      (id) => !this._players.get(id)?.shielded,
    );

    // Explicit defense-in-depth: never allow the empowered into the final list
    // (in case of any future path that re-introduces them).
    if (empowered) {
      candidateList = candidateList.filter((id) => id !== empowered);
    }

    let shieldGranted: UUID | null = null;
    if (action === "protect" && target && this._empoweredId) {
      // Protected player is not a candidate; they gain a shield
      shieldGranted = target;
      candidateList = candidateList.filter((id) => id !== target);
    }

    // Pick top 2; if fewer than 2, empowered fills from remaining alive non-shielded
    const top2: UUID[] = candidateList.slice(0, 2);

    while (top2.length < 2) {
      const eligible = alive.filter(
        (id) =>
          !top2.includes(id) &&
          !this._players.get(id)?.shielded &&
          id !== this._empoweredId,
      );
      if (eligible.length === 0) {
        // Last resort: pick anyone alive not already in top2
        const anyone = alive.find((id) => !top2.includes(id));
        if (anyone) top2.push(anyone);
        else break;
      } else {
        const pick = eligible[Math.floor(Math.random() * eligible.length)];
        if (!pick) throw new Error("Expected eligible player but got undefined");
        top2.push(pick);
      }
    }

    if (top2.length < 2) {
      // Not enough candidates; game should end
      this.appendCanonicalEvent("power.candidates_resolved", {
        exposeScores: scores,
        candidates: null,
        autoEliminated: null,
        shieldGranted,
        method: "insufficient_candidates",
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

    const candidate0 = top2[0];
    const candidate1 = top2[1];
    if (!candidate0 || !candidate1) throw new Error("Expected 2 council candidates but got fewer");
    const candidates: [UUID, UUID] = [candidate0, candidate1];
    this.appendCanonicalEvent("power.candidates_resolved", {
      exposeScores: scores,
      candidates,
      autoEliminated: null,
      shieldGranted,
      method: "expose_scores",
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
