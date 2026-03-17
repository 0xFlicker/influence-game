/**
 * Influence Game - Game State Manager
 *
 * Handles all mutable game state: players, votes, shields, elimination.
 * Pure TypeScript — no xstate, no ElizaOS.
 */

import { randomUUID } from "crypto";
import type {
  UUID,
  Player,
  VoteTally,
  CouncilVoteTally,
  RoundResult,
  PowerAction,
} from "./types";
import { PlayerStatus, Phase } from "./types";

export function createUUID(): UUID {
  return randomUUID();
}

export class GameState {
  readonly gameId: UUID;
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

  constructor(players: { id: UUID; name: string }[]) {
    this.gameId = createUUID();
    for (const p of players) {
      this._players.set(p.id, {
        id: p.id,
        name: p.name,
        status: PlayerStatus.ALIVE,
        shielded: false,
      });
    }
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

  isGameOver(): boolean {
    return this.getAlivePlayers().length <= 1;
  }

  getWinner(): Player | undefined {
    const alive = this.getAlivePlayers();
    return alive.length === 1 ? alive[0] : undefined;
  }

  // ---------------------------------------------------------------------------
  // Round management
  // ---------------------------------------------------------------------------

  startRound(): void {
    this._round += 1;
    // Reset round-specific state
    this._currentVoteTally = { empowerVotes: {}, exposeVotes: {} };
    this._currentCouncilTally = { votes: {} };
    this._empoweredId = null;
    this._councilCandidates = null;
    this._powerAction = null;

    // Shields expire at the start of each new round (they last one round)
    for (const player of this._players.values()) {
      // Shields set in PREVIOUS round's POWER phase expire now
      // (They were set when protecting; we clear after the round they protected)
    }
  }

  expireShields(): void {
    for (const player of this._players.values()) {
      if (player.shielded) {
        this._players.set(player.id, { ...player, shielded: false });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // VOTE phase
  // ---------------------------------------------------------------------------

  recordVote(voterId: UUID, empowerTarget: UUID, exposeTarget: UUID): void {
    const voter = this._players.get(voterId);
    if (!voter || voter.status !== PlayerStatus.ALIVE) return;

    this._currentVoteTally.empowerVotes[voterId] = empowerTarget;
    this._currentVoteTally.exposeVotes[voterId] = exposeTarget;
  }

  recordLastMessage(playerId: UUID, message: string): void {
    const player = this._players.get(playerId);
    if (!player) return;
    this._players.set(playerId, { ...player, lastMessage: message });
  }

  /**
   * Tally votes and determine the empowered agent.
   * Returns the empowered player ID.
   */
  tallyEmpowerVotes(): UUID {
    const alive = this.getAlivePlayerIds();
    const counts: Record<UUID, number> = {};
    for (const id of alive) counts[id] = 0;

    for (const [, target] of Object.entries(
      this._currentVoteTally.empowerVotes,
    )) {
      if (target in counts) counts[target]++;
    }

    const maxVotes = Math.max(...Object.values(counts), 0);

    if (maxVotes === 0) {
      // Zero empower votes — pick randomly
      const empowered = alive[Math.floor(Math.random() * alive.length)];
      this._empoweredId = empowered;
      return empowered;
    }

    const tied = alive.filter((id) => counts[id] === maxVotes);
    const empowered = tied[Math.floor(Math.random() * tied.length)];
    this._empoweredId = empowered;
    return empowered;
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
      if (target in counts) counts[target]++;
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // POWER phase
  // ---------------------------------------------------------------------------

  setPowerAction(action: PowerAction): void {
    this._powerAction = action;
  }

  /**
   * Determine the two council candidates after power action is applied.
   *
   * Rules:
   * 1. Start with top 2 by expose votes.
   * 2. If empowered uses protect: protected player is replaced by next most-exposed
   *    (or empowered picks if tied/insufficient). Protected player gets shield.
   * 3. If auto: immediately eliminate the target, skip council.
   * 4. If 2 players left: skip expose; empowered chooses directly.
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
        this._councilCandidates = [others[0], others[0]]; // only one choice
        return {
          candidates: this._councilCandidates,
          autoEliminated: null,
          shieldGranted: null,
        };
      }
    }

    const scores = this.getExposeScores();
    const sorted = alive.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

    const action = this._powerAction?.action ?? "pass";
    const target = this._powerAction?.target;

    if (action === "eliminate" && target) {
      // Auto-eliminate: skip council
      return { candidates: null, autoEliminated: target, shieldGranted: null };
    }

    // Start with top 2
    let candidateList = [...sorted];

    // Remove shielded players from eligibility
    candidateList = candidateList.filter(
      (id) => !this._players.get(id)?.shielded,
    );

    if (action === "protect" && target && this._empoweredId) {
      // Protected player is not a candidate; they gain a shield
      const player = this._players.get(target);
      if (player) {
        this._players.set(target, { ...player, shielded: true });
      }
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
        top2.push(eligible[Math.floor(Math.random() * eligible.length)]);
      }
    }

    if (top2.length < 2) {
      // Not enough candidates; game should end
      return { candidates: null, autoEliminated: null, shieldGranted: null };
    }

    this._councilCandidates = [top2[0], top2[1]];
    return {
      candidates: this._councilCandidates,
      autoEliminated: null,
      shieldGranted: action === "protect" ? target ?? null : null,
    };
  }

  // ---------------------------------------------------------------------------
  // COUNCIL phase
  // ---------------------------------------------------------------------------

  recordCouncilVote(voterId: UUID, target: UUID): void {
    this._currentCouncilTally.votes[voterId] = target;
  }

  /**
   * Tally council votes and eliminate a candidate.
   * Tie → empowered agent decides.
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

    if (c1Votes > c2Votes) return c1;
    if (c2Votes > c1Votes) return c2;

    // Tie: empowered decides — use their recorded council vote if any
    const empoweredVote = this._currentCouncilTally.votes[empoweredId];
    if (empoweredVote === c1 || empoweredVote === c2) return empoweredVote;

    // Fallback: random
    return Math.random() < 0.5 ? c1 : c2;
  }

  // ---------------------------------------------------------------------------
  // Elimination
  // ---------------------------------------------------------------------------

  eliminatePlayer(id: UUID): void {
    const player = this._players.get(id);
    if (!player) return;
    this._players.set(id, { ...player, status: PlayerStatus.ELIMINATED });
  }

  // ---------------------------------------------------------------------------
  // Round result recording
  // ---------------------------------------------------------------------------

  recordRoundResult(result: RoundResult): void {
    this._roundResults.push(result);
  }

  // ---------------------------------------------------------------------------
  // Transcript helpers
  // ---------------------------------------------------------------------------

  describeState(): string {
    const alive = this.getAlivePlayers()
      .map((p) => `${p.name}${p.shielded ? " (shielded)" : ""}`)
      .join(", ");
    return `Round ${this._round} | Alive: ${alive}`;
  }
}
