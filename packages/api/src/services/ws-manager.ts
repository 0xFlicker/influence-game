/**
 * WebSocket Manager
 *
 * Manages WebSocket connections for live game observation.
 * Uses Bun's native pub/sub for efficient per-game broadcasting.
 */

import type { ServerWebSocket } from "bun";
import type { GameStreamEvent, TranscriptEntry } from "@influence/engine";
import type { GameWatchState } from "./game-watch-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsConnectionData {
  gameId: string;
}

type PublicWsRoomMetadata = {
  rooms: Array<{
    roomId: number;
    round: number;
    beat: number;
    playerIds: string[];
  }>;
  excluded: string[];
};

/** Public transcript entry sent to WebSocket clients (matches WsTranscriptEntry in web/lib/api.ts). */
export interface PublicWsTranscriptEntry {
  round: TranscriptEntry["round"];
  phase: TranscriptEntry["phase"];
  from: TranscriptEntry["from"];
  scope: TranscriptEntry["scope"];
  to?: TranscriptEntry["to"];
  roomId?: TranscriptEntry["roomId"];
  roomMetadata?: PublicWsRoomMetadata;
  text: TranscriptEntry["text"];
  thinking?: TranscriptEntry["thinking"];
  anonymous?: TranscriptEntry["anonymous"];
  displayOrder?: TranscriptEntry["displayOrder"];
  timestamp: TranscriptEntry["timestamp"];
}

/** Event shape sent to WebSocket clients (matches WsGameEvent in web/lib/api.ts) */
export type WsOutboundEvent =
  | { type: "watch_state"; state: GameWatchState }
  | { type: "phase_change"; phase: string; round: number; alivePlayers: string[] }
  | { type: "message"; entry: PublicWsTranscriptEntry }
  | { type: "player_eliminated"; playerId: string; playerName: string; round: number }
  | { type: "game_over"; winner?: string; winnerName?: string; totalRounds: number }
  | { type: "game_status"; gameId: string; status: "suspended" | "cancelled"; terminal: true; reasonCode: string; message?: string }
  | { type: "error"; message: string };

type WsRawOutboundEvent = Exclude<WsOutboundEvent, { type: "message" }>;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Minimal interface for Bun server's publish method. */
interface WsPublisher {
  publish(topic: string, data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): void;
}

let _server: WsPublisher | null = null;

/** Track observer count per game for diagnostics. */
const gameObserverCount = new Map<string, number>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Bind the Bun Server instance so we can call server.publish(). */
export function setServer(server: WsPublisher): void {
  _server = server;
}

/** Topic name for a game's WebSocket channel. */
function gameTopic(gameId: string): string {
  return `game:${gameId}`;
}

function buildPublicRoomMetadata(
  roomMetadata: TranscriptEntry["roomMetadata"] | undefined,
): PublicWsRoomMetadata | undefined {
  if (!roomMetadata) return undefined;

  return {
    rooms: roomMetadata.rooms.map((room) => ({
      roomId: room.roomId,
      round: room.round,
      beat: room.beat,
      playerIds: [...room.playerIds],
    })),
    excluded: [...roomMetadata.excluded],
  };
}

function buildPublicTranscriptEntry(entry: TranscriptEntry): PublicWsTranscriptEntry {
  return {
    round: entry.round,
    phase: entry.phase,
    timestamp: entry.timestamp,
    from: entry.from,
    scope: entry.scope,
    to: entry.to,
    roomId: entry.roomId,
    roomMetadata: buildPublicRoomMetadata(entry.roomMetadata),
    text: entry.text,
    thinking: entry.thinking,
    anonymous: entry.anonymous,
    displayOrder: entry.displayOrder,
  };
}

function shouldBroadcastTranscriptEntry(entry: TranscriptEntry): boolean {
  return entry.scope !== "huddle";
}

/** Called when a new WebSocket connection opens. */
export function handleOpen(ws: ServerWebSocket<WsConnectionData>): void {
  const { gameId } = ws.data;
  ws.subscribe(gameTopic(gameId));
  gameObserverCount.set(gameId, (gameObserverCount.get(gameId) ?? 0) + 1);
}

/** Called when a WebSocket connection closes. */
export function handleClose(ws: ServerWebSocket<WsConnectionData>): void {
  const { gameId } = ws.data;
  ws.unsubscribe(gameTopic(gameId));
  const count = (gameObserverCount.get(gameId) ?? 1) - 1;
  if (count <= 0) {
    gameObserverCount.delete(gameId);
  } else {
    gameObserverCount.set(gameId, count);
  }
}

/** Broadcast a GameStreamEvent from the engine to all observers of a game. */
export function broadcastGameEvent(gameId: string, event: GameStreamEvent): void {
  if (!_server) return;

  let outbound: WsOutboundEvent;
  switch (event.type) {
    case "agent_turn":
      return;
    case "transcript_entry":
      if (!shouldBroadcastTranscriptEntry(event.entry)) return;
      outbound = { type: "message", entry: buildPublicTranscriptEntry(event.entry) };
      break;
    case "phase_change":
      outbound = {
        type: "phase_change",
        phase: event.phase,
        round: event.round,
        alivePlayers: event.alivePlayers.map((p) => p.id),
      };
      break;
    case "player_eliminated":
      outbound = {
        type: "player_eliminated",
        playerId: event.playerId,
        playerName: event.playerName,
        round: event.round,
      };
      break;
    case "game_over":
      outbound = {
        type: "game_over",
        winner: event.winner,
        winnerName: event.winnerName,
        totalRounds: event.totalRounds,
      };
      break;
  }

  _server.publish(gameTopic(gameId), JSON.stringify(outbound));
}

/** Broadcast a non-message WsOutboundEvent to all observers of a game. */
export function broadcastRaw(gameId: string, event: WsRawOutboundEvent): void {
  if (!_server) return;
  const outbound = event as WsOutboundEvent;
  if (outbound.type === "message") return;
  _server.publish(gameTopic(gameId), JSON.stringify(outbound));
}

/** Broadcast viewer-safe watch state to all observers of a game. */
export function broadcastWatchState(gameId: string, state: GameWatchState): void {
  broadcastRaw(gameId, { type: "watch_state", state });
}

/** Send viewer-safe watch state to a single client (for catch-up on connect). */
export function sendWatchState(
  ws: ServerWebSocket<WsConnectionData>,
  state: GameWatchState,
): void {
  const outbound: WsOutboundEvent = { type: "watch_state", state };
  ws.send(JSON.stringify(outbound));
}

/** Get the number of active observers for a game. */
export function getObserverCount(gameId: string): number {
  return gameObserverCount.get(gameId) ?? 0;
}
