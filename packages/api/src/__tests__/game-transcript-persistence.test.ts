/**
 * U2 DB tests: checkpoint-aligned product dialogue watermark, suffix catch-up,
 * recovery identity gate, and terminal reconciliation exact-once.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { Phase, type TranscriptEntry } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import {
  captureGameCompletionSettlement,
  settleCapturedGameCompletion,
} from "../services/game-completion-settlement.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import {
  computePrefixDigest,
  TRANSCRIPT_PREFIX_DIGEST_EMPTY,
  readGameTranscriptState,
} from "../services/game-transcript-persistence.js";
import { evaluateProductDialogueRecoveryGate as recoveryGate } from "../services/game-recovery.js";
import { initialGameTranscriptStateValues as initialState } from "../services/transcript-capture.js";
import {
  createCanonicalEventFixture,
  createCheckpointCapsule,
  enrichCapsuleForV1Candidate,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

function productEntry(
  sequence: number,
  text: string,
  extras: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  return {
    round: 1,
    phase: Phase.LOBBY,
    timestamp: 1_720_000_000_000 + sequence,
    from: "Atlas",
    scope: "public",
    text,
    entrySequence: sequence,
    speakerPlayerId: "atlas",
    audiencePlayerIds: [],
    dialogueKind: "public_speech",
    dialogueContext: { version: 1 },
    ...extras,
  };
}

async function insertCurrentCaptureGame(db: DrizzleDB, status: "in_progress" | "suspended" = "in_progress") {
  const gameId = await insertGame(db, { status });
  await db.update(schema.games).set({
    transcriptCaptureVersion: 1,
    formalSpeechCaptureVersion: 1,
  }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values(initialState(gameId, 1));
  return gameId;
}

describe("U2 product dialogue watermark at checkpoints", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("phase boundary persists only the new suffix and advances watermark once", async () => {
    const gameId = await insertCurrentCaptureGame(db);
    const events = createCanonicalEventFixture(gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: events.length,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);

    const firstProjection = [productEntry(1, "hello"), productEntry(2, "world")];
    const midSequence = Math.min(3, events.length);
    const midEvents = events.slice(0, midSequence);
    const midCapsule = createCheckpointCapsule(midEvents, "phase_boundary");
    const midHash = (await db.select({ eventHash: schema.gameEvents.eventHash })
      .from(schema.gameEvents)
      .where(and(
        eq(schema.gameEvents.gameId, gameId),
        eq(schema.gameEvents.sequence, midCapsule.lastEventSequence),
      )))[0]!.eventHash;
    const midEnriched = enrichCapsuleForV1Candidate(midCapsule, {
      ownerEpoch,
      eventHeadHash: midHash,
      actorCoordinate: "vote",
    });

    const first = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: {
        ...midEnriched,
        productDialogueProjection: firstProjection,
      },
    });
    expect(first.ok).toBe(true);

    const stateAfterFirst = await readGameTranscriptState(db, gameId);
    expect(stateAfterFirst).toMatchObject({
      durableSequence: 2,
      durableCount: 2,
      durableEventSequence: midCapsule.lastEventSequence,
      ownerEpoch,
    });
    expect(stateAfterFirst!.prefixDigest).toBe(computePrefixDigest(firstProjection));

    const rowsAfterFirst = await db.select({
      entrySequence: schema.transcripts.entrySequence,
      text: schema.transcripts.text,
    }).from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, gameId))
      .orderBy(asc(schema.transcripts.entrySequence));
    expect(rowsAfterFirst.map((r) => r.text)).toEqual(["hello", "world"]);

    // Later boundary with one new row — only sequence 3 inserts.
    const fullProjection = [...firstProjection, productEntry(3, "again")];
    const fullCapsule = createCheckpointCapsule(events, "phase_boundary");
    const fullHash = hashCanonicalEvent(events.at(-1)!);
    const fullEnriched = enrichCapsuleForV1Candidate(fullCapsule, {
      ownerEpoch,
      eventHeadHash: fullHash,
      actorCoordinate: "vote",
    });
    const second = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: {
        ...fullEnriched,
        productDialogueProjection: fullProjection,
      },
    });
    expect(second.ok).toBe(true);

    const stateAfterSecond = await readGameTranscriptState(db, gameId);
    expect(stateAfterSecond).toMatchObject({
      durableSequence: 3,
      durableCount: 3,
      durableEventSequence: fullCapsule.lastEventSequence,
    });
    expect(stateAfterSecond!.prefixDigest).toBe(computePrefixDigest(fullProjection));

    const rows = await db.select({
      entrySequence: schema.transcripts.entrySequence,
      text: schema.transcripts.text,
      firstDurableEventSequence: schema.transcripts.firstDurableEventSequence,
    }).from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, gameId))
      .orderBy(asc(schema.transcripts.entrySequence));
    expect(rows).toHaveLength(3);
    expect(rows[2]!.text).toBe("again");
    expect(rows[2]!.firstDurableEventSequence).toBe(fullCapsule.lastEventSequence);
    // Earlier rows sealed at the earlier boundary.
    expect(rows[0]!.firstDurableEventSequence).toBe(midCapsule.lastEventSequence);
  });

  test("failed checkpoint leaves new dialogue uncommitted; later checkpoint catches up", async () => {
    const gameId = await insertCurrentCaptureGame(db);
    const events = createCanonicalEventFixture(gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: events.length,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);

    const capsule = createCheckpointCapsule(events, "phase_boundary");
    const eventHash = hashCanonicalEvent(events.at(-1)!);
    const enriched = enrichCapsuleForV1Candidate(capsule, {
      ownerEpoch,
      eventHeadHash: eventHash,
      actorCoordinate: "vote",
    });

    // Sparse suffix 1,3 must fail closed.
    const failed = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: {
        ...enriched,
        productDialogueProjection: [productEntry(1, "a"), productEntry(3, "c")],
      },
    });
    expect(failed.ok).toBe(false);
    expect(failed.ok === false && failed.error).toMatch(/sparse|product_dialogue/);

    expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, gameId))).toHaveLength(0);
    const state = await readGameTranscriptState(db, gameId);
    expect(state).toMatchObject({
      durableSequence: 0,
      durableCount: 0,
      prefixDigest: TRANSCRIPT_PREFIX_DIGEST_EMPTY,
    });

    // Later successful checkpoint with contiguous projection catches up fully.
    const ok = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: {
        ...enriched,
        productDialogueProjection: [
          productEntry(1, "a"),
          productEntry(2, "b"),
          productEntry(3, "c"),
        ],
      },
    });
    expect(ok.ok).toBe(true);
    const after = await readGameTranscriptState(db, gameId);
    expect(after?.durableSequence).toBe(3);
    expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, gameId))).toHaveLength(3);
  });

  test("existing-checkpoint retry reconciles product evidence; projection-only is insufficient", async () => {
    const gameId = await insertCurrentCaptureGame(db);
    const events = createCanonicalEventFixture(gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: events.length,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);

    const capsule = createCheckpointCapsule(events, "phase_boundary");
    const eventHash = hashCanonicalEvent(events.at(-1)!);
    const enriched = enrichCapsuleForV1Candidate(capsule, {
      ownerEpoch,
      eventHeadHash: eventHash,
      actorCoordinate: "vote",
    });
    const projection = [productEntry(1, "stable")];

    const first = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: { ...enriched, productDialogueProjection: projection },
    });
    expect(first.ok).toBe(true);

    const retry = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: { ...enriched, productDialogueProjection: projection },
    });
    expect(retry.ok).toBe(true);
    expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, gameId))).toHaveLength(1);

    // Conflicting content at same sequence must not succeed.
    const conflict = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: {
        ...enriched,
        productDialogueProjection: [productEntry(1, "DIFFERENT")],
      },
    });
    expect(conflict.ok).toBe(false);
    expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, gameId))).toHaveLength(1);
    const text = (await db.select({ text: schema.transcripts.text })
      .from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, gameId)))[0]!.text;
    expect(text).toBe("stable");
  });

  test("legacy version 0 games skip modern watermark and keep prior checkpoint behavior", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const events = createCanonicalEventFixture(gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: events.length,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);

    const capsule = createCheckpointCapsule(events, "phase_boundary");
    const eventHash = hashCanonicalEvent(events.at(-1)!);
    const enriched = enrichCapsuleForV1Candidate(capsule, {
      ownerEpoch,
      eventHeadHash: eventHash,
      actorCoordinate: "vote",
    });

    const result = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: {
        ...enriched,
        productDialogueProjection: [productEntry(1, "ignored-on-v0")],
      },
    });
    expect(result.ok).toBe(true);
    expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, gameId))).toHaveLength(0);
    expect(await readGameTranscriptState(db, gameId)).toBeNull();
  });
});

describe("U2 recovery product dialogue gate", () => {
  test("refuses older checkpoint when product state is already at a newer boundary", () => {
    const productState = {
      gameId: "g",
      captureVersion: 1,
      ownerEpoch: "o",
      durableEventSequence: 10,
      durableEventHash: `sha256:${"a".repeat(64)}`,
      durableSequence: 2,
      durableCount: 2,
      prefixDigest: TRANSCRIPT_PREFIX_DIGEST_EMPTY,
      terminalState: "unset",
      terminalCount: null,
      terminalDigest: null,
    };
    const older = recoveryGate({
      checkpointLastEventSequence: 5,
      transcriptCursor: {
        productDialogue: {
          version: 1,
          durableSequence: 1,
          durableCount: 1,
          prefixDigest: TRANSCRIPT_PREFIX_DIGEST_EMPTY,
          durableEventSequence: 5,
          durableEventHash: `sha256:${"b".repeat(64)}`,
          ownerEpoch: "o",
        },
      },
      productState,
    });
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.reason).toMatch(/superseded/);
  });

  test("requires exact evidence match at the published boundary", () => {
    const digest = `sha256:${"c".repeat(64)}`;
    const productState = {
      gameId: "g",
      captureVersion: 1,
      ownerEpoch: "o",
      durableEventSequence: 10,
      durableEventHash: `sha256:${"a".repeat(64)}`,
      durableSequence: 2,
      durableCount: 2,
      prefixDigest: digest,
      terminalState: "unset",
      terminalCount: null,
      terminalDigest: null,
    };
    const ok = recoveryGate({
      checkpointLastEventSequence: 10,
      transcriptCursor: {
        productDialogue: {
          version: 1,
          durableSequence: 2,
          durableCount: 2,
          prefixDigest: digest,
          durableEventSequence: 10,
          durableEventHash: `sha256:${"a".repeat(64)}`,
          ownerEpoch: "o",
        },
      },
      productState,
    });
    expect(ok.ok).toBe(true);

    const mismatch = recoveryGate({
      checkpointLastEventSequence: 10,
      transcriptCursor: {
        productDialogue: {
          version: 1,
          durableSequence: 2,
          durableCount: 2,
          prefixDigest: `sha256:${"d".repeat(64)}`,
          durableEventSequence: 10,
          durableEventHash: `sha256:${"a".repeat(64)}`,
          ownerEpoch: "o",
        },
      },
      productState,
    });
    expect(mismatch.ok).toBe(false);
  });
});

describe("U2 terminal settlement reconcile", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("settlement with live prefix is exact-once and seals terminal digest", async () => {
    const gameId = await insertCurrentCaptureGame(db, "in_progress");
    const events = createCanonicalEventFixture(gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: events.length,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);
    const finalEvent = events.at(-1)!;
    const finalHash = hashCanonicalEvent(finalEvent);

    const liveProjection = [productEntry(1, "live-one"), productEntry(2, "live-two")];
    const capsule = createCheckpointCapsule(events, "phase_boundary");
    const enriched = enrichCapsuleForV1Candidate(capsule, {
      ownerEpoch,
      eventHeadHash: finalHash,
      actorCoordinate: "vote",
    });
    expect((await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: { ...enriched, productDialogueProjection: liveProjection },
    })).ok).toBe(true);

    const fullTranscript: TranscriptEntry[] = [
      ...liveProjection,
      productEntry(3, "terminal-three"),
      {
        round: 1,
        phase: Phase.END,
        timestamp: 1_720_000_000_099,
        from: "Atlas",
        scope: "diary",
        text: "private diary",
        speakerPlayerId: "atlas",
      },
    ];

    await captureGameCompletionSettlement(db, {
      gameId,
      ownerEpoch,
      finalEventSequence: finalEvent.sequence,
      finalEventHash: finalHash,
      terminalResult: {
        gameId,
        winnerId: "atlas",
        winnerName: "Atlas",
        rounds: 1,
        transcript: fullTranscript,
        eliminationOrder: ["mira"],
        rankedPlayerIds: ["atlas", "echo", "nyx", "mira"],
      },
      tokenUsage: {
        total: {
          promptTokens: 10,
          cachedTokens: 0,
          completionTokens: 5,
          reasoningTokens: 0,
          totalTokens: 15,
          callCount: 1,
          emptyResponses: 0,
        },
        perAction: {
          "atlas:vote": {
            promptTokens: 10,
            cachedTokens: 0,
            completionTokens: 5,
            reasoningTokens: 0,
            totalTokens: 15,
            callCount: 1,
            emptyResponses: 0,
          },
        },
      },
      resolvedModel: "gpt-5-mini",
      calculatedCost: {
        model: "gpt-5-mini",
        inputCost: 0.001,
        outputCost: 0.002,
        totalCost: 0.003,
      },
      completionConfig: { maxRounds: 5 },
      finishedAt: "2026-07-15T12:00:00.000Z",
    });

    const settled = await settleCapturedGameCompletion(db, gameId, { source: "runner" });
    expect(settled.outcome).toBe("completed");

    const state = await readGameTranscriptState(db, gameId);
    expect(state).toMatchObject({
      durableSequence: 3,
      durableCount: 3,
      terminalState: "complete",
      terminalCount: 3,
    });
    expect(state!.terminalDigest).toBe(computePrefixDigest([
      productEntry(1, "live-one"),
      productEntry(2, "live-two"),
      productEntry(3, "terminal-three"),
    ]));

    const dialogueRows = await db.select()
      .from(schema.transcripts)
      .where(and(
        eq(schema.transcripts.gameId, gameId),
        eq(schema.transcripts.scope, "public"),
      ));
    expect(dialogueRows).toHaveLength(3);

    const diaryRows = await db.select()
      .from(schema.transcripts)
      .where(and(
        eq(schema.transcripts.gameId, gameId),
        eq(schema.transcripts.scope, "diary"),
      ));
    expect(diaryRows).toHaveLength(1);

    // Repeated settlement is exact-once.
    const again = await settleCapturedGameCompletion(db, gameId, { source: "runner" });
    expect(again.outcome).toBe("already_completed");
    expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, gameId))).toHaveLength(4);
  });

  test("same-sequence content conflict becomes repair-required", async () => {
    const gameId = await insertCurrentCaptureGame(db, "in_progress");
    const events = createCanonicalEventFixture(gameId);
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: events.length,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);
    const finalEvent = events.at(-1)!;
    const finalHash = hashCanonicalEvent(finalEvent);

    const live = [productEntry(1, "live")];
    const capsule = createCheckpointCapsule(events, "phase_boundary");
    const enriched = enrichCapsuleForV1Candidate(capsule, {
      ownerEpoch,
      eventHeadHash: finalHash,
      actorCoordinate: "vote",
    });
    expect((await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: { ...enriched, productDialogueProjection: live },
    })).ok).toBe(true);

    await captureGameCompletionSettlement(db, {
      gameId,
      ownerEpoch,
      finalEventSequence: finalEvent.sequence,
      finalEventHash: finalHash,
      terminalResult: {
        gameId,
        winnerId: "atlas",
        winnerName: "Atlas",
        rounds: 1,
        transcript: [productEntry(1, "CONFLICT")],
        eliminationOrder: [],
        rankedPlayerIds: ["atlas", "echo", "nyx", "mira"],
      },
      tokenUsage: {
        total: {
          promptTokens: 1,
          cachedTokens: 0,
          completionTokens: 0,
          reasoningTokens: 0,
          totalTokens: 1,
          callCount: 1,
          emptyResponses: 0,
        },
        perAction: {
          x: {
            promptTokens: 1,
            cachedTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 1,
            callCount: 1,
            emptyResponses: 0,
          },
        },
      },
      resolvedModel: "gpt-5-mini",
      calculatedCost: null,
      completionConfig: {},
      finishedAt: "2026-07-15T12:00:00.000Z",
    });

    await expect(settleCapturedGameCompletion(db, gameId, { source: "runner" }))
      .rejects.toMatchObject({ code: "completion_settlement_repair_required" });

    const settlement = (await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, gameId)))[0]!;
    expect(settlement.state).toBe("repair_required");
    expect(settlement.lastSafeFailureCode).toBe("transcript_content_conflict");

    const state = await readGameTranscriptState(db, gameId);
    expect(state?.terminalState).toBe("unset");
    expect(state?.durableSequence).toBe(1);
  });
});
