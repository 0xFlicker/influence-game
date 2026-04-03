/**
 * Influence Game - Context Builder
 *
 * Builds PhaseContext objects passed to agents during game phases.
 */

import type { GameState } from "./game-state";
import type { TranscriptLogger } from "./transcript-logger";
import type { UUID, RoomAllocation, JuryMember } from "./types";
import { Phase } from "./types";
import type { PhaseContext, IAgent } from "./game-runner.types";
import { computeJurySize } from "./types";

export class ContextBuilder {
  /** Room allocations for the current round */
  currentRoomAllocations: RoomAllocation[] = [];
  /** Players excluded from rooms this round */
  currentExcludedPlayerIds: UUID[] = [];

  constructor(
    private readonly gameState: GameState,
    private readonly logger: TranscriptLogger,
    private readonly whisperInbox: Map<UUID, Array<{ from: string; text: string }>>,
    private readonly totalPlayerCount: number,
  ) {}

  /**
   * Get the active jury — the last N eliminated players based on game size.
   * Early eliminations don't earn jury seats.
   */
  getActiveJury(): readonly JuryMember[] {
    const maxJurors = computeJurySize(this.totalPlayerCount);
    const allJurors = this.gameState.jury;
    if (allJurors.length <= maxJurors) return allJurors;
    return allJurors.slice(allJurors.length - maxJurors);
  }

  buildPhaseContext(
    agentId: UUID,
    phase: Phase,
    extra?: { empoweredId?: UUID; councilCandidates?: [UUID, UUID] },
    isEliminated?: boolean,
    roomInfo?: { roomCount?: number; roomPartner?: string },
  ): PhaseContext {
    const player = this.gameState.getPlayer(agentId)!;

    const roomAllocations = this.currentRoomAllocations.length > 0
      ? this.currentRoomAllocations.map((r) => ({
          roomId: r.roomId,
          playerA: this.gameState.getPlayerName(r.playerA),
          playerB: this.gameState.getPlayerName(r.playerB),
        }))
      : undefined;
    const excludedPlayers = this.currentExcludedPlayerIds.length > 0
      ? this.currentExcludedPlayerIds.map((id) => this.gameState.getPlayerName(id))
      : undefined;

    return {
      gameId: this.gameState.gameId,
      round: this.gameState.round,
      phase,
      selfId: agentId,
      selfName: player.name,
      alivePlayers: this.gameState.getAlivePlayers().map((p) => ({ id: p.id, name: p.name })),
      publicMessages: [...this.logger.publicMessages],
      whisperMessages: this.whisperInbox.get(agentId) ?? [],
      empoweredId: extra?.empoweredId ?? this.gameState.empoweredId ?? undefined,
      councilCandidates: extra?.councilCandidates ?? this.gameState.councilCandidates ?? undefined,
      roomCount: roomInfo?.roomCount,
      roomAllocations,
      excludedPlayers,
      roomPartner: roomInfo?.roomPartner,
      endgameStage: this.gameState.endgameStage ?? undefined,
      jury: this.gameState.jury.length > 0 ? [...this.getActiveJury()] : undefined,
      finalists: (() => {
        const alivePlayers = this.gameState.getAlivePlayers();
        if (alivePlayers.length !== 2) return undefined;
        const f0 = alivePlayers[0];
        const f1 = alivePlayers[1];
        if (!f0 || !f1) return undefined;
        return [f0.id, f1.id] as [UUID, UUID];
      })(),
      isEliminated: isEliminated ?? false,
    };
  }
}
