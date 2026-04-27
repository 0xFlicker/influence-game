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
    const rooms: RoomAllocation[] = [{ roomId: 1, playerIds: [alice.id, bob.id], round: 1, beat: 1 }];
    logger.logRoomAllocation("Room 1: Alice, Bob", rooms, []);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.roomMetadata).toBeDefined();
    expect(logger.transcript[0]!.roomMetadata!.rooms).toHaveLength(1);
    expect(logger.transcript[0]!.roomMetadata!.excluded).toEqual([]);
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
      roomMates: ["Alice", "Bob"],
    });

    expect(ctx.roomCount).toBe(2);
    expect(ctx.roomMates).toEqual(["Alice", "Bob"]);
  });

  it("buildPhaseContext includes room allocations when set", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    builder.currentRoomAllocations = [{ roomId: 1, playerIds: [alice.id, bob.id], round: 1, beat: 1 }];

    const ctx = builder.buildPhaseContext(alice.id, Phase.WHISPER);
    expect(ctx.roomAllocations).toHaveLength(1);
    expect(ctx.roomAllocations![0]!.playerNames).toEqual(["Alice", "Bob"]);
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
  it("skips open rooms below five alive players", () => {
    expect(computeRoomCount(2)).toBe(0);
    expect(computeRoomCount(4)).toBe(0);
  });

  it("scales open rooms by ceil(alive / 3)", () => {
    expect(computeRoomCount(5)).toBe(2);
    expect(computeRoomCount(6)).toBe(2);
    expect(computeRoomCount(7)).toBe(3);
    expect(computeRoomCount(9)).toBe(3);
    expect(computeRoomCount(10)).toBe(4);
    expect(computeRoomCount(12)).toBe(4);
    expect(computeRoomCount(16)).toBe(6);
  });
});

describe("allocateRooms", () => {
  it("honors valid neutral room choices exactly", () => {
    const a = createUUID(), b = createUUID(), c = createUUID(), d = createUUID(), e = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
      { id: d, name: "D" },
      { id: e, name: "E" },
    ];
    const choices = new Map<UUID, number | null>([[a, 2], [b, 2], [c, 1], [d, 1], [e, 2]]);
    const { rooms } = allocateRooms(choices, players, 2, 1, 1);
    expect(rooms).toHaveLength(2);
    expect(rooms[0]!.playerIds).toEqual([c, d]);
    expect(rooms[1]!.playerIds).toEqual([a, b, e]);
  });

  it("falls back invalid and missing choices to Room 1", () => {
    const a = createUUID(), b = createUUID(), c = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
    ];
    const choices = new Map<UUID, number | null>([[a, 0], [b, 3], [c, null]]);
    const { rooms, diagnostics } = allocateRooms(choices, players, 2, 1, 1);
    expect(rooms[0]!.playerIds).toEqual([a, b, c]);
    expect(rooms[1]!.playerIds).toEqual([]);
    expect(diagnostics.choices.map((choice) => choice.status)).toEqual(["invalid", "invalid", "missing"]);
  });

  it("represents empty and singleton rooms", () => {
    const a = createUUID(), b = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
    ];
    const { rooms, diagnostics } = allocateRooms(new Map([[a, 2], [b, 1]]), players, 3, 4, 2);
    expect(rooms).toHaveLength(3);
    expect(rooms[0]).toMatchObject({ roomId: 1, round: 4, beat: 2, playerIds: [b] });
    expect(rooms[1]).toMatchObject({ roomId: 2, round: 4, beat: 2, playerIds: [a] });
    expect(rooms[2]).toMatchObject({ roomId: 3, round: 4, beat: 2, playerIds: [] });
    expect(diagnostics.allocatedRooms.map((room) => room.conversationRan)).toEqual([false, false, false]);
  });
});
