import { randomUUID } from "crypto";
import {
  GameState,
  Phase,
  replayCanonicalEvents,
  type CanonicalGameEvent,
  type GameCheckpointCapsule,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameRunOwnerStatus, GameStatus, KernelHealthStatus } from "../db/schema.js";
import { hashCanonicalEvent } from "../services/game-events.js";

const FIXED_NOW = "2026-06-14T00:00:00.000Z";

export function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_720_000_000_000 + ticks++;
}

export function createCanonicalEventFixture(gameId: string): readonly CanonicalGameEvent[] {
  const state = new GameState(
    [
      { id: "atlas", name: "Atlas" },
      { id: "echo", name: "Echo" },
      { id: "mira", name: "Mira" },
      { id: "nyx", name: "Nyx" },
    ],
    { gameId, now: fixedClock() },
  );

  state.startRound();
  state.recordVote("atlas", "mira", "echo");
  state.recordVote("echo", "mira", "atlas");
  state.recordVote("mira", "echo", "atlas");
  state.recordVote("nyx", "mira", "echo");

  return state.getCanonicalEvents();
}

export async function insertGame(
  db: DrizzleDB,
  params: {
    id?: string;
    slug?: string;
    status?: GameStatus;
    config?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const gameId = params.id ?? randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    ...(params.slug && { slug: params.slug }),
    config: JSON.stringify(params.config ?? {
      maxRounds: 5,
      modelTier: "budget",
      visibility: "private",
      viewerMode: "speedrun",
    }),
    status: params.status ?? "suspended",
    trackType: "custom",
    minPlayers: 4,
    maxPlayers: 4,
    startedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
  });
  return gameId;
}

export async function insertOwner(
  db: DrizzleDB,
  gameId: string,
  params: {
    ownerEpoch?: string;
    status?: GameRunOwnerStatus;
    kernelHealth?: KernelHealthStatus;
    expiresAt?: string;
    failureReason?: string;
    lastPersistedEventSequence?: number;
  } = {},
): Promise<string> {
  const ownerEpoch = params.ownerEpoch ?? randomUUID();
  await db.insert(schema.gameRunOwners).values({
    id: randomUUID(),
    gameId,
    ownerEpoch,
    status: params.status ?? "active",
    runSource: "api",
    processId: "durable-run-test",
    acquiredAt: FIXED_NOW,
    heartbeatAt: FIXED_NOW,
    expiresAt: params.expiresAt,
    lastPersistedEventSequence: params.lastPersistedEventSequence ?? 0,
    kernelHealth: params.kernelHealth ?? "healthy",
    failureReason: params.failureReason,
  });
  return ownerEpoch;
}

export async function insertCanonicalEventRows(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  events: readonly CanonicalGameEvent[],
  overrides: {
    eventHash?: (event: CanonicalGameEvent) => string;
  } = {},
): Promise<void> {
  const rows: Array<typeof schema.gameEvents.$inferInsert> = events.map((event) => ({
    gameId,
    sequence: event.sequence,
    eventType: event.type,
    eventHash: overrides.eventHash?.(event) ?? hashCanonicalEvent(event),
    ownerEpoch,
    visibility: event.visibility,
    payloadVersion: event.payloadVersion,
    runSource: "api",
    sourcePointers: event.sourcePointers as unknown as ReadonlyArray<Record<string, unknown>>,
    envelope: event as unknown as Record<string, unknown>,
  }));
  await db.insert(schema.gameEvents).values(rows);
}

export function createCheckpointCapsule(
  events: readonly CanonicalGameEvent[],
  checkpointKind: GameCheckpointCapsule["checkpointKind"] = "phase_boundary",
): GameCheckpointCapsule {
  const projection = replayCanonicalEvents(events);
  const players = Object.values(projection.players);
  const alivePlayerCount = players.filter((player) => player.status !== "eliminated").length;
  const eliminatedPlayerCount = players.length - alivePlayerCount;

  return {
    gameId: projection.gameId,
    lastEventSequence: projection.lastSequence,
    checkpointKind,
    phase: projection.phase ?? Phase.INIT,
    round: projection.round,
    eventCount: events.length,
    projection,
    state: {
      gameId: projection.gameId,
      round: projection.round,
      alivePlayerCount,
      eliminatedPlayerCount,
    },
    projectionSummary: {
      gameId: projection.gameId,
      lastSequence: projection.lastSequence,
      round: projection.round,
      phase: projection.phase,
      alivePlayerCount,
      eliminatedPlayerCount,
      roomAllocationRounds: Object.keys(projection.roomAllocations).length,
      roundResultCount: projection.roundResults.length,
    },
    hydrateable: false,
    hydrationStatus: {
      replayableProjection: true,
      xstateSnapshot: false,
      phaseAccumulators: false,
      agentMemoryState: false,
      pendingLlmCalls: false,
      tokenCostCursor: false,
      missingInputs: [
        "xstateSnapshot",
        "phaseAccumulators",
        "agentMemoryState",
        "pendingLlmCalls",
        "tokenCostCursor",
      ],
    },
    transcriptCursor: {
      entries: 0,
    },
    tokenCostCursor: null,
  };
}
