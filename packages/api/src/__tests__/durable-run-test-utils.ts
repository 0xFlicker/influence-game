import { randomUUID } from "crypto";
import {
  GameState,
  Phase,
  replayCanonicalEvents,
  buildActorWitness,
  buildPhaseAccumulatorRegistry,
  buildRuntimeSnapshotV1,
  buildTranscriptWatermark,
  accumulatorProof,
  sealBoundaryIdentity,
  createEngineBoundaryPlaceholder,
  requiredPhaseBoundaryAccumulatorIds,
  type CanonicalGameEvent,
  type GameCheckpointCapsule,
  type RuntimeSnapshotV1,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameRunOwnerStatus, GameStatus, KernelHealthStatus } from "../db/schema.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import { sha256StableJson } from "../services/stable-hash.js";

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

function buildDefaultAccumulatorEntries(): Array<{ id: string; status: "empty" | "drained"; proof: ReturnType<typeof accumulatorProof> }> {
  return requiredPhaseBoundaryAccumulatorIds().map((id) => {
    if (id === "transcriptStreamBuffer") {
      return { id, status: "drained" as const, proof: accumulatorProof("drained_at_boundary", "fixture stream buffer drained") };
    }
    return { id, status: "empty" as const, proof: accumulatorProof("empty_at_boundary", `fixture ${id} empty at boundary`) };
  });
}

export function buildSealedRuntimeSnapshot(params: {
  ownerEpoch: string;
  eventHeadHash: string;
  projectionHash: string;
  capsule: GameCheckpointCapsule;
  actorCoordinate?: string;
}): RuntimeSnapshotV1 {
  const boundary = sealBoundaryIdentity(
    createEngineBoundaryPlaceholder({
      boundarySequence: params.capsule.lastEventSequence,
      checkpointKind: params.capsule.checkpointKind,
      phase: params.capsule.phase,
      round: params.capsule.round,
    }),
    {
      ownerEpoch: params.ownerEpoch,
      eventHeadHash: params.eventHeadHash,
      projectionHash: params.projectionHash,
    },
  );

  const alivePlayerIds = Object.values(params.capsule.projection.players)
    .filter((player) => player.status !== "eliminated")
    .map((player) => player.id);

  const actorWitness = buildActorWitness({
    boundary,
    actorCoordinate: params.actorCoordinate ?? "vote",
    actorStatus: "active",
    round: params.capsule.round,
    phase: params.capsule.phase,
    alivePlayerIds,
  });

  const accumulatorRegistry = buildPhaseAccumulatorRegistry({
    boundary,
    entries: buildDefaultAccumulatorEntries(),
  });

  const transcriptWatermark = buildTranscriptWatermark({
    boundary,
    lastCanonicalSequence: params.capsule.lastEventSequence,
    entryCount: 0,
    boundaryDigest: `transcript-boundary:${params.capsule.lastEventSequence}:0`,
  });

  return buildRuntimeSnapshotV1({
    boundary,
    actorWitness,
    accumulatorRegistry,
    transcriptWatermark,
  });
}

export function buildPositivePlayerContinuityCapsules(_capsule: GameCheckpointCapsule) {
  return ["atlas", "echo", "mira", "nyx"].map((playerId) => ({
    playerId,
    playerName: playerId,
    strategyPacket: null,
    reflectionSummary: null,
    notes: [],
    commitments: [],
    relationships: { allies: [], threats: [] },
    powerActionMemory: null,
    roundHistory: [],
  }));
}

export function buildPositiveHouseContinuityCapsule(capsule: GameCheckpointCapsule) {
  return {
    revisionId: "h1",
    previousRevisionId: null,
    updatedAtRound: capsule.round,
    updatedAtPhase: capsule.phase,
    summary: "",
    alliances: [],
    tensions: [],
    promises: [],
    voteBlocs: [],
    mingleDiscoveries: [],
    playerTrajectories: [],
    storyArcs: [],
    droppedThreads: [],
    openQuestions: [],
    changedSincePrevious: "",
  };
}

export function enrichCapsuleForV1Candidate(
  capsule: GameCheckpointCapsule,
  params: {
    ownerEpoch: string;
    eventHeadHash: string;
    projectionHash?: string;
    actorCoordinate?: string;
  },
): GameCheckpointCapsule {
  const projectionHash = params.projectionHash ?? sha256StableJson(capsule.projection);
  const runtimeSnapshot = buildSealedRuntimeSnapshot({
    ownerEpoch: params.ownerEpoch,
    eventHeadHash: params.eventHeadHash,
    projectionHash,
    capsule,
    actorCoordinate: params.actorCoordinate,
  });

  const playerContinuityCapsules = buildPositivePlayerContinuityCapsules(capsule);
  const houseContinuityCapsule = buildPositiveHouseContinuityCapsule(capsule);

  return {
    ...capsule,
    snapshotManifest: {
      version: 1,
      components: {
        projectionTruth: { status: "captured", version: 1 },
        xstateActor: { status: "captured", version: 1 },
        phaseAccumulators: { status: "captured", version: 1 },
        playerContinuity: { status: "private_reference_only", version: 1 },
        houseContinuity: { status: "private_reference_only", version: 1 },
        transcriptCursor: { status: "captured", version: 1 },
        tokenCursor: { status: "captured", version: 1 },
        ownerEpoch: { status: "captured", version: 1 },
      },
    },
    boundaryCertificate: {
      gameId: capsule.gameId,
      ownerEpoch: params.ownerEpoch,
      boundarySequence: capsule.lastEventSequence,
      checkpointReason: capsule.checkpointKind,
      phase: capsule.phase,
      round: capsule.round,
      projectionHash,
      eventCommitReceipt: { sequence: capsule.lastEventSequence, hash: params.eventHeadHash },
      noPendingEffectsAsserted: true,
    },
    runtimeSnapshot,
    playerContinuityCapsules,
    houseContinuityCapsule,
    transcriptCursor: {
      entries: runtimeSnapshot.transcriptWatermark.entryCount,
      version: 1,
      durableBoundary: true,
      boundaryDigest: runtimeSnapshot.transcriptWatermark.boundaryDigest,
      lastCanonicalSequence: capsule.lastEventSequence,
    },
    tokenCostCursor: capsule.tokenCostCursor,
    hydrationStatus: {
      replayableProjection: true,
      xstateSnapshot: true,
      phaseAccumulators: true,
      agentMemoryState: true,
      pendingLlmCalls: false,
      tokenCostCursor: true,
      missingInputs: [],
    },
  };
}

export function createCheckpointCapsule(
  events: readonly CanonicalGameEvent[],
  checkpointKind: GameCheckpointCapsule["checkpointKind"] = "phase_boundary",
): GameCheckpointCapsule {
  const projection = replayCanonicalEvents(events);
  const players = Object.values(projection.players);
  const alivePlayerCount = players.filter((player) => player.status !== "eliminated").length;
  const eliminatedPlayerCount = players.length - alivePlayerCount;

  const snapshotManifest = {
    version: 1 as const,
    components: {
      projectionTruth: { status: "captured" as const, version: 1 },
      xstateActor: { status: "missing" as const },
      phaseAccumulators: { status: "missing" as const },
      playerContinuity: { status: "missing" as const },
      houseContinuity: { status: "missing" as const },
      transcriptCursor: { status: "missing" as const },
      tokenCursor: { status: "missing" as const },
      ownerEpoch: { status: "missing" as const },
    },
  };

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
    snapshotManifest,
    boundaryCertificate: {
      gameId: projection.gameId,
      boundarySequence: projection.lastSequence,
      checkpointReason: checkpointKind,
      eventCommitReceipt: null,
      noPendingEffectsAsserted: true,
    },
    playerContinuityCapsules: [],
    houseContinuityCapsule: null,
    runtimeSnapshot: null,
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
    tokenCostCursor: {
      version: 1,
      totals: { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, callCount: 0, emptyResponses: 0 },
      perSource: {},
    },
  };
}