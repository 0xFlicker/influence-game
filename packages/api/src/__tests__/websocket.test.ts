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
  broadcastRaw,
  broadcastWatchState,
  sendWatchState,
  getObserverCount,
  type WsConnectionData,
} from "../services/ws-manager.js";
import { Phase } from "@influence/engine";
import type { GameStreamEvent } from "@influence/engine";
import type { GameWatchState } from "../services/game-watch-state.js";

type TranscriptEntryEvent = Extract<GameStreamEvent, { type: "transcript_entry" }>;
type TranscriptEntryWithPrivateFields = TranscriptEntryEvent["entry"] & {
  decisionLog: string;
  privateTraceManifest: { bucket: string; key: string; marker: string };
  prompt: string;
  providerPayload: { marker: string };
  rawResponse: { marker: string };
  sourcePointers: Array<{ marker: string }>;
  storageKey: string;
};

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

  test("broadcastGameEvent preserves thinking while stripping reasoning context from transcript entries", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "transcript_entry",
      entry: {
        round: 1,
        phase: Phase.MINGLE,
        timestamp: Date.now(),
        from: "Alice",
        scope: "mingle",
        text: "Let's compare notes.",
        thinking: "Viewer-facing strategy note.",
        reasoningContext: "Native hidden reasoning context.",
      },
    };

    broadcastGameEvent("game-private", event);

    const parsed = JSON.parse(published[0]!.data);
    expect(parsed.type).toBe("message");
    expect(parsed.entry.text).toBe("Let's compare notes.");
    expect(parsed.entry.thinking).toBe("Viewer-facing strategy note.");
    expect(parsed.entry.reasoningContext).toBeUndefined();
  });

  test("broadcastGameEvent preserves thinking-scope transcript entries", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "transcript_entry",
      entry: {
        round: 1,
        phase: Phase.MINGLE,
        timestamp: Date.now(),
        from: "Alice",
        scope: "thinking",
        text: "Strategic read for viewers.",
        reasoningContext: "Native hidden reasoning context.",
      },
    };

    broadcastGameEvent("game-private", event);

    expect(published).toHaveLength(1);
    const parsed = JSON.parse(published[0]!.data);
    expect(parsed.type).toBe("message");
    expect(parsed.entry.scope).toBe("thinking");
    expect(parsed.entry.text).toBe("Strategic read for viewers.");
    expect(parsed.entry.reasoningContext).toBeUndefined();
  });

  test("broadcastGameEvent preserves room metadata on transcript entries", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "transcript_entry",
      entry: {
        round: 1,
        phase: Phase.MINGLE,
        timestamp: Date.now(),
        from: "House",
        scope: "system",
        text: "Beat 1: Room 1: Alice, Bob | Room 2: Empty",
        roomMetadata: {
          rooms: [
            { roomId: 1, round: 1, beat: 1, playerIds: ["p1", "p2"] },
            { roomId: 2, round: 1, beat: 1, playerIds: [] },
          ],
          excluded: [],
        },
      },
    };

    broadcastGameEvent("game-rooms", event);

    const parsed = JSON.parse(published[0]!.data);
    expect(parsed.type).toBe("message");
    expect(parsed.entry).toEqual({
      round: 1,
      phase: Phase.MINGLE,
      timestamp: event.entry.timestamp,
      from: "House",
      scope: "system",
      text: "Beat 1: Room 1: Alice, Bob | Room 2: Empty",
      roomMetadata: {
        rooms: [
          { roomId: 1, round: 1, beat: 1, playerIds: ["p1", "p2"] },
          { roomId: 2, round: 1, beat: 1, playerIds: [] },
        ],
        excluded: [],
      },
    });
    expect(parsed.entry.roomMetadata.rooms).toHaveLength(2);
    expect(parsed.entry.roomMetadata.rooms[1].playerIds).toEqual([]);
  });

  test("broadcastGameEvent serializes only the public transcript message fields", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const entry: TranscriptEntryWithPrivateFields = {
      round: 2,
      phase: Phase.MINGLE,
      timestamp: Date.now(),
      from: "Alice",
      scope: "mingle",
      to: ["p2"],
      roomId: 3,
      roomMetadata: {
        rooms: [{ roomId: 3, round: 2, beat: 1, playerIds: ["p1", "p2"] }],
        excluded: ["p4"],
        diagnostics: {
          round: 2,
          beat: 1,
          roomCount: 3,
          eligiblePlayers: [{ id: "p1", name: "Alice" }],
          assignments: [
            {
              player: { id: "p1", name: "Alice" },
              assignedRoomId: 3,
              source: "house",
              repairNotes: ["PRIVATE_REPAIR_NOTE_SENTINEL"],
              intent: {
                seekPlayers: ["Bob"],
                avoidPlayers: ["Charlie"],
                preferredRoomSize: "pair",
                purpose: "PRIVATE_ROOM_INTENT_SENTINEL",
                provisionalTarget: "Charlie",
                noTargetReason: null,
                openingAsk: "PRIVATE_OPENING_ASK_SENTINEL",
                strategicLens: "room_traffic",
                strategicLensRationale: "PRIVATE_STRATEGIC_LENS_SENTINEL",
              },
            },
          ],
          allocatedRooms: [
            {
              roomId: 3,
              beat: 1,
              players: [{ id: "p1", name: "Alice" }],
              conversationRan: true,
            },
          ],
          actions: [
            {
              player: { id: "p1", name: "Alice" },
              turn: 1,
              fromRoomId: 3,
              toRoomId: 3,
              moved: false,
              action: "talk",
              gotoRoomId: null,
              gotoPlayerName: "PRIVATE_GOTO_PLAYER_SENTINEL",
              gotoStatus: "valid",
            },
          ],
        },
      },
      text: "Let's keep this room aligned.",
      thinking: "PUBLIC_THINKING_SENTINEL",
      anonymous: true,
      displayOrder: 2,
      reasoningContext: "PRIVATE_REASONING_SENTINEL",
      decisionLog: "PRIVATE_DECISION_LOG_SENTINEL",
      privateTraceManifest: {
        bucket: "PRIVATE_TRACE_BUCKET_SENTINEL",
        key: "PRIVATE_TRACE_STORAGE_KEY_SENTINEL",
        marker: "PRIVATE_TRACE_MARKER_SENTINEL",
      },
      prompt: "PRIVATE_PROMPT_SENTINEL",
      providerPayload: { marker: "PRIVATE_PROVIDER_PAYLOAD_SENTINEL" },
      rawResponse: { marker: "PRIVATE_RAW_RESPONSE_SENTINEL" },
      sourcePointers: [{ marker: "PRIVATE_SOURCE_POINTER_SENTINEL" }],
      storageKey: "PRIVATE_STORAGE_KEY_SENTINEL",
    };
    const event: GameStreamEvent = { type: "transcript_entry", entry };

    broadcastGameEvent("game-sentinel", event);

    const parsed = JSON.parse(published[0]!.data);
    expect(parsed).toEqual({
      type: "message",
      entry: {
        round: 2,
        phase: Phase.MINGLE,
        timestamp: entry.timestamp,
        from: "Alice",
        scope: "mingle",
        to: ["p2"],
        roomId: 3,
        roomMetadata: {
          rooms: [{ roomId: 3, round: 2, beat: 1, playerIds: ["p1", "p2"] }],
          excluded: ["p4"],
        },
        text: "Let's keep this room aligned.",
        thinking: "PUBLIC_THINKING_SENTINEL",
        anonymous: true,
        displayOrder: 2,
      },
    });

    const serialized = JSON.stringify(parsed);
    expect(serialized).toContain("PUBLIC_THINKING_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_REASONING_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_DECISION_LOG_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_TRACE_BUCKET_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_TRACE_STORAGE_KEY_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_TRACE_MARKER_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_PROMPT_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_PROVIDER_PAYLOAD_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_RAW_RESPONSE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_SOURCE_POINTER_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_STORAGE_KEY_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_REPAIR_NOTE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_ROOM_INTENT_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_OPENING_ASK_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_STRATEGIC_LENS_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_GOTO_PLAYER_SENTINEL");
  });

  test("broadcastGameEvent ignores internal agent_turn events", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const event: GameStreamEvent = {
      type: "agent_turn",
      round: 1,
      phase: Phase.VOTE,
      timestamp: Date.now(),
      action: "vote",
      actor: { id: "p1", name: "Alice", role: "player" },
      visibility: "private",
      response: {
        empowerTarget: { id: "p2", name: "Bob" },
        exposeTarget: { id: "p3", name: "Charlie" },
        decisionLog: "Private strategic receipt that must not be broadcast.",
      },
      thinking: "Keep Bob close and pressure Charlie.",
    };

    broadcastGameEvent("game-123", event);

    expect(published).toHaveLength(0);
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

  test("broadcastRaw publishes terminal game_status events", () => {
    const { server, published } = createMockServer();
    setServer(server);

    broadcastRaw("game-suspended", {
      type: "game_status",
      gameId: "game-suspended",
      status: "suspended",
      terminal: true,
      reasonCode: "runner_failed",
      message: "Game suspended.",
    });

    expect(published[0]!.topic).toBe("game:game-suspended");
    const parsed = JSON.parse(published[0]!.data);
    expect(parsed).toEqual({
      type: "game_status",
      gameId: "game-suspended",
      status: "suspended",
      terminal: true,
      reasonCode: "runner_failed",
      message: "Game suspended.",
    });
  });

  test("broadcastRaw ignores message events that bypass the TypeScript boundary", () => {
    const { server, published } = createMockServer();
    setServer(server);

    const unsafeMessage = {
      type: "message",
      entry: {
        round: 1,
        phase: Phase.MINGLE,
        timestamp: Date.now(),
        from: "Alice",
        scope: "mingle",
        text: "Unsafe raw message",
        reasoningContext: "PRIVATE_RAW_BYPASS_SENTINEL",
      },
    } as unknown as Parameters<typeof broadcastRaw>[1];

    broadcastRaw("game-unsafe-raw", unsafeMessage);

    expect(published).toHaveLength(0);
  });

  test("sendWatchState sends watch_state event to single client", () => {
    const { ws, sent } = createMockWs("game-123");

    const state = watchStateFixture("game-123", 7);

    sendWatchState(ws, state);

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]!);
    expect(parsed.type).toBe("watch_state");
    expect(parsed.state.gameId).toBe("game-123");
    expect(parsed.state.eventCursor.sequence).toBe(7);
    expect(JSON.stringify(parsed)).not.toContain("thinking");
    expect(JSON.stringify(parsed)).not.toContain("reasoningContext");
  });

  test("broadcastWatchState publishes watch_state updates with cursor", () => {
    const { server, published } = createMockServer();
    setServer(server);

    broadcastWatchState("game-watch", watchStateFixture("game-watch", 11));

    expect(published[0]!.topic).toBe("game:game-watch");
    const parsed = JSON.parse(published[0]!.data);
    expect(parsed).toMatchObject({
      type: "watch_state",
      state: {
        gameId: "game-watch",
        eventCursor: { sequence: 11 },
        projection: { availability: "available" },
      },
    });
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

function watchStateFixture(gameId: string, sequence: number): GameWatchState {
  return {
    schemaVersion: 1,
    gameId,
    status: "in_progress",
    source: "durable_projection",
    currentRound: 2,
    currentPhase: "LOBBY",
    maxRounds: 9,
    eventCursor: {
      sequence,
      source: "trusted_prefix",
      eventType: "round.started",
      createdAt: "2026-06-20T00:00:00.000Z",
    },
    projection: {
      availability: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      eventCount: sequence,
      trustedEventCount: sequence,
      validPrefixLength: sequence,
      lastTrustedSequence: sequence,
      diagnostics: [],
    },
    players: [
      { id: "p1", name: "Alice", persona: "strategic", status: "alive", shielded: false },
      { id: "p2", name: "Bob", persona: "social", status: "alive", shielded: true },
      { id: "p3", name: "Charlie", persona: "honest", status: "eliminated", shielded: false },
    ],
    counts: {
      totalPlayers: 3,
      alivePlayers: 2,
      eliminatedPlayers: 1,
      unknownPlayers: 0,
    },
    final: { status: "not_final" },
  };
}
