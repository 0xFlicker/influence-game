import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  Phase,
  type GameExecutionStateV1,
  type GameTurnCommitResultV1,
  type GameTurnIntentV1,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  createCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
  withJuryWinner,
} from "../__tests__/durable-run-test-utils.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import { hashCanonicalEvent } from "./game-events.js";
import { initialGameTranscriptStateValues } from "./transcript-capture.js";
import { serializeTranscriptEntry } from "./transcript-serialization.js";
import { settleDurableTerminalGame } from "./durable-game-terminal.js";
import { createDurableGameRunnerStore } from "./durable-game-runner-store.js";
import {
  captureGameCompletionSettlement,
  preparePendingCompletionSettlementsOnStartup,
} from "./game-completion-settlement.js";
import { adoptInProgressDurableGamesOnStartup } from "./startup-durable-games.js";

describe("durable game terminal settlement", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("reconstructs and settles from committed authority under an adopted owner", async () => {
    const fixture = await createTerminalFixture(db);

    const result = await settleDurableTerminalGame(db, {
      gameId: fixture.gameId,
      ownerEpoch: fixture.currentOwnerEpoch,
    });

    expect(result.capture).toMatchObject({ created: true, state: "pending" });
    expect(result.settlement).toMatchObject({ outcome: "completed", state: "completed" });

    const game = (await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]!;
    expect(game.status).toBe("completed");
    expect(game.endedAt).toBe(fixture.finalEvent.timestamp);
    expect(JSON.parse(game.config)).toMatchObject({ viewerMode: "replay" });

    const settlement = (await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0]!;
    expect(settlement.ownerEpoch).toBe(fixture.currentOwnerEpoch);
    expect(settlement.finalEventHash).toBe(fixture.finalEventHash);
    expect(settlement.state).toBe("completed");
    expect(settlement.payload).toMatchObject({
      boundary: {
        ownerEpoch: fixture.currentOwnerEpoch,
        finalEventSequence: fixture.finalEvent.sequence,
        finalEventHash: fixture.finalEventHash,
      },
      result: {
        gameId: fixture.gameId,
        winnerId: "atlas",
        winnerName: "Atlas",
        rounds: 4,
        rankedPlayerIds: expect.arrayContaining(["atlas", "echo", "mira", "nyx"]),
        transcript: [{ text: "A committed private diary marker." }],
      },
      tokenUsage: {
        total: {
          promptTokens: 11,
          cachedTokens: 3,
          cacheWriteTokens: 2,
          completionTokens: 7,
          reasoningTokens: 4,
          totalTokens: 18,
          callCount: 1,
          emptyResponses: 0,
        },
        perAction: {
          "Atlas/jury_vote": {
            promptTokens: 11,
            completionTokens: 7,
            callCount: 1,
          },
        },
        byServiceTier: {
          flex: {
            promptTokens: 11,
            completionTokens: 7,
            callCount: 1,
          },
        },
      },
      finishedAt: fixture.finalEvent.timestamp,
    });

    const storedResult = (await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId)))[0]!;
    expect(storedResult.winnerId).toBe("atlas");
    expect(storedResult.roundsPlayed).toBe(4);
    expect(storedResult.finishedAt).toBe(fixture.finalEvent.timestamp);
    expect(JSON.parse(storedResult.tokenUsage)).toMatchObject({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
      perAction: { "Atlas/jury_vote": { callCount: 1 } },
    });

    const publications = await db.select({
      publicationSequence: schema.gamePublications.publicationSequence,
      availableAt: schema.gamePublications.availableAt,
    }).from(schema.gamePublications)
      .where(eq(schema.gamePublications.gameId, fixture.gameId));
    expect(publications).toEqual([
      { publicationSequence: 1, availableAt: "2026-06-20T00:00:00.500Z" },
      { publicationSequence: 2, availableAt: "2026-06-20T00:00:01.001Z" },
    ]);
    const execution = (await db.select({
      nextPublicationAvailableAt: schema.gameExecutionStates.nextPublicationAvailableAt,
    }).from(schema.gameExecutionStates)
      .where(eq(schema.gameExecutionStates.gameId, fixture.gameId)))[0]!;
    expect(execution.nextPublicationAvailableAt).toBe("2026-06-20T00:00:01.001Z");

    const owners = await db.select({
      ownerEpoch: schema.gameRunOwners.ownerEpoch,
      status: schema.gameRunOwners.status,
    }).from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, fixture.gameId));
    expect(owners.find((owner) => owner.ownerEpoch === fixture.priorOwnerEpoch)?.status).toBe("expired");
    expect(owners.find((owner) => owner.ownerEpoch === fixture.currentOwnerEpoch)?.status).toBe("closed");
  });

  test("refuses to settle before the terminal gameplay boundary is committed", async () => {
    const fixture = await createTerminalFixture(db, { executionStatus: "ready" });

    await expect(settleDurableTerminalGame(db, {
      gameId: fixture.gameId,
      ownerEpoch: fixture.currentOwnerEpoch,
    })).rejects.toMatchObject({ code: "execution_not_terminal" });

    expect(await db.select().from(schema.gameCompletionSettlements)).toHaveLength(0);
    expect(await db.select().from(schema.gameResults)).toHaveLength(0);
  });

  test("adopts and completes a terminal game after a crash immediately following completion capture", async () => {
    const fixture = await createTerminalFixture(db);
    const snapshot = await createDurableGameRunnerStore(db, {
      gameId: fixture.gameId,
      ownerEpoch: fixture.currentOwnerEpoch,
    }).load(fixture.gameId);
    if (!snapshot) throw new Error("Expected terminal durable snapshot");
    const captured = await captureGameCompletionSettlement(db, {
      gameId: fixture.gameId,
      ownerEpoch: fixture.currentOwnerEpoch,
      finalEventSequence: fixture.finalEvent.sequence,
      finalEventHash: fixture.finalEventHash,
      terminalResult: {
        gameId: fixture.gameId,
        winnerId: "atlas",
        winnerName: "Atlas",
        rounds: 4,
        transcript: snapshot.transcriptEntries,
        eliminationOrder: [],
        rankedPlayerIds: ["atlas", "echo", "mira", "nyx"],
      },
      tokenUsage: { total: {
        promptTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        callCount: 0,
        emptyResponses: 0,
      }, perAction: {} },
      resolvedModel: "gpt-5.6-luna",
      calculatedCost: null,
      completionConfig: { viewerMode: "replay" },
      finishedAt: fixture.finalEvent.timestamp,
    });
    expect(captured).toMatchObject({ created: true, state: "pending" });

    expect(await preparePendingCompletionSettlementsOnStartup(db)).toEqual({
      scanned: 0,
      readyGameIds: [],
    });
    const result = await adoptInProgressDurableGamesOnStartup(db, {
      processId: "post-capture-restart",
      start: async ({ gameId, ownerEpoch }) => {
        await settleDurableTerminalGame(db, { gameId, ownerEpoch });
      },
    });

    expect(result).toEqual({
      scanned: 1,
      adopted: [fixture.gameId],
      skipped: [],
    });
    expect((await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]?.status).toBe("completed");
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0])
      .toMatchObject({ state: "completed" });
  });
});

async function createTerminalFixture(
  db: DrizzleDB,
  options: { executionStatus?: "ready" | "terminal" } = {},
) {
  const gameId = await insertGame(db, {
    status: "in_progress",
    config: {
      maxRounds: 5,
      modelSelection: {
        catalogId: "openai:gpt-5.6-luna",
        reasoningPolicy: "action-policy",
      },
      visibility: "private",
      viewerMode: "speedrun",
    },
  });
  await db.update(schema.games).set({
    transcriptCaptureVersion: 1,
    formalSpeechCaptureVersion: 1,
  }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));

  const events = withJuryWinner(createCanonicalEventFixture(gameId), "atlas");
  const finalEvent = events.at(-1)!;
  const finalEventHash = hashCanonicalEvent(finalEvent);
  const priorOwnerEpoch = await insertOwner(db, gameId, {
    status: "expired",
    expiresAt: "2026-06-21T00:00:00.000Z",
    lastPersistedEventSequence: events.length,
  });
  await insertCanonicalEventRows(db, gameId, priorOwnerEpoch, events);
  const currentOwnerEpoch = await insertOwner(db, gameId, {
    expiresAt: "2099-01-01T00:00:00.000Z",
    lastPersistedEventSequence: events.length,
  });

  await db.update(schema.gameTranscriptStates).set({
    ownerEpoch: currentOwnerEpoch,
    durableEventSequence: finalEvent.sequence,
    durableEventHash: finalEventHash,
  }).where(eq(schema.gameTranscriptStates.gameId, gameId));

  const executionState: GameExecutionStateV1 = {
    version: 1,
    gameId,
    ownerEpoch: currentOwnerEpoch,
    status: options.executionStatus ?? "terminal",
    heads: {
      version: 1,
      turnSequence: 12,
      eventSequence: finalEvent.sequence,
      eventHash: finalEventHash,
      dialogueSequence: 0,
      publicationSequence: 2,
    },
    lastPresentationPhase: Phase.END,
    nextPublicationAvailableAt: "2026-06-20T00:00:00.500Z",
    xstateSnapshot: { value: "end" },
    cursor: { version: 1, kind: "terminal", stage: "commit_game" },
    playerContinuityCapsules: [],
    houseNarrativeContinuity: null,
    retry: null,
  };
  await db.insert(schema.gameExecutionStates).values({
    gameId,
    contractVersion: 1,
    ownerEpoch: currentOwnerEpoch,
    status: executionState.status,
    committedTurnSequence: executionState.heads.turnSequence,
    eventHeadSequence: executionState.heads.eventSequence,
    eventHeadHash: executionState.heads.eventHash,
    dialogueHeadSequence: executionState.heads.dialogueSequence,
    publicationHeadSequence: executionState.heads.publicationSequence,
    lastPresentationPhase: executionState.lastPresentationPhase,
    nextPublicationAvailableAt: executionState.nextPublicationAvailableAt,
    xstateSnapshot: executionState.xstateSnapshot,
    executionCursor: executionState.cursor,
    playerContinuityCapsules: executionState.playerContinuityCapsules,
    houseNarrativeContinuity: executionState.houseNarrativeContinuity,
    retryState: executionState.retry,
  });

  const turnId = `${gameId}:turn:terminal`;
  const intentHash = `sha256:${"c".repeat(64)}`;
  const effectHash = `sha256:${"d".repeat(64)}`;
  const intent: GameTurnIntentV1 = {
    version: 1,
    gameId,
    turnId,
    turnSequence: 12,
    seed: "terminal-fixture",
    baseHeads: {
      version: 1,
      turnSequence: 11,
      eventSequence: finalEvent.sequence,
      eventHash: finalEventHash,
      dialogueSequence: 0,
      publicationSequence: 0,
    },
    branch: { version: 1, kind: "engine", action: "commit_game" },
    actorIds: [],
    targetIds: [],
    handles: [],
    participantIds: [],
    providerSubcalls: [],
  };
  const committedAt = finalEvent.timestamp;
  const commitResult: GameTurnCommitResultV1 = {
    version: 1,
    gameId,
    turnId,
    turnSequence: 12,
    intentHash,
    effectHash,
    committedAt,
    state: executionState,
    canonicalEvents: [],
    dialogueSequences: [],
    publications: [{
      version: 1,
      gameId,
      sequence: 1,
      turnId,
      turnSequence: 12,
      turnPublicationOrdinal: 1,
      availableAt: "2026-06-20T00:00:00.500Z",
      payload: { version: 1, kind: "canonical_event", eventSequence: 1 },
    }, {
      version: 1,
      gameId,
      sequence: 2,
      turnId,
      turnSequence: 12,
      turnPublicationOrdinal: 2,
      availableAt: null,
      payload: {
        version: 1,
        kind: "completion",
        eventSequence: finalEvent.sequence,
      },
    }],
    alreadyCommitted: false,
  };
  await db.insert(schema.gameTurns).values({
    id: turnId,
    gameId,
    contractVersion: 1,
    turnSequence: 12,
    status: "committed",
    plannedOwnerEpoch: currentOwnerEpoch,
    committedOwnerEpoch: currentOwnerEpoch,
    baseEventSequence: finalEvent.sequence,
    baseDialogueSequence: 0,
    basePublicationSequence: 0,
    intent,
    intentHash,
    effectHash,
    commitResult,
    plannedAt: committedAt,
    committedAt,
  });
  await db.insert(schema.transcripts).values({
    ...serializeTranscriptEntry(gameId, {
      round: 4,
      phase: Phase.END,
      timestamp: Date.parse(finalEvent.timestamp) - 1,
      from: "House",
      scope: "diary",
      to: ["atlas"],
      text: "A committed private diary marker.",
    }, { transcriptCaptureVersion: 1 }),
    gameTurnId: turnId,
    gameTurnTranscriptOrdinal: 1,
  });
  await db.insert(schema.gamePublications).values([{
    gameId,
    publicationSequence: 1,
    turnId,
    turnSequence: 12,
    turnPublicationOrdinal: 1,
    contractVersion: 1,
    kind: "canonical_event",
    payload: { version: 1, kind: "canonical_event", eventSequence: 1 },
    availableAt: "2026-06-20T00:00:00.500Z",
  }, {
    gameId,
    publicationSequence: 2,
    turnId,
    turnSequence: 12,
    turnPublicationOrdinal: 2,
    contractVersion: 1,
    kind: "completion",
    payload: commitResult.publications[1]!.payload,
    availableAt: null,
  }]);

  const logicalCallId = `${gameId}:jury-vote`;
  const attemptId = randomUUID();
  await db.insert(schema.providerLogicalCalls).values({
    id: logicalCallId,
    gameId,
    actorId: "atlas",
    actorName: "Atlas",
    actorRole: "juror",
    action: "jury_vote",
    phase: Phase.JURY_VOTE,
    round: 4,
    logicalCallOrdinal: 1,
  });
  await db.insert(schema.providerCallAttempts).values({
    id: attemptId,
    logicalCallId,
    gameId,
    ownerEpoch: priorOwnerEpoch,
    attemptOrdinal: 1,
    transportAttemptId: randomUUID(),
    reservationHash: `sha256:${"a".repeat(64)}`,
    terminalHash: `sha256:${"b".repeat(64)}`,
    status: "terminal",
    transport: "responses",
    providerProfileId: "openai",
    catalogId: "openai:gpt-5.6-luna",
    modelName: "gpt-5.6-luna",
    startedAt: "2026-06-20T00:00:00.000Z",
    completedAt: "2026-06-20T00:00:00.100Z",
    latencyMs: 100,
    outcomeKind: "usable",
    retryable: false,
    disposition: "accepted",
    accounting: {
      usage: {
        promptTokens: 11,
        cachedTokens: 3,
        cacheWriteTokens: 2,
        completionTokens: 7,
        reasoningTokens: 4,
        totalTokens: 18,
      },
      effectiveServiceTier: "flex",
    },
  });

  return {
    gameId,
    priorOwnerEpoch,
    currentOwnerEpoch,
    finalEvent,
    finalEventHash,
  };
}
