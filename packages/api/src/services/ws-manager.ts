/**
 * WebSocket Manager
 *
 * Manages WebSocket connections for live game observation.
 * Uses Bun's native pub/sub for efficient per-game broadcasting.
 */

import type { ServerWebSocket } from "bun";
import type { GameStreamEvent, GameStateSnapshot } from "@influence/engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsConnectionData {
  gameId: string;
}

/** Event shape sent to WebSocket clients (matches WsGameEvent in web/lib/api.ts) */
export type WsOutboundEvent =
  | { type: "game_state"; snapshot: GameStateSnapshot }
  | { type: "phase_change"; phase: string; round: number; alivePlayers: string[] }
  | { type: "message"; entry: { round: number; phase: string; from: string; scope: string; to?: string[]; text: string; timestamp: number } }
  | { type: "player_eliminated"; playerId: string; playerName: string; round: number }
  | { type: "game_over"; winner?: string; winnerName?: string; totalRounds: number }
  | { type: "error"; message: string };

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
    case "transcript_entry":
      outbound = { type: "message", entry: event.entry };
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

/** Send a state snapshot to a single client (for catch-up on connect). */
export function sendSnapshot(
  ws: ServerWebSocket<WsConnectionData>,
  snapshot: GameStateSnapshot,
): void {
  const outbound: WsOutboundEvent = { type: "game_state", snapshot };
  ws.send(JSON.stringify(outbound));
}

/** Get the number of active observers for a game. */
export function getObserverCount(gameId: string): number {
  return gameObserverCount.get(gameId) ?? 0;
}
