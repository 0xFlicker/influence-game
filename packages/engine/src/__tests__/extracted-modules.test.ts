/**
 * Tests for extracted game-runner modules.
 *
 * Validates TranscriptLogger, ContextBuilder, DiaryRoom, and phase utility functions.
 * No LLM calls — fully deterministic.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { GameState, createUUID } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { ContextBuilder } from "../context-builder";
import { Phase } from "../types";
import type { UUID, RoomAllocation } from "../types";
import type { GameStreamEvent } from "../game-runner.types";
import { computeLobbyMessagesPerPlayer } from "../phases/lobby";
import { computeRoomCount, allocateRooms } from "../phases/whisper";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeGameState(names: string[]): GameState {
  return new GameState(names.map((name) => ({ id: createUUID(), name })));
}

// ---------------------------------------------------------------------------
// TranscriptLogger
// ---------------------------------------------------------------------------

describe("TranscriptLogger", () => {
  let gs: GameState;
  let logger: TranscriptLogger;

  beforeEach(() => {
    gs = makeGameState(["Alice", "Bob", "Charlie"]);
    gs.startRound();
    logger = new TranscriptLogger(gs);
  });

  it("logPublic adds to transcript and publicMessages", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logPublic(alice.id, "Hello everyone!", Phase.LOBBY);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.from).toBe("Alice");
    expect(logger.transcript[0]!.scope).toBe("public");
    expect(logger.transcript[0]!.text).toBe("Hello everyone!");
    expect(logger.publicMessages).toHaveLength(1);
    expect(logger.publicMessages[0]!.from).toBe("Alice");
  });

  it("logPublic with anonymous metadata", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logPublic(alice.id, "Anonymous rumor", Phase.RUMOR, { anonymous: true, displayOrder: 3 });

    expect(logger.transcript[0]!.anonymous).toBe(true);
    expect(logger.transcript[0]!.displayOrder).toBe(3);
    expect(logger.publicMessages[0]!.anonymous).toBe(true);
    expect(logger.publicMessages[0]!.displayOrder).toBe(3);
  });

  it("logWhisper adds whisper transcript entry", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    logger.logWhisper(alice.id, [bob.id], "Secret message", 1);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("whisper");
    expect(logger.transcript[0]!.from).toBe("Alice");
    expect(logger.transcript[0]!.to).toEqual(["Bob"]);
    expect(logger.transcript[0]!.roomId).toBe(1);
  });

  it("logSystem adds system transcript entry", () => {
    logger.logSystem("=== VOTE PHASE ===", Phase.VOTE);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("system");
    expect(logger.transcript[0]!.from).toBe("House");
  });

  it("logDiary adds diary transcript entry", () => {
    logger.logDiary("Alice", "My strategic thoughts...");

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("diary");
    expect(logger.transcript[0]!.phase).toBe(Phase.DIARY_ROOM);
  });

  it("logThinking adds thinking transcript entry", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logThinking(alice.id, "I need to be careful...", Phase.LOBBY);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("thinking");
    expect(logger.transcript[0]!.from).toBe("Alice");
  });

  it("logRoomAllocation includes room metadata", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const rooms: RoomAllocation[] = [{ roomId: 1, playerA: alice.id, playerB: bob.id, round: 1 }];
    logger.logRoomAllocation("Room 1: Alice & Bob", rooms, ["Charlie"]);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.roomMetadata).toBeDefined();
    expect(logger.transcript[0]!.roomMetadata!.rooms).toHaveLength(1);
    expect(logger.transcript[0]!.roomMetadata!.excluded).toEqual(["Charlie"]);
  });

  it("emitStream calls listener and handles errors gracefully", () => {
    const events: GameStreamEvent[] = [];
    logger.setStreamListener((event) => events.push(event));
    logger.logSystem("Test", Phase.LOBBY);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("transcript_entry");
  });

  it("emitStream catches listener errors", () => {
    logger.setStreamListener(() => { throw new Error("Test error"); });
    // Should not throw
    logger.logSystem("Test", Phase.LOBBY);
    expect(logger.transcript).toHaveLength(1);
  });

  it("emitPhaseChange emits phase_change event", () => {
    const events: GameStreamEvent[] = [];
    logger.setStreamListener((event) => events.push(event));
    logger.emitPhaseChange(Phase.LOBBY);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("phase_change");
  });
});

// ---------------------------------------------------------------------------
// ContextBuilder
// ---------------------------------------------------------------------------

describe("ContextBuilder", () => {
  let gs: GameState;
  let logger: TranscriptLogger;
  let whisperInbox: Map<UUID, Array<{ from: string; text: string }>>;
  let builder: ContextBuilder;

  beforeEach(() => {
    gs = makeGameState(["Alice", "Bob", "Charlie", "Dave", "Eve"]);
    gs.startRound();
    logger = new TranscriptLogger(gs);
    whisperInbox = new Map();
    builder = new ContextBuilder(gs, logger, whisperInbox, 5);
  });

  it("buildPhaseContext returns correct basic fields", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.LOBBY);

    expect(ctx.selfId).toBe(alice.id);
    expect(ctx.selfName).toBe("Alice");
    expect(ctx.phase).toBe(Phase.LOBBY);
    expect(ctx.round).toBe(1);
    expect(ctx.alivePlayers).toHaveLength(5);
    expect(ctx.isEliminated).toBe(false);
  });

  it("buildPhaseContext includes whisper inbox", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    whisperInbox.set(alice.id, [{ from: "Bob", text: "Secret" }]);
    const ctx = builder.buildPhaseContext(alice.id, Phase.WHISPER);

    expect(ctx.whisperMessages).toHaveLength(1);
    expect(ctx.whisperMessages[0]!.from).toBe("Bob");
  });

  it("buildPhaseContext includes extra empowered/candidates", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const charlie = gs.getAlivePlayers().find((p) => p.name === "Charlie")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.COUNCIL, {
      empoweredId: bob.id,
      councilCandidates: [bob.id, charlie.id],
    });

    expect(ctx.empoweredId).toBe(bob.id);
    expect(ctx.councilCandidates).toEqual([bob.id, charlie.id]);
  });

  it("buildPhaseContext includes room info", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.WHISPER, undefined, undefined, {
      roomCount: 2,
      roomPartner: "Bob",
    });

    expect(ctx.roomCount).toBe(2);
    expect(ctx.roomPartner).toBe("Bob");
  });

  it("buildPhaseContext includes room allocations when set", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    builder.currentRoomAllocations = [{ roomId: 1, playerA: alice.id, playerB: bob.id, round: 1 }];
    builder.currentExcludedPlayerIds = [gs.getAlivePlayers().find((p) => p.name === "Charlie")!.id];

    const ctx = builder.buildPhaseContext(alice.id, Phase.WHISPER);
    expect(ctx.roomAllocations).toHaveLength(1);
    expect(ctx.roomAllocations![0]!.playerA).toBe("Alice");
    expect(ctx.excludedPlayers).toHaveLength(1);
    expect(ctx.excludedPlayers![0]).toBe("Charlie");
  });

  it("buildPhaseContext detects finalists when 2 alive", () => {
    const players = gs.getAlivePlayers();
    gs.eliminatePlayer(players[2]!.id);
    gs.eliminatePlayer(players[3]!.id);
    gs.eliminatePlayer(players[4]!.id);

    const ctx = builder.buildPhaseContext(players[0]!.id, Phase.OPENING_STATEMENTS);
    expect(ctx.finalists).toBeDefined();
    expect(ctx.finalists).toHaveLength(2);
  });

  it("buildPhaseContext returns no finalists when more than 2 alive", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.LOBBY);
    expect(ctx.finalists).toBeUndefined();
  });

  it("getActiveJury limits jury size based on player count", () => {
    // With 5 players, jury size should be limited
    const jury = builder.getActiveJury();
    expect(jury).toHaveLength(0); // No jury members initially
  });

  it("buildPhaseContext includes public messages from logger", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logPublic(alice.id, "Hello!", Phase.LOBBY);

    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const ctx = builder.buildPhaseContext(bob.id, Phase.LOBBY);
    expect(ctx.publicMessages).toHaveLength(1);
    expect(ctx.publicMessages[0]!.text).toBe("Hello!");
  });
});

// ---------------------------------------------------------------------------
// Phase utility functions
// ---------------------------------------------------------------------------

describe("computeLobbyMessagesPerPlayer", () => {
  it("returns 4 for 4-5 players", () => {
    expect(computeLobbyMessagesPerPlayer(4)).toBe(4);
    expect(computeLobbyMessagesPerPlayer(5)).toBe(4);
  });

  it("returns 3 for 6-7 players", () => {
    expect(computeLobbyMessagesPerPlayer(6)).toBe(3);
    expect(computeLobbyMessagesPerPlayer(7)).toBe(3);
  });

  it("returns 2 for 8+ players", () => {
    expect(computeLobbyMessagesPerPlayer(8)).toBe(2);
    expect(computeLobbyMessagesPerPlayer(12)).toBe(2);
  });

  it("respects config override", () => {
    expect(computeLobbyMessagesPerPlayer(4, 6)).toBe(6);
    expect(computeLobbyMessagesPerPlayer(12, 1)).toBe(1);
  });
});

describe("computeRoomCount", () => {
  it("returns at least 1 room", () => {
    expect(computeRoomCount(2)).toBe(1);
    expect(computeRoomCount(3)).toBe(1);
  });

  it("scales with player count", () => {
    expect(computeRoomCount(4)).toBe(1);
    expect(computeRoomCount(6)).toBe(2);
    expect(computeRoomCount(8)).toBe(3);
    expect(computeRoomCount(10)).toBe(4);
  });
});

describe("allocateRooms", () => {
  it("creates mutual match rooms first", () => {
    const a = createUUID(), b = createUUID(), c = createUUID(), d = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
      { id: d, name: "D" },
    ];

    // A wants B, B wants A (mutual)
    const requests = new Map<UUID, UUID>();
    requests.set(a, b);
    requests.set(b, a);
    requests.set(c, d);
    requests.set(d, a); // D wants A but A is taken

    const { rooms } = allocateRooms(requests, players, 2, 1);
    expect(rooms).toHaveLength(2);
    // First room should be mutual match A-B
    expect(rooms[0]!.playerA).toBe(a);
    expect(rooms[0]!.playerB).toBe(b);
  });

  it("returns excluded players not in rooms", () => {
    const a = createUUID(), b = createUUID(), c = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
    ];

    const requests = new Map<UUID, UUID>();
    requests.set(a, b);
    requests.set(b, a);
    // C has no request

    const { rooms, excluded } = allocateRooms(requests, players, 1, 1);
    expect(rooms).toHaveLength(1);
    expect(excluded).toContain(c);
  });

  it("respects room count limit", () => {
    const a = createUUID(), b = createUUID(), c = createUUID(), d = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
      { id: d, name: "D" },
    ];

    const requests = new Map<UUID, UUID>();
    requests.set(a, b);
    requests.set(b, a);
    requests.set(c, d);
    requests.set(d, c);

    // Only allow 1 room even though 2 mutual matches exist
    const { rooms, excluded } = allocateRooms(requests, players, 1, 1);
    expect(rooms).toHaveLength(1);
    expect(excluded).toHaveLength(2);
  });

  it("handles empty requests", () => {
    const a = createUUID(), b = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
    ];

    const requests = new Map<UUID, UUID>();
    const { rooms, excluded } = allocateRooms(requests, players, 2, 1);
    expect(rooms).toHaveLength(0);
    expect(excluded).toHaveLength(2);
  });

  it("assigns correct round and room IDs", () => {
    const a = createUUID(), b = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
    ];

    const requests = new Map<UUID, UUID>();
    requests.set(a, b);
    requests.set(b, a);

    const { rooms } = allocateRooms(requests, players, 1, 3);
    expect(rooms[0]!.roomId).toBe(1);
    expect(rooms[0]!.round).toBe(3);
  });

  it("prevents a player from being paired twice", () => {
    const a = createUUID(), b = createUUID(), c = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
    ];

    // Both B and C want A
    const requests = new Map<UUID, UUID>();
    requests.set(b, a);
    requests.set(c, a);
    requests.set(a, b); // A wants B

    const { rooms } = allocateRooms(requests, players, 2, 1);
    // A-B should be the mutual match; C can't pair with A
    const pairedPlayers = new Set<UUID>();
    for (const room of rooms) {
      expect(pairedPlayers.has(room.playerA)).toBe(false);
      expect(pairedPlayers.has(room.playerB)).toBe(false);
      pairedPlayers.add(room.playerA);
      pairedPlayers.add(room.playerB);
    }
  });

  it("keeps repeat pair requests when anti-repeat experiment is disabled", () => {
    const a = createUUID(), b = createUUID(), c = createUUID(), d = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
      { id: d, name: "D" },
    ];

    const requests = new Map<UUID, UUID>();
    requests.set(a, b);
    requests.set(b, a);
    requests.set(c, d);
    requests.set(d, c);

    const priorRooms: RoomAllocation[] = [{ roomId: 1, playerA: a, playerB: b, round: 1 }];
    const { rooms, brokenPreferences } = allocateRooms(
      requests,
      players,
      2,
      2,
      { priorRooms },
    );

    expect(rooms[0]!.playerA).toBe(a);
    expect(rooms[0]!.playerB).toBe(b);
    expect(brokenPreferences).toHaveLength(0);
  });

  it("breaks prior repeat pair preferences when anti-repeat experiment is enabled", () => {
    const a = createUUID(), b = createUUID(), c = createUUID(), d = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
      { id: d, name: "D" },
    ];

    const requests = new Map<UUID, UUID>();
    requests.set(a, b);
    requests.set(b, a);
    requests.set(c, a);
    requests.set(d, b);

    const priorRooms: RoomAllocation[] = [{ roomId: 1, playerA: a, playerB: b, round: 1 }];
    const { rooms, excluded, brokenPreferences } = allocateRooms(
      requests,
      players,
      2,
      2,
      { avoidRepeatPairs: true, priorRooms },
    );

    const roomPairs = rooms.map((room) => new Set([room.playerA, room.playerB]));
    expect(roomPairs.some((pair) => pair.has(a) && pair.has(b))).toBe(false);
    expect(roomPairs.some((pair) => pair.has(c) && pair.has(a))).toBe(true);
    expect(roomPairs.some((pair) => pair.has(d) && pair.has(b))).toBe(true);
    expect(excluded).toHaveLength(0);
    expect(brokenPreferences).toEqual([
      { playerId: a, requestedPartnerId: b },
      { playerId: b, requestedPartnerId: a },
    ]);
  });
});
