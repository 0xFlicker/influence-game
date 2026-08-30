import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  Phase,
  type GameExecutionStateV1,
  type GameTurnCommitDraftV1,
  type GameTurnIntentV1,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  commitGameTurn,
  createInitialGameExecutionStateV1,
  initializeGameExecutionAuthority,
  planGameTurn,
  readGameExecutionState,
} from "../services/game-turn-commit.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const FIRST_AVAILABLE_AT = "2026-08-27T12:00:00.000Z";
const SECOND_AVAILABLE_AT = "2026-08-27T12:00:01.000Z";

describe("atomic durable game turn commit", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("commits facts, dialogue, continuity, cursor, publications, and provider links atomically", async () => {
    const fixture = await createAuthority(db);
    const firstIntent = makeIntent(fixture.state, "turn-1");
    const firstPlan = await planGameTurn(db, {
      ownerEpoch: fixture.ownerEpoch,
      intent: firstIntent,
    });
    const firstDraft = makeDraft(fixture.state, firstIntent, firstPlan.intentHash);
    const first = await commitGameTurn(db, {
      ownerEpoch: fixture.ownerEpoch,
      draft: firstDraft,
    });

    expect(first.alreadyCommitted).toBe(false);
    expect(first.state.heads).toEqual({
      version: 1,
      turnSequence: 1,
      eventSequence: 2,
      eventHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      dialogueSequence: 1,
      publicationSequence: 2,
    });
    expect(first.publications.map((row) => row.sequence)).toEqual([1, 2]);

    const [eventRows, transcriptRows, publicationRows] = await Promise.all([
      db.select().from(schema.gameEvents).where(eq(schema.gameEvents.gameId, fixture.gameId)),
      db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, fixture.gameId)),
      db.select().from(schema.gamePublications).where(eq(schema.gamePublications.gameId, fixture.gameId)),
    ]);
    expect(eventRows).toHaveLength(2);
    expect(transcriptRows).toHaveLength(1);
    expect(transcriptRows[0]?.entrySequence).toBe(1);
    expect(publicationRows.map((row) => row.publicationSequence)).toEqual([1, 2]);
    expect((await readGameExecutionState(db, fixture.gameId))?.lastPresentationPhase).toBe(Phase.LOBBY);

    const logicalCallId = "logical-turn-2";
    const secondState = first.state;
    const secondIntent = makeIntent(secondState, "turn-2", logicalCallId);
    const secondPlan = await planGameTurn(db, {
      ownerEpoch: fixture.ownerEpoch,
      intent: secondIntent,
    });
    await insertAcceptedProviderCall(db, fixture.gameId, logicalCallId);
    const secondDraft: GameTurnCommitDraftV1 = {
      ...makeDraft(secondState, secondIntent, secondPlan.intentHash),
      canonicalEvents: [],
      transcriptEntries: [],
      publications: [],
      acceptedProviderCallIds: [logicalCallId],
      nextExecution: {
        ...makeDraft(secondState, secondIntent, secondPlan.intentHash).nextExecution,
        lastPresentationPhase: secondState.lastPresentationPhase,
        nextPublicationAvailableAt: secondState.nextPublicationAvailableAt,
      },
    };
    const second = await commitGameTurn(db, {
      ownerEpoch: fixture.ownerEpoch,
      draft: secondDraft,
    });
    expect(second.state.heads.turnSequence).toBe(2);
    const linked = (await db.select({
      gameTurnId: schema.providerLogicalCalls.gameTurnId,
      gameTurnSubcallSlot: schema.providerLogicalCalls.gameTurnSubcallSlot,
      gameTurnCommittedAt: schema.providerLogicalCalls.gameTurnCommittedAt,
    }).from(schema.providerLogicalCalls)
      .where(eq(schema.providerLogicalCalls.id, logicalCallId)))[0];
    expect(linked).toEqual({
      gameTurnId: "turn-2",
      gameTurnSubcallSlot: 1,
      gameTurnCommittedAt: second.committedAt,
    });
  });

  test("serializes concurrent exact retries into one commit", async () => {
    const fixture = await createAuthority(db);
    const intent = makeIntent(fixture.state, "turn-concurrent");
    const plan = await planGameTurn(db, { ownerEpoch: fixture.ownerEpoch, intent });
    const draft = makeDraft(fixture.state, intent, plan.intentHash);

    const results = await Promise.all([
      commitGameTurn(db, { ownerEpoch: fixture.ownerEpoch, draft }),
      commitGameTurn(db, { ownerEpoch: fixture.ownerEpoch, draft }),
    ]);
    expect(results.map((result) => result.alreadyCommitted).sort()).toEqual([false, true]);
    expect(await db.select().from(schema.gameEvents)).toHaveLength(2);
    expect(await db.select().from(schema.transcripts)).toHaveLength(1);
    expect(await db.select().from(schema.gamePublications)).toHaveLength(2);

    const conflicting = {
      ...draft,
      nextExecution: {
        ...draft.nextExecution,
        xstateSnapshot: { value: "conflicting" },
      },
    };
    await expect(
      commitGameTurn(db, { ownerEpoch: fixture.ownerEpoch, draft: conflicting }),
    ).rejects.toMatchObject({ code: "turn_effect_conflict" });
  });

  test("adopts an exact planned intent under the new active owner", async () => {
    const fixture = await createAuthority(db);
    const intent = makeIntent(fixture.state, "turn-adopt");
    await planGameTurn(db, { ownerEpoch: fixture.ownerEpoch, intent });

    await db.update(schema.gameRunOwners).set({
      status: "expired",
      expiresAt: "2026-08-27T00:00:00.000Z",
    }).where(eq(schema.gameRunOwners.ownerEpoch, fixture.ownerEpoch));
    const nextOwnerEpoch = await insertOwner(db, fixture.gameId, {
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await db.update(schema.gameExecutionStates).set({ ownerEpoch: nextOwnerEpoch })
      .where(eq(schema.gameExecutionStates.gameId, fixture.gameId));

    const adopted = await planGameTurn(db, { ownerEpoch: nextOwnerEpoch, intent });
    expect(adopted.alreadyPlanned).toBe(true);
    const turn = (await db.select({
      plannedOwnerEpoch: schema.gameTurns.plannedOwnerEpoch,
      intentHash: schema.gameTurns.intentHash,
    }).from(schema.gameTurns).where(eq(schema.gameTurns.id, intent.turnId)))[0];
    expect(turn).toEqual({
      plannedOwnerEpoch: nextOwnerEpoch,
      intentHash: adopted.intentHash,
    });

    const different = { ...intent, seed: "different-seed" };
    await expect(
      planGameTurn(db, { ownerEpoch: nextOwnerEpoch, intent: different }),
    ).rejects.toMatchObject({ code: "turn_intent_conflict" });

    const adoptedState = { ...fixture.state, ownerEpoch: nextOwnerEpoch };
    const committed = await commitGameTurn(db, {
      ownerEpoch: nextOwnerEpoch,
      draft: makeDraft(adoptedState, intent, adopted.intentHash),
    });
    expect(committed.state.ownerEpoch).toBe(nextOwnerEpoch);
  });

  test("rejects a second planned turn with a typed conflict", async () => {
    const fixture = await createAuthority(db);
    const first = makeIntent(fixture.state, "turn-first");
    await planGameTurn(db, { ownerEpoch: fixture.ownerEpoch, intent: first });
    const second = makeIntent(fixture.state, "turn-second");
    await expect(
      planGameTurn(db, { ownerEpoch: fixture.ownerEpoch, intent: second }),
    ).rejects.toMatchObject({ code: "turn_intent_conflict" });
  });

  test("rolls back every side effect when finalization fails", async () => {
    const fixture = await createAuthority(db);
    const intent = makeIntent(fixture.state, "turn-rollback");
    const plan = await planGameTurn(db, { ownerEpoch: fixture.ownerEpoch, intent });
    const draft = makeDraft(fixture.state, intent, plan.intentHash);
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `fail_turn_commit_${suffix}`;
    const triggerName = `fail_turn_commit_${suffix}`;
    await db.execute(sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'committed' THEN
          RAISE EXCEPTION 'injected turn finalization failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON game_turns
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `));

    try {
      await expect(
        commitGameTurn(db, { ownerEpoch: fixture.ownerEpoch, draft }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS ${triggerName} ON game_turns;
        DROP FUNCTION IF EXISTS ${functionName}();
      `));
    }

    expect(await db.select().from(schema.gameEvents)).toHaveLength(0);
    expect(await db.select().from(schema.transcripts)).toHaveLength(0);
    expect(await db.select().from(schema.gamePublications)).toHaveLength(0);
    expect((await readGameExecutionState(db, fixture.gameId))?.heads).toEqual(fixture.state.heads);
    expect((await db.select({ status: schema.gameTurns.status })
      .from(schema.gameTurns).where(eq(schema.gameTurns.id, intent.turnId)))[0]?.status).toBe("planned");
  });

  test("rejects publication pacing regressions and nonterminal holds", async () => {
    const fixture = await createAuthority(db);
    const intent = makeIntent(fixture.state, "turn-pacing");
    const plan = await planGameTurn(db, { ownerEpoch: fixture.ownerEpoch, intent });
    const draft = makeDraft(fixture.state, intent, plan.intentHash);
    draft.publications[1]!.availableAt = "2026-08-27T11:59:59.000Z";
    await expect(
      commitGameTurn(db, { ownerEpoch: fixture.ownerEpoch, draft }),
    ).rejects.toMatchObject({ code: "publication_conflict" });
  });
});

async function createAuthority(db: DrizzleDB) {
  const gameId = await insertGame(db, { status: "in_progress" });
  await db.update(schema.games).set({
    transcriptCaptureVersion: 1,
    formalSpeechCaptureVersion: 1,
  }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  const ownerEpoch = await insertOwner(db, gameId, {
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const state = createInitialGameExecutionStateV1({
    gameId,
    ownerEpoch,
    xstateSnapshot: { value: "introduction" },
    cursor: { version: 1, kind: "phase_enter", actor: "introduction" },
  });
  await initializeGameExecutionAuthority(db, state);
  return { gameId, ownerEpoch, state };
}

function makeIntent(
  state: GameExecutionStateV1,
  turnId: string,
  providerLogicalCallId?: string,
): GameTurnIntentV1 {
  return {
    version: 1,
    gameId: state.gameId,
    turnId,
    turnSequence: state.heads.turnSequence + 1,
    seed: `seed:${turnId}`,
    baseHeads: structuredClone(state.heads),
    branch: {
      version: 1,
      kind: providerLogicalCallId ? "single_provider" : "engine",
      action: providerLogicalCallId ? "introduction" : "round_start",
    },
    actorIds: providerLogicalCallId ? ["atlas"] : [],
    targetIds: [],
    handles: [],
    participantIds: providerLogicalCallId ? ["atlas"] : [],
    providerSubcalls: providerLogicalCallId
      ? [{
          version: 1,
          slot: 1,
          logicalCallId: providerLogicalCallId,
          semanticCoordinate: { version: 1, kind: "durable_turn", turnId, subcallSlot: 1 },
          actorId: "atlas",
          action: "introduction",
          contractId: "agent-introduction-v1",
        }]
      : [],
  };
}

function makeDraft(
  state: GameExecutionStateV1,
  intent: GameTurnIntentV1,
  intentHash: string,
): GameTurnCommitDraftV1 {
  return {
    version: 1,
    gameId: state.gameId,
    turnId: intent.turnId,
    turnSequence: intent.turnSequence,
    intentHash,
    expectedBaseHeads: structuredClone(state.heads),
    nextExecution: {
      version: 1,
      status: "ready",
      lastPresentationPhase: Phase.LOBBY,
      nextPublicationAvailableAt: SECOND_AVAILABLE_AT,
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
      text: "I am ready to play.",
      speakerPlayerId: "atlas",
      audiencePlayerIds: [],
      dialogueKind: "public_speech",
      dialogueContext: { version: 1 },
    }],
    publications: [{
      version: 1,
      kind: "transcript_entry",
      transcriptIndex: 0,
      availableAt: FIRST_AVAILABLE_AT,
    }, {
      version: 1,
      kind: "canonical_event",
      eventIndex: 1,
      availableAt: SECOND_AVAILABLE_AT,
    }],
    acceptedProviderCallIds: [],
  };
}

async function insertAcceptedProviderCall(
  db: DrizzleDB,
  gameId: string,
  logicalCallId: string,
): Promise<void> {
  await db.insert(schema.providerLogicalCalls).values({
    id: logicalCallId,
    gameId,
    actorId: "atlas",
    actorName: "Atlas",
    actorRole: "player",
    action: "introduction",
    phase: Phase.INTRODUCTION,
    round: 0,
    semanticCoordinate: { version: 1, kind: "durable_turn", turnId: "turn-2", subcallSlot: 1 },
    semanticCoordinateHash: "sha256:turn-2-provider-call",
    acceptedAttemptId: `attempt:${logicalCallId}`,
    acceptedCatalogId: "openai:gpt-test",
    acceptedValue: { message: "Hello" },
    acceptedValueSha256: `sha256:${"1".repeat(64)}`,
    acceptedAt: "2026-08-27T11:59:00.000Z",
  });
}
