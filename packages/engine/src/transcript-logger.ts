/**
 * Influence Game - Transcript Logger
 *
 * Handles all transcript logging and stream event emission for the game runner.
 * Assigns product dialogue sequences and normalized audience/context for
 * dialogue-bearing scopes (public, mingle, whisper, huddle, system).
 * Diary/thinking rows receive actor identity only — never dialogue sequence.
 */

import type { GameState } from "./game-state";
import type { MingleSessionDiagnostics, RoomAllocation, UUID } from "./types";
import { Phase } from "./types";
import type {
  AgentTurnEvent,
  TranscriptDialogueContext,
  TranscriptDialogueKind,
  TranscriptEntry,
  GameStreamEvent,
} from "./game-runner.types";

type AgentTurnInput = Omit<AgentTurnEvent, "type" | "round" | "timestamp">;

const DIALOGUE_SCOPES = new Set<TranscriptEntry["scope"]>([
  "public",
  "mingle",
  "huddle",
  "whisper",
  "system",
]);

export class TranscriptLogger {
  readonly transcript: TranscriptEntry[] = [];
  readonly publicMessages: Array<{ from: string; text: string; phase: Phase; round: number; anonymous?: boolean; displayOrder?: number }> = [];
  private _streamListener?: (event: GameStreamEvent) => void;
  private streamBuffer: GameStreamEvent[] | null = null;
  /** 1-based product dialogue sequence counter (dialogue scopes only). */
  private dialogueSequence = 0;

  constructor(private readonly gameState: GameState) {}

  seed(entries: readonly TranscriptEntry[]): void {
    this.transcript.length = 0;
    this.publicMessages.length = 0;
    this.dialogueSequence = 0;
    for (const entry of entries) {
      const seededEntry: TranscriptEntry = { ...entry };
      this.transcript.push(seededEntry);
      if (
        typeof seededEntry.entrySequence === "number" &&
        seededEntry.entrySequence > this.dialogueSequence
      ) {
        this.dialogueSequence = seededEntry.entrySequence;
      }
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

  private nextDialogueSequence(): number {
    this.dialogueSequence += 1;
    return this.dialogueSequence;
  }

  private pushDialogueEntry(entry: TranscriptEntry): void {
    if (!DIALOGUE_SCOPES.has(entry.scope)) {
      throw new Error(`pushDialogueEntry called for non-dialogue scope ${entry.scope}`);
    }
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  private pushNonDialogueEntry(entry: TranscriptEntry): void {
    if (DIALOGUE_SCOPES.has(entry.scope)) {
      throw new Error(`pushNonDialogueEntry called for dialogue scope ${entry.scope}`);
    }
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
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
      speakerPlayerId: fromId,
      entrySequence: this.nextDialogueSequence(),
      dialogueKind: "public_speech",
      audiencePlayerIds: [],
      dialogueContext: { version: 1 },
      ...(opts?.anonymous && { anonymous: true }),
      ...(opts?.displayOrder != null && { displayOrder: opts.displayOrder }),
      ...(opts?.thinking && { thinking: opts.thinking }),
      ...(opts?.reasoningContext && { reasoningContext: opts.reasoningContext }),
    };
    this.pushDialogueEntry(entry);
  }

  logMingleMessage(
    fromId: string,
    toIds: string[],
    text: string,
    roomId?: number,
    thinking?: string,
    reasoningContext?: string,
    phase: Phase.MINGLE | Phase.MINGLE_I | Phase.POST_VOTE_MINGLE = Phase.MINGLE,
  ): void {
    const fromName = this.gameState.getPlayerName(fromId);
    const toNames = toIds.map((id) => this.gameState.getPlayerName(id));
    const audience = dedupeIds(toIds);
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: fromName,
      scope: "mingle",
      to: toNames,
      text,
      speakerPlayerId: fromId,
      entrySequence: this.nextDialogueSequence(),
      dialogueKind: "mingle_speech",
      audiencePlayerIds: audience,
      dialogueContext: {
        version: 1,
        ...(roomId != null && { roomId }),
      },
      ...(roomId != null && { roomId }),
      ...(thinking && { thinking }),
      ...(reasoningContext && { reasoningContext }),
    };
    this.pushDialogueEntry(entry);
  }

  logHuddleMessage(
    fromId: string,
    toIds: string[],
    text: string,
    phase: Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE,
    thinking?: string,
    reasoningContext?: string,
    huddleContext?: {
      allianceId: string;
      scheduleId: string;
      sessionId: string;
      window?: string;
      /** Exact session-time audience including the speaker. */
      sessionAudiencePlayerIds: readonly string[];
    },
  ): void {
    const fromName = this.gameState.getPlayerName(fromId);
    const toNames = toIds.map((id) => this.gameState.getPlayerName(id));
    const sessionAudience = dedupeIds(
      huddleContext?.sessionAudiencePlayerIds ?? [fromId, ...toIds],
    );
    const dialogueContext: TranscriptDialogueContext = {
      version: 1,
      sessionAudiencePlayerIds: sessionAudience,
      ...(huddleContext?.allianceId && { allianceId: huddleContext.allianceId }),
      ...(huddleContext?.scheduleId && { scheduleId: huddleContext.scheduleId }),
      ...(huddleContext?.sessionId && { sessionId: huddleContext.sessionId }),
      ...(huddleContext?.window && { window: huddleContext.window }),
    };
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: fromName,
      scope: "huddle",
      to: toNames,
      text,
      speakerPlayerId: fromId,
      entrySequence: this.nextDialogueSequence(),
      dialogueKind: "huddle_speech",
      audiencePlayerIds: sessionAudience,
      dialogueContext,
      ...(thinking && { thinking }),
      ...(reasoningContext && { reasoningContext }),
    };
    this.pushDialogueEntry(entry);
  }

  logRoomAllocation(
    text: string,
    rooms: RoomAllocation[],
    excludedNames: string[],
    diagnostics?: MingleSessionDiagnostics,
    phase: Phase.MINGLE | Phase.MINGLE_I | Phase.POST_VOTE_MINGLE = Phase.MINGLE,
  ): TranscriptEntry {
    // Safe context excludes diagnostics (producer-only allocation detail).
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
      speakerPlayerId: null,
      entrySequence: this.nextDialogueSequence(),
      dialogueKind: "system_room_allocation",
      audiencePlayerIds: [],
      dialogueContext: { version: 1 },
      roomMetadata: {
        rooms,
        excluded: excludedNames,
        ...(diagnostics && { diagnostics }),
      },
    };
    this.pushDialogueEntry(entry);
    return entry;
  }

  logSystem(
    text: string,
    phase: Phase,
    thinking?: string,
    reasoningContext?: string,
    kind: TranscriptDialogueKind = "system_announcement",
  ): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
      speakerPlayerId: null,
      entrySequence: this.nextDialogueSequence(),
      dialogueKind: kind,
      audiencePlayerIds: [],
      dialogueContext: { version: 1 },
      ...(thinking && { thinking }),
      ...(reasoningContext && { reasoningContext }),
    };
    this.pushDialogueEntry(entry);
  }

  logDiary(from: string, text: string, thinking?: string, reasoningContext?: string): void {
    const speakerPlayerId = resolvePlayerIdByName(this.gameState, from);
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.DIARY_ROOM,
      timestamp: Date.now(),
      from,
      scope: "diary",
      text,
      speakerPlayerId,
      ...(thinking && { thinking }),
      ...(reasoningContext && { reasoningContext }),
    };
    this.pushNonDialogueEntry(entry);
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
      speakerPlayerId: fromId,
      ...(reasoningContext && { reasoningContext }),
    };
    this.pushNonDialogueEntry(entry);
  }
}

function dedupeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function resolvePlayerIdByName(gameState: GameState, name: string): UUID | null {
  const player = gameState.getAllPlayers().find((p) => p.name === name);
  return player?.id ?? null;
}
