/**
 * Influence Game - Transcript Logger
 *
 * Handles all transcript logging and stream event emission for the game runner.
 */

import type { GameState } from "./game-state";
import type { MingleSessionDiagnostics, RoomAllocation } from "./types";
import { Phase } from "./types";
import type { AgentTurnEvent, TranscriptEntry, GameStreamEvent } from "./game-runner.types";

type AgentTurnInput = Omit<AgentTurnEvent, "type" | "round" | "timestamp">;

export class TranscriptLogger {
  readonly transcript: TranscriptEntry[] = [];
  readonly publicMessages: Array<{ from: string; text: string; phase: Phase; round: number; anonymous?: boolean; displayOrder?: number }> = [];
  private _streamListener?: (event: GameStreamEvent) => void;
  private streamBuffer: GameStreamEvent[] | null = null;

  constructor(private readonly gameState: GameState) {}

  seed(entries: readonly TranscriptEntry[]): void {
    this.transcript.length = 0;
    this.publicMessages.length = 0;
    for (const entry of entries) {
      const seededEntry: TranscriptEntry = { ...entry };
      this.transcript.push(seededEntry);
      if (seededEntry.scope === "public") {
        this.publicMessages.push({
          from: seededEntry.from,
          text: seededEntry.text,
          phase: seededEntry.phase,
          round: seededEntry.round,
          ...(seededEntry.anonymous && { anonymous: true }),
          ...(seededEntry.displayOrder != null && { displayOrder: seededEntry.displayOrder }),
        });
      }
    }
  }

  setStreamListener(listener: (event: GameStreamEvent) => void): void {
    this._streamListener = listener;
  }

  beginStreamBuffering(): void {
    this.streamBuffer ??= [];
  }

  flushStreamBuffer(): void {
    const buffered = this.streamBuffer;
    this.streamBuffer = null;
    if (!buffered) return;
    for (const event of buffered) {
      this.deliverStreamEvent(event);
    }
  }

  dropStreamBuffer(): void {
    this.streamBuffer = null;
  }

  /** Whether the durable stream buffer is empty (post-flush boundary evidence). */
  isStreamBufferEmpty(): boolean {
    return this.streamBuffer === null || this.streamBuffer.length === 0;
  }

  emitStream(event: GameStreamEvent): void {
    if (this.streamBuffer) {
      this.streamBuffer.push(event);
      return;
    }
    this.deliverStreamEvent(event);
  }

  private deliverStreamEvent(event: GameStreamEvent): void {
    try {
      this._streamListener?.(event);
    } catch (err) {
      console.warn(`[game-runner] stream listener error on event="${event.type}":`, err instanceof Error ? err.message : err);
    }
  }

  emitPhaseChange(phase: Phase): void {
    const alivePlayers = this.gameState.getAlivePlayers().map((p) => ({ id: p.id, name: p.name }));
    this.emitStream({ type: "phase_change", phase, round: this.gameState.round, alivePlayers });
  }

  emitAgentTurn(input: AgentTurnInput): void {
    const event: AgentTurnEvent = {
      type: "agent_turn",
      round: this.gameState.round,
      timestamp: Date.now(),
      ...input,
    };
    this.emitStream(event);
  }

  logPublic(
    fromId: string,
    text: string,
    phase: Phase,
    opts?: { anonymous?: boolean; displayOrder?: number; thinking?: string; reasoningContext?: string },
  ): void {
    const name = this.gameState.getPlayerName(fromId);
    this.publicMessages.push({
      from: name,
      text,
      phase,
      round: this.gameState.round,
      ...(opts?.anonymous && { anonymous: true }),
      ...(opts?.displayOrder != null && { displayOrder: opts.displayOrder }),
    });
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: name,
      scope: "public",
      text,
      ...(opts?.anonymous && { anonymous: true }),
      ...(opts?.displayOrder != null && { displayOrder: opts.displayOrder }),
      ...(opts?.thinking && { thinking: opts.thinking }),
      ...(opts?.reasoningContext && { reasoningContext: opts.reasoningContext }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logMingleMessage(fromId: string, toIds: string[], text: string, roomId?: number, thinking?: string, reasoningContext?: string): void {
    const fromName = this.gameState.getPlayerName(fromId);
    const toNames = toIds.map((id) => this.gameState.getPlayerName(id));
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.MINGLE,
      timestamp: Date.now(),
      from: fromName,
      scope: "mingle",
      to: toNames,
      text,
      ...(roomId != null && { roomId }),
      ...(thinking && { thinking }),
      ...(reasoningContext && { reasoningContext }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logRoomAllocation(
    text: string,
    rooms: RoomAllocation[],
    excludedNames: string[],
    diagnostics?: MingleSessionDiagnostics,
  ): TranscriptEntry {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.MINGLE,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
      roomMetadata: {
        rooms,
        excluded: excludedNames,
        ...(diagnostics && { diagnostics }),
      },
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
    return entry;
  }

  logSystem(text: string, phase: Phase, thinking?: string, reasoningContext?: string): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
      ...(thinking && { thinking }),
      ...(reasoningContext && { reasoningContext }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logDiary(from: string, text: string, thinking?: string, reasoningContext?: string): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.DIARY_ROOM,
      timestamp: Date.now(),
      from,
      scope: "diary",
      text,
      ...(thinking && { thinking }),
      ...(reasoningContext && { reasoningContext }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logThinking(fromId: string, text: string, phase: Phase, reasoningContext?: string): void {
    const name = this.gameState.getPlayerName(fromId);
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: name,
      scope: "thinking",
      text,
      ...(reasoningContext && { reasoningContext }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }
}
