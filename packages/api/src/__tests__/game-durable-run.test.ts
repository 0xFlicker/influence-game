import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { createEvidenceManifest } from "../services/game-evidence.js";
import {
  getDurableRunInspection,
} from "../services/game-durable-run.js";
import { getPersistedGameProjectionBeforeTerminalOutcome } from "../services/game-projection-read-model.js";
import type { PersistedGameEventsRead } from "../services/game-event-read-model.js";
import type { CanonicalGameEvent } from "@influence/engine";
import { acquireGameRunOwner } from "../services/game-ownership.js";
import { abortAllGames, startGame } from "../services/game-lifecycle.js";
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

  test("inspects durable events and checkpoints written by the API lifecycle runner", async () => {
    const gameId = await insertGame(db, {
      status: "waiting",
      config: {
        maxRounds: 5,
        modelTier: "budget",
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
      expect(inspection.eventLog.status).toBe("complete");
      expect(inspection.eventLog.rowCount).toBeGreaterThan(0);
      expect(inspection.projection.status).toBe("complete");
      expect(inspection.projection.replayedEventCount).toBe(inspection.eventLog.rowCount);
      expect(inspection.checkpoints.count).toBeGreaterThan(0);
      expect(inspection.checkpoints.entries.every((checkpoint) => checkpoint.resumeAvailable === false)).toBeTrue();
      expect(inspection.evidence.totalCount).toBe(0);
      expect(inspection.diagnostics).toEqual([]);

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
      expect(transcriptRows.some((row) => row.phase === "DIARY_ROOM" && row.text === "--- Diary Room (after COUNCIL) ---")).toBeTrue();
      expect(transcriptRows.some((row) => row.phase === "DIARY_ROOM" && row.scope === "diary" && row.text === "diary entry")).toBeTrue();
    } finally {
      handleClose(observer);
    }
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
    expect(result.response.schemaVersion).toBe(2);
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

  test("handles pre-kernel games as inspectable empty durable runs", async () => {
    const gameId = await insertGame(db, { status: "waiting" });

    const result = await getDurableRunInspection(db, gameId);

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.response.eventLog.status).toBe("empty");
    expect(result.response.projection.status).toBe("empty");
    expect(result.response.kernel.owner).toBeNull();
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
