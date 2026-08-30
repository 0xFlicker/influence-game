import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { createEvidenceManifest } from "../services/game-evidence.js";
import {
  buildFinaleIntegrity,
  getDurableRunInspection,
} from "../services/game-durable-run.js";
import {
  createInitialGameExecutionStateV1,
  initializeGameExecutionAuthority,
  planGameTurn,
} from "../services/game-turn-commit.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { getPersistedGameProjectionBeforeTerminalOutcome } from "../services/game-projection-read-model.js";
import type { PersistedGameEventsRead } from "../services/game-event-read-model.js";
import type { CanonicalGameEvent } from "@influence/engine";
import { acquireGameRunOwner } from "../services/game-ownership.js";
import {
  abortAllGames,
  abortGame,
  isGameRunning,
  startGame,
} from "../services/game-lifecycle.js";
import { adoptInProgressDurableGamesOnStartup } from "../services/startup-durable-games.js";
import {
  handleClose,
  handleOpen,
  setServer,
  type WsConnectionData,
} from "../services/ws-manager.js";
import type { ServerWebSocket } from "bun";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  createCheckpointCapsule,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
  withJuryWinner,
} from "./durable-run-test-utils.js";

const savedMockRunner = process.env.INFLUENCE_API_TEST_MOCK_RUNNER;

describe("buildFinaleIntegrity", () => {
  test("is not_applicable without jury.winner_determined", () => {
    expect(buildFinaleIntegrity([{ type: "round.started", payload: { round: 1 } }])).toMatchObject({
      judgmentDetected: false,
      status: "not_applicable",
      findings: [],
    });
  });

  test("flags missing openings and closings for completed Judgment logs", () => {
    const integrity = buildFinaleIntegrity([
      {
        type: "jury.winner_determined",
        payload: { winnerId: "iris", method: "majority", tally: { votes: {} }, voteCounts: [] },
      },
    ]);
    expect(integrity.judgmentDetected).toBe(true);
    expect(integrity.status).toBe("incomplete");
    expect(integrity.findings.map((f) => f.code).sort()).toEqual([
      "judgment_closing_argument_missing",
      "judgment_opening_statement_missing",
    ]);
  });

  test("is complete when two openings and two closings are present", () => {
    const integrity = buildFinaleIntegrity([
      {
        type: "judgment.speech_recorded",
        payload: { speechKind: "opening_statement", playerId: "a", text: "o1", provenance: "agent" },
      },
      {
        type: "judgment.speech_recorded",
        payload: { speechKind: "opening_statement", playerId: "b", text: "o2", provenance: "agent" },
      },
      {
        type: "judgment.speech_recorded",
        payload: { speechKind: "closing_argument", playerId: "a", text: "c1", provenance: "agent" },
      },
      {
        type: "judgment.speech_recorded",
        payload: { speechKind: "closing_argument", playerId: "b", text: "c2", provenance: "timeout" },
      },
      {
        type: "jury.winner_determined",
        payload: { winnerId: "a", method: "majority", tally: { votes: {} }, voteCounts: [] },
      },
    ]);
    expect(integrity).toMatchObject({
      status: "complete",
      openingStatementCount: 2,
      closingArgumentCount: 2,
      findings: [],
    });
  });
});

async function waitForCompletedDurableInspection(db: DrizzleDB, gameId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await getDurableRunInspection(db, gameId);
    if (
      result.ok &&
      result.response.kernel.owner?.status === "closed" &&
      result.response.eventLog.rowCount > 0
    ) {
      return result.response;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for durable run completion for ${gameId}`);
}

async function waitForRunnerToStop(gameId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isGameRunning(gameId)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for local runner shutdown for ${gameId}`);
}

describe("durable run inspection read model", () => {
  test("replays the trusted pre-jury prefix while terminal settlement is non-final", () => {
    const gameId = "sealed-game";
    const initialEvents = createCanonicalEventFixture(gameId);
    const lastInitial = initialEvents.at(-1)!;
    const powerElimination: CanonicalGameEvent = {
      sequence: lastInitial.sequence + 1,
      gameId,
      round: 1,
      phase: null,
      type: "player.eliminated",
      timestamp: "2026-06-20T00:00:00.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        playerId: "mira",
        playerName: "Mira",
        eliminatedRound: 1,
        juryMember: { playerId: "mira", playerName: "Mira", eliminatedRound: 1 },
      },
    };
    const eventsWithWinner = withJuryWinner(
      [...initialEvents, powerElimination],
      "atlas",
    );
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
    const persistedEvents: PersistedGameEventsRead = {
      gameId,
      status: "complete",
      events: events.map((event) => ({
        gameId,
        sequence: event.sequence,
        eventType: event.type,
        eventHash: hashCanonicalEvent(event),
        ownerEpoch: "owner-epoch",
        visibility: event.visibility,
        payloadVersion: 1,
        envelope: event,
        createdAt: event.timestamp,
      })),
      diagnostics: [],
      eventCount: events.length,
      validPrefixLength: events.length,
      lastTrustedSequence: finalLoserElimination.sequence,
      persistedHead: {
        sequence: finalLoserElimination.sequence,
        eventType: finalLoserElimination.type,
        eventHash: hashCanonicalEvent(finalLoserElimination),
        createdAt: finalLoserElimination.timestamp,
      },
    };

    const safeProjection = getPersistedGameProjectionBeforeTerminalOutcome(persistedEvents);

    expect(safeProjection.summary?.players.aliveIds.sort()).toEqual(["atlas", "echo", "nyx"]);
    expect(safeProjection.summary?.players.eliminatedIds).toEqual(["mira"]);
    expect(safeProjection.summary?.winner).toBeNull();
    expect(safeProjection.summary?.acceptedOutcomes.juryWinner).toBeNull();
    expect(safeProjection.summary?.voteState.juryVotes).toEqual({});
  });

  let db: DrizzleDB;

  function openMockObserver(gameId: string): ServerWebSocket<WsConnectionData> {
    const subscriptions = new Set<string>();
    const ws = {
      data: { gameId },
      subscribe(topic: string) {
        subscriptions.add(topic);
      },
      unsubscribe(topic: string) {
        subscriptions.delete(topic);
      },
      send() {},
    } as unknown as ServerWebSocket<WsConnectionData>;
    handleOpen(ws);
    return ws;
  }

  beforeAll(() => {
    process.env.LINODE_OBJ_BUCKET = "public-profile-pictures";
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-content";
    process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
  });

  afterAll(async () => {
    await abortAllGames();
    if (savedMockRunner === undefined) {
      delete process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
    } else {
      process.env.INFLUENCE_API_TEST_MOCK_RUNNER = savedMockRunner;
    }
  });

  beforeEach(async () => {
    await abortAllGames();
    db = await setupTestDB();
  });

  afterEach(async () => {
    await abortAllGames();
    setServer({ publish() {} });
  });

  test("completes an API game from committed logical turns and publications", async () => {
    const gameId = await insertGame(db, {
      status: "waiting",
      config: {
        maxRounds: 5,
        modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
        visibility: "private",
        viewerMode: "speedrun",
        timers: {
          introduction: 0,
          lobby: 0,
          mingle: 0,
          rumor: 0,
          vote: 0,
          power: 0,
          council: 0,
        },
      },
    });
    await db.update(schema.games).set({ maxPlayers: 5, startedAt: null })
      .where(eq(schema.games.id, gameId));

    await db.insert(schema.gamePlayers).values(
      ["Atlas", "Echo", "Mira", "Nyx", "Vera"].map((name) => ({
        id: randomUUID(),
        gameId,
        persona: JSON.stringify({ name, personality: "strategic", personaKey: "strategic" }),
        agentConfig: JSON.stringify({ model: "mock", temperature: 0 }),
      })),
    );

    const owner = await acquireGameRunOwner(db, gameId);
    expect(owner.ok).toBeTrue();
    if (!owner.ok) throw new Error(owner.error);

    const published: Array<{ topic: string; data: string }> = [];
    setServer({
      publish(topic: string, data: string) {
        published.push({ topic, data });
      },
    });
    const observer = openMockObserver(gameId);

    try {
      const startResult = await startGame(db, gameId, owner.claim.ownerEpoch);
      expect(startResult.error).toBeUndefined();

      const inspection = await waitForCompletedDurableInspection(db, gameId);

      expect(inspection.game.status).toBe("completed");
      expect(inspection.completionSettlement).toMatchObject({
        state: "completed",
        retryEligible: false,
        resultHash: expect.stringMatching(/^sha256:/),
      });
      expect(inspection.completionSettlement).not.toHaveProperty("payload");
      expect(inspection.kernel.owner?.status).toBe("closed");
      expect(inspection.execution).toMatchObject({
        authority: {
          status: "terminal",
          cursor: { kind: "terminal", coordinate: "commit_game" },
          retry: null,
        },
        plannedTurn: null,
        publications: {
          heldCount: 0,
          firstHeldSequence: null,
        },
      });
      expect(inspection.execution.authority?.heads.turnSequence).toBeGreaterThan(0);
      expect(inspection.execution.publications.totalCount > 0).toBeTrue();
      expect(inspection.eventLog.status).toBe("complete");
      expect(inspection.eventLog.rowCount).toBeGreaterThan(0);
      expect(inspection.projection.status).toBe("complete");
      expect(inspection.projection.replayedEventCount).toBe(inspection.eventLog.rowCount);
      expect(inspection.checkpoints.count).toBe(0);
      expect(inspection.evidence.totalCount).toBe(0);
      expect(inspection.diagnostics).toEqual([]);

      const execution = (await db.select()
        .from(schema.gameExecutionStates)
        .where(eq(schema.gameExecutionStates.gameId, gameId)))[0];
      const turns = await db.select()
        .from(schema.gameTurns)
        .where(eq(schema.gameTurns.gameId, gameId));
      const publications = await db.select()
        .from(schema.gamePublications)
        .where(eq(schema.gamePublications.gameId, gameId))
        .orderBy(asc(schema.gamePublications.publicationSequence));
      expect(execution).toMatchObject({ status: "terminal" });
      expect(turns.length).toBeGreaterThan(0);
      expect(turns.every((turn) => turn.status === "committed")).toBeTrue();
      expect(publications.map((publication) => publication.publicationSequence)).toEqual(
        publications.map((_, index) => index + 1),
      );
      expect(publications.at(-1)).toMatchObject({
        kind: "completion",
      });
      expect(publications.at(-1)?.availableAt).not.toBeNull();

      const finalWatchState = published
        .map((message) => JSON.parse(message.data) as { type: string; state?: { status?: string; currentPhase?: string; gameId?: string } })
        .filter((message) => message.type === "watch_state")
        .findLast((message) => message.state?.status === "completed");
      expect(finalWatchState).toMatchObject({
        type: "watch_state",
        state: {
          gameId,
          status: "completed",
          currentPhase: "END",
        },
      });

      const transcriptRows = await db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId));
      expect(transcriptRows.some((row) => row.phase === "DIARY_ROOM" && row.text === "--- Diary Room (after FORMAT_RESOLVE) ---")).toBeTrue();
      expect(transcriptRows.some((row) => row.phase === "DIARY_ROOM" && row.scope === "diary" && row.text === "diary entry")).toBeTrue();
    } finally {
      handleClose(observer);
    }
  });

  test("adopts the same in-progress game after an ordinary runner reload", async () => {
    const gameId = await insertGame(db, {
      status: "waiting",
      config: {
        maxRounds: 1,
        modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
        visibility: "private",
        viewerMode: "speedrun",
        timers: {
          introduction: 0,
          lobby: 0,
          mingle: 0,
          rumor: 0,
          vote: 0,
          power: 0,
          council: 0,
        },
      },
    });
    await db.update(schema.games).set({ maxPlayers: 5, startedAt: null })
      .where(eq(schema.games.id, gameId));
    await db.insert(schema.gamePlayers).values(
      ["Atlas", "Echo", "Mira", "Nyx", "Vera"].map((name) => ({
        id: randomUUID(),
        gameId,
        persona: JSON.stringify({ name, personality: "strategic", personaKey: "strategic" }),
        agentConfig: JSON.stringify({ model: "mock", temperature: 0 }),
      })),
    );

    const firstOwner = await acquireGameRunOwner(db, gameId);
    expect(firstOwner.ok).toBeTrue();
    if (!firstOwner.ok) throw new Error(firstOwner.error);
    expect((await startGame(db, gameId, firstOwner.claim.ownerEpoch)).error).toBeUndefined();
    expect(abortGame(gameId)).toBeTrue();
    await waitForRunnerToStop(gameId);

    const interrupted = (await db.select()
      .from(schema.gameExecutionStates)
      .where(eq(schema.gameExecutionStates.gameId, gameId)))[0];
    expect(interrupted?.committedTurnSequence).toBeGreaterThan(0);
    expect((await db.select({ status: schema.games.status })
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0]?.status).toBe("in_progress");

    const adoption = await adoptInProgressDurableGamesOnStartup(db, {
      isAlreadyRunning: isGameRunning,
      start: async ({ gameId: adoptedGameId, ownerEpoch }) => {
        const started = await startGame(db, adoptedGameId, ownerEpoch);
        if (started.error) throw new Error(started.error);
      },
    });
    expect(adoption.adopted).toContain(gameId);
    const completed = await waitForCompletedDurableInspection(db, gameId);
    expect(completed.game.id).toBe(gameId);
    expect(completed.game.status).toBe("completed");

    const events = await db.select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, gameId));
    const turns = await db.select()
      .from(schema.gameTurns)
      .where(eq(schema.gameTurns.gameId, gameId))
      .orderBy(asc(schema.gameTurns.turnSequence));
    expect(events.filter((event) => event.eventType === "game.roster_initialized")).toHaveLength(1);
    expect(turns.map((turn) => turn.turnSequence)).toEqual(
      turns.map((_, index) => index + 1),
    );
    expect(turns.every((turn) => turn.status === "committed")).toBeTrue();
  });

  test("summarizes API kernel events, checkpoints, and private trace manifests without exposing raw content", async () => {
    const gameId = await insertGame(db, { slug: "durable-slug" });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);

    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const checkpoint = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: createCheckpointCapsule(events),
    });
    const evidence = await createEvidenceManifest(db, {
      gameId,
      ownerEpoch,
      eventSequence: 2,
      evidenceType: "llm_response",
      retentionClass: "debug",
      storage: {
        provider: "linode_object_storage",
        bucket: "private-content",
        key: `content/${gameId}/round-1/response.json`,
      },
      sourcePointers: [{
        kind: "agent_turn",
        actorId: "atlas",
        action: "vote",
      }],
      metadata: {
        prompt: "raw original prompt should not appear in durable inspection",
        response: "raw LLM response should not appear in durable inspection",
      },
    });

    expect(checkpoint.ok).toBeTrue();
    expect(evidence.ok).toBeTrue();

    const result = await getDurableRunInspection(db, "durable-slug");

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.schemaVersion).toBe(3);
    expect(result.response.game.id).toBe(gameId);
    expect(result.response.completionSettlement).toMatchObject({
      state: "not_applicable",
      retryEligible: false,
    });
    expect(result.response.kernel.health).toMatchObject({
      status: "healthy",
      durableEventCount: events.length,
      checkpointCount: 1,
      evidenceManifestCount: 1,
    });
    expect(result.response.kernel.owner?.lastPersistedEventSequence).toBe(events.length);
    expect(result.response.execution).toEqual({
      authority: null,
      plannedTurn: null,
      publications: {
        totalCount: 0,
        dueCount: 0,
        scheduledCount: 0,
        heldCount: 0,
        firstDueSequence: null,
        firstHeldSequence: null,
      },
    });
    expect(result.response.eventLog).toMatchObject({
      status: "complete",
      rowCount: events.length,
      trustedEventCount: events.length,
      lastTrustedSequence: events.length,
    });
    expect(result.response.projection.status).toBe("complete");
    expect(result.response.projection.summary?.players.totalCount).toBe(4);
    expect(result.response.checkpoints.count).toBe(1);
    expect(result.response.checkpoints.entries[0]).toMatchObject({
      lastEventSequence: events.length,
      checkpointKind: "phase_boundary",
      transcriptCursorPresent: true,
      tokenCostCursorPresent: true,
    });
    // U6: passport is present, non-candidate for live (continuity missing until full resume work)
    const cp0 = result.response.checkpoints.entries[0]!;
    expect(cp0.passport).toBeDefined();
    expect(cp0.passport.verdict).not.toBe("hydration_candidate");
    expect(Array.isArray(cp0.passport.stamps)).toBeTrue();
    expect("hydrateable" in cp0).toBeFalse();
    expect("hydrationStatus" in cp0).toBeFalse();
    expect("degradedReason" in cp0).toBeFalse();
    // do not leak raw capsules
    expect(JSON.stringify(result.response)).not.toContain("strategyPacket");
    expect(result.response.evidence).toMatchObject({
      totalCount: 1,
      byEvidenceType: { llm_response: 1 },
      storage: {
        withStorageCount: 1,
        providerCounts: { linode_object_storage: 1 },
      },
      eventSequenceCoverage: {
        linkedCount: 1,
        minSequence: 2,
        maxSequence: 2,
      },
    });
    expect(result.response.diagnostics).toEqual([]);

    const serialized = JSON.stringify(result.response);
    expect(serialized).not.toContain("private-content");
    expect(serialized).not.toContain(`content/${gameId}/round-1/response.json`);
    expect(serialized).not.toContain("raw original prompt");
    expect(serialized).not.toContain("raw LLM response");
    expect(serialized).not.toContain("sourcePointers");
  });

  test("reports planned durable progress without exposing snapshots, participants, or prose", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    await db.insert(schema.gameTranscriptStates).values(
      initialGameTranscriptStateValues(gameId),
    );
    const state = createInitialGameExecutionStateV1({
      gameId,
      ownerEpoch,
      xstateSnapshot: { privateCanary: "PRIVATE_XSTATE_CANARY" },
      cursor: {
        version: 1,
        kind: "serial_actor",
        lane: "lobby_speech",
        actorIds: ["PRIVATE_CURSOR_ACTOR"],
        actorIndex: 0,
      },
    });
    await initializeGameExecutionAuthority(db, state);
    await planGameTurn(db, {
      ownerEpoch,
      intent: {
        version: 1,
        gameId,
        turnId: `${gameId}:turn:1`,
        turnSequence: 1,
        seed: "PRIVATE_TURN_SEED",
        baseHeads: state.heads,
        branch: { version: 1, kind: "single_provider", action: "lobby_speech" },
        actorIds: ["PRIVATE_INTENT_ACTOR"],
        targetIds: ["PRIVATE_INTENT_TARGET"],
        handles: ["PRIVATE_INTENT_HANDLE"],
        participantIds: ["PRIVATE_INTENT_PARTICIPANT"],
        providerSubcalls: [{
          version: 1,
          slot: 1,
          logicalCallId: "PRIVATE_LOGICAL_CALL",
          semanticCoordinate: { version: 1, kind: "durable_turn", turnId: "PRIVATE_INTENT_TURN", subcallSlot: 1 },
          actorId: "PRIVATE_INTENT_ACTOR",
          action: "lobby_speech",
          contractId: "PRIVATE_CONTRACT_ID",
        }],
      },
    });

    const result = await getDurableRunInspection(db, gameId);

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.execution).toMatchObject({
      authority: {
        status: "ready",
        heads: {
          turnSequence: 0,
          eventSequence: 0,
          dialogueSequence: 0,
          publicationSequence: 0,
        },
        cursor: {
          kind: "serial_actor",
          coordinate: "lobby_speech",
          actorIndex: 0,
          actorCount: 1,
          pass: null,
        },
      },
      plannedTurn: {
        turnSequence: 1,
        branchKind: "single_provider",
        action: "lobby_speech",
        providerSubcallCount: 1,
      },
      publications: { totalCount: 0 },
    });
    const serialized = JSON.stringify(result.response.execution);
    for (const canary of [
      "PRIVATE_XSTATE_CANARY",
      "PRIVATE_CURSOR_ACTOR",
      "PRIVATE_TURN_SEED",
      "PRIVATE_INTENT_ACTOR",
      "PRIVATE_INTENT_TARGET",
      "PRIVATE_INTENT_HANDLE",
      "PRIVATE_INTENT_PARTICIPANT",
      "PRIVATE_LOGICAL_CALL",
      "PRIVATE_CONTRACT_ID",
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });

  test("handles pre-kernel games as inspectable empty durable runs", async () => {
    const gameId = await insertGame(db, { status: "waiting" });

    const result = await getDurableRunInspection(db, gameId);

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.eventLog.status).toBe("empty");
    expect(result.response.projection.status).toBe("empty");
    expect(result.response.kernel.owner).toBeNull();
    expect(result.response.execution.authority).toBeNull();
    expect(result.response.execution.plannedTurn).toBeNull();
    expect(result.response.execution.publications.totalCount).toBe(0);
    expect(result.response.checkpoints.count).toBe(0);
    expect(result.response.evidence.totalCount).toBe(0);
  });

  test("surfaces invalid event logs while replaying only the trusted prefix", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 3 });
    const events = createCanonicalEventFixture(gameId).slice(0, 3);

    await insertCanonicalEventRows(db, gameId, ownerEpoch, events, {
      eventHash: (event) => event.sequence === 2
        ? "sha256:not-the-real-event-hash"
        : hashCanonicalEvent(event),
    });

    const result = await getDurableRunInspection(db, gameId);

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.eventLog).toMatchObject({
      status: "invalid",
      rowCount: 3,
      trustedEventCount: 1,
      firstInvalidSequence: 2,
    });
    expect(result.response.projection.status).toBe("incomplete");
    expect(result.response.projection.summary?.lastSequence).toBe(1);
    expect(result.response.diagnostics[0]?.code).toBe("hash_mismatch");
  });

  test("resolves exact game IDs before slug matches", async () => {
    const targetId = randomUUID();
    await insertGame(db, { slug: targetId });
    await insertGame(db, { id: targetId });

    const result = await getDurableRunInspection(db, targetId);

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.game.id).toBe(targetId);
    expect(result.response.game.slug).toBe(`test-${targetId}`);
  });

  test("reports expired active owners as suspended at inspection time", async () => {
    const gameId = await insertGame(db);
    await insertOwner(db, gameId, {
      expiresAt: "2020-01-01T00:00:00.000Z",
      lastPersistedEventSequence: 2,
    });

    const result = await getDurableRunInspection(db, gameId);

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.kernel.owner?.status).toBe("expired");
    expect(result.response.kernel.owner?.kernelHealth).toBe("suspended");
    expect(result.response.kernel.health.status).toBe("suspended");
    expect(result.response.diagnostics.some((diagnostic) => (
      diagnostic.code === "owner_epoch_expired"
    ))).toBeTrue();
  });

  test("redacts malformed private content storage providers into an unknown bucket", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    await db.insert(schema.gameEvidenceManifests).values({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      eventSequence: 1,
      evidenceType: "llm_response",
      retentionClass: "debug",
      accessScope: "producer_admin",
      storageProvider: "linode_object_storage:private-content/content/secret.json",
      storageBucket: "private-content",
      storageKey: "content/secret.json",
      metadata: {
        prompt: "raw prompt",
        response: "raw response",
      },
    });

    const result = await getDurableRunInspection(db, gameId);

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.evidence.storage.providerCounts).toEqual({ unknown: 1 });
    expect(result.response.diagnostics.some((diagnostic) => (
      diagnostic.code === "malformed_private_content_storage_provider"
    ))).toBeTrue();

    const serialized = JSON.stringify(result.response);
    expect(serialized).not.toContain("linode_object_storage:private-content");
    expect(serialized).not.toContain("content/secret.json");
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("raw response");
  });

  test("returns not found for missing games", async () => {
    const result = await getDurableRunInspection(db, "missing-game");

    expect(result).toEqual({
      ok: false,
      statusCode: 404,
      error: "Game not found",
    });
  });
});
