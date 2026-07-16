import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Phase } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  assertGameCompletionEnvelopeV1,
  captureGameCompletionSettlement,
  getGameCompletionSettlementSummary,
  prepareCapturedCompletionAfterRunnerExit,
  preparePendingCompletionSettlementsOnStartup,
  settleCapturedGameCompletion,
  type CaptureGameCompletionSettlementInput,
} from "../services/game-completion-settlement.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import {
  createCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const FINISHED_AT = "2026-07-15T12:00:00.000Z";

describe("game completion settlement capture", () => {
  let db: DrizzleDB;
  let operatorUserId: string;

  beforeEach(async () => {
    db = await setupTestDB();
    operatorUserId = randomUUID();
    await db.insert(schema.users).values({ id: operatorUserId, displayName: "Settlement operator" });
  });

  const adminContext = () => ({
    source: "admin" as const,
    actorUserId: operatorUserId,
    requestedReason: "test operator retry",
  });

  async function createCaptureFixture(): Promise<{
    gameId: string;
    ownerEpoch: string;
    input: CaptureGameCompletionSettlementInput;
  }> {
    const gameId = await insertGame(db, { status: "in_progress" });
    const events = createCanonicalEventFixture(gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: events.length,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);
    const finalEvent = events.at(-1)!;

    return {
      gameId,
      ownerEpoch,
      input: {
        gameId,
        ownerEpoch,
        finalEventSequence: finalEvent.sequence,
        finalEventHash: hashCanonicalEvent(finalEvent),
        terminalResult: {
          // This comes from the runner snapshot, not from the API route argument.
          gameId,
          winnerId: "atlas",
          winnerName: "Atlas",
          rounds: 1,
          transcript: [{
            round: 1,
            phase: Phase.END,
            timestamp: 1_720_000_000_000,
            from: "House",
            scope: "system",
            text: "private terminal transcript marker",
          }],
          eliminationOrder: ["Mira", "Nyx"],
          rankedPlayerIds: ["atlas", "echo", "nyx", "mira"],
        },
        tokenUsage: {
          total: {
            promptTokens: 100,
            cachedTokens: 20,
            completionTokens: 30,
            reasoningTokens: 10,
            totalTokens: 130,
            callCount: 2,
            emptyResponses: 0,
          },
          perAction: {
            "atlas:vote": {
              promptTokens: 100,
              cachedTokens: 20,
              completionTokens: 30,
              reasoningTokens: 10,
              totalTokens: 130,
              callCount: 2,
              emptyResponses: 0,
            },
          },
        },
        resolvedModel: "gpt-5-mini",
        calculatedCost: {
          model: "gpt-5-mini",
          inputCost: 0.00002,
          outputCost: 0.00006,
          totalCost: 0.00008,
        },
        completionConfig: {
          maxRounds: 5,
          viewerMode: "replay",
          modelSelection: { default: "gpt-5-mini" },
        },
        finishedAt: FINISHED_AT,
      },
    };
  }

  function completionEnvelopeFromInput(input: CaptureGameCompletionSettlementInput) {
    return assertGameCompletionEnvelopeV1({
      schema: "influence.game-completion",
      version: 1,
      boundary: {
        ownerEpoch: input.ownerEpoch,
        finalEventSequence: input.finalEventSequence,
        finalEventHash: input.finalEventHash,
      },
      result: input.terminalResult,
      tokenUsage: input.tokenUsage,
      model: {
        resolvedModel: input.resolvedModel,
        calculatedCost: input.calculatedCost,
      },
      completionConfig: input.completionConfig,
      finishedAt: input.finishedAt,
    });
  }

  async function insertCorruptedSettlement(
    fixture: Awaited<ReturnType<typeof createCaptureFixture>>,
  ) {
    const envelope = completionEnvelopeFromInput(fixture.input);
    await db.insert(schema.gameCompletionSettlements).values({
      id: randomUUID(),
      gameId: fixture.gameId,
      ownerEpoch: fixture.ownerEpoch,
      finalEventSequence: fixture.input.finalEventSequence,
      finalEventHash: fixture.input.finalEventHash,
      payloadSchemaVersion: 1,
      payload: envelope as unknown as Record<string, unknown>,
      payloadHash: `sha256:${"f".repeat(64)}`,
      state: "pending",
    });
  }

  function failGameResultInsert(targetDb: DrizzleDB): DrizzleDB {
    type SettlementTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
    type SettlementCallback = (tx: SettlementTransaction) => Promise<unknown>;

    return new Proxy(targetDb, {
      get(target, property) {
        if (property !== "transaction") return Reflect.get(target, property, target);
        return (callback: SettlementCallback) => target.transaction(async (tx) => {
          const faultingTx = new Proxy(tx, {
            get(transaction, transactionProperty) {
              const member = Reflect.get(transaction, transactionProperty, transaction);
              if (transactionProperty !== "insert") {
                return typeof member === "function" ? member.bind(transaction) : member;
              }
              const insert = member as (...args: unknown[]) => unknown;
              return (...args: unknown[]) => {
                if (args[0] === schema.gameResults) {
                  throw new Error("injected post-capture settlement failure");
                }
                return insert.apply(transaction, args);
              };
            },
          }) as SettlementTransaction;
          return callback(faultingTx);
        });
      },
    });
  }

  test("captures a private v1 envelope at the exact owner and event boundary", async () => {
    const fixture = await createCaptureFixture();

    const captured = await captureGameCompletionSettlement(db, fixture.input);

    expect(captured).toMatchObject({
      created: true,
      state: "pending",
      retryReadyAt: null,
    });
    expect(captured.resultHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const stored = (await db.select()
      .from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0]!;
    expect(stored.payloadSchemaVersion).toBe(1);
    expect(stored.payloadHash).toBe(captured.resultHash);
    expect(stored.payload).toMatchObject({
      version: 1,
      boundary: {
        ownerEpoch: fixture.ownerEpoch,
        finalEventSequence: fixture.input.finalEventSequence,
        finalEventHash: fixture.input.finalEventHash,
      },
      result: {
        gameId: fixture.gameId,
        winnerId: "atlas",
      },
      finishedAt: FINISHED_AT,
    });
  });

  test("returns the existing row for an identical recapture and rejects any conflicting recapture", async () => {
    const fixture = await createCaptureFixture();
    const first = await captureGameCompletionSettlement(db, fixture.input);
    const second = await captureGameCompletionSettlement(db, fixture.input);

    expect(second).toEqual({ ...first, created: false });
    expect(await db.select().from(schema.gameCompletionSettlements)).toHaveLength(1);

    await expect(captureGameCompletionSettlement(db, {
      ...fixture.input,
      terminalResult: {
        ...fixture.input.terminalResult,
        winnerName: "An outcome override",
      },
    })).rejects.toMatchObject({ code: "conflicting_capture" });
  });

  test("rejects a terminal result whose runner-sourced game identity differs", async () => {
    const fixture = await createCaptureFixture();

    await expect(captureGameCompletionSettlement(db, {
      ...fixture.input,
      terminalResult: {
        ...fixture.input.terminalResult,
        gameId: "different-runner-game",
      },
    })).rejects.toMatchObject({ code: "terminal_game_mismatch" });
  });

  test("fails closed for absent, inactive, expired, or head-mismatched ownership", async () => {
    const absent = await createCaptureFixture();
    await expect(captureGameCompletionSettlement(db, {
      ...absent.input,
      ownerEpoch: "missing-owner",
    })).rejects.toMatchObject({ code: "owner_not_found" });

    const inactive = await createCaptureFixture();
    await db.update(schema.gameRunOwners)
      .set({ status: "revoked" })
      .where(eq(schema.gameRunOwners.ownerEpoch, inactive.ownerEpoch));
    await expect(captureGameCompletionSettlement(db, inactive.input))
      .rejects.toMatchObject({ code: "owner_not_active" });

    const expired = await createCaptureFixture();
    await db.update(schema.gameRunOwners)
      .set({ expiresAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(schema.gameRunOwners.ownerEpoch, expired.ownerEpoch));
    await expect(captureGameCompletionSettlement(db, expired.input))
      .rejects.toMatchObject({ code: "owner_expired" });

    const mismatchedHead = await createCaptureFixture();
    await db.update(schema.gameRunOwners)
      .set({ lastPersistedEventSequence: mismatchedHead.input.finalEventSequence - 1 })
      .where(eq(schema.gameRunOwners.ownerEpoch, mismatchedHead.ownerEpoch));
    await expect(captureGameCompletionSettlement(db, mismatchedHead.input))
      .rejects.toMatchObject({ code: "event_head_mismatch" });
  });

  test("rejects event-boundary and stored-envelope hash mismatches", async () => {
    const wrongEventHash = await createCaptureFixture();
    await expect(captureGameCompletionSettlement(db, {
      ...wrongEventHash.input,
      finalEventHash: `sha256:${"0".repeat(64)}`,
    })).rejects.toMatchObject({ code: "event_hash_mismatch" });

    const corruptedEnvelope = await createCaptureFixture();
    await insertCorruptedSettlement(corruptedEnvelope);
    await expect(captureGameCompletionSettlement(db, corruptedEnvelope.input))
      .rejects.toMatchObject({ code: "stored_payload_hash_mismatch" });
  });

  test("strictly validates v1 payloads and exposes only the shared redacted summary", async () => {
    const fixture = await createCaptureFixture();
    await captureGameCompletionSettlement(db, fixture.input);
    const stored = (await db.select()
      .from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0]!;

    expect(() => assertGameCompletionEnvelopeV1({
      ...stored.payload,
      rawPrompt: "must never be accepted",
    })).toThrow("Unexpected completion envelope field: rawPrompt");

    const summary = await getGameCompletionSettlementSummary(db, fixture.gameId);
    expect(summary).toEqual({
      schemaVersion: 1,
      state: "pending",
      retryEligible: false,
      attemptCount: 0,
      resultHash: stored.payloadHash,
      boundary: {
        ownerEpoch: fixture.ownerEpoch,
        finalEventSequence: fixture.input.finalEventSequence,
        finalEventHash: fixture.input.finalEventHash,
      },
      failureCode: null,
      capturedAt: expect.any(String),
      retryReadyAt: null,
      lastAttemptedAt: null,
      completedAt: null,
    });
    expect(JSON.stringify(summary)).not.toContain("private terminal transcript marker");
    expect(JSON.stringify(summary)).not.toContain("winnerId");
    expect(summary).not.toHaveProperty("payload");

    expect(await getGameCompletionSettlementSummary(db, "missing-game")).toEqual({
      schemaVersion: 1,
      state: "not_applicable",
      retryEligible: false,
      attemptCount: 0,
      resultHash: null,
      boundary: null,
      failureCode: null,
      capturedAt: null,
      retryReadyAt: null,
      lastAttemptedAt: null,
      completedAt: null,
    });
  });

  test("prepares a sealed pending completion from durable state after runner exit", async () => {
    const fixture = await createCaptureFixture();
    await captureGameCompletionSettlement(db, fixture.input);

    const prepared = await prepareCapturedCompletionAfterRunnerExit(
      db,
      fixture.gameId,
      "runner_exit",
    );

    expect(prepared).toEqual({
      state: "pending",
      prepared: true,
      retryReady: true,
      openedRetry: true,
    });
    expect((await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]).toMatchObject({ status: "suspended" });
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch)))[0]).toMatchObject({
      status: "expired",
      failureReason: "completion_settlement_transient_failure",
    });
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0]?.retryReadyAt)
      .toBeString();

    expect(await prepareCapturedCompletionAfterRunnerExit(db, fixture.gameId, "runner_exit"))
      .toEqual({
        state: "pending",
        prepared: true,
        retryReady: true,
        openedRetry: false,
      });
  });

  test("survives a post-capture transaction failure, startup preparation, and operator redrive", async () => {
    const fixture = await createCaptureFixture();
    await captureGameCompletionSettlement(db, fixture.input);

    await expect(settleCapturedGameCompletion(
      failGameResultInsert(db),
      fixture.gameId,
      { source: "runner" },
    )).rejects.toThrow("injected post-capture settlement failure");

    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId))).toHaveLength(0);
    expect(await db.select().from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, fixture.gameId))).toHaveLength(0);
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0]).toMatchObject({
      state: "pending",
      attemptCount: 1,
      retryReadyAt: null,
    });

    expect(await preparePendingCompletionSettlementsOnStartup(db)).toEqual({
      scanned: 1,
      readyGameIds: [fixture.gameId],
    });
    const redriven = await settleCapturedGameCompletion(db, fixture.gameId, adminContext());

    expect(redriven.outcome).toBe("completed");
    expect((await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]).toMatchObject({
      status: "completed",
      endedAt: FINISHED_AT,
    });
    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId))).toHaveLength(1);
  });

  test("the database rejects mutation of sealed envelope fields", async () => {
    const fixture = await createCaptureFixture();
    await captureGameCompletionSettlement(db, fixture.input);

    await expect(db.update(schema.gameCompletionSettlements).set({
      payloadHash: `sha256:${"0".repeat(64)}`,
    }).where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)).execute())
      .rejects.toMatchObject({
        cause: {
          code: "23514",
          message: "completion settlement envelope fields are immutable",
        },
      });
  });

  test("settles the sealed outcome atomically with frozen timestamps and metadata", async () => {
    const fixture = await createCaptureFixture();
    const profileOwnerId = randomUUID();
    const profileId = randomUUID();
    await db.insert(schema.users).values({ id: profileOwnerId, displayName: "Profile owner" });
    await db.insert(schema.agentProfiles).values({
      id: profileId,
      userId: profileOwnerId,
      name: `Settlement profile ${profileId}`,
      personality: "strategic",
    });
    await db.insert(schema.gamePlayers).values({
      ...playerSeat(fixture.gameId, "atlas", profileOwnerId),
      agentProfileId: profileId,
    });
    await captureGameCompletionSettlement(db, fixture.input);

    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId))).toHaveLength(0);
    expect(await db.select().from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, fixture.gameId))).toHaveLength(0);
    expect((await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]?.status).toBe("in_progress");
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch)))[0]?.status).toBe("active");
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId)))[0])
      .toMatchObject({ gamesPlayed: 0, gamesWon: 0 });

    const settled = await settleCapturedGameCompletion(db, fixture.gameId, { source: "runner" });

    expect(settled).toMatchObject({ outcome: "completed", state: "completed" });
    const game = (await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]!;
    expect(game).toMatchObject({ status: "completed", endedAt: FINISHED_AT });
    expect(JSON.parse(game.config)).toEqual(fixture.input.completionConfig);

    const result = (await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId)))[0]!;
    expect(result).toMatchObject({
      winnerId: "atlas",
      roundsPlayed: 1,
      finishedAt: FINISHED_AT,
    });
    expect(JSON.parse(result.tokenUsage)).toEqual({
      promptTokens: 100,
      cachedTokens: 20,
      completionTokens: 30,
      reasoningTokens: 10,
      totalTokens: 130,
      emptyResponses: 0,
      estimatedCost: 0.00008,
      perAction: fixture.input.tokenUsage.perAction,
    });
    expect(await db.select().from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, fixture.gameId))).toHaveLength(1);
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch)))[0])
      .toMatchObject({ status: "closed", closedAt: FINISHED_AT });
    expect(await db.select().from(schema.gamePostgameMedia)
      .where(eq(schema.gamePostgameMedia.gameId, fixture.gameId))).toHaveLength(1);
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId)))[0])
      .toMatchObject({ gamesPlayed: 1, gamesWon: 1, updatedAt: FINISHED_AT });

    const settlement = (await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0]!;
    expect(settlement).toMatchObject({ state: "completed", attemptCount: 1 });
    expect(settlement.completedAt).toBeString();
    expect(await db.select().from(schema.gameCompletionSettlementAttempts)
      .where(eq(schema.gameCompletionSettlementAttempts.gameId, fixture.gameId)))
      .toHaveLength(1);
  });

  test("repeated and concurrent settlement attempts are exact-once no-ops", async () => {
    const fixture = await createCaptureFixture();
    await captureGameCompletionSettlement(db, fixture.input);

    const raced = await Promise.all([
      settleCapturedGameCompletion(db, fixture.gameId, { source: "runner" }),
      settleCapturedGameCompletion(db, fixture.gameId, { source: "runner" }),
    ]);
    const repeated = await settleCapturedGameCompletion(db, fixture.gameId, adminContext());

    expect(raced.map((result) => result.outcome).sort())
      .toEqual(["already_completed", "completed"]);
    expect(repeated.outcome).toBe("already_completed");
    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId))).toHaveLength(1);
    expect(await db.select().from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, fixture.gameId))).toHaveLength(1);
    expect(await db.select().from(schema.gamePostgameMedia)
      .where(eq(schema.gamePostgameMedia.gameId, fixture.gameId))).toHaveLength(1);
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0])
      .toMatchObject({ state: "completed", attemptCount: 3 });
  });

  test("an expired owner can settle only from the exact settlement-pending suspension", async () => {
    const fixture = await createCaptureFixture();
    await captureGameCompletionSettlement(db, fixture.input);
    await db.update(schema.gameRunOwners).set({
      status: "expired",
      failureReason: "completion_settlement_transient_failure",
      closedAt: "2026-07-15T12:01:00.000Z",
    }).where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch));
    await db.update(schema.games).set({ status: "suspended" })
      .where(eq(schema.games.id, fixture.gameId));
    await db.update(schema.gameCompletionSettlements).set({
      retryReadyAt: "2026-07-15T12:01:00.000Z",
    }).where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId));

    await expect(settleCapturedGameCompletion(db, fixture.gameId, adminContext()))
      .resolves.toMatchObject({ outcome: "completed" });
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch)))[0])
      .toMatchObject({ status: "closed", closedAt: FINISHED_AT });
  });

  test("an operator cannot bypass the retry-ready owner gate", async () => {
    const fixture = await createCaptureFixture();
    await captureGameCompletionSettlement(db, fixture.input);
    await db.update(schema.gameRunOwners).set({
      status: "expired",
      failureReason: "runner_failed",
      closedAt: "2026-07-15T12:01:00.000Z",
    }).where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch));
    await db.update(schema.games).set({ status: "suspended" })
      .where(eq(schema.games.id, fixture.gameId));

    await expect(settleCapturedGameCompletion(db, fixture.gameId, adminContext()))
      .rejects.toMatchObject({
        code: "completion_settlement_retry_not_ready",
        safeFailureCode: "completion_game_state_conflict",
      });
    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId))).toHaveLength(0);
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch)))[0]?.status)
      .toBe("expired");
  });

  test("free-track account ratings and counters use the sealed ranking exactly once", async () => {
    const fixture = await createCaptureFixture();
    const winnerUserId = randomUUID();
    const runnerUpUserId = randomUUID();
    await db.insert(schema.users).values([
      { id: winnerUserId, displayName: "Winner" },
      { id: runnerUpUserId, displayName: "Runner up" },
    ]);
    await db.update(schema.games).set({ trackType: "free" })
      .where(eq(schema.games.id, fixture.gameId));
    await db.insert(schema.gamePlayers).values([
      playerSeat(fixture.gameId, "atlas", winnerUserId),
      playerSeat(fixture.gameId, "echo", runnerUpUserId),
      playerSeat(fixture.gameId, "nyx"),
      playerSeat(fixture.gameId, "mira"),
    ]);
    await captureGameCompletionSettlement(db, fixture.input);

    await settleCapturedGameCompletion(db, fixture.gameId, { source: "runner" });
    await settleCapturedGameCompletion(db, fixture.gameId, adminContext());

    const users = await db.select().from(schema.users);
    expect(users.find((user) => user.id === winnerUserId)).toMatchObject({
      rating: 1216,
      peakRating: 1216,
      gamesPlayed: 1,
      gamesWon: 1,
      lastGameAt: FINISHED_AT,
    });
    expect(users.find((user) => user.id === runnerUpUserId)).toMatchObject({
      rating: 1184,
      peakRating: 1200,
      gamesPlayed: 1,
      gamesWon: 0,
      lastGameAt: FINISHED_AT,
    });
  });

  test("missing frozen competition evidence becomes repair-required and awards nothing", async () => {
    const fixture = await createCaptureFixture();
    const ownerUserId = randomUUID();
    const profileId = randomUUID();
    const seasonId = randomUUID();
    await db.insert(schema.users).values({ id: ownerUserId, displayName: "Owned seat" });
    await db.insert(schema.agentProfiles).values({
      id: profileId,
      userId: ownerUserId,
      name: `Contestant ${profileId}`,
      personality: "strategic",
    });
    await db.insert(schema.seasons).values({
      id: seasonId,
      slug: `season-${seasonId}`,
      name: "Settlement evidence season",
      status: "active",
    });
    await db.update(schema.games).set({ seasonId, trackType: "free" })
      .where(eq(schema.games.id, fixture.gameId));
    await db.insert(schema.gamePlayers).values([
      {
        ...playerSeat(fixture.gameId, "atlas", ownerUserId),
        agentProfileId: profileId,
      },
      playerSeat(fixture.gameId, "echo"),
      playerSeat(fixture.gameId, "nyx"),
      playerSeat(fixture.gameId, "mira"),
    ]);
    await captureGameCompletionSettlement(db, fixture.input);

    await expect(settleCapturedGameCompletion(db, fixture.gameId, { source: "runner" }))
      .rejects.toMatchObject({
        code: "completion_settlement_repair_required",
        safeFailureCode: "competition_settlement_evidence_missing",
      });

    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId))).toHaveLength(0);
    expect(await db.select().from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, fixture.gameId))).toHaveLength(0);
    expect(await db.select().from(schema.competitionReceipts)
      .where(eq(schema.competitionReceipts.gameId, fixture.gameId))).toHaveLength(0);
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId)))[0])
      .toMatchObject({ gamesPlayed: 0, gamesWon: 0 });
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0])
      .toMatchObject({
        state: "repair_required",
        lastSafeFailureCode: "competition_settlement_evidence_missing",
      });
  });

  test("deterministic envelope conflicts become repair-required with zero terminal side effects", async () => {
    const fixture = await createCaptureFixture();
    await insertCorruptedSettlement(fixture);

    await expect(settleCapturedGameCompletion(db, fixture.gameId, { source: "runner" }))
      .rejects.toMatchObject({
        code: "completion_settlement_repair_required",
        safeFailureCode: "completion_envelope_hash_mismatch",
      });

    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, fixture.gameId))).toHaveLength(0);
    expect(await db.select().from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, fixture.gameId))).toHaveLength(0);
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, fixture.gameId)))[0])
      .toMatchObject({
        state: "repair_required",
        attemptCount: 1,
        lastSafeFailureCode: "completion_envelope_hash_mismatch",
      });
    expect((await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]?.status).toBe("in_progress");
  });
});

function playerSeat(
  gameId: string,
  playerId: string,
  userId?: string,
): typeof schema.gamePlayers.$inferInsert {
  return {
    id: playerId,
    gameId,
    ...(userId && { userId }),
    persona: JSON.stringify({ name: playerId, personality: "strategic" }),
    agentConfig: JSON.stringify({ model: "gpt-5-mini" }),
  };
}
