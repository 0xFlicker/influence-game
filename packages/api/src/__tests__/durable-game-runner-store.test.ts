import { beforeEach, describe, expect, test } from "bun:test";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import {
  Phase,
  type GameTurnCommitDraftV1,
  type GameTurnIntentV1,
} from "@influence/engine";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  createDurableGameRunnerStore,
  DurableGameRunnerStoreIntegrityError,
} from "../services/durable-game-runner-store.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const AVAILABLE_AT = "2026-08-27T12:00:00.000Z";

describe("API durable GameRunner store", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("initializes, commits, reloads, and replays one exact committed turn", async () => {
    const fixture = await createFixture(db);
    const store = createDurableGameRunnerStore(db, fixture);
    const initialized = await store.initialize({
      version: 1,
      gameId: fixture.gameId,
      xstateSnapshot: { value: "introduction" },
      cursor: { version: 1, kind: "phase_enter", actor: "introduction" },
      playerContinuityCapsules: [],
      houseNarrativeContinuity: null,
      canonicalEvents: [],
      transcriptEntries: [],
    });
    expect(initialized.execution.heads).toMatchObject({
      turnSequence: 0,
      eventSequence: 0,
      dialogueSequence: 0,
      publicationSequence: 0,
    });

    const intent = makeIntent(fixture.gameId);
    expect(await store.planNextTurn(intent)).toEqual({
      version: 1,
      status: "execute",
      intent,
    });
    const committed = await store.commitTurn(makeDraft(intent));
    expect(committed.result.alreadyCommitted).toBe(false);
    expect(committed.snapshot.execution.heads).toMatchObject({
      turnSequence: 1,
      eventSequence: 2,
      dialogueSequence: 1,
      publicationSequence: 2,
    });
    expect(committed.snapshot.canonicalEvents[0]).toMatchObject({
      sequence: 1,
      type: "round.started",
    });
    expect(committed.snapshot.transcriptEntries[0]).toMatchObject({
      entrySequence: 1,
      from: "Atlas",
      speakerPlayerId: "atlas",
      audiencePlayerIds: [],
      dialogueContext: { version: 1 },
      text: "A committed introduction.",
    });
    expect(committed.snapshot.transcriptEntries[1]).toMatchObject({
      from: "House",
      scope: "diary",
      to: ["atlas"],
      text: "What did that introduction establish?",
    });

    // Presentation timestamps are deliberately inverted; logical turn ordinal
    // remains the sole reload order authority.
    await db.update(schema.transcripts).set({ timestamp: 2_000 })
      .where(eq(schema.transcripts.gameTurnTranscriptOrdinal, 1));
    await db.update(schema.transcripts).set({ timestamp: 1_000 })
      .where(eq(schema.transcripts.gameTurnTranscriptOrdinal, 2));

    const replay = await store.planNextTurn(intent);
    expect(replay.status).toBe("committed");
    if (replay.status !== "committed") throw new Error("Expected committed replay");
    expect(replay.result.alreadyCommitted).toBe(true);
    const loaded = await store.load(fixture.gameId);
    if (!loaded) throw new Error("Expected committed durable snapshot");
    expect(loaded.transcriptEntries.map((entry) => entry.text)).toEqual([
      "A committed introduction.",
      "What did that introduction establish?",
    ]);
    expect(replay.snapshot).toEqual(loaded);
  });

  test("rejects a cross-game load and a stale runner owner", async () => {
    const fixture = await createFixture(db);
    const store = createDurableGameRunnerStore(db, fixture);
    await store.initialize({
      version: 1,
      gameId: fixture.gameId,
      xstateSnapshot: { value: "introduction" },
      cursor: { version: 1, kind: "phase_enter", actor: "introduction" },
      playerContinuityCapsules: [],
      houseNarrativeContinuity: null,
      canonicalEvents: [],
      transcriptEntries: [],
    });

    await expect(store.load("another-game")).rejects.toBeInstanceOf(
      DurableGameRunnerStoreIntegrityError,
    );
    await db.update(schema.gameRunOwners).set({
      status: "expired",
      closedAt: AVAILABLE_AT,
    }).where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch));
    const nextOwner = await insertOwner(db, fixture.gameId, {
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await db.update(schema.gameExecutionStates).set({ ownerEpoch: nextOwner })
      .where(eq(schema.gameExecutionStates.gameId, fixture.gameId));
    await expect(store.load(fixture.gameId)).rejects.toThrow(
      "does not match the runner owner",
    );
  });

  test("rejects initialization that smuggles an uncommitted frontier", async () => {
    const fixture = await createFixture(db);
    const store = createDurableGameRunnerStore(db, fixture);
    await expect(store.initialize({
      version: 1,
      gameId: fixture.gameId,
      xstateSnapshot: { value: "introduction" },
      cursor: { version: 1, kind: "phase_enter", actor: "introduction" },
      playerContinuityCapsules: [],
      houseNarrativeContinuity: null,
      canonicalEvents: [{
        sequence: 1,
        gameId: fixture.gameId,
        round: 1,
        phase: Phase.INIT,
        type: "round.started",
        timestamp: AVAILABLE_AT,
        source: "engine",
        visibility: "system",
        payloadVersion: 1,
        sourcePointers: [],
        payload: { round: 1 },
      }],
      transcriptEntries: [],
    })).rejects.toThrow("is not the active owner event head");
  });
});

async function createFixture(db: DrizzleDB): Promise<{
  gameId: string;
  ownerEpoch: string;
}> {
  const gameId = await insertGame(db, { status: "in_progress" });
  await db.update(schema.games).set({
    transcriptCaptureVersion: 1,
    formalSpeechCaptureVersion: 1,
  }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  const ownerEpoch = await insertOwner(db, gameId, {
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  return { gameId, ownerEpoch };
}

function makeIntent(gameId: string): GameTurnIntentV1 {
  return {
    version: 1,
    gameId,
    turnId: `${gameId}:turn:1`,
    turnSequence: 1,
    seed: "seed:turn-1",
    baseHeads: {
      version: 1,
      turnSequence: 0,
      eventSequence: 0,
      eventHash: null,
      dialogueSequence: 0,
      publicationSequence: 0,
    },
    branch: { version: 1, kind: "engine", action: "round_start" },
    actorIds: [],
    targetIds: [],
    handles: [],
    participantIds: [],
    providerSubcalls: [],
  };
}

function makeDraft(intent: GameTurnIntentV1): GameTurnCommitDraftV1 {
  return {
    version: 1,
    gameId: intent.gameId,
    turnId: intent.turnId,
    turnSequence: intent.turnSequence,
    intentHash: hashCanonicalJson(intent),
    expectedBaseHeads: structuredClone(intent.baseHeads),
    nextExecution: {
      version: 1,
      status: "ready",
      lastPresentationPhase: Phase.LOBBY,
      nextPublicationAvailableAt: AVAILABLE_AT,
      xstateSnapshot: { value: "lobby" },
      cursor: { version: 1, kind: "phase_enter", actor: "lobby" },
      playerContinuityCapsules: [],
      houseNarrativeContinuity: null,
      retry: null,
    },
    canonicalEvents: [{
      version: 1,
      round: 1,
      phase: Phase.INIT,
      type: "round.started",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { round: 1 },
    }, {
      version: 1,
      round: 1,
      phase: Phase.LOBBY,
      type: "game.phase_entered",
      source: "engine",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        phase: Phase.LOBBY,
        remainingPlayers: [{ id: "atlas", name: "Atlas" }],
      },
    }],
    transcriptEntries: [{
      round: 1,
      phase: Phase.LOBBY,
      from: "Atlas",
      scope: "public",
      text: "A committed introduction.",
      speakerPlayerId: "atlas",
      audiencePlayerIds: [],
      dialogueKind: "public_speech",
      dialogueContext: { version: 1 },
    }, {
      round: 1,
      phase: Phase.LOBBY,
      from: "House",
      scope: "diary",
      to: ["atlas"],
      text: "What did that introduction establish?",
    }],
    publications: [{
      version: 1,
      kind: "transcript_entry",
      transcriptIndex: 0,
      availableAt: AVAILABLE_AT,
    }, {
      version: 1,
      kind: "canonical_event",
      eventIndex: 1,
      availableAt: AVAILABLE_AT,
    }],
    acceptedProviderCallIds: [],
  };
}
