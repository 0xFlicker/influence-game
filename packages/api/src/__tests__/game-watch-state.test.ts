import { beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { GameState, Phase, type CanonicalGameEvent } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { getGameWatchReplayFrames, getGameWatchState } from "../services/game-watch-state.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  createResolvedRoundCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
  withJuryWinner,
} from "./durable-run-test-utils.js";

describe("GameWatchState", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("derives current live state from persisted durable projection", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-live-projection",
      status: "in_progress",
      config: gameConfig({ maxRounds: 7 }),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = advanceToRoundTwo(createResolvedRoundCanonicalEventFixture(gameId));
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const state = await getGameWatchState(db, "watch-live-projection");

    expect(state).not.toBeNull();
    expect(state).toMatchObject({
      schemaVersion: 3,
      gameId,
      slug: "watch-live-projection",
      source: "durable_projection",
      status: "in_progress",
      currentRound: 2,
      currentPhase: "LOBBY",
      maxRounds: 7,
      eventCursor: {
        sequence: events.length,
        source: "trusted_prefix",
      },
      projection: {
        availability: "available",
        eventLogStatus: "complete",
        projectionStatus: "complete",
        trustedEventCount: events.length,
      },
    });
    expect(state?.players.find((player) => player.id === "atlas")).toMatchObject({
      id: "atlas",
      name: "Atlas Prime",
      persona: "profiled strategist",
      personaKey: "strategic",
      status: "eliminated",
      shielded: false,
      avatarUrl: "https://example.test/atlas.png",
    });
    expect(state?.players.filter((player) => player.status === "eliminated").map((player) => player.id)).toHaveLength(1);
  });

  test("uses durable final projection for completed winner state", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-final-projection",
      status: "completed",
      config: gameConfig({ maxRounds: 5 }),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = withJuryWinner(createCanonicalEventFixture(gameId), "mira");
    await appendGameEvents(db, { gameId, ownerEpoch, events });
    await insertResult(db, gameId, { winnerId: "mira", roundsPlayed: 3 });

    const state = await getGameWatchState(db, gameId);

    expect(state).toMatchObject({
      source: "durable_projection",
      currentPhase: "JURY_VOTE",
      final: {
        status: "final",
        winner: {
          id: "mira",
          name: "Mira",
          method: "random_tiebreaker",
          source: "durable_projection",
        },
      },
      winner: {
        id: "mira",
        name: "Mira",
      },
    });
  });

  test("does not expose a durable terminal winner before completion settlement commits", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-pending-completion-settlement",
      status: "suspended",
      config: gameConfig({ maxRounds: 5 }),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      status: "expired",
      kernelHealth: "suspended",
      failureReason: "completion_settlement_transient_failure",
    });
    const eventsWithWinner = withJuryWinner(createCanonicalEventFixture(gameId), "mira");
    const winnerEvent = eventsWithWinner.at(-1)!;
    const finalLoserElimination: CanonicalGameEvent = {
      sequence: winnerEvent.sequence + 1,
      gameId,
      round: 4,
      phase: null,
      type: "player.eliminated",
      timestamp: "2026-06-20T00:00:02.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        playerId: "echo",
        playerName: "Echo",
        eliminatedRound: 4,
        juryMember: { playerId: "echo", playerName: "Echo", eliminatedRound: 4 },
      },
    };
    const events = [...eventsWithWinner, finalLoserElimination];
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);

    const state = await getGameWatchState(db, gameId);

    expect(state).toMatchObject({
      status: "suspended",
      source: "durable_projection",
      final: { status: "not_final" },
    });
    expect(state?.final.winner).toBeUndefined();
    expect(state?.final.roundsPlayed).toBeUndefined();
    expect(state?.winner).toBeUndefined();
    expect(state?.players.find((player) => player.id === "mira")?.status).toBe("alive");
    expect(state?.players.find((player) => player.id === "echo")?.status).toBe("alive");
  });

  test("labels older completed games without durable events as best-available terminal result", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-terminal-fallback",
      status: "completed",
      config: gameConfig({ maxRounds: 9 }),
    });
    await insertFixturePlayers(db, gameId);
    await insertResult(db, gameId, { winnerId: "atlas", roundsPlayed: 4 });

    const state = await getGameWatchState(db, "watch-terminal-fallback");

    expect(state).toMatchObject({
      source: "best_available_terminal_result",
      currentRound: 4,
      currentPhase: "END",
      projection: {
        availability: "unavailable",
        eventLogStatus: "empty",
        projectionStatus: "empty",
      },
      final: {
        status: "final",
        winner: {
          id: "atlas",
          name: "Atlas Prime",
          source: "best_available_terminal_result",
        },
      },
    });
  });

  test("returns pre-kernel state without fabricating durable facts", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-pre-kernel",
      status: "waiting",
      config: gameConfig({ maxRounds: 6 }),
    });
    await insertFixturePlayers(db, gameId, ["atlas", "echo"]);

    const state = await getGameWatchState(db, gameId);

    expect(state).toMatchObject({
      source: "pre_kernel_empty",
      currentRound: 0,
      currentPhase: "INIT",
      projection: {
        availability: "unavailable",
        eventLogStatus: "empty",
        projectionStatus: "empty",
        trustedEventCount: 0,
      },
    });
    expect(state?.players).toHaveLength(2);
    expect(state?.players.every((player) => player.status === "alive")).toBe(true);
  });

  test("keeps generated persona display text separate from avatar persona key", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-generated-persona-key",
      status: "waiting",
      config: gameConfig(),
    });
    await db.insert(schema.gamePlayers).values({
      id: "zara",
      gameId,
      persona: JSON.stringify({
        name: "Zara Quinn",
        personality: "observer",
        personaKey: "observer",
        personalityBlurb: "Zara is exuberant and unpredictable.",
      }),
      agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
    });

    const state = await getGameWatchState(db, gameId);

    expect(state?.players).toEqual([
      expect.objectContaining({
        id: "zara",
        name: "Zara Quinn",
        persona: "Zara is exuberant and unpredictable.",
        personaKey: "observer",
        status: "alive",
      }),
    ]);
  });

  test("surfaces public post-vote pressure statuses during pre-council Mingle", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-post-vote-pressure",
      status: "in_progress",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createPostVotePressureFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const state = await getGameWatchState(db, "watch-post-vote-pressure");
    const players = state?.players ?? [];

    expect(state).toMatchObject({
      currentPhase: "MINGLE",
      players: expect.arrayContaining([
        expect.objectContaining({
          id: "mira",
          pressureStatus: "empowered",
        }),
        expect.objectContaining({
          id: "atlas",
          pressureStatus: "locked_at_risk",
          exposeScore: 2,
        }),
        expect.objectContaining({
          id: "echo",
          pressureStatus: "locked_at_risk",
          exposeScore: 2,
        }),
      ]),
    });
    expect(players.find((player) => player.id === "nyx")?.pressureStatus).toBe("fallback_risk");
  });

  test("builds replay pressure frames from durable events", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-replay-pressure-frames",
      status: "completed",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createPostVotePressureFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const frames = await getGameWatchReplayFrames(db, "watch-replay-pressure-frames");
    const mingleFrame = frames?.findLast((frame) => frame.phase === "MINGLE");

    expect(mingleFrame).toMatchObject({
      eventType: "mingle.rooms_allocated",
      players: expect.arrayContaining([
        expect.objectContaining({
          id: "mira",
          pressureStatus: "empowered",
        }),
        expect.objectContaining({
          id: "atlas",
          pressureStatus: "locked_at_risk",
          exposeScore: 2,
        }),
        expect.objectContaining({
          id: "echo",
          pressureStatus: "locked_at_risk",
          exposeScore: 2,
        }),
      ]),
    });
  });

  test("distinguishes shield fallback replacements from vote-derived exposed candidates", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-shield-fallback-pressure",
      status: "in_progress",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createShieldFallbackPressureFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const state = await getGameWatchState(db, "watch-shield-fallback-pressure");
    const players = state?.players ?? [];

    expect(state).toMatchObject({
      currentPhase: "POWER",
      players: expect.arrayContaining([
        expect.objectContaining({
          id: "mira",
          pressureStatus: "empowered",
        }),
        expect.objectContaining({
          id: "echo",
          pressureStatus: "locked_at_risk",
          exposeScore: 2,
        }),
        expect.objectContaining({
          id: "nyx",
          pressureStatus: "fallback_risk",
        }),
      ]),
    });
    const atlas = players.find((player) => player.id === "atlas");
    expect(atlas?.shielded).toBe(true);
    expect(atlas?.exposeScore).toBeUndefined();
    expect(atlas?.pressureStatus).toBeUndefined();
  });

  test("uses only the trusted prefix for degraded invalid event logs", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-degraded",
      status: "in_progress",
      config: gameConfig({ maxRounds: 5 }),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 3 });
    const events = createCanonicalEventFixture(gameId).slice(0, 3);
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events, {
      eventHash: (event) => event.sequence === 2
        ? "sha256:not-the-real-event-hash"
        : hashCanonicalEvent(event),
    });

    const state = await getGameWatchState(db, gameId);

    expect(state).toMatchObject({
      source: "degraded",
      eventCursor: {
        sequence: 1,
        source: "trusted_prefix",
      },
      projection: {
        availability: "degraded",
        eventLogStatus: "invalid",
        projectionStatus: "incomplete",
        trustedEventCount: 1,
        validPrefixLength: 1,
        firstInvalidSequence: 2,
      },
    });
    expect(state?.projection.diagnostics[0]).toMatchObject({
      code: "hash_mismatch",
      severity: "error",
      message: "The persisted event log failed integrity validation.",
      sequence: 2,
    });
    expect(state?.players).toHaveLength(4);
  });

  test("marks players unknown when a degraded log has no trusted projection", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-degraded-empty-prefix",
      status: "in_progress",
      config: gameConfig({ maxRounds: 5 }),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 2 });
    const events = createCanonicalEventFixture(gameId).slice(0, 2);
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events, {
      eventHash: (event) => event.sequence === 1
        ? "sha256:not-the-real-event-hash"
        : hashCanonicalEvent(event),
    });

    const state = await getGameWatchState(db, gameId);

    expect(state).toMatchObject({
      source: "degraded",
      eventCursor: {
        sequence: 0,
        source: "none",
      },
      counts: {
        alivePlayers: 0,
        eliminatedPlayers: 0,
        unknownPlayers: 4,
      },
      projection: {
        availability: "degraded",
        eventLogStatus: "invalid",
        projectionStatus: "failed",
        trustedEventCount: 0,
        validPrefixLength: 0,
        firstInvalidSequence: 1,
      },
    });
    expect(state?.players.every((player) => player.status === "unknown")).toBe(true);
  });

  test("does not expose raw event envelopes or producer/private evidence fields", async () => {
    const gameId = await insertGame(db, {
      slug: "watch-private-stripped",
      status: "in_progress",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = withPrivatePointers(createCanonicalEventFixture(gameId));
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const state = await getGameWatchState(db, gameId);
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain("sourcePointers");
    expect(serialized).not.toContain("canonicalPayload");
    expect(serialized).not.toContain("privateTrace");
    expect(serialized).not.toContain("thinking");
    expect(serialized).not.toContain("reasoningContext");
    expect(serialized).not.toContain("ownerEpoch");
    expect(serialized).not.toContain("eventHash");
  });
});

function gameConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    maxRounds: 10,
    modelTier: "budget",
    visibility: "public",
    viewerMode: "speedrun",
    ...overrides,
  };
}

async function insertFixturePlayers(
  db: DrizzleDB,
  gameId: string,
  ids: readonly string[] = ["atlas", "echo", "mira", "nyx"],
): Promise<void> {
  for (const id of ids) {
    let agentProfileId: string | null = null;
    if (id === "atlas") {
      agentProfileId = randomUUID();
      await db.insert(schema.users).values({
        id: `user-${agentProfileId}`,
        walletAddress: `0x${createHash("sha1").update(agentProfileId).digest("hex").slice(0, 40)}`,
      });
      await db.insert(schema.agentProfiles).values({
        id: agentProfileId,
        userId: `user-${agentProfileId}`,
        name: "Mutable Profile Atlas",
        personality: "mutable profile strategist",
        personaKey: "strategic",
        avatarUrl: "https://example.test/atlas.png",
      });
    }

    const name = id === "atlas" ? "Atlas Prime" : titleCase(id);
    await db.insert(schema.gamePlayers).values({
      id,
      gameId,
      agentProfileId,
      persona: JSON.stringify({
        name,
        personality: id === "atlas" ? "profiled strategist" : `${id} persona`,
        personaKey: id === "atlas" ? "strategic" : "honest",
      }),
      agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
    });
  }
}

async function insertResult(
  db: DrizzleDB,
  gameId: string,
  params: {
    winnerId: string | null;
    roundsPlayed: number;
  },
): Promise<void> {
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId: params.winnerId,
    roundsPlayed: params.roundsPlayed,
    tokenUsage: JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  });
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function advanceToRoundTwo(events: readonly CanonicalGameEvent[]): readonly CanonicalGameEvent[] {
  const last = events.at(-1);
  if (!last) throw new Error("Expected fixture events");
  return [
    ...events,
    {
      sequence: last.sequence + 1,
      gameId: last.gameId,
      round: 2,
      phase: Phase.LOBBY,
      type: "round.started",
      timestamp: "2026-06-20T00:00:00.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { round: 2 },
    },
  ];
}

function createPostVotePressureFixture(gameId: string): readonly CanonicalGameEvent[] {
  const state = new GameState(
    [
      { id: "atlas", name: "Atlas" },
      { id: "echo", name: "Echo" },
      { id: "mira", name: "Mira" },
      { id: "nyx", name: "Nyx" },
    ],
    { gameId, now: () => 1_720_000_000_000 },
  );

  state.startRound();
  state.recordVote("atlas", "mira", "echo");
  state.recordVote("echo", "mira", "atlas");
  state.recordVote("mira", "echo", "atlas");
  state.recordVote("nyx", "mira", "echo");
  state.tallyEmpowerVotes();
  state.recordRoomAllocations([
    {
      roomId: 1,
      round: 1,
      beat: 1,
      playerIds: ["atlas", "echo", "mira", "nyx"],
    },
  ], [], []);

  return state.getCanonicalEvents();
}

function createShieldFallbackPressureFixture(gameId: string): readonly CanonicalGameEvent[] {
  const state = new GameState(
    [
      { id: "atlas", name: "Atlas" },
      { id: "echo", name: "Echo" },
      { id: "mira", name: "Mira" },
      { id: "nyx", name: "Nyx" },
    ],
    { gameId, now: () => 1_720_000_000_000 },
  );

  state.startRound();
  state.recordVote("atlas", "mira", "echo");
  state.recordVote("echo", "mira", "atlas");
  state.recordVote("mira", "echo", "atlas");
  state.recordVote("nyx", "mira", "echo");
  state.tallyEmpowerVotes();
  state.setPowerAction({ action: "protect", target: "atlas" });
  state.determineCandidates(["nyx"]);

  return state.getCanonicalEvents();
}

function withPrivatePointers(events: readonly CanonicalGameEvent[]): readonly CanonicalGameEvent[] {
  return events.map((event) => ({
    ...event,
    sourcePointers: [
      {
        kind: "agent_turn",
        action: "vote",
        round: event.round,
        phase: event.phase ?? Phase.INIT,
        actorId: "atlas",
      },
    ],
  }));
}
