/**
 * Influence Game - Transcript Logger
 *
 * Handles all transcript logging and stream event emission for the game runner.
 */

import type { GameState } from "./game-state";
import type { RoomAllocation, WhisperSessionDiagnostics } from "./types";
import { Phase } from "./types";
import type { TranscriptEntry, GameStreamEvent } from "./game-runner.types";

export class TranscriptLogger {
  readonly transcript: TranscriptEntry[] = [];
  readonly publicMessages: Array<{ from: string; text: string; phase: Phase; round: number; anonymous?: boolean; displayOrder?: number }> = [];
  private _streamListener?: (event: GameStreamEvent) => void;

  constructor(private readonly gameState: GameState) {}

  setStreamListener(listener: (event: GameStreamEvent) => void): void {
    this._streamListener = listener;
  }

  emitStream(event: GameStreamEvent): void {
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

  logPublic(
    fromId: string,
    text: string,
    phase: Phase,
    opts?: { anonymous?: boolean; displayOrder?: number; thinking?: string },
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
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logWhisper(fromId: string, toIds: string[], text: string, roomId?: number, thinking?: string): void {
    const fromName = this.gameState.getPlayerName(fromId);
    const toNames = toIds.map((id) => this.gameState.getPlayerName(id));
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.WHISPER,
      timestamp: Date.now(),
      from: fromName,
      scope: "whisper",
      to: toNames,
      text,
      ...(roomId != null && { roomId }),
      ...(thinking && { thinking }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logRoomAllocation(
    text: string,
    rooms: RoomAllocation[],
    excludedNames: string[],
    diagnostics?: WhisperSessionDiagnostics,
  ): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.WHISPER,
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
  }

  logSystem(text: string, phase: Phase): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logDiary(from: string, text: string, thinking?: string): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.DIARY_ROOM,
      timestamp: Date.now(),
      from,
      scope: "diary",
      text,
      ...(thinking && { thinking }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  logThinking(fromId: string, text: string, phase: Phase): void {
    const name = this.gameState.getPlayerName(fromId);
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: name,
      scope: "thinking",
      text,
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }
}
