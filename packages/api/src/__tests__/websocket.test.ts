/**
 * WebSocket real-time game streaming tests.
 *
 * Tests the WS manager module in isolation (no real Bun server needed).
 * Verifies event translation, observer tracking, and snapshot delivery.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  setServer,
  handleOpen,
  handleClose,
  broadcastGameEvent,
  sendSnapshot,
  getObserverCount,
  type WsConnectionData,
} from "../services/ws-manager.js";
import { Phase } from "@influence/engine";
import type { GameStreamEvent, GameStateSnapshot } from "@influence/engine";

// ---------------------------------------------------------------------------
// Mock WebSocket & Server
// ---------------------------------------------------------------------------

/** Collects messages sent and topics subscribed. */
function createMockWs(gameId: string) {
  const sent: string[] = [];
  const subscriptions = new Set<string>();

  const ws = {
    data: { gameId } as WsConnectionData,
    send(data: string) {
      sent.push(data);
    },
    subscribe(topic: string) {
      subscriptions.add(topic);
    },
    unsubscribe(topic: string) {
      subscriptions.delete(topic);
    },
  } as unknown as ServerWebSocket<WsConnectionData>;

  return { ws, sent, subscriptions };
}

function createMockServer() {
  const published: Array<{ topic: string; data: string }> = [];

  const server = {
    publish(topic: string, data: string) {
      published.push({ topic, data });
    },
  };

  return { server, published };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebSocket Manager", () => {
  beforeEach(() => {
    // Reset server reference
    setServer({ publish() {} });
  });

  test("handleOpen subscribes to game topic and increments observer count", () => {
    const { ws, subscriptions } = createMockWs("game-open-1");
    handleOpen(ws);

    expect(subscriptions.has("game:game-open-1")).toBe(true);
    expect(getObserverCount("game-open-1")).toBe(1);

    handleClose(ws); // cleanup
  });

  test("handleClose unsubscribes and decrements observer count", () => {
    const { ws } = createMockWs("game-close-1");
    handleOpen(ws);
    expect(getObserverCount("game-close-1")).toBe(1);

    handleClose(ws);
    expect(getObserverCount("game-close-1")).toBe(0);
  });

  test("multiple observers tracked correctly", () => {
    const { ws: ws1 } = createMockWs("game-multi-1");
    const { ws: ws2 } = createMockWs("game-multi-1");
    const { ws: ws3 } = createMockWs("game-multi-other");

    handleOpen(ws1);
    handleOpen(ws2);
    handleOpen(ws3);

    expect(getObserverCount("game-multi-1")).toBe(2);
    expect(getObserverCount("game-multi-other")).toBe(1);

    handleClose(ws1);
    expect(getObserverCount("game-multi-1")).toBe(1);

    handleClose(ws2);
    expect(getObserverCount("game-multi-1")).toBe(0);

    handleClose(ws3); // cleanup
  });

  test("broadcastGameEvent translates transcript_entry to message event", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "transcript_entry",
      entry: {
        round: 1,
        phase: Phase.LOBBY,
        timestamp: Date.now(),
        from: "Alice",
        scope: "public",
        text: "Hello everyone!",
      },
    };

    broadcastGameEvent("game-123", event);

    expect(published).toHaveLength(1);
    expect(published[0]!.topic).toBe("game:game-123");

    const parsed = JSON.parse(published[0]!.data);
    expect(parsed.type).toBe("message");
    expect(parsed.entry.from).toBe("Alice");
    expect(parsed.entry.text).toBe("Hello everyone!");
  });

  test("broadcastGameEvent translates phase_change", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "phase_change",
      phase: Phase.VOTE,
      round: 2,
      alivePlayers: [
        { id: "p1", name: "Alice" },
        { id: "p2", name: "Bob" },
      ],
    };

    broadcastGameEvent("game-123", event);

    const parsed = JSON.parse(published[0]!.data);
    expect(parsed.type).toBe("phase_change");
    expect(parsed.phase).toBe("VOTE");
    expect(parsed.round).toBe(2);
    expect(parsed.alivePlayers).toEqual(["p1", "p2"]);
  });

  test("broadcastGameEvent translates player_eliminated", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "player_eliminated",
      playerId: "p3",
      playerName: "Charlie",
      round: 3,
    };

    broadcastGameEvent("game-123", event);

    const parsed = JSON.parse(published[0]!.data);
    expect(parsed.type).toBe("player_eliminated");
    expect(parsed.playerId).toBe("p3");
    expect(parsed.playerName).toBe("Charlie");
    expect(parsed.round).toBe(3);
  });

  test("broadcastGameEvent translates game_over", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "game_over",
      winner: "p1",
      winnerName: "Alice",
      totalRounds: 5,
    };

    broadcastGameEvent("game-123", event);

    const parsed = JSON.parse(published[0]!.data);
    expect(parsed.type).toBe("game_over");
    expect(parsed.winner).toBe("p1");
    expect(parsed.winnerName).toBe("Alice");
    expect(parsed.totalRounds).toBe(5);
  });

  test("sendSnapshot sends game_state event to single client", () => {
    const { ws, sent } = createMockWs("game-123");

    const snapshot: GameStateSnapshot = {
      gameId: "game-123",
      round: 2,
      alivePlayers: [
        { id: "p1", name: "Alice", shielded: false },
        { id: "p2", name: "Bob", shielded: true },
      ],
      eliminatedPlayers: [{ id: "p3", name: "Charlie" }],
      transcript: [
        {
          round: 1,
          phase: Phase.LOBBY,
          timestamp: 1000,
          from: "Alice",
          scope: "public",
          text: "Hello!",
        },
      ],
    };

    sendSnapshot(ws, snapshot);

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]!);
    expect(parsed.type).toBe("game_state");
    expect(parsed.snapshot.gameId).toBe("game-123");
    expect(parsed.snapshot.alivePlayers).toHaveLength(2);
    expect(parsed.snapshot.eliminatedPlayers).toHaveLength(1);
    expect(parsed.snapshot.transcript).toHaveLength(1);
  });

  test("broadcastGameEvent does nothing without server", () => {
    // @ts-expect-error — intentionally clear server
    setServer(null);

    // Should not throw
    broadcastGameEvent("game-123", {
      type: "game_over",
      totalRounds: 1,
    });
  });
});
