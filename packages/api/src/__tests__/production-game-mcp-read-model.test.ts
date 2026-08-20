import { beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  GameState,
  Phase,
  type CanonicalGameEvent,
  type LaunchFormatId,
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_GAME_ID,
  EDGE_SMOKE_DUSK_PLAYERS,
  createEdgeSmokeDuskEvents,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { ProductionGameMcpReadModel } from "../game-mcp/read-model.js";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import {
  PRIVATE_TRACE_CONTENT_TYPE,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTracePutObjectInput,
  type PrivateTraceStorageAdapter,
} from "../services/private-trace-storage.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE } from "../services/private-trace-writer.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { captureGameCompletionSettlement } from "../services/game-completion-settlement.js";
import { getGameWatchReplayFrames } from "../services/game-watch-state.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { findForbiddenTranscriptDtoKeys } from "../services/transcript-serialization.js";
import { readMatchTranscriptPage } from "../services/match-transcript-read-model.js";
import { readMatchCognitionPage } from "../services/match-cognition-read-model.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  createResolvedRoundCanonicalEventFixture,
  fixedClock,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
  withJuryWinner,
} from "./durable-run-test-utils.js";

const PRODUCER_ACCESS = {
  userId: "producer-reviewer",
  authProfile: "producer" as const,
};

const PRIVATE_DECISION_SENTINEL = "PRIVATE_ACCEPTED_ACTION_DECISION_SENTINEL";

const CURSOR_SECRET = "test-jwt-secret-match-transcript-pagination";

class FakePrivateTraceStorage implements PrivateTraceStorageAdapter {
  private readonly objects = new Map<string, { body: string; contentType: string }>();

  setObject(bucket: string, key: string, body: string, contentType = PRIVATE_TRACE_CONTENT_TYPE): void {
    this.objects.set(`${bucket}/${key}`, { body, contentType });
  }

  async putObject(input: PrivateTracePutObjectInput): Promise<{ etag?: string }> {
    this.setObject(input.bucket, input.key, input.body, input.contentType);
    return { etag: "fake-etag" };
  }

  async getObject(input: { bucket: string; key: string; maxBytes?: number }): Promise<{
    body: string;
    contentLength?: number;
    contentType?: string;
  }> {
    const found = this.objects.get(`${input.bucket}/${input.key}`);
    if (!found) throw new Error("object not found");
    const body = input.maxBytes === undefined
      ? found.body
      : Buffer.from(found.body, "utf8").subarray(0, Math.max(1, Math.floor(input.maxBytes))).toString("utf8");
    return {
      body,
      contentLength: Buffer.byteLength(body, "utf8"),
      contentType: found.contentType,
    };
  }

  async headObject(input: { bucket: string; key: string }): Promise<{
    contentLength?: number;
    contentType?: string;
  }> {
    const found = this.objects.get(`${input.bucket}/${input.key}`);
    if (!found) throw new Error("object not found");
    return {
      contentLength: Buffer.byteLength(found.body, "utf8"),
      contentType: found.contentType,
    };
  }
}

describe("ProductionGameMcpReadModel", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    process.env.JWT_SECRET = CURSOR_SECRET;
  });

  test("reads deployed game summaries, projections, filters, and player timelines from DB state", async () => {
    const gameId = await insertGame(db, {
      slug: "mcp-read-model-game",
      status: "in_progress",
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const readModel = new ProductionGameMcpReadModel(db);
    const games = await readModel.listGames(PRODUCER_ACCESS);
    expect(games.canonicalGameFacts.games).toHaveLength(1);
    expect(games.canonicalGameFacts.games[0]).toMatchObject({
      id: gameId,
      slug: "mcp-read-model-game",
      rated: false,
      eventLog: {
        status: "complete",
        rowCount: events.length,
        trustedEventCount: events.length,
        lastTrustedSequence: events.length,
      },
      projection: {
        status: "complete",
        round: 1,
        alivePlayers: expect.arrayContaining(["Atlas", "Echo", "Mira", "Nyx"]),
      },
    });

    const projection = await readModel.readProjection("mcp-read-model-game", PRODUCER_ACCESS);
    expect(projection.canonicalGameFacts.projection).toMatchObject({
      status: "complete",
      replayedEventCount: events.length,
      summary: {
        gameId,
        lastSequence: events.length,
      },
    });

    const filtered = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: events[0]!.type,
      limit: 1,
    }, PRODUCER_ACCESS);
    expect(filtered.canonicalGameFacts).toMatchObject({
      eventLogStatus: "complete",
      validPrefixLength: events.length,
      events: [{
        gameId,
        sequence: events[0]!.sequence,
        eventType: events[0]!.type,
      }],
    });
    expect(filtered.diagnostics).toEqual([]);

    const timeline = await readModel.playerTimeline({
      gameIdOrSlug: "mcp-read-model-game",
      player: "atlas",
      limit: 5,
    }, PRODUCER_ACCESS);
    expect(timeline.canonicalGameFacts.eventLogStatus).toBe("complete");
    expect(timeline.canonicalGameFacts.validPrefixLength).toBe(events.length);
    expect(timeline.canonicalGameFacts.events.length).toBeGreaterThan(0);
    expect(timeline.canonicalGameFacts.events[0]?.matchSources?.length).toBeGreaterThan(0);
    expect(timeline.diagnostics).toEqual([]);

    const juryEvent = withJuryWinner(events, "atlas").at(-1)!;
    const finalEvent: CanonicalGameEvent = {
      sequence: juryEvent.sequence + 1,
      gameId,
      round: juryEvent.round,
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
        eliminatedRound: juryEvent.round,
        juryMember: {
          playerId: "echo",
          playerName: "Echo",
          eliminatedRound: juryEvent.round,
        },
      },
    };
    await appendGameEvents(db, { gameId, ownerEpoch, events: [juryEvent, finalEvent] });
    await captureGameCompletionSettlement(db, {
      gameId,
      ownerEpoch,
      finalEventSequence: finalEvent.sequence,
      finalEventHash: hashCanonicalEvent(finalEvent),
      terminalResult: {
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
          text: "PRIVATE_PENDING_SETTLEMENT_TRANSCRIPT",
        }],
        eliminationOrder: [],
        rankedPlayerIds: ["atlas"],
      },
      tokenUsage: {
        total: {
          promptTokens: 0,
          cachedTokens: 0,
          completionTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          callCount: 0,
          emptyResponses: 0,
        },
        perAction: {},
      },
      resolvedModel: "private-model-name",
      calculatedCost: null,
      completionConfig: { privatePrompt: "PRIVATE_COMPLETION_PROMPT" },
      finishedAt: "2026-07-15T12:00:00.000Z",
    });
    const inspection = await readModel.inspectDurableRun(gameId, PRODUCER_ACCESS);
    expect(inspection.developerEvidence.durableRun).toMatchObject({
      completionSettlement: {
        state: "pending",
        retryEligible: false,
        resultHash: expect.stringMatching(/^sha256:/),
      },
      projection: {
        summary: {
          winner: null,
          acceptedOutcomes: { juryWinner: null },
          voteState: { juryVotes: {} },
        },
      },
    });
    const serializedInspection = JSON.stringify(inspection);
    expect(serializedInspection).not.toContain("PRIVATE_PENDING_SETTLEMENT_TRANSCRIPT");
    expect(serializedInspection).not.toContain("PRIVATE_COMPLETION_PROMPT");
    expect(serializedInspection).not.toContain("private-model-name");
    expect(serializedInspection).not.toContain("payload");
    expect(serializedInspection).not.toContain("tokenUsage");

    const pendingList = await readModel.listGames(PRODUCER_ACCESS);
    expect(pendingList.canonicalGameFacts.games[0]?.projection).not.toHaveProperty("winner");
    const pendingProjection = await readModel.readProjection(gameId, PRODUCER_ACCESS);
    expect(pendingProjection.canonicalGameFacts.projection.summary).toMatchObject({
      winner: null,
      acceptedOutcomes: { juryWinner: null },
      voteState: { juryVotes: {} },
    });
    const pendingWinnerEvents = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "jury.winner_determined",
    }, PRODUCER_ACCESS);
    expect(pendingWinnerEvents.canonicalGameFacts.events).toEqual([]);
    const pendingJuryVotes = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "jury.vote_cast",
    }, PRODUCER_ACCESS);
    expect(pendingJuryVotes.canonicalGameFacts.events).toEqual([]);
    const pendingFinalElimination = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "player.eliminated",
      fromSequence: finalEvent.sequence,
    }, PRODUCER_ACCESS);
    expect(pendingFinalElimination.canonicalGameFacts.events).toEqual([]);
    const pendingRoundFacts = await readModel.readRoundFacts({
      gameIdOrSlug: gameId,
      round: finalEvent.round,
    }, PRODUCER_ACCESS);
    expect(pendingRoundFacts.canonicalGameFacts.roundFacts.players.eliminated)
      .not.toContainEqual(expect.objectContaining({ id: "echo" }));
  });

  test("reads LLM-native postgame surfaces for edge-smoke-dusk", async () => {
    await insertEdgeSmokeDuskFixture(db);

    const readModel = new ProductionGameMcpReadModel(db);
    const classicRound = await readModel.readRoundFacts({
      gameIdOrSlug: EDGE_SMOKE_DUSK_EXPECTED.slug,
      round: 1,
    }, PRODUCER_ACCESS);
    expect(classicRound.schemaVersion).toBe(2);
    expect(classicRound.game).toMatchObject({
      gameKernel: "classic",
      gameKernelSource: "inferred",
      gameKernelDiagnostics: [],
    });
    expect(classicRound.canonicalGameFacts.roundFacts.standardVote).toMatchObject({
      status: "available",
      ledger: expect.arrayContaining([
        expect.objectContaining({
          voter: EDGE_SMOKE_DUSK_PLAYERS.lilith,
          empowerTarget: EDGE_SMOKE_DUSK_PLAYERS.shadowtech,
          exposeTarget: EDGE_SMOKE_DUSK_PLAYERS.ash,
        }),
      ]),
    });
    expect(classicRound.canonicalGameFacts.roundFacts.power?.status).toBe("available");
    expect(classicRound.canonicalGameFacts.roundFacts.council?.status).toBe("available");
    expect(classicRound.canonicalGameFacts.roundFacts.council?.eliminated).toEqual(
      EDGE_SMOKE_DUSK_PLAYERS.ash,
    );

    const classicProjection = await readModel.readProjection(
      EDGE_SMOKE_DUSK_EXPECTED.slug,
      PRODUCER_ACCESS,
    );
    expect(classicProjection.canonicalGameFacts.projection).toMatchObject({
      status: "complete",
      summary: {
        gameId: EDGE_SMOKE_DUSK_GAME_ID,
        winner: EDGE_SMOKE_DUSK_PLAYERS.lilith,
      },
    });

    for (const eventType of [
      "vote.cast",
      "power.action_set",
      "council.vote_cast",
    ] as const) {
      const events = await readModel.filterEvents({
        gameIdOrSlug: EDGE_SMOKE_DUSK_EXPECTED.slug,
        eventType,
        visibilityMode: "public",
      }, PRODUCER_ACCESS);
      expect(events.canonicalGameFacts.events.length).toBeGreaterThan(0);
      expect(events.canonicalGameFacts.events[0]?.eventShape).toBe("viewer_decision");
      expect(events.canonicalGameFacts.events[0]?.event).toMatchObject({ type: eventType });
    }

    const replayFrames = await getGameWatchReplayFrames(db, EDGE_SMOKE_DUSK_EXPECTED.slug);
    expect(replayFrames).not.toBeNull();
    expect(replayFrames?.every((frame) => frame.schemaVersion === 3)).toBe(true);
    expect(replayFrames?.some((frame) => frame.viewerDecisionEvent?.type === "vote.cast")).toBe(true);
    expect(replayFrames?.some((frame) => frame.viewerDecisionEvent?.type === "power.action_set")).toBe(true);
    expect(replayFrames?.some((frame) => frame.viewerDecisionEvent?.type === "council.vote_cast")).toBe(true);

    const brief = await readModel.readGameBrief({
      gameIdOrSlug: EDGE_SMOKE_DUSK_EXPECTED.slug,
    }, PRODUCER_ACCESS);

    expect(brief.ok).toBe(true);
    if (!brief.ok) return;
    expect(brief.postgame.summary.winner).toEqual({
      id: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
      name: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
    });
    expect(brief.postgame.schemaVersion).toBe(2);
    expect(brief.postgame.executiveSummary[0]?.text).toBe(
      "Shadowtech controlled power for 3 consecutive rounds.",
    );
    expect(brief.postgame.summary.finalVote).toMatchObject({
      totalVotes: 7,
      margin: 1,
      runnerUp: { id: EDGE_SMOKE_DUSK_EXPECTED.runnerUpId },
    });
    expect(brief.postgame.summary.dominantEmpoweredPlayers[0]).toEqual({
      player: EDGE_SMOKE_DUSK_PLAYERS.shadowtech,
      votes: 3,
    });
    expect(brief.postgame.summary.bootOrder.map((entry) => entry.player.id)).toEqual(
      [...EDGE_SMOKE_DUSK_EXPECTED.bootOrder],
    );
    expect(brief.postgame.summary.bootOrder.at(-1)).toMatchObject({
      player: EDGE_SMOKE_DUSK_PLAYERS.kestrel,
      source: "jury",
      juryMember: false,
    });
    expect(brief.postgame.roundSummaries).toHaveLength(EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed);
    expect(brief.postgame.roundSummaries[0]).toMatchObject({
      headline: {
        text: "Ash Calder is eliminated.",
      },
    });
    const endgameDiagnostics = brief.postgame.roundSummaries
      .filter((round) => round.round >= 6)
      .flatMap((round) => round.diagnostics.map((diagnostic) => diagnostic.code));
    expect(endgameDiagnostics).not.toContain("standard_vote_not_yet_resolved");
    expect(endgameDiagnostics).not.toContain("power_not_yet_resolved");
    expect(endgameDiagnostics).not.toContain("council_not_yet_resolved");
    expect(brief.postgame.derivedVoteCohorts.length).toBeGreaterThan(0);
    expect(brief.postgame.derivedVoteCohorts[0]).toMatchObject({
      size: 3,
      sharedVotes: expect.any(Array),
      cohesionScore: 1,
    });
    expect(brief.postgame.gameMomentum.some((segment) =>
      segment.leader.kind === "player" &&
      segment.leader.player.id === EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id &&
      segment.indicators.includes("empowerment")
    )).toBe(true);
    expect(JSON.stringify(brief)).not.toContain("sourcePointers");
    expect(JSON.stringify(brief)).not.toContain("payloadVersion");

    const jury = await readModel.readJuryBreakdown({
      gameIdOrSlug: EDGE_SMOKE_DUSK_GAME_ID,
    }, PRODUCER_ACCESS);
    expect(jury.ok).toBe(true);
    if (!jury.ok) return;
    const juryVotes = new Map(jury.jury.perJurorVotes.map((vote) => [vote.juror.id, vote.finalist.id]));
    expect(juryVotes.get(EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id)).toBe(EDGE_SMOKE_DUSK_EXPECTED.runnerUpId);
    expect(juryVotes.get(EDGE_SMOKE_DUSK_PLAYERS.nova.id)).toBe(EDGE_SMOKE_DUSK_EXPECTED.runnerUpId);
    for (const jurorId of EDGE_SMOKE_DUSK_EXPECTED.lilithJuryVotes) {
      expect(juryVotes.get(jurorId)).toBe(EDGE_SMOKE_DUSK_EXPECTED.winnerId);
    }
    expect(jury.jury.juryNarrative.map((line) => line.text)).toContain("Final margin: one vote.");
    expect(jury.jury.runnerUpSupporters.map((player) => player.id).sort()).toEqual([
      EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id,
      EDGE_SMOKE_DUSK_PLAYERS.nova.id,
      EDGE_SMOKE_DUSK_PLAYERS.ember.id,
    ].sort());

    const player = await readModel.readPlayerGameSummary({
      gameIdOrSlug: EDGE_SMOKE_DUSK_GAME_ID,
      player: "Lilith Voss",
    }, PRODUCER_ACCESS);
    expect(player.ok).toBe(true);
    if (!player.ok) return;
    expect(player.player.won).toBe(true);
    expect(player.player.overallGameShape.value).toBe("under the radar");
    expect(player.player.majorityAlignmentByRound.filter((round) => round.aligned === true)).toHaveLength(5);

    const turningPoints = await readModel.readGameTurningPoints({
      gameIdOrSlug: EDGE_SMOKE_DUSK_GAME_ID,
    }, PRODUCER_ACCESS);
    expect(turningPoints.ok).toBe(true);
    if (!turningPoints.ok) return;
    expect(turningPoints.turningPoints.some((point) => point.type === "jury_split")).toBe(true);

    const agentGames = await readModel.listAgentGames({
      agentName: "Lilith Voss",
    }, PRODUCER_ACCESS);
    expect(agentGames.ok).toBe(true);
    if (!agentGames.ok) return;
    expect(agentGames.games[0]).toMatchObject({
      gameId: EDGE_SMOKE_DUSK_GAME_ID,
      won: true,
      finalJuryVoteTotal: 7,
      juryVotesReceived: 4,
    });

    const producer = await readModel.readProducerGameAnalysis({
      gameIdOrSlug: EDGE_SMOKE_DUSK_GAME_ID,
    }, PRODUCER_ACCESS);
    expect(producer.ok).toBe(true);
    if (!producer.ok) return;
    expect(producer.producerAnalysis.playerByPlayerStrategicGrades.some((grade) =>
      grade.player.id === EDGE_SMOKE_DUSK_EXPECTED.winnerId &&
      grade.grade === "A"
    )).toBe(true);
    expect(producer.developerEvidence).toHaveProperty("cognitiveArtifacts");
  });

  test("producer game analysis exposes honest first-page metadata for private indexes", async () => {
    await insertEdgeSmokeDuskFixture(db);
    await db.update(schema.games)
      .set({ cognitiveArtifactCaptureVersion: 1 })
      .where(eq(schema.games.id, EDGE_SMOKE_DUSK_GAME_ID));
    const owner = (await db.select({ ownerEpoch: schema.gameRunOwners.ownerEpoch })
      .from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, EDGE_SMOKE_DUSK_GAME_ID)))[0];
    if (!owner) throw new Error("expected edge-smoke-dusk owner epoch");

    const cognitiveIds = Array.from({ length: 52 }, () => randomUUID());
    await db.insert(schema.gameCognitiveArtifacts).values(cognitiveIds.map((id, index) => ({
      id,
      gameId: EDGE_SMOKE_DUSK_GAME_ID,
      artifactType: index % 2 === 0 ? "thinking" as const : "strategy" as const,
      actorRole: "player" as const,
      actorPlayerId: EDGE_SMOKE_DUSK_PLAYERS.lilith.id,
      actorUserId: "user-lilith",
      action: "vote",
      payloadByteLength: 2,
      payload: {},
      createdAt: "2026-08-19T12:00:00.000Z",
    })));
    const traceIds = Array.from({ length: 53 }, () => randomUUID());
    await db.insert(schema.gameEvidenceManifests).values(traceIds.map((id) => ({
      id,
      gameId: EDGE_SMOKE_DUSK_GAME_ID,
      ownerEpoch: owner.ownerEpoch,
      evidenceType: PRIVATE_TRACE_EVIDENCE_TYPE,
      retentionClass: "debug",
      accessScope: "producer_admin",
      redactionStatus: "active" as const,
      metadata: {},
      createdAt: "2026-08-19T12:00:00.000Z",
    })));

    const readModel = new ProductionGameMcpReadModel(db);
    const producer = await readModel.readProducerGameAnalysis({
      gameIdOrSlug: EDGE_SMOKE_DUSK_GAME_ID,
    }, PRODUCER_ACCESS);
    expect(producer.ok).toBe(true);
    if (!producer.ok) return;
    const cognitiveFirst = asRecord(producer.developerEvidence.cognitiveArtifacts);
    const traceFirst = asRecord(producer.developerEvidence.traceManifests);
    const cognitiveCursor = cognitiveFirst.nextCursor;
    const traceCursor = traceFirst.nextCursor;
    expect(producer.schemaVersion).toBe(2);
    expect(cognitiveFirst).toMatchObject({
      ok: true,
      pageSize: 50,
      totalCount: 52,
    });
    expect(traceFirst).toMatchObject({
      ok: true,
      pageSize: 50,
      totalCount: 53,
    });
    expect(typeof cognitiveCursor).toBe("string");
    expect(typeof traceCursor).toBe("string");
    if (typeof cognitiveCursor !== "string" || typeof traceCursor !== "string") {
      throw new Error("Expected producer analysis continuation cursors");
    }

    const seenCognitiveIds = (cognitiveFirst.artifacts as Array<{ id: string }>).map(({ id }) => id);
    let nextCognitiveCursor: string | null = cognitiveCursor;
    while (nextCognitiveCursor) {
      const response = await readModel.listCognitiveArtifacts({
        gameIdOrSlug: EDGE_SMOKE_DUSK_GAME_ID,
        limit: 17,
        cursor: nextCognitiveCursor,
      }, PRODUCER_ACCESS);
      const page = asRecord(response.cognitiveArtifacts);
      seenCognitiveIds.push(...(page.artifacts as Array<{ id: string }>).map(({ id }) => id));
      nextCognitiveCursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
    }

    const seenTraceIds = (traceFirst.manifests as Array<{ id: string }>).map(({ id }) => id);
    let nextTraceCursor: string | null = traceCursor;
    while (nextTraceCursor) {
      const response = await readModel.listTraceManifests(
        EDGE_SMOKE_DUSK_GAME_ID,
        PRODUCER_ACCESS,
        17,
        nextTraceCursor,
      );
      const page = asRecord(response.developerEvidence);
      seenTraceIds.push(...(page.manifests as Array<{ id: string }>).map(({ id }) => id));
      nextTraceCursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
    }

    expect(seenCognitiveIds).toHaveLength(cognitiveIds.length);
    expect(new Set(seenCognitiveIds).size).toBe(cognitiveIds.length);
    expect([...seenCognitiveIds].sort()).toEqual([...cognitiveIds].sort());
    expect(seenTraceIds).toHaveLength(traceIds.length);
    expect(new Set(seenTraceIds).size).toBe(traceIds.length);
    expect([...seenTraceIds].sort()).toEqual([...traceIds].sort());
  });

  test("persists every launch format through sanitized MCP facts and viewer events", async () => {
    const fixtures = [
      {
        name: "Save-or-Eliminate",
        formatId: "save_or_eliminate" as const,
        ballotCount: 4,
        pointerCount: 0,
        resolutionKind: "clear" as const,
      },
      {
        name: "Vote Bomb",
        formatId: "vote_bomb" as const,
        ballotCount: 4,
        pointerCount: 0,
        resolutionKind: "auto" as const,
      },
      {
        name: "Safety Bounce",
        formatId: "safety_bounce" as const,
        ballotCount: 4,
        pointerCount: 3,
        resolutionKind: "clear" as const,
      },
      {
        name: "Safety Bounce sole vulnerable",
        formatId: "safety_bounce_sole_vulnerable" as const,
        ballotCount: 0,
        pointerCount: 2,
        resolutionKind: "auto" as const,
      },
    ];

    const readModel = new ProductionGameMcpReadModel(db);
    for (const fixture of fixtures) {
      const gameId = await insertGame(db, {
        slug: `persisted-format-${fixture.formatId}-${randomUUID()}`,
        status: "completed",
      });
      await insertFormatFixturePlayers(db, gameId);
      const ownerEpoch = await insertOwner(db, gameId);
      await appendGameEvents(db, {
        gameId,
        ownerEpoch,
        events: createPersistedFormatFixtureEvents(gameId, fixture.formatId),
      });

      const roundFacts = await readModel.readRoundFacts({ gameIdOrSlug: gameId, round: 1 }, PRODUCER_ACCESS);
      const format = roundFacts.canonicalGameFacts.roundFacts.format;
      expect(roundFacts.game).toMatchObject({ gameKernel: "format" });
      expect(format).toMatchObject({
        status: "available",
        selectedFormatId: fixture.formatId === "safety_bounce_sole_vulnerable"
          ? "safety_bounce"
          : fixture.formatId,
        resolutionKind: fixture.resolutionKind,
      });
      expect(format.acceptedBallots).toHaveLength(fixture.ballotCount);
      expect(format.safetyBounce?.pointers ?? []).toHaveLength(fixture.pointerCount);
      if (fixture.formatId === "safety_bounce_sole_vulnerable") {
        expect(format.acceptedBallots).toEqual([]);
        expect(format.ballotPresentation).toEqual({
          status: "not_applicable",
          rollCall: [],
        });
        expect(format.safetyBounce?.vulnerable).toHaveLength(1);
      } else {
        expect(format.ballotPresentation).toEqual({
          status: "revealed",
          rollCall: format.acceptedBallots,
        });
        expect(new Set(
          format.ballotPresentation.rollCall.map((ballot) => ballot.voter.id),
        ).size).toBe(fixture.ballotCount);
      }

      for (const eventType of [
        "format.menu_offered",
        "format.selected",
        "format.resolved",
        ...(fixture.pointerCount > 0
          ? ["format.safety_bounce_started", "format.safety_bounce_pointer"] as const
          : []),
      ]) {
        const filtered = await readModel.filterEvents({
          gameIdOrSlug: gameId,
          eventType,
          visibilityMode: "public",
        }, PRODUCER_ACCESS);
        expect(filtered.canonicalGameFacts.events.length).toBeGreaterThan(0);
        expect(filtered.canonicalGameFacts.events.every((entry) => entry.eventType === eventType)).toBe(true);
        const serialized = JSON.stringify(filtered);
        expect(serialized).not.toContain(PRIVATE_DECISION_SENTINEL);
        expect(serialized).not.toContain("sourcePointers");
        expect(serialized).not.toContain("reasoningContext");
        expect(serialized).not.toContain("decisionLog");
      }

      // All helper-created ballots retain their historical producer envelope.
      // The public event view must still expose only the sanitized ledger.
      const ballots = await readModel.filterEvents({
        gameIdOrSlug: gameId,
        eventType: "format.ballot_cast",
        visibilityMode: "public",
      }, PRODUCER_ACCESS);
      expect(ballots.canonicalGameFacts.events).toHaveLength(fixture.ballotCount);
      expect(ballots.canonicalGameFacts.events.every((entry) => entry.eventShape === "viewer_decision")).toBe(true);
      expect(ballots.canonicalGameFacts.events.every((entry) => entry.event?.type === "format.ballot_cast")).toBe(true);
      const ballotPayloads = ballots.canonicalGameFacts.events.map((entry) => entry.event?.payload);
      expect(ballotPayloads).toEqual(
        format.acceptedBallots.map((ballot) => ({
          formatId: format.selectedFormatId,
          voterId: ballot.voter.id,
          targetId: ballot.target.id,
          polarity: ballot.polarity,
        })),
      );
      const serialized = JSON.stringify({ roundFacts, ballots });
      expect(serialized).not.toContain(PRIVATE_DECISION_SENTINEL);
      expect(serialized).not.toContain("sourcePointers");
      expect(serialized).not.toContain("thinking");
      expect(serialized).not.toContain("reasoningContext");
      expect(serialized).not.toContain("decisionLog");
    }
  });

  test("returns persisted invalid-log diagnostics through event filters and timelines", async () => {
    const gameId = await insertGame(db, { slug: "mcp-invalid-log" });
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 3 });
    const events = createCanonicalEventFixture(gameId).slice(0, 3);
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events, {
      eventHash: (event) => event.sequence === 2
        ? "sha256:not-the-real-event-hash"
        : hashCanonicalEvent(event),
    });

    const readModel = new ProductionGameMcpReadModel(db);
    const filtered = await readModel.filterEvents({ gameIdOrSlug: gameId }, PRODUCER_ACCESS);
    expect(filtered.canonicalGameFacts).toMatchObject({
      eventLogStatus: "invalid",
      validPrefixLength: 1,
    });
    expect(filtered.canonicalGameFacts.events).toHaveLength(1);
    expect(filtered.diagnostics[0]).toMatchObject({
      code: "hash_mismatch",
      sequence: 2,
    });

    const timeline = await readModel.playerTimeline({
      gameIdOrSlug: "mcp-invalid-log",
      player: "atlas",
    }, PRODUCER_ACCESS);
    expect(timeline.canonicalGameFacts).toMatchObject({
      player: "atlas",
      eventLogStatus: "invalid",
      validPrefixLength: 1,
    });
    expect(timeline.diagnostics[0]).toMatchObject({
      code: "hash_mismatch",
      sequence: 2,
    });

    const roundFacts = await readModel.readRoundFacts({ gameIdOrSlug: gameId }, PRODUCER_ACCESS);
    expect(roundFacts.canonicalGameFacts.availability).toMatchObject({
      canonicalFactsStatus: "unavailable",
      eventLogStatus: "invalid",
    });
  });

  test("filters games-scope reads to games created or joined by the subject", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    await db.insert(schema.users).values([
      { id: userId, walletAddress: "0xgamescope000000000000000000000000000001" },
      { id: otherUserId, walletAddress: "0xgamescope000000000000000000000000000002" },
    ]);

    const createdGameId = await insertGame(db, { slug: "created-by-subject" });
    await db
      .update(schema.games)
      .set({ createdById: userId })
      .where(eq(schema.games.id, createdGameId));
    const ownerEpoch = await insertOwner(db, createdGameId);
    const createdGameEvents = createCanonicalEventFixture(createdGameId);
    await appendGameEvents(db, {
      gameId: createdGameId,
      ownerEpoch,
      events: createdGameEvents,
    });

    const joinedGameId = await insertGame(db, { slug: "joined-by-subject" });
    const agentProfileGameId = await insertGame(db, { slug: "agent-profile-by-subject" });
    const unrelatedGameId = await insertGame(db, { slug: "unrelated-game" });
    await insertGamePlayer(db, {
      gameId: joinedGameId,
      userId,
    });
    const agentProfileId = randomUUID();
    await db.insert(schema.agentProfiles).values({
      id: agentProfileId,
      userId,
      name: "Owned Agent",
      personality: "careful and observant",
    });
    await insertGamePlayer(db, {
      gameId: agentProfileGameId,
      agentProfileId,
    });
    await insertGamePlayer(db, {
      gameId: unrelatedGameId,
      userId: otherUserId,
    });

    const readModel = new ProductionGameMcpReadModel(db);
    const gamesAccess = {
      userId,
      authProfile: "subject" as const,
    };
    const games = await readModel.listGames(gamesAccess, 20);
    const gameIds = games.canonicalGameFacts.games.map((game) => game.id);

    expect(gameIds).toContain(createdGameId);
    expect(gameIds).toContain(joinedGameId);
    expect(gameIds).toContain(agentProfileGameId);
    expect(gameIds).not.toContain(unrelatedGameId);
    expect(games.developerEvidence).toBeUndefined();

    const producerProjection = await readModel.readProjection(createdGameId, PRODUCER_ACCESS);
    expect(Object.keys(
      producerProjection.canonicalGameFacts.projection.summary?.voteState.empowerVotes ?? {},
    ).length).toBeGreaterThan(0);

    const gamesProjection = await readModel.readProjection(createdGameId, gamesAccess);
    expect(gamesProjection.canonicalGameFacts.projection.summary?.voteState).toEqual({
      empowerVotes: {},
      exposeVotes: {},
      councilVotes: {},
      endgameEliminationVotes: {},
      juryVotes: {},
      empoweredId: null,
      empoweredName: null,
      councilCandidates: null,
      councilCandidateNames: null,
      candidateResolution: null,
      powerAction: null,
    });

    await expect(readModel.readProjection(unrelatedGameId, gamesAccess)).rejects.toThrow(
      /^Game is not accessible for MCP scope: games:read$/,
    );
    await expect(readModel.readProjection("missing-game", gamesAccess)).rejects.toThrow(
      /^Game is not accessible for MCP scope: games:read$/,
    );
  });

  test("reads sanitized round facts for created, joined, and producer-accessible games", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    await db.insert(schema.users).values([
      { id: userId, walletAddress: "0xroundfacts0000000000000000000000000001" },
      { id: otherUserId, walletAddress: "0xroundfacts0000000000000000000000000002" },
    ]);

    const createdGameId = await insertGame(db, { slug: "round-facts-created", status: "in_progress" });
    await db
      .update(schema.games)
      .set({ createdById: userId })
      .where(eq(schema.games.id, createdGameId));
    const createdOwnerEpoch = await insertOwner(db, createdGameId);
    const createdEvents = createResolvedRoundCanonicalEventFixture(createdGameId);
    await appendGameEvents(db, { gameId: createdGameId, ownerEpoch: createdOwnerEpoch, events: createdEvents });

    const joinedGameId = await insertGame(db, { slug: "round-facts-joined", status: "in_progress" });
    await insertGamePlayer(db, { gameId: joinedGameId, userId });
    const joinedOwnerEpoch = await insertOwner(db, joinedGameId);
    await appendGameEvents(db, {
      gameId: joinedGameId,
      ownerEpoch: joinedOwnerEpoch,
      events: createResolvedRoundCanonicalEventFixture(joinedGameId),
    });

    const unrelatedGameId = await insertGame(db, { slug: "round-facts-unrelated", status: "in_progress" });
    await insertGamePlayer(db, { gameId: unrelatedGameId, userId: otherUserId });
    const unrelatedOwnerEpoch = await insertOwner(db, unrelatedGameId);
    await appendGameEvents(db, {
      gameId: unrelatedGameId,
      ownerEpoch: unrelatedOwnerEpoch,
      events: createResolvedRoundCanonicalEventFixture(unrelatedGameId),
    });

    const readModel = new ProductionGameMcpReadModel(db);
    const gamesAccess = {
      userId,
      authProfile: "subject" as const,
    };

    const createdFacts = await readModel.readRoundFacts({
      gameIdOrSlug: "round-facts-created",
      round: 1,
    }, gamesAccess);
    expect(createdFacts.canonicalGameFacts.availability).toMatchObject({
      canonicalFactsStatus: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      artifactDerivedFacts: { status: "not_used" },
    });
    expect(createdFacts.canonicalGameFacts.roundFacts.standardVote.status).toBe("available");
    expect(createdFacts.canonicalGameFacts.roundFacts.power?.status).toBe("available");
    expect(createdFacts.canonicalGameFacts.roundFacts.council?.status).toBe("available");
    expect(createdFacts.canonicalGameFacts.roundFacts.standardVote.ledger[0]).toMatchObject({
      voter: { id: "atlas", name: "Atlas" },
      empowerTarget: { id: "mira", name: "Mira" },
      exposeTarget: { id: "echo", name: "Echo" },
    });
    const createdJson = JSON.stringify(createdFacts);
    expect(createdJson).not.toContain("sourcePointers");
    expect(createdJson).not.toContain("payloadVersion");
    expect(createdJson).not.toContain("eventHash");
    expect(createdJson).not.toContain("privateReasoning");

    const joinedFacts = await readModel.readRoundFacts({ gameIdOrSlug: joinedGameId }, gamesAccess);
    expect(joinedFacts.canonicalGameFacts.roundFacts.council?.status).toBe("available");

    const producerFacts = await readModel.readRoundFacts({ gameIdOrSlug: unrelatedGameId }, PRODUCER_ACCESS);
    expect(producerFacts.canonicalGameFacts.roundFacts.standardVote.status).toBe("available");

    await expect(readModel.readRoundFacts({ gameIdOrSlug: unrelatedGameId }, gamesAccess)).rejects.toThrow(
      /^Game is not accessible for MCP scope: games:read$/,
    );
    await expect(readModel.readRoundFacts({ gameIdOrSlug: "missing-game" }, gamesAccess)).rejects.toThrow(
      /^Game is not accessible for MCP scope: games:read$/,
    );
  });

  test("shares sanitized format ballot ledgers across MCP audiences while preserving producer provenance", async () => {
    const ownerUserId = randomUUID();
    const otherUserId = randomUUID();
    const spectatorUserId = randomUUID();
    await db.insert(schema.users).values([
      { id: ownerUserId, walletAddress: "0xformatfacts0000000000000000000000000001" },
      { id: otherUserId, walletAddress: "0xformatfacts0000000000000000000000000002" },
      { id: spectatorUserId, walletAddress: "0xformatfacts0000000000000000000000000003" },
    ]);

    const gameId = await insertGame(db, {
      slug: "format-ballot-scope",
      status: "in_progress",
    });
    await db
      .update(schema.games)
      // Creator-only access is the current authorized non-seat observer lane.
      .set({ createdById: spectatorUserId, gameKernel: "format" })
      .where(eq(schema.games.id, gameId));
    const ownerPlayerId = await insertGamePlayer(db, {
      gameId,
      userId: ownerUserId,
      name: "OwnerSeat",
    });
    const peerPlayerId = await insertGamePlayer(db, {
      gameId,
      userId: otherUserId,
      name: "PeerSeat",
    });
    const thirdPlayerId = await insertGamePlayer(db, {
      gameId,
      name: "ThirdSeat",
    });
    const fourthPlayerId = await insertGamePlayer(db, {
      gameId,
      name: "FourthSeat",
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const roster = [
      { id: ownerPlayerId, name: "OwnerSeat" },
      { id: peerPlayerId, name: "PeerSeat" },
      { id: thirdPlayerId, name: "ThirdSeat" },
      { id: fourthPlayerId, name: "FourthSeat" },
    ] as const;
    const state = new GameState([...roster], { gameId, now: fixedClock() });
    const privatePointer = (
      actorId: string,
      action: "format-pick" | "format-save-or-eliminate-ballot" | "format-resolution",
      phase: Phase,
    ) => [{
      kind: "agent_turn" as const,
      decisionId: PRIVATE_DECISION_SENTINEL,
      actorId,
      action,
      phase,
      round: 1,
    }];

    state.startRound();
    state.recordFormatMenu(ownerPlayerId, ["save_or_eliminate", "vote_bomb"]);
    state.recordFormatSelected(
      ownerPlayerId,
      "save_or_eliminate",
      privatePointer(PRIVATE_DECISION_SENTINEL, "format-pick", Phase.FORMAT_PICK),
    );
    // Deliberately submit out of roster order so the resolution projection has
    // to establish canonical roll-call order instead of preserving timing.
    const submittedBallots = [
      { voterId: thirdPlayerId, targetId: peerPlayerId, polarity: "eliminate" as const },
      { voterId: ownerPlayerId, targetId: peerPlayerId, polarity: "eliminate" as const },
      { voterId: fourthPlayerId, targetId: peerPlayerId, polarity: "eliminate" as const },
      { voterId: peerPlayerId, targetId: ownerPlayerId, polarity: "save" as const },
    ];
    for (const ballot of submittedBallots) {
      state.recordFormatBallot(
        { formatId: "save_or_eliminate", ...ballot },
        privatePointer(
          ballot.voterId,
          "format-save-or-eliminate-ballot",
          Phase.FORMAT_RESOLVE,
        ),
      );
    }
    state.recordFormatResolution({
      formatId: "save_or_eliminate",
      empoweredId: ownerPlayerId,
      eliminatedId: peerPlayerId,
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: {
        nets: {
          [ownerPlayerId]: 1,
          [peerPlayerId]: -3,
          [thirdPlayerId]: 0,
          [fourthPlayerId]: 0,
        },
        savesReceived: {
          [ownerPlayerId]: 1,
          [peerPlayerId]: 0,
          [thirdPlayerId]: 0,
          [fourthPlayerId]: 0,
        },
        eliminateReceived: {
          [ownerPlayerId]: 0,
          [peerPlayerId]: 3,
          [thirdPlayerId]: 0,
          [fourthPlayerId]: 0,
        },
      },
      voteBomb: null,
      safetyBounce: null,
    }, privatePointer(PRIVATE_DECISION_SENTINEL, "format-resolution", Phase.FORMAT_RESOLVE));
    const events = state.getCanonicalEvents();
    const ballotEvents = events.filter(
      (event): event is Extract<CanonicalGameEvent, { type: "format.ballot_cast" }> =>
        event.type === "format.ballot_cast",
    );
    const readModel = new ProductionGameMcpReadModel(db);
    const ownerAccess = { userId: ownerUserId, authProfile: "subject" as const };
    const playerNames = new Map(roster.map((player) => [player.id, player.name]));
    const playerName = (playerId: string): string => {
      const name = playerNames.get(playerId);
      if (!name) throw new Error(`Missing roster name for ${playerId}`);
      return name;
    };
    const expectedEntry = (ballot: typeof submittedBallots[number]) => ({
      voter: { id: ballot.voterId, name: playerName(ballot.voterId) },
      target: { id: ballot.targetId, name: playerName(ballot.targetId) },
      polarity: ballot.polarity,
    });

    for (const ballotCount of [1, 2, 4]) {
      const lastBallot = ballotEvents[ballotCount - 1];
      if (!lastBallot) throw new Error(`Missing ballot prefix ${ballotCount}`);
      await appendGameEvents(db, {
        gameId,
        ownerEpoch,
        events: events.slice(0, lastBallot.sequence),
      });

      const prefixFacts = await readModel.readRoundFacts(
        { gameIdOrSlug: gameId, round: 1 },
        ownerAccess,
      );
      const format = prefixFacts.canonicalGameFacts.roundFacts.format;
      expect(format.acceptedBallots).toEqual(
        submittedBallots.slice(0, ballotCount).map(expectedEntry),
      );
      expect(format.ballotPresentation).toEqual({
        status: "sealed",
        rollCall: [],
      });

      const prefixEvents = await readModel.filterEvents({
        gameIdOrSlug: gameId,
        eventType: "format.ballot_cast",
        visibilityMode: "public",
      }, ownerAccess);
      expect(prefixEvents.canonicalGameFacts.events.map((entry) => entry.event.payload)).toEqual(
        submittedBallots.slice(0, ballotCount).map((ballot) => ({
          formatId: "save_or_eliminate",
          ...ballot,
        })),
      );
      expect(JSON.stringify(prefixEvents)).not.toContain("sourcePointers");
      expect(JSON.stringify(prefixEvents)).not.toContain(PRIVATE_DECISION_SENTINEL);
    }

    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const ownerFacts = await readModel.readRoundFacts({ gameIdOrSlug: gameId, round: 1 }, ownerAccess);
    const ownerFormat = ownerFacts.canonicalGameFacts.roundFacts.format;
    const expectedAcceptedBallots = submittedBallots.map(expectedEntry);
    const expectedRollCall = roster.map((player) =>
      expectedEntry(submittedBallots.find((ballot) => ballot.voterId === player.id)!));
    expect(ownerFormat).toMatchObject({
      status: "available",
      selectedFormatId: "save_or_eliminate",
      acceptedBallots: expectedAcceptedBallots,
      ballotPresentation: {
        status: "revealed",
        rollCall: expectedRollCall,
      },
    });
    expect(ownerFormat.ballotPresentation.rollCall).toHaveLength(
      ownerFormat.acceptedBallots.length,
    );
    expect(new Set(
      ownerFormat.ballotPresentation.rollCall.map((ballot) => ballot.voter.id),
    ).size).toBe(ownerFormat.acceptedBallots.length);

    const peerFacts = await readModel.readRoundFacts(
      { gameIdOrSlug: gameId, round: 1 },
      { userId: otherUserId, authProfile: "subject" },
    );
    expect(peerFacts.canonicalGameFacts.roundFacts.format).toEqual(
      ownerFacts.canonicalGameFacts.roundFacts.format,
    );
    expect(JSON.stringify(peerFacts)).not.toContain(PRIVATE_DECISION_SENTINEL);

    const spectatorFacts = await readModel.readRoundFacts(
      { gameIdOrSlug: gameId, round: 1 },
      { userId: spectatorUserId, authProfile: "subject" },
    );
    expect(spectatorFacts.canonicalGameFacts.roundFacts.format).toEqual(
      ownerFacts.canonicalGameFacts.roundFacts.format,
    );

    const producerFacts = await readModel.readRoundFacts({ gameIdOrSlug: gameId, round: 1 }, PRODUCER_ACCESS);
    expect(producerFacts.canonicalGameFacts.roundFacts.format).toEqual(
      ownerFacts.canonicalGameFacts.roundFacts.format,
    );

    // filter_events: public format facts stay visible in both non-producer
    // visibility modes, but the decision-bearing source pointers do not.
    for (const eventType of [
      "format.selected",
      "format.resolved",
    ] as const) {
      for (const visibilityMode of ["public", "player"] as const) {
        const publicFacts = await readModel.filterEvents({
          gameIdOrSlug: gameId,
          eventType,
          visibilityMode,
        }, ownerAccess);
        expect(publicFacts.canonicalGameFacts.events).toHaveLength(1);
        expect(JSON.stringify(publicFacts)).not.toContain(PRIVATE_DECISION_SENTINEL);
        expect(JSON.stringify(publicFacts)).not.toContain("sourcePointers");
      }
    }

    const publicBallots = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "format.ballot_cast",
      visibilityMode: "public",
    }, ownerAccess);
    expect(publicBallots.canonicalGameFacts.events).toHaveLength(4);
    expect(publicBallots.canonicalGameFacts.events.map((entry) => entry.event.payload)).toEqual(
      submittedBallots.map((ballot) => ({
        formatId: "save_or_eliminate",
        ...ballot,
      })),
    );
    expect(JSON.stringify(publicBallots)).not.toContain("sourcePointers");
    expect(JSON.stringify(publicBallots)).not.toContain(PRIVATE_DECISION_SENTINEL);

    const producerViewerBallots = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "format.ballot_cast",
      visibilityMode: "public",
    }, PRODUCER_ACCESS);
    expect(producerViewerBallots.canonicalGameFacts.events).toEqual(
      publicBallots.canonicalGameFacts.events,
    );

    const pointerOnlyActorMatch = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      actor: PRIVATE_DECISION_SENTINEL,
    }, ownerAccess);
    expect(pointerOnlyActorMatch.canonicalGameFacts.events).toEqual([]);
    expect(JSON.stringify(pointerOnlyActorMatch)).not.toContain("matchSources");

    await expect(readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "format.ballot_cast",
      visibilityMode: "producer",
    }, ownerAccess)).rejects.toThrow(/producer visibility requires MCP scope: producer/);

    const producerBallots = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "format.ballot_cast",
      visibilityMode: "producer",
    }, PRODUCER_ACCESS);
    expect(producerBallots.canonicalGameFacts.events.length).toBe(4);
    expect(producerBallots.canonicalGameFacts.events.every((entry) => entry.eventShape === "canonical")).toBe(true);
    expect(JSON.stringify(producerBallots)).toContain("sourcePointers");
    expect(JSON.stringify(producerBallots)).toContain(PRIVATE_DECISION_SENTINEL);

    const producerPointerMatch = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      actor: PRIVATE_DECISION_SENTINEL,
    }, PRODUCER_ACCESS);
    expect(producerPointerMatch.canonicalGameFacts.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(producerPointerMatch)).toContain(PRIVATE_DECISION_SENTINEL);
    expect(producerPointerMatch.canonicalGameFacts.events[0]?.matchSources).toContain(
      "sourcePointers.actorId",
    );

    const ownerJson = JSON.stringify(ownerFacts);
    expect(ownerJson).not.toContain("thinking");
    expect(ownerJson).not.toContain("reasoningContext");
    expect(ownerJson).not.toContain("decisionLog");
  });

  test("exposes dual-kernel gameKernel and omits classic power/council on format games", async () => {
    const ownerUserId = randomUUID();
    await db.insert(schema.users).values({
      id: ownerUserId,
      walletAddress: "0xformatkernel000000000000000000000000001",
    });

    const formatGameId = await insertGame(db, {
      slug: "format-kernel-dual-shape",
      status: "in_progress",
    });
    await db
      .update(schema.games)
      .set({ createdById: ownerUserId, gameKernel: "format" })
      .where(eq(schema.games.id, formatGameId));
    const ownerPlayerId = await insertGamePlayer(db, {
      gameId: formatGameId,
      userId: ownerUserId,
      name: "KernelOwner",
    });
    const peerPlayerId = await insertGamePlayer(db, {
      gameId: formatGameId,
      name: "KernelPeer",
    });
    const formatOwnerEpoch = await insertOwner(db, formatGameId);
    const formatBase = createCanonicalEventFixture(formatGameId);
    const formatEvents: CanonicalGameEvent[] = [
      {
        sequence: formatBase.length + 1,
        gameId: formatGameId,
        round: 1,
        phase: Phase.FORMAT_MENU,
        type: "format.menu_offered",
        timestamp: "2026-07-24T13:00:00.000Z",
        source: "phase",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          empoweredId: ownerPlayerId,
          offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
        },
      },
      {
        sequence: formatBase.length + 2,
        gameId: formatGameId,
        round: 1,
        phase: Phase.FORMAT_PICK,
        type: "format.selected",
        timestamp: "2026-07-24T13:00:01.000Z",
        source: "phase",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          empoweredId: ownerPlayerId,
          formatId: "save_or_eliminate",
        },
      },
      {
        sequence: formatBase.length + 3,
        gameId: formatGameId,
        round: 1,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.resolved",
        timestamp: "2026-07-24T13:00:02.000Z",
        source: "phase",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          formatId: "save_or_eliminate",
          empoweredId: ownerPlayerId,
          eliminatedId: peerPlayerId,
          resolutionKind: "clear",
          tiedPlayerIds: [],
          tiebreakerId: null,
          saveOrEliminate: {
            nets: { [ownerPlayerId]: 1, [peerPlayerId]: -1 },
            savesReceived: { [ownerPlayerId]: 1, [peerPlayerId]: 0 },
            eliminateReceived: { [ownerPlayerId]: 0, [peerPlayerId]: 1 },
          },
          voteBomb: null,
          safetyBounce: null,
        },
      },
    ];
    await appendGameEvents(db, {
      gameId: formatGameId,
      ownerEpoch: formatOwnerEpoch,
      events: [...formatBase, ...formatEvents],
    });

    const classicGameId = await insertGame(db, {
      slug: "classic-kernel-dual-shape",
      status: "in_progress",
    });
    await db
      .update(schema.games)
      .set({ createdById: ownerUserId, gameKernel: "classic" })
      .where(eq(schema.games.id, classicGameId));
    await insertGamePlayer(db, {
      gameId: classicGameId,
      userId: ownerUserId,
      name: "ClassicOwner",
    });
    const classicOwnerEpoch = await insertOwner(db, classicGameId);
    await appendGameEvents(db, {
      gameId: classicGameId,
      ownerEpoch: classicOwnerEpoch,
      events: createResolvedRoundCanonicalEventFixture(classicGameId),
    });

    const readModel = new ProductionGameMcpReadModel(db);
    const access = { userId: ownerUserId, authProfile: "subject" as const };

    const listed = await readModel.listGames(access, 20);
    const formatListRow = listed.canonicalGameFacts.games.find((g) => g.id === formatGameId);
    const classicListRow = listed.canonicalGameFacts.games.find((g) => g.id === classicGameId);
    expect(formatListRow?.gameKernel).toBe("format");
    expect(formatListRow?.gameKernelSource).toBe("stored");
    expect(classicListRow?.gameKernel).toBe("classic");
    expect(classicListRow?.gameKernelSource).toBe("stored");

    const formatFacts = await readModel.readRoundFacts({ gameIdOrSlug: formatGameId, round: 1 }, access);
    expect(formatFacts.canonicalGameFacts.roundFacts.format.status).toBe("available");
    expect(formatFacts.canonicalGameFacts.roundFacts).not.toHaveProperty("power");
    expect(formatFacts.canonicalGameFacts.roundFacts).not.toHaveProperty("council");

    const classicFacts = await readModel.readRoundFacts({ gameIdOrSlug: classicGameId, round: 1 }, access);
    expect(classicFacts.canonicalGameFacts.roundFacts.standardVote).toMatchObject({
      status: "available",
      ledger: expect.arrayContaining([
        expect.objectContaining({
          voter: { id: "atlas", name: "Atlas" },
          empowerTarget: { id: "mira", name: "Mira" },
          exposeTarget: { id: "echo", name: "Echo" },
        }),
      ]),
    });
    expect(classicFacts.canonicalGameFacts.roundFacts.power?.status).toBe("available");
    expect(classicFacts.canonicalGameFacts.roundFacts.council?.status).toBe("available");

    const classicProjection = await readModel.readProjection(classicGameId, PRODUCER_ACCESS);
    expect(classicProjection.canonicalGameFacts.projection.summary?.voteState).toMatchObject({
      empowerVotes: expect.objectContaining({ atlas: "mira" }),
      exposeVotes: expect.objectContaining({ atlas: "echo" }),
      powerAction: { action: "protect", target: "echo" },
      councilVotes: expect.objectContaining({
        atlas: expect.any(String),
        echo: expect.any(String),
        mira: expect.any(String),
        nyx: expect.any(String),
      }),
    });

    for (const [eventType, expectedCount] of [
      ["vote.cast", 4],
      ["power.action_set", 1],
      ["council.vote_cast", 4],
    ] as const) {
      const filtered = await readModel.filterEvents({
        gameIdOrSlug: classicGameId,
        eventType,
        visibilityMode: "public",
      }, PRODUCER_ACCESS);
      expect(filtered.canonicalGameFacts.events).toHaveLength(expectedCount);
      expect(filtered.canonicalGameFacts.events.every(
        (event) => event.eventShape === "viewer_decision",
      )).toBe(true);
    }
  });

  test("exposes stored-kernel contradiction diagnostics on MCP game identities", async () => {
    const gameId = await insertGame(db, {
      slug: "stored-kernel-contradiction",
      status: "in_progress",
    });
    await db
      .update(schema.games)
      .set({ gameKernel: "classic" })
      .where(eq(schema.games.id, gameId));
    const ownerEpoch = await insertOwner(db, gameId, {
      lastPersistedEventSequence: 1,
    });
    const formatEvidence: CanonicalGameEvent = {
      sequence: 1,
      gameId,
      round: 1,
      phase: Phase.FORMAT_MENU,
      type: "format.menu_offered",
      timestamp: "2026-07-27T00:00:00.000Z",
      source: "phase",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        empoweredId: "empowered",
        offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
      },
    };
    await insertCanonicalEventRows(db, gameId, ownerEpoch, [formatEvidence]);

    const readModel = new ProductionGameMcpReadModel(db);
    const resolved = await readModel.resolveGame(gameId);
    expect(resolved).not.toBeNull();
    expect(resolved).toMatchObject({
      gameKernel: "classic",
      gameKernelSource: "stored",
      gameKernelDiagnostics: [{
        code: "stored_kernel_event_contradiction",
        storedKernel: "classic",
        evidenceKernel: "format",
        eventType: "format.menu_offered",
        sequence: 1,
      }],
    });

    const listed = await readModel.listGames(PRODUCER_ACCESS, 100);
    expect(
      listed.canonicalGameFacts.games.find((game) => game.id === gameId)
        ?.gameKernelDiagnostics,
    ).toEqual(resolved!.gameKernelDiagnostics);

    const projection = await readModel.readProjection(gameId, PRODUCER_ACCESS);
    expect(projection.game.gameKernelDiagnostics).toEqual(
      resolved!.gameKernelDiagnostics,
    );

    const roundFacts = await readModel.readRoundFacts(
      { gameIdOrSlug: gameId, round: 1 },
      PRODUCER_ACCESS,
    );
    expect(roundFacts.schemaVersion).toBe(2);
    expect(roundFacts.game.gameKernelDiagnostics).toEqual(
      resolved!.gameKernelDiagnostics,
    );
    expect(JSON.stringify(roundFacts)).not.toContain("sourcePointers");
  });

  test("blocks producer event visibility for games-scope reads", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xgamescope000000000000000000000000000003",
    });
    const gameId = await insertGame(db, { slug: "visibility-scope" });
    await insertGamePlayer(db, { gameId, userId });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    const allianceEvent: CanonicalGameEvent = {
      sequence: events.length + 1,
      gameId,
      round: 1,
      phase: Phase.PRE_VOTE_HUDDLE,
      type: "alliance.huddle_outcome_recorded",
      timestamp: "2026-06-11T00:00:10.000Z",
      source: "engine",
      visibility: "producer",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        outcome: {
          id: "outcome-glass",
          sessionId: "session-glass",
          allianceId: "alliance-glass",
          window: "pre_vote",
          round: 1,
          ask: "Align before the public Vote.",
          plan: "Glass Table agrees to keep the plan hidden.",
          promises: [],
          dissent: [],
          confidence: "medium",
          posture: "coordinating",
          leakOrBetrayalClaims: [],
          createdAt: "2026-06-11T00:00:10.000Z",
        },
      },
    };
    await appendGameEvents(db, { gameId, ownerEpoch, events: [...events, allianceEvent] });

    const readModel = new ProductionGameMcpReadModel(db);
    const gamesAccess = {
      userId,
      authProfile: "subject" as const,
    };
    await expect(readModel.filterEvents({
      gameIdOrSlug: gameId,
      visibilityMode: "producer",
    }, gamesAccess)).rejects.toThrow("producer visibility requires MCP scope: producer");

    const playerSafeEvents = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "alliance.huddle_outcome_recorded",
    }, gamesAccess);
    expect(playerSafeEvents.canonicalGameFacts.events).toEqual([]);

    const producerEvents = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: "alliance.huddle_outcome_recorded",
    }, PRODUCER_ACCESS);
    expect(producerEvents.canonicalGameFacts.events).toHaveLength(1);
    expect(JSON.stringify(playerSafeEvents)).not.toContain("Glass Table");
  });

  test("reads owner-scoped named alliance facts without leaking non-member huddles", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xallianceowner000000000000000000000000001",
    });
    const gameId = await insertGame(db, {
      slug: "agent-alliances",
      status: "in_progress",
    });
    const alice = await insertGamePlayer(db, { gameId, userId, name: "Alice" });
    const bob = await insertGamePlayer(db, { gameId, name: "Bob" });
    const cara = await insertGamePlayer(db, { gameId, name: "Cara" });
    const dax = await insertGamePlayer(db, { gameId, name: "Dax" });

    const state = new GameState([
      { id: alice, name: "Alice" },
      { id: bob, name: "Bob" },
      { id: cara, name: "Cara" },
      { id: dax, name: "Dax" },
    ], { gameId, now: fixedClock() });
    state.startRound();
    const ab = state.recordAllianceProposal({
      lineageId: "lineage-ab",
      allianceId: "alliance-ab",
      versionId: "version-ab",
      proposerId: alice,
      name: "Back Row Pair",
      memberIds: [alice, bob],
      purpose: "Vote together before the first ballot.",
      timebox: "Until first ballot",
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: ab.versionId,
      playerId: bob,
      response: "accepted",
    }, { phase: Phase.MINGLE_I });

    const ac = state.recordAllianceProposal({
      lineageId: "lineage-ac",
      allianceId: "alliance-ac",
      versionId: "version-ac",
      proposerId: cara,
      name: "Smoke Test Pair",
      memberIds: [cara, alice, bob],
      purpose: "Compare reads without promising a vote.",
      timebox: "One round",
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceResponse({
      lineageId: "lineage-ac",
      versionId: ac.versionId,
      playerId: alice,
      response: "trial",
    }, { phase: Phase.MINGLE_I });
    state.expireAllianceProposal("lineage-ac", { phase: Phase.MINGLE_I });

    const cd = state.recordAllianceProposal({
      lineageId: "lineage-cd",
      allianceId: "alliance-cd",
      versionId: "version-cd",
      proposerId: cara,
      name: "Off Camera Pair",
      memberIds: [cara, dax],
      purpose: "Hide from Alice.",
      timebox: "One round",
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceResponse({
      lineageId: "lineage-cd",
      versionId: cd.versionId,
      playerId: dax,
      response: "accepted",
    }, { phase: Phase.MINGLE_I });

    state.recordAllianceHuddleCompleted({
      id: "session-ab",
      scheduleId: "schedule-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: 1,
      pass: 1,
      speakerIds: [alice, bob],
      completedAt: "2026-06-14T00:01:00.000Z",
    });
    state.recordAllianceHuddleOutcome({
      id: "outcome-ab",
      sessionId: "session-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: 1,
      ask: "Vote with Bob.",
      plan: "Alice and Bob agree to test Cara as the first vote.",
      promises: ["Alice backs Bob publicly."],
      dissent: [],
      confidence: "high",
      posture: "coordinating",
      leakOrBetrayalClaims: [],
      commitments: [{
        speakerId: alice,
        speakerName: "Alice",
        proposedTargetName: "Cara",
        noTargetReason: null,
        proposedAction: "Vote Cara if the active format permits it.",
        memberCommitments: [{ memberName: "Bob", commitment: "Bob will compare the legal ballot." }],
        contingency: "Re-evaluate if Cara earns immunity.",
        confidence: "high",
        dissent: ["Bob prefers Dax if Cara is unavailable."],
        alternativePlan: "Vote Dax only if Cara is unavailable.",
      }],
      createdAt: "2026-06-14T00:01:05.000Z",
    });
    state.recordAllianceHuddleCompleted({
      id: "session-cd",
      scheduleId: "schedule-cd",
      allianceId: "alliance-cd",
      window: "pre_vote",
      round: 1,
      pass: 1,
      speakerIds: [cara, dax],
      completedAt: "2026-06-14T00:01:10.000Z",
    });
    state.recordAllianceHuddleOutcome({
      id: "outcome-cd",
      sessionId: "session-cd",
      allianceId: "alliance-cd",
      window: "pre_vote",
      round: 1,
      ask: "Keep Alice out.",
      plan: "Cara and Dax target Alice quietly.",
      promises: ["Do not tell Alice."],
      dissent: [],
      confidence: "medium",
      posture: "coordinating",
      leakOrBetrayalClaims: [],
      createdAt: "2026-06-14T00:01:15.000Z",
    });

    const ownerEpoch = await insertOwner(db, gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events: state.getCanonicalEvents() });
    await db.insert(schema.transcripts).values([
      {
        gameId,
        round: 1,
        phase: Phase.PRE_VOTE_HUDDLE,
        fromPlayerId: alice,
        scope: "huddle",
        toPlayerIds: JSON.stringify([bob]),
        text: "Bob, I can vote Cara if you hold the line.",
        thinking: "I need Bob to feel this was his idea.",
        timestamp: 1,
      },
      {
        gameId,
        round: 1,
        phase: Phase.PRE_VOTE_HUDDLE,
        fromPlayerId: cara,
        scope: "huddle",
        toPlayerIds: JSON.stringify([dax]),
        text: "Dax, Alice never sees this.",
        thinking: "Alice is outside this plan.",
        timestamp: 2,
      },
    ]);

    const readModel = new ProductionGameMcpReadModel(db);
    const result = await readModel.readAgentAlliances({ gameIdOrSlug: "agent-alliances" }, {
      userId,
      authProfile: "subject",
    });

    expect(result.availability.status).toBe("available");
    expect(result.detailLevel).toBe("compact");
    expect(result.player).toMatchObject({ id: alice, name: "Alice" });
    expect(result.allianceFacts?.summary).toMatchObject({
      proposalCount: 2,
      activeAllianceCount: 1,
      huddleCount: 1,
      latestHuddleRound: 1,
    });
    expect(result.allianceFacts?.proposals.map((proposal) => proposal.name).sort()).toEqual([
      "Back Row Pair",
      "Smoke Test Pair",
    ]);
    expect(result.allianceFacts?.proposals.find((proposal) => proposal.name === "Smoke Test Pair")).toMatchObject({
      status: "expired",
      yourResponse: "trial",
    });
    expect(result.allianceFacts?.proposals.find((proposal) => proposal.name === "Back Row Pair")).toMatchObject({
      status: "activated",
      resolvedRound: 1,
      finalResult: "activated",
    });
    expect(result.allianceFacts?.alliances.map((alliance) => alliance.name)).toEqual(["Back Row Pair"]);
    expect(result.allianceFacts?.huddles).toHaveLength(1);
    expect(result.allianceFacts?.huddles[0]).toMatchObject({
      allianceName: "Back Row Pair",
      messageCount: 1,
      outcomeSummary: {
        plan: "Alice and Bob agree to test Cara as the first vote.",
      },
    });
    expect(JSON.stringify(result.allianceFacts?.huddles[0])).not.toContain("messages");
    expect(JSON.stringify(result.allianceFacts?.huddles[0])).not.toContain("thinking");
    expect(JSON.stringify(result.allianceFacts)).not.toContain("Bob will compare the legal ballot.");

    const fullResult = await readModel.readAgentAlliances({ gameIdOrSlug: "agent-alliances", detailLevel: "full" }, {
      userId,
      authProfile: "subject",
    });

    expect(fullResult.detailLevel).toBe("full");
    expect(fullResult.allianceFacts?.huddles[0]).toMatchObject({
      allianceName: "Back Row Pair",
      messages: [{
        text: "Bob, I can vote Cara if you hold the line.",
        thinking: "I need Bob to feel this was his idea.",
      }],
      outcome: {
        plan: "Alice and Bob agree to test Cara as the first vote.",
        commitments: [{
          proposedTargetName: "Cara",
          proposedAction: "Vote Cara if the active format permits it.",
          dissent: ["Bob prefers Dax if Cara is unavailable."],
        }],
      },
    });

    const producerResult = await readModel.readAgentAlliances({
      gameIdOrSlug: "agent-alliances",
      player: "Alice",
      detailLevel: "full",
    }, PRODUCER_ACCESS);
    expect(producerResult.allianceFacts?.huddles[0]).toMatchObject({
      outcome: {
        commitments: [expect.objectContaining({
          proposedTargetName: "Cara",
          memberCommitments: [{ memberName: "Bob", commitment: "Bob will compare the legal ballot." }],
        })],
      },
    });

    const selectedByName = await readModel.readAgentAlliances({ gameIdOrSlug: "agent-alliances", player: "aLiCe" }, {
      userId,
      authProfile: "subject",
    });

    expect(selectedByName.availability.status).toBe("available");
    expect(selectedByName.player).toMatchObject({ id: alice, name: "Alice" });

    const unauthorizedByName = await readModel.readAgentAlliances({ gameIdOrSlug: "agent-alliances", player: "Bob" }, {
      userId,
      authProfile: "subject",
    });

    expect(unauthorizedByName.availability.status).toBe("agent_not_authorized");
    expect(unauthorizedByName.allianceFacts).toBeUndefined();
    expect(unauthorizedByName.availability.diagnostics[0]?.message).toContain("not authorized");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Off Camera Pair");
    expect(serialized).not.toContain("Alice never sees this");
    expect(serialized).not.toContain("Alice is outside this plan");
    expect(serialized).not.toContain("Bob, I can vote Cara if you hold the line.");
    expect(serialized).not.toContain("I need Bob to feel this was his idea.");
    expect(serialized).not.toContain("sourcePointers");
    expect(serialized).not.toContain("reasoning");

    const filtered = await readModel.filterEvents({ gameIdOrSlug: "agent-alliances", actor: "Alice" }, {
      userId,
      authProfile: "subject",
    });
    expect(filtered.canonicalGameFacts.allianceContext?.summary.proposalCount).toBe(2);
    expect(JSON.stringify(filtered.canonicalGameFacts.allianceContext)).not.toContain("messages");

    const timeline = await readModel.playerTimeline({ gameIdOrSlug: "agent-alliances", player: "Alice" }, {
      userId,
      authProfile: "subject",
    });
    expect(timeline.canonicalGameFacts.allianceTimeline?.alliances[0]).toMatchObject({
      name: "Back Row Pair",
      huddleOutcomeCount: 1,
    });
  });

  test("filters Judgment closing speeches by phase for public and producer visibility", async () => {
    const gameId = await insertGame(db, {
      slug: "mcp-judgment-speech-filter",
      status: "completed",
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const base = createCanonicalEventFixture(gameId);
    const last = base.at(-1)!;
    const closings: CanonicalGameEvent[] = [
      {
        sequence: last.sequence + 1,
        gameId,
        round: 2,
        phase: Phase.CLOSING_ARGUMENTS,
        type: "judgment.speech_recorded",
        timestamp: "2026-06-20T00:00:10.000Z",
        source: "engine",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          speechKind: "closing_argument",
          playerId: "atlas",
          text: "My game was clean and earned.",
          provenance: "agent",
        },
      },
      {
        sequence: last.sequence + 2,
        gameId,
        round: 2,
        phase: Phase.CLOSING_ARGUMENTS,
        type: "judgment.speech_recorded",
        timestamp: "2026-06-20T00:00:11.000Z",
        source: "engine",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          speechKind: "closing_argument",
          playerId: "echo",
          text: "Vote for the social game.",
          provenance: "timeout",
        },
      },
    ];
    await appendGameEvents(db, { gameId, ownerEpoch, events: [...base, ...closings] });

    const readModel = new ProductionGameMcpReadModel(db);
    const producer = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      phase: Phase.CLOSING_ARGUMENTS,
      visibilityMode: "producer",
    }, PRODUCER_ACCESS);
    expect(producer.canonicalGameFacts.events).toHaveLength(2);
    expect(producer.canonicalGameFacts.events.every((row) => row.eventType === "judgment.speech_recorded")).toBe(true);
    expect(JSON.stringify(producer.canonicalGameFacts.events)).toContain("My game was clean and earned.");
    expect(JSON.stringify(producer.canonicalGameFacts.events)).not.toContain("thinking");

    const publicMode = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      phase: Phase.CLOSING_ARGUMENTS,
      visibilityMode: "public",
    }, PRODUCER_ACCESS);
    expect(publicMode.canonicalGameFacts.events).toHaveLength(2);
  });

  test("requires an explicit agent selector when a user owns multiple players in a game", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xallianceowner000000000000000000000000002",
    });
    const gameId = await insertGame(db, { slug: "agent-alliances-ambiguous" });
    const first = await insertGamePlayer(db, { gameId, userId, name: "First" });
    const second = await insertGamePlayer(db, { gameId, userId, name: "Second" });

    const readModel = new ProductionGameMcpReadModel(db);
    const result = await readModel.readAgentAlliances({ gameIdOrSlug: gameId }, {
      userId,
      authProfile: "subject",
    });

    expect(result.availability.status).toBe("agent_ambiguous");
    expect(result.selectablePlayers?.map((player) => player.id).sort()).toEqual([first, second].sort());
  });

  test("requires an explicit selector when player name matches multiple visible players", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xallianceowner000000000000000000000000003",
    });
    const gameId = await insertGame(db, { slug: "agent-alliances-duplicate-name" });
    const first = await insertGamePlayer(db, { gameId, userId, name: "Echo" });
    const second = await insertGamePlayer(db, { gameId, userId, name: "echo" });

    const readModel = new ProductionGameMcpReadModel(db);
    const result = await readModel.readAgentAlliances({ gameIdOrSlug: gameId, player: "ECHO" }, {
      userId,
      authProfile: "subject",
    });

    expect(result.availability.status).toBe("agent_ambiguous");
    expect(result.selectablePlayers?.map((player) => player.id).sort()).toEqual([first, second].sort());
  });

  test("reads and searches private trace evidence through DB manifests and storage", async () => {
    const gameId = await insertGame(db, { slug: "mcp-private-trace" });
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();
    const decisionId = randomUUID();
    const manifestId = await insertPrivateTraceManifest(db, storage, {
      gameId,
      ownerEpoch,
      decisionId,
      body: JSON.stringify({
        reasoningContext: "the secret plan is to shield Mira",
        toolArguments: { expose: "Vera" },
      }),
    });

    const readModel = new ProductionGameMcpReadModel(
      db,
      new PrivateTraceReadModel(db, () => storage),
    );

    await expect(readModel.listTraceManifests(gameId, {
      userId: randomUUID(),
      authProfile: "subject",
    })).rejects.toThrow("Producer-only MCP evidence requires MCP scope: producer");

    const manifests = await readModel.listTraceManifests(gameId, PRODUCER_ACCESS);
    expect(asRecord(manifests.developerEvidence)).toMatchObject({
      gameId,
      totalCount: 1,
      linkageSummary: {
        trustedCanonicalPrefixStatus: "empty",
        eligibleAcceptedDecisionCount: 0,
        linkedAcceptedDecisionCount: 0,
        degradedAcceptedDecisionCount: 0,
        intentionallyUnlinkedTraceCount: 1,
        unclassifiedTraceCount: 0,
      },
      manifests: [{
        id: manifestId,
        gameId,
        decisionId,
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "vote",
        phase: "VOTE",
      }],
    });

    const content = await readModel.readTraceContent({
      manifestId,
      gameId,
      maxBytes: 1024,
    }, PRODUCER_ACCESS);
    expect(asRecord(content.privateReasoning)).toMatchObject({
      ok: true,
      response: {
        manifest: { id: manifestId, gameId },
        content: expect.stringContaining("the secret plan"),
        contentType: PRIVATE_TRACE_CONTENT_TYPE,
      },
    });

    const cappedContent = await readModel.readTraceContent({
      manifestId,
      gameId,
      maxBytes: 24,
    }, PRODUCER_ACCESS);
    expect(asRecord(cappedContent.privateReasoning)).toMatchObject({
      ok: true,
      response: {
        manifest: { id: manifestId, gameId },
        returnedByteLength: 24,
        truncated: true,
      },
    });

    const search = await readModel.searchReasoningTraces({
      gameIdOrSlug: "mcp-private-trace",
      query: "secret plan",
    }, PRODUCER_ACCESS);
    expect(asRecord(search.privateReasoning)).toMatchObject({
      gameId,
      matches: [{
        manifestId,
        gameId,
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "vote",
        preview: expect.stringContaining("secret plan"),
      }],
    });

    const wrongGameRead = await readModel.readTraceContent({
      manifestId,
      gameId: "not-this-game",
    }, PRODUCER_ACCESS);
    expect(asRecord(wrongGameRead.privateReasoning)).toMatchObject({
      ok: false,
      status: "not_found",
    });
  });

  test("producer trace pagination exhausts equal timestamps exactly once and rejects foreign cursors", async () => {
    const gameId = await insertGame(db, { slug: "mcp-private-trace-pages" });
    const otherGameId = await insertGame(db, { slug: "mcp-private-trace-pages-other" });
    const ownerEpoch = await insertOwner(db, gameId);
    await insertOwner(db, otherGameId);
    const storage = new FakePrivateTraceStorage();
    const expectedIds: string[] = [];
    for (let index = 0; index < 13; index++) {
      expectedIds.push(await insertPrivateTraceManifest(db, storage, {
        gameId,
        ownerEpoch,
        decisionId: randomUUID(),
        body: JSON.stringify({ index }),
        createdAt: "2026-08-19T12:00:00.000Z",
      }));
    }

    const readModel = new ProductionGameMcpReadModel(
      db,
      new PrivateTraceReadModel(db, () => storage),
    );
    const first = await readModel.listTraceManifests(gameId, PRODUCER_ACCESS, 2);
    const firstPage = asRecord(first.developerEvidence);
    const firstCursor = firstPage.nextCursor;
    expect(first.schemaVersion).toBe(2);
    expect(firstPage).toMatchObject({
      ok: true,
      pageSize: 2,
      totalCount: expectedIds.length,
    });
    expect(typeof firstCursor).toBe("string");
    if (typeof firstCursor !== "string") throw new Error("Expected trace pagination cursor");
    const firstLinkageSummary = firstPage.linkageSummary;

    const lateManifestId = "00000000-0000-4000-8000-000000000002";
    await insertPrivateTraceManifest(db, storage, {
      id: lateManifestId,
      gameId,
      ownerEpoch,
      decisionId: randomUUID(),
      body: JSON.stringify({ insertedAfterFirstPage: true }),
      createdAt: "2026-08-19T12:00:00.000Z",
    });

    const tampered = `${firstCursor.slice(0, -1)}${firstCursor.endsWith("a") ? "b" : "a"}`;
    expect(asRecord((await readModel.listTraceManifests(
      gameId,
      PRODUCER_ACCESS,
      2,
      tampered,
    )).developerEvidence)).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });
    expect(asRecord((await readModel.listTraceManifests(
      otherGameId,
      PRODUCER_ACCESS,
      2,
      firstCursor,
    )).developerEvidence)).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });
    expect(asRecord((await readModel.listTraceManifests(
      randomUUID(),
      PRODUCER_ACCESS,
      2,
      firstCursor,
    )).developerEvidence)).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });
    expect(asRecord((await readModel.listTraceManifests(
      gameId,
      { userId: "another-producer", authProfile: "producer" },
      2,
      firstCursor,
    )).developerEvidence)).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });
    await expect(readModel.listTraceManifests(gameId, {
      userId: randomUUID(),
      authProfile: "subject",
    }, 2, firstCursor)).rejects.toThrow("Producer-only MCP evidence requires MCP scope: producer");

    const seen = (firstPage.manifests as Array<{ id: string }>).map((manifest) => manifest.id);
    let cursor: string | null = firstCursor;
    let pageIndex = 0;
    const pageSizes = [1, 5, 3];
    while (cursor) {
      const response = await readModel.listTraceManifests(
        gameId,
        PRODUCER_ACCESS,
        pageSizes[pageIndex % pageSizes.length],
        cursor,
      );
      const page = asRecord(response.developerEvidence);
      expect(page).toMatchObject({ ok: true, totalCount: expectedIds.length });
      expect(page.linkageSummary).toEqual(firstLinkageSummary);
      const manifests = page.manifests as Array<{ id: string }>;
      expect(page.pageSize).toBe(manifests.length);
      seen.push(...manifests.map((manifest) => manifest.id));
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
      pageIndex += 1;
    }

    expect(seen).toHaveLength(expectedIds.length);
    expect(new Set(seen).size).toBe(expectedIds.length);
    expect([...seen].sort()).toEqual([...expectedIds].sort());
    expect(seen).not.toContain(lateManifestId);
  });

  test("trace linkage summary excludes canonical events committed after its manifest snapshot", async () => {
    const gameId = await insertGame(db, { slug: "mcp-private-trace-linkage-snapshot" });
    const ownerEpoch = await insertOwner(db, gameId);
    const lockAcquired = Promise.withResolvers<void>();
    const releaseLock = Promise.withResolvers<void>();
    const locker = db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE game_evidence_manifests IN ACCESS EXCLUSIVE MODE`);
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;

    const readModel = new PrivateTraceReadModel(db, () => new FakePrivateTraceStorage());
    const listing = readModel.listManifests(gameId);
    await waitForBlockedTraceManifestRead(db);
    const decisionId = randomUUID();
    await appendGameEvents(db, {
      gameId,
      ownerEpoch,
      events: [{
        sequence: 1,
        gameId,
        round: 1,
        phase: Phase.VOTE,
        type: "vote.cast",
        timestamp: "2026-08-19T12:00:00.000Z",
        source: "engine",
        visibility: "producer",
        payloadVersion: 1,
        sourcePointers: [{
          kind: "agent_turn",
          actorId: "atlas",
          action: "vote",
          round: 1,
          phase: Phase.VOTE,
          decisionId,
        }],
        payload: {
          voterId: "atlas",
          empowerTarget: "mira",
          exposeTarget: "echo",
        },
      }],
    });
    releaseLock.resolve();
    await locker;

    const sealed = await listing;
    expect(sealed).toMatchObject({
      ok: true,
      totalCount: 0,
      linkageSummary: {
        trustedCanonicalPrefixStatus: "empty",
        eligibleAcceptedDecisionCount: 0,
        degradedAcceptedDecisionCount: 0,
      },
    });
    const fresh = await readModel.listManifests(gameId);
    expect(fresh).toMatchObject({
      ok: true,
      totalCount: 0,
      linkageSummary: {
        trustedCanonicalPrefixStatus: "complete",
        eligibleAcceptedDecisionCount: 1,
        degradedAcceptedDecisionCount: 1,
      },
    });
  });
});

async function waitForBlockedTraceManifestRead(db: DrizzleDB): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await db.execute<{ waiting: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query LIKE '%game_evidence_manifests%'
          AND query LIKE 'select%'
      ) AS waiting
    `);
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the trace manifest read to block on the table lock");
}

async function insertEdgeSmokeDuskFixture(db: DrizzleDB): Promise<void> {
  const userId = "user-lilith";
  const agentProfileId = "agent-lilith";
  await db.insert(schema.users).values({
    id: userId,
    email: "lilith@test.example",
    displayName: "Lilith Owner",
  });
  await db.insert(schema.agentProfiles).values({
    id: agentProfileId,
    userId,
    name: EDGE_SMOKE_DUSK_PLAYERS.lilith.name,
    personality: "Precise and socially patient.",
    personaKey: "strategic",
  });
  const gameId = await insertGame(db, {
    id: EDGE_SMOKE_DUSK_GAME_ID,
    slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
    status: "completed",
    config: {
      maxRounds: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
      visibility: "public",
      viewerMode: "speedrun",
    },
  });
  await db.update(schema.games)
    .set({ endedAt: "2026-07-01T00:00:00.000Z" })
    .where(eq(schema.games.id, gameId));
  await db.insert(schema.gamePlayers).values(Object.values(EDGE_SMOKE_DUSK_PLAYERS).map((player) => ({
    id: player.id,
    gameId,
    userId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id ? userId : null,
    agentProfileId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id ? agentProfileId : null,
    persona: JSON.stringify({
      name: player.name,
      personality: `${player.name} fixture persona`,
      personaKey: "strategic",
    }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  })));
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
    roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
    tokenUsage: JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }),
    finishedAt: "2026-07-01T00:00:00.000Z",
  });
  const ownerEpoch = await insertOwner(db, gameId);
  await appendGameEvents(db, {
    gameId,
    ownerEpoch,
    events: createEdgeSmokeDuskEvents(gameId),
  });
}

type PersistedFormatFixtureId =
  | "save_or_eliminate"
  | "vote_bomb"
  | "safety_bounce"
  | "safety_bounce_sole_vulnerable";

async function insertFormatFixturePlayers(db: DrizzleDB, gameId: string): Promise<void> {
  await db.insert(schema.gamePlayers).values(persistedFormatFixturePlayers(gameId).map((player) => ({
    ...player,
    gameId,
    persona: JSON.stringify({ name: player.name, personality: "persisted format fixture" }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  })));
}

function createPersistedFormatFixtureEvents(
  gameId: string,
  fixtureId: PersistedFormatFixtureId,
): readonly CanonicalGameEvent[] {
  const fixturePlayers = persistedFormatFixturePlayers(gameId);
  const players = fixtureId === "safety_bounce_sole_vulnerable"
    ? fixturePlayers.slice(0, 3)
    : fixturePlayers;
  const state = new GameState([...players], { gameId, now: fixedClock() });
  const [atlas, bob, cara, dax] = fixturePlayers;
  if (!atlas || !bob || !cara || !dax) throw new Error("Expected persisted format fixture players");

  state.startRound();
  for (const player of players) {
    state.recordVote(player.id, atlas.id, bob.id);
  }
  const { empowered } = state.tallyEmpowerVotes();

  const selectedFormat = fixtureId === "safety_bounce_sole_vulnerable"
    ? "safety_bounce"
    : fixtureId;
  const offeredFormatIds: [LaunchFormatId, LaunchFormatId] = selectedFormat === "save_or_eliminate"
    ? ["save_or_eliminate", "vote_bomb"]
    : selectedFormat === "vote_bomb"
      ? ["vote_bomb", "safety_bounce"]
      : ["safety_bounce", "save_or_eliminate"];
  state.recordFormatMenu(empowered, offeredFormatIds);
  state.recordFormatSelected(empowered, selectedFormat, [
    persistedFormatSourcePointer(empowered, "format-pick"),
  ]);

  if (selectedFormat === "save_or_eliminate") {
    state.recordFormatBallot({
      formatId: selectedFormat,
      voterId: atlas.id,
      targetId: bob.id,
      polarity: "eliminate",
    }, [persistedFormatSourcePointer(atlas.id, "format-save-or-eliminate-ballot")]);
    state.recordFormatBallot({
      formatId: selectedFormat,
      voterId: bob.id,
      targetId: cara.id,
      polarity: "save",
    }, [persistedFormatSourcePointer(bob.id, "format-save-or-eliminate-ballot")]);
    state.recordFormatBallot({
      formatId: selectedFormat,
      voterId: cara.id,
      targetId: bob.id,
      polarity: "eliminate",
    }, [persistedFormatSourcePointer(cara.id, "format-save-or-eliminate-ballot")]);
    state.recordFormatBallot({
      formatId: selectedFormat,
      voterId: dax.id,
      targetId: bob.id,
      polarity: "eliminate",
    }, [persistedFormatSourcePointer(dax.id, "format-save-or-eliminate-ballot")]);
    state.recordFormatResolution({
      formatId: selectedFormat,
      empoweredId: empowered,
      eliminatedId: bob.id,
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: {
        nets: { [atlas.id]: 0, [bob.id]: -3, [cara.id]: 1, [dax.id]: 0 },
        savesReceived: { [atlas.id]: 0, [bob.id]: 0, [cara.id]: 1, [dax.id]: 0 },
        eliminateReceived: { [atlas.id]: 0, [bob.id]: 3, [cara.id]: 0, [dax.id]: 0 },
      },
      voteBomb: null,
      safetyBounce: null,
    });
    return state.getCanonicalEvents();
  }

  if (selectedFormat === "vote_bomb") {
    state.recordFormatBallot({ formatId: selectedFormat, voterId: atlas.id, targetId: bob.id }, [
      persistedFormatSourcePointer(atlas.id, "format-vote-bomb-ballot"),
    ]);
    state.recordFormatBallot({ formatId: selectedFormat, voterId: bob.id, targetId: cara.id }, [
      persistedFormatSourcePointer(bob.id, "format-vote-bomb-ballot"),
    ]);
    state.recordFormatBallot({ formatId: selectedFormat, voterId: cara.id, targetId: bob.id }, [
      persistedFormatSourcePointer(cara.id, "format-vote-bomb-ballot"),
    ]);
    state.recordFormatBallot({ formatId: selectedFormat, voterId: dax.id, targetId: bob.id }, [
      persistedFormatSourcePointer(dax.id, "format-vote-bomb-ballot"),
    ]);
    state.recordFormatResolution({
      formatId: selectedFormat,
      empoweredId: empowered,
      eliminatedId: cara.id,
      resolutionKind: "auto",
      tiedPlayerIds: [cara.id],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: {
        totals: { [atlas.id]: 0, [bob.id]: 3, [cara.id]: 1, [dax.id]: 0 },
        zeroSafePlayerIds: [atlas.id, dax.id],
      },
      safetyBounce: null,
    });
    return state.getCanonicalEvents();
  }

  state.recordSafetyBounceStarted(atlas.id);
  state.recordSafetyBouncePointer(atlas.id, bob.id, "vulnerable", [
    persistedFormatSourcePointer(atlas.id, "bounce-pointer"),
  ]);
  state.recordSafetyBouncePointer(bob.id, cara.id, "safe", [
    persistedFormatSourcePointer(bob.id, "bounce-pointer"),
  ]);

  if (fixtureId === "safety_bounce_sole_vulnerable") {
    state.recordFormatResolution({
      formatId: selectedFormat,
      empoweredId: empowered,
      eliminatedId: bob.id,
      resolutionKind: "auto",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: null,
      safetyBounce: {
        starterId: atlas.id,
        safePlayerIds: [atlas.id, cara.id],
        vulnerablePlayerIds: [bob.id],
        voteTotals: {},
      },
    });
    return state.getCanonicalEvents();
  }

  state.recordSafetyBouncePointer(cara.id, dax.id, "vulnerable", [
    persistedFormatSourcePointer(cara.id, "bounce-pointer"),
  ]);
  state.recordFormatBallot({ formatId: selectedFormat, voterId: atlas.id, targetId: dax.id }, [
    persistedFormatSourcePointer(atlas.id, "format-safety-bounce-vote"),
  ]);
  state.recordFormatBallot({ formatId: selectedFormat, voterId: bob.id, targetId: dax.id }, [
    persistedFormatSourcePointer(bob.id, "format-safety-bounce-vote"),
  ]);
  state.recordFormatBallot({ formatId: selectedFormat, voterId: cara.id, targetId: dax.id }, [
    persistedFormatSourcePointer(cara.id, "format-safety-bounce-vote"),
  ]);
  state.recordFormatBallot({ formatId: selectedFormat, voterId: dax.id, targetId: bob.id }, [
    persistedFormatSourcePointer(dax.id, "format-safety-bounce-vote"),
  ]);
  state.recordFormatResolution({
    formatId: selectedFormat,
    empoweredId: empowered,
    eliminatedId: dax.id,
    resolutionKind: "clear",
    tiedPlayerIds: [],
    tiebreakerId: null,
    saveOrEliminate: null,
    voteBomb: null,
    safetyBounce: {
      starterId: atlas.id,
      safePlayerIds: [atlas.id, cara.id],
      vulnerablePlayerIds: [bob.id, dax.id],
      voteTotals: { [bob.id]: 1, [dax.id]: 3 },
    },
  });
  return state.getCanonicalEvents();
}

function persistedFormatFixturePlayers(gameId: string) {
  return [
    { id: `${gameId}-format-atlas`, name: "Format Atlas" },
    { id: `${gameId}-format-bob`, name: "Format Bob" },
    { id: `${gameId}-format-cara`, name: "Format Cara" },
    { id: `${gameId}-format-dax`, name: "Format Dax" },
  ] as const;
}

function persistedFormatSourcePointer(
  actorId: string,
  action: "format-pick" | "format-save-or-eliminate-ballot" | "format-vote-bomb-ballot" | "format-safety-bounce-vote" | "bounce-pointer",
) {
  return {
    kind: "agent_turn" as const,
    decisionId: PRIVATE_DECISION_SENTINEL,
    actorId,
    action,
    phase: Phase.FORMAT_RESOLVE,
    round: 1,
  };
}

async function insertPrivateTraceManifest(
  db: DrizzleDB,
  storage: FakePrivateTraceStorage,
  params: {
    id?: string;
    gameId: string;
    ownerEpoch: string;
    decisionId?: string;
    body: string;
    createdAt?: string;
  },
): Promise<string> {
  const manifestId = params.id ?? randomUUID();
  const bucket = "private-trace-bucket";
  const key = `content/${params.gameId}/private-traces/test-${manifestId}.json`;
  const byteLength = Buffer.byteLength(params.body, "utf8");
  storage.setObject(bucket, key, params.body);

  await db.insert(schema.gameEvidenceManifests).values({
    id: manifestId,
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
    decisionId: params.decisionId,
    evidenceType: PRIVATE_TRACE_EVIDENCE_TYPE,
    retentionClass: "debug",
    accessScope: "producer_admin",
    redactionStatus: "active",
    storageProvider: PRIVATE_TRACE_STORAGE_PROVIDER,
    storageBucket: bucket,
    storageKey: key,
    metadata: {
      formatVersion: 2,
      contentType: PRIVATE_TRACE_CONTENT_TYPE,
      byteLength,
      recordCount: 1,
      sha256: sha256Text(params.body),
      actor: { id: "atlas", name: "Atlas", role: "player" },
      action: "vote",
      phase: "VOTE",
      round: 1,
      modelName: "gpt-5-nano",
    },
    ...(params.createdAt && { createdAt: params.createdAt }),
  });

  return manifestId;
}

function sha256Text(body: string): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as Record<string, unknown>;
}

async function insertGamePlayer(
  db: DrizzleDB,
  params: {
    gameId: string;
    userId?: string;
    agentProfileId?: string;
    name?: string;
  },
): Promise<string> {
  const playerId = randomUUID();
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId: params.gameId,
    userId: params.userId,
    agentProfileId: params.agentProfileId,
    persona: JSON.stringify({ name: params.name ?? "Test Player", personality: "careful" }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  });
  return playerId;
}

// ---------------------------------------------------------------------------
// U4 — stable authorized match transcript pagination
// ---------------------------------------------------------------------------

describe("ProductionGameMcpReadModel match transcript pagination (U4)", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    process.env.JWT_SECRET = CURSOR_SECRET;
  });

  test("page size 1 walks mixed public/private without gaps or duplicates", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 5 });
    const { gameId, userId, ownerPlayerId, peerPlayerId } = fixture;

    await db.insert(schema.transcripts).values([
      modernPublicRow(gameId, 1, "Public A", 1000),
      modernMingleRow(gameId, 2, {
        speakerPlayerId: ownerPlayerId,
        audiencePlayerIds: [ownerPlayerId, peerPlayerId],
        text: "Private mingle",
        timestamp: 1000, // identical timestamp
      }),
      modernPublicRow(gameId, 3, "Public B", 1000),
      modernMingleRow(gameId, 4, {
        speakerPlayerId: peerPlayerId,
        audiencePlayerIds: [peerPlayerId, "unrelated"],
        text: "Hidden other room",
        timestamp: 1001,
      }),
      modernPublicRow(gameId, 5, "Public C", 1002),
    ]);

    const readModel = new ProductionGameMcpReadModel(db);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = cursor
        ? await readMatchTranscriptPage(db, { gameIdOrSlug: gameId, cursor, limit: 1 }, {
            subjectUserId: userId,
            cursorSecret: CURSOR_SECRET,
          })
        : await readModel.readMatchTranscript(
            { gameIdOrSlug: gameId, limit: 1 },
            { userId, authProfile: "subject" },
          );
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      pages += 1;
      for (const entry of page.entries) {
        seen.push(`${entry.entrySequence}:${entry.text}`);
      }
      if (page.nextCursorKind === "catchup" || page.nextCursor == null) break;
      if (page.entries.length === 0) break;
      cursor = page.nextCursor ?? undefined;
      if (pages > 20) throw new Error("pagination did not terminate");
    }

    // Hidden seq 4 never appears; authorized 1,2,3,5 with no gaps/dupes.
    expect(seen).toEqual([
      "1:Public A",
      "2:Private mingle",
      "3:Public B",
      "5:Public C",
    ]);
    expect(JSON.stringify(seen)).not.toContain("Hidden");
  });

  test("concurrent appends do not change first walk; catch-up returns newer rows", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 2 });
    const { gameId, userId, ownerPlayerId } = fixture;

    await db.insert(schema.transcripts).values([
      modernPublicRow(gameId, 1, "First", 1),
      modernPublicRow(gameId, 2, "Second", 2),
    ]);

    const first = await readMatchTranscriptPage(db, { gameIdOrSlug: gameId, limit: 10 }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entries.map((e) => e.text)).toEqual(["First", "Second"]);
    expect(first.pageSize).toBe(first.entries.length);
    expect(first.nextCursorKind).toBe("catchup");
    expect(first.readThrough.throughEntrySequence).toBe(2);

    // Append beyond pinned watermark and advance durable state.
    await db.insert(schema.transcripts).values([
      modernPublicRow(gameId, 3, "Third after pin", 3),
      modernMingleRow(gameId, 4, {
        speakerPlayerId: ownerPlayerId,
        audiencePlayerIds: [ownerPlayerId],
        text: "Fourth after pin",
        timestamp: 4,
      }),
    ]);
    await db.update(schema.gameTranscriptStates).set({
      durableSequence: 4,
      durableCount: 4,
    }).where(eq(schema.gameTranscriptStates.gameId, gameId));

    // Re-walking without cursor still sees only new pin if we don't catch up —
    // first-page re-read pins current watermark 4.
    const fresh = await readMatchTranscriptPage(db, { gameIdOrSlug: gameId, limit: 10 }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.entries.map((e) => e.text)).toEqual([
      "First",
      "Second",
      "Third after pin",
      "Fourth after pin",
    ]);
    expect(fresh.pageSize).toBe(fresh.entries.length);

    // Catch-up from original first walk returns only rows after prior watermark.
    const catchup = await readMatchTranscriptPage(db, {
      gameIdOrSlug: gameId,
      cursor: first.nextCursor!,
      limit: 10,
    }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(catchup.ok).toBe(true);
    if (!catchup.ok) return;
    expect(catchup.entries.map((e) => e.text)).toEqual([
      "Third after pin",
      "Fourth after pin",
    ]);
    expect(catchup.pageSize).toBe(catchup.entries.length);

    const emptyCatchup = await readMatchTranscriptPage(db, {
      gameIdOrSlug: gameId,
      cursor: catchup.nextCursor!,
      limit: 10,
    }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(emptyCatchup.ok).toBe(true);
    if (!emptyCatchup.ok) return;
    expect(emptyCatchup.entries).toEqual([]);
    expect(emptyCatchup.pageSize).toBe(0);
  });

  test("cursor reuse with another game/subject/filter/ownership fails uniformly", async () => {
    const a = await seedModernOwnerGame(db, { watermark: 2, slug: "cursor-game-a" });
    const b = await seedModernOwnerGame(db, { watermark: 2, slug: "cursor-game-b" });
    // Seat user A into game B so game B is accessible but cursor game binding still fails.
    await insertGamePlayer(db, { gameId: b.gameId, userId: a.userId, name: "A-in-B" });
    // Seat user B into game A so subject mismatch is distinguishable from not_accessible.
    await insertGamePlayer(db, { gameId: a.gameId, userId: b.userId, name: "B-in-A" });

    await db.insert(schema.transcripts).values([
      modernPublicRow(a.gameId, 1, "A1", 1),
      modernPublicRow(a.gameId, 2, "A2", 2),
      modernPublicRow(b.gameId, 1, "B1", 1),
      modernPublicRow(b.gameId, 2, "B2", 2),
    ]);

    const pageA = await readMatchTranscriptPage(db, { gameIdOrSlug: a.gameId, limit: 1 }, {
      subjectUserId: a.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(pageA.ok).toBe(true);
    if (!pageA.ok) return;
    expect(pageA.nextCursor).toBeTruthy();
    const cursorA = pageA.nextCursor;
    if (!cursorA) return;

    // Wrong game (accessible, but cursor bound to A)
    const wrongGame = await readMatchTranscriptPage(db, {
      gameIdOrSlug: b.gameId,
      cursor: cursorA,
    }, {
      subjectUserId: a.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(wrongGame).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });

    // Wrong subject (B can access game A but ownership fingerprint differs)
    const wrongSubject = await readMatchTranscriptPage(db, {
      gameIdOrSlug: a.gameId,
      cursor: cursorA,
    }, {
      subjectUserId: b.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(wrongSubject).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });

    // Conflicting filter
    const wrongFilter = await readMatchTranscriptPage(db, {
      gameIdOrSlug: a.gameId,
      cursor: cursorA,
      phase: "VOTE",
    }, {
      subjectUserId: a.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(wrongFilter).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });
  });

  test("ownership change between pages invalidates cursor", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 3 });
    const { gameId, userId, ownerPlayerId } = fixture;
    await db.insert(schema.transcripts).values([
      modernPublicRow(gameId, 1, "One", 1),
      modernPublicRow(gameId, 2, "Two", 2),
      modernPublicRow(gameId, 3, "Three", 3),
    ]);

    const page1 = await readMatchTranscriptPage(db, { gameIdOrSlug: gameId, limit: 1 }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;

    // Transfer ownership off the subject mid-walk.
    await db.update(schema.gamePlayers)
      .set({ userId: null })
      .where(eq(schema.gamePlayers.id, ownerPlayerId));

    const page2 = await readMatchTranscriptPage(db, {
      gameIdOrSlug: gameId,
      cursor: page1.nextCursor!,
    }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    // No longer participating → denied or not_accessible (non-enumerating).
    expect(page2.ok).toBe(false);
    if (page2.ok) return;
    expect(["denied", "not_accessible", "cursor_invalid_or_stale"]).toContain(page2.status);
  });

  test("closed parser rejects unknown keys, bad enums, fractional limits, invalid timestamps", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 0 });
    const cases: Array<{ input: Record<string, unknown>; field?: string }> = [
      { input: { gameIdOrSlug: fixture.gameId, unknownField: true }, field: "unknownField" },
      { input: { gameIdOrSlug: fixture.gameId, scope: "diary" }, field: "scope" },
      { input: { gameIdOrSlug: fixture.gameId, limit: 1.5 }, field: "limit" },
      { input: { gameIdOrSlug: fixture.gameId, limit: 999 }, field: "limit" },
      { input: { gameIdOrSlug: fixture.gameId, fromTimestamp: "not-a-date" }, field: "fromTimestamp" },
      {
        input: {
          gameIdOrSlug: fixture.gameId,
          fromTimestamp: "2026-01-02T00:00:00.000Z",
          toTimestamp: "2026-01-01T00:00:00.000Z",
        },
        field: "fromTimestamp",
      },
      { input: { gameIdOrSlug: fixture.gameId, cursor: "x".repeat(5000) }, field: "cursor" },
    ];

    for (const c of cases) {
      const result = await readMatchTranscriptPage(db, c.input, {
        subjectUserId: fixture.userId,
        cursorSecret: CURSOR_SECRET,
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.status).toBe("invalid_input");
    }
  });

  test("player filter returns non-owned public speech but never private room dialogue", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 4 });
    const { gameId, userId, ownerPlayerId, peerPlayerId } = fixture;

    await db.insert(schema.transcripts).values([
      modernPublicRow(gameId, 1, "Peer public", 1, peerPlayerId),
      modernMingleRow(gameId, 2, {
        speakerPlayerId: peerPlayerId,
        audiencePlayerIds: [peerPlayerId, "other"],
        text: "Peer private room",
        timestamp: 2,
      }),
      modernMingleRow(gameId, 3, {
        speakerPlayerId: ownerPlayerId,
        audiencePlayerIds: [ownerPlayerId, peerPlayerId],
        text: "Shared mingle",
        timestamp: 3,
      }),
      modernPublicRow(gameId, 4, "Owner public", 4, ownerPlayerId),
    ]);

    const page = await readMatchTranscriptPage(db, {
      gameIdOrSlug: gameId,
      player: peerPlayerId,
      limit: 50,
    }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    const texts = page.entries.map((e) => e.text);
    // Player filter is speaker-scoped: peer public speech is visible; peer private room is not
    // even when the owner could not see it either. Shared mingle has owner as speaker so it
    // does not match the peer speaker filter. Owner public is excluded.
    expect(texts).toEqual(["Peer public"]);
    expect(texts).not.toContain("Peer private room");
    expect(texts).not.toContain("Shared mingle");
    expect(texts).not.toContain("Owner public");
    expect(JSON.stringify(page)).not.toContain("Peer private room");
  });

  test("Season 0 / capture v0 omits all system rows and reports version-wide limitation", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: `0x${userId.replace(/-/g, "").slice(0, 40)}`,
    });
    const gameId = await insertGame(db, { slug: "season0-legacy", status: "completed" });
    // leave transcriptCaptureVersion at 0
    const ownerPlayerId = await insertGamePlayer(db, { gameId, userId, name: "Owner" });
    const peerPlayerId = await insertGamePlayer(db, { gameId, name: "Peer" });

    await db.insert(schema.transcripts).values([
      {
        gameId,
        round: 1,
        phase: "LOBBY",
        fromPlayerId: null,
        scope: "system",
        text: "=== PHASE BANNER ===",
        timestamp: 1,
      },
      {
        gameId,
        round: 1,
        phase: "LOBBY",
        fromPlayerId: null,
        scope: "system",
        text: "timeout diagnostic internal",
        timestamp: 2,
      },
      {
        gameId,
        round: 1,
        phase: "LOBBY",
        fromPlayerId: "Owner",
        scope: "public",
        text: "Hello lobby",
        timestamp: 3,
      },
      {
        gameId,
        round: 1,
        phase: "VOTE",
        fromPlayerId: null,
        scope: "system",
        text: "viewer narration",
        timestamp: 4,
      },
      {
        gameId,
        round: 1,
        phase: "MINGLE_I",
        fromPlayerId: "Owner",
        scope: "mingle",
        toPlayerIds: JSON.stringify(["Peer"]),
        text: "Secret plan",
        timestamp: 5,
      },
    ]);

    const page = await readMatchTranscriptPage(db, { gameIdOrSlug: gameId, limit: 50 }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    expect(page.orderingQuality).toBe("deterministic_approximate");
    expect(page.limitations).toEqual([{
      code: "legacy_system_dialogue_unclassified",
      message: expect.stringContaining("Capture version 0"),
      scope: "capture_version",
    }]);
    expect(page.entries.every((e) => e.scope !== "system")).toBe(true);
    expect(page.entries.map((e) => e.text)).toEqual(["Hello lobby", "Secret plan"]);
    // No system-row counts anywhere.
    expect(JSON.stringify(page)).not.toContain("omittedCount");
    expect(JSON.stringify(page)).not.toContain("systemCount");
    void ownerPlayerId;
    void peerPlayerId;
  });

  test("legacy equal-timestamp fixtures remain deterministic across pages", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: `0x${userId.replace(/-/g, "").slice(0, 40)}`,
    });
    const gameId = await insertGame(db, { slug: "legacy-equal-ts", status: "completed" });
    await insertGamePlayer(db, { gameId, userId, name: "Owner" });

    const sameTs = 5_000;
    await db.insert(schema.transcripts).values([
      { gameId, round: 1, phase: "LOBBY", scope: "public", text: "A", timestamp: sameTs, fromPlayerId: "Owner" },
      { gameId, round: 1, phase: "LOBBY", scope: "public", text: "B", timestamp: sameTs, fromPlayerId: "Owner" },
      { gameId, round: 1, phase: "LOBBY", scope: "public", text: "C", timestamp: sameTs, fromPlayerId: "Owner" },
    ]);

    const texts: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await readMatchTranscriptPage(db, {
        gameIdOrSlug: gameId,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      }, {
        subjectUserId: userId,
        cursorSecret: CURSOR_SECRET,
      });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.orderingQuality).toBe("deterministic_approximate");
      texts.push(...page.entries.map((e) => e.text));
      if (!page.nextCursor || page.nextCursorKind == null) break;
      cursor = page.nextCursor;
    }
    expect(texts).toEqual(["A", "B", "C"]);
  });

  test("high hidden-row density does not create empty intermediate pages", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 20 });
    const { gameId, userId, ownerPlayerId } = fixture;

    const rows = [];
    for (let i = 1; i <= 20; i++) {
      if (i % 5 === 0) {
        rows.push(modernPublicRow(gameId, i, `Visible ${i}`, i, ownerPlayerId));
      } else {
        rows.push(modernMingleRow(gameId, i, {
          speakerPlayerId: "foreign-a",
          audiencePlayerIds: ["foreign-a", "foreign-b"],
          text: `Hidden ${i}`,
          timestamp: i,
        }));
      }
    }
    await db.insert(schema.transcripts).values(rows);

    const page = await readMatchTranscriptPage(db, { gameIdOrSlug: gameId, limit: 2 }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    // First page should contain authorized rows, not empty due to hidden density.
    expect(page.entries.length).toBe(2);
    expect(page.entries.every((e) => e.text.startsWith("Visible"))).toBe(true);
    expect(page.entries.length).not.toBe(0);
  });

  test("DTO sanitization excludes thinking and forbidden keys recursively", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 1 });
    const { gameId, userId, ownerPlayerId } = fixture;

    await db.insert(schema.transcripts).values([{
      ...modernPublicRow(gameId, 1, "Said aloud", 1, ownerPlayerId),
      thinking: "NEVER LEAK THIS THINKING",
      roomMetadata: JSON.stringify({ diagnostic: "secret room allocation" }),
      safeContext: {
        version: 1,
        decisionId: PRIVATE_DECISION_SENTINEL,
      },
    }]);

    const page = await readMatchTranscriptPage(db, { gameIdOrSlug: gameId, limit: 10 }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.text).toBe("Said aloud");
    const forbidden = findForbiddenTranscriptDtoKeys(page);
    expect(forbidden).toEqual([]);
    expect(JSON.stringify(page)).not.toContain("NEVER LEAK");
    expect(JSON.stringify(page)).not.toContain("thinking");
    expect(JSON.stringify(page)).not.toContain("roomMetadata");
    expect(JSON.stringify(page)).not.toContain(PRIVATE_DECISION_SENTINEL);
    expect(JSON.stringify(page)).not.toContain("decisionId");
    expect(page.entries[0]?.contentTrust).toBe("untrusted_game_authored");
    expect(page.entries[0]?.authority).toBe("transcript");
  });

  test("creator-only access is denied without revealing rows; unknown game is non-enumerating", async () => {
    const creatorId = randomUUID();
    await db.insert(schema.users).values({
      id: creatorId,
      walletAddress: `0x${creatorId.replace(/-/g, "").slice(0, 40)}`,
    });
    const gameId = await insertGame(db, { slug: "creator-only-tx", status: "in_progress" });
    await db.update(schema.games).set({
      createdById: creatorId,
      transcriptCaptureVersion: 1,
    }).where(eq(schema.games.id, gameId));
    await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId, 1));
    await db.insert(schema.transcripts).values([modernPublicRow(gameId, 1, "Secret", 1)]);
    await db.update(schema.gameTranscriptStates).set({
      durableSequence: 1,
      durableCount: 1,
    }).where(eq(schema.gameTranscriptStates.gameId, gameId));

    const denied = await readMatchTranscriptPage(db, { gameIdOrSlug: gameId }, {
      subjectUserId: creatorId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.status).toBe("denied");

    const unknown = await readMatchTranscriptPage(db, { gameIdOrSlug: randomUUID() }, {
      subjectUserId: creatorId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.status).toBe("not_accessible");
  });

  test("malformed/expired/rotated cursor fails with uniform cursor_invalid_or_stale", async () => {
    const fixture = await seedModernOwnerGame(db, { watermark: 1 });
    await db.insert(schema.transcripts).values([
      modernPublicRow(fixture.gameId, 1, "Only", 1),
    ]);

    const page = await readMatchTranscriptPage(db, { gameIdOrSlug: fixture.gameId, limit: 1 }, {
      subjectUserId: fixture.userId,
      cursorSecret: CURSOR_SECRET,
      nowMs: 1_720_000_000_000,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    const expired = await readMatchTranscriptPage(db, {
      gameIdOrSlug: fixture.gameId,
      cursor: page.nextCursor!,
    }, {
      subjectUserId: fixture.userId,
      cursorSecret: CURSOR_SECRET,
      nowMs: 1_720_000_000_000 + 31 * 60 * 1000,
    });
    expect(expired).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });

    const rotated = await readMatchTranscriptPage(db, {
      gameIdOrSlug: fixture.gameId,
      cursor: page.nextCursor!,
    }, {
      subjectUserId: fixture.userId,
      cursorSecret: "different-rotated-secret-material",
      nowMs: 1_720_000_000_000,
    });
    expect(rotated).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });

    const malformed = await readMatchTranscriptPage(db, {
      gameIdOrSlug: fixture.gameId,
      cursor: "%%%not-a-cursor%%%",
    }, {
      subjectUserId: fixture.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(malformed).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });
  });
});

// ---------------------------------------------------------------------------
// U5 — owned thinking and strategy timeline
// ---------------------------------------------------------------------------

describe("ProductionGameMcpReadModel owned match cognition (U5)", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    process.env.JWT_SECRET = CURSOR_SECRET;
  });

  test("owners page thinking/strategy for every owned seat; reasoning stays off timeline", async () => {
    const fixture = await seedCognitionOwnerGame(db);
    const { gameId, userId, ownerA, ownerB, peer } = fixture;

    const thinkingA = randomUUID();
    const strategyB = randomUUID();
    const reasoningA = randomUUID();
    const peerThinking = randomUUID();

    await insertCognitionArtifact(db, {
      id: thinkingA,
      gameId,
      actorPlayerId: ownerA,
      actorUserId: userId,
      artifactType: "thinking",
      payload: { thinking: "seat-a thought" },
      createdAt: "2026-07-21T10:00:02.000Z",
    });
    await insertCognitionArtifact(db, {
      id: strategyB,
      gameId,
      actorPlayerId: ownerB,
      actorUserId: userId,
      artifactType: "strategy",
      payload: {
        stage: "proposal",
        strategyCandidate: { operation: "delta", submittedValue: "seat-b strategy" },
      },
      createdAt: "2026-07-21T10:00:01.000Z",
    });
    await insertCognitionArtifact(db, {
      id: reasoningA,
      gameId,
      actorPlayerId: ownerA,
      actorUserId: userId,
      artifactType: "reasoning",
      payload: { reasoningContext: "should not appear on timeline" },
      createdAt: "2026-07-21T10:00:03.000Z",
    });
    await insertCognitionArtifact(db, {
      id: peerThinking,
      gameId,
      actorPlayerId: peer,
      artifactType: "thinking",
      payload: { thinking: "peer secret" },
      createdAt: "2026-07-21T10:00:04.000Z",
    });

    const readModel = new ProductionGameMcpReadModel(db);
    const page = await readModel.readOwnedMatchCognition(
      { gameIdOrSlug: gameId, limit: 10 },
      { userId, authProfile: "subject" },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) throw new Error(page.error);
    expect(page.entries.map((e) => e.id).sort()).toEqual([thinkingA, strategyB].sort());
    expect(page.entries.every((e) => e.authority === "cognition")).toBe(true);
    expect(page.entries.some((e) => e.id === reasoningA)).toBe(false);
    expect(page.entries.some((e) => e.id === peerThinking)).toBe(false);
    expect(JSON.stringify(page)).not.toContain("peer secret");
    expect(JSON.stringify(page)).not.toContain("reasoningContext");
    expect(JSON.stringify(page)).not.toContain("should not appear");

    const thinkingEntry = page.entries.find((e) => e.id === thinkingA);
    expect(thinkingEntry?.thinkingProse).toEqual({
      thinking: "seat-a thought",
      contentTrust: "untrusted_game_authored",
    });
    expect(thinkingEntry?.strategyProse).toBeUndefined();

    const strategyEntry = page.entries.find((e) => e.id === strategyB);
    expect(strategyEntry?.strategyProse).toMatchObject({
      stage: "proposal",
      operation: "delta",
      submission: "value",
      value: "seat-b strategy",
    });
    expect(strategyEntry?.strategyProse?.contentTrust).toBe("untrusted_game_authored");
  });

  test("hundreds of newer non-owned rows cannot hide an older owned artifact", async () => {
    const fixture = await seedCognitionOwnerGame(db);
    const { gameId, userId, ownerA, peer } = fixture;
    const ownedId = randomUUID();

    await insertCognitionArtifact(db, {
      id: ownedId,
      gameId,
      actorPlayerId: ownerA,
      actorUserId: userId,
      artifactType: "thinking",
      payload: { thinking: "older owned" },
      createdAt: "2026-07-21T09:00:00.000Z",
    });
    for (let i = 0; i < 200; i++) {
      await insertCognitionArtifact(db, {
        id: randomUUID(),
        gameId,
        actorPlayerId: peer,
        artifactType: "thinking",
        payload: { thinking: `noise-${i}` },
        createdAt: `2026-07-21T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
      });
    }

    const page = await readMatchCognitionPage(db, { gameIdOrSlug: gameId, limit: 5 }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) throw new Error(page.error);
    expect(page.entries.map((e) => e.id)).toEqual([ownedId]);
    expect(JSON.stringify(page)).not.toContain("noise-");
  });

  test("Production MCP list/read enforce subject_owner (non-owned thinking denied)", async () => {
    const fixture = await seedCognitionOwnerGame(db);
    const { gameId, userId, ownerA, peer } = fixture;
    const ownedThinking = randomUUID();
    const peerThinking = randomUUID();

    await insertCognitionArtifact(db, {
      id: ownedThinking,
      gameId,
      actorPlayerId: ownerA,
      actorUserId: userId,
      artifactType: "thinking",
      payload: { thinking: "mine" },
    });
    await insertCognitionArtifact(db, {
      id: peerThinking,
      gameId,
      actorPlayerId: peer,
      artifactType: "thinking",
      payload: { thinking: "theirs" },
    });

    const readModel = new ProductionGameMcpReadModel(db);
    const listed = await readModel.listCognitiveArtifacts(
      { gameIdOrSlug: gameId },
      { userId, authProfile: "subject" },
    );
    const body = listed.cognitiveArtifacts as {
      ok: boolean;
      artifacts: Array<{ id: string; actorPlayerId?: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.artifacts.map((a) => a.id)).toEqual([ownedThinking]);
    expect(body.artifacts.every((a) => a.actorPlayerId === ownerA || a.actorPlayerId === fixture.ownerB)).toBe(true);

    const denied = await readModel.readCognitiveArtifact({
      gameIdOrSlug: gameId,
      artifactId: peerThinking,
      artifactType: "thinking",
      actorPlayerId: peer,
    }, { userId, authProfile: "subject" });
    const deniedBody = denied.cognitiveArtifacts as { ok: boolean; status?: string };
    expect(deniedBody.ok).toBe(false);
    expect(deniedBody.status).toBe("denied");

    // Subject with producer/sysop metadata still subject_owner only.
    const elevatedList = await readModel.listCognitiveArtifacts(
      { gameIdOrSlug: gameId },
      { userId, authProfile: "subject" },
    );
    const elevatedBody = elevatedList.cognitiveArtifacts as {
      ok: boolean;
      artifacts: Array<{ id: string }>;
    };
    expect(elevatedBody.artifacts.map((a) => a.id)).toEqual([ownedThinking]);

    // Explicit producer surface still sees all.
    const producerList = await readModel.listCognitiveArtifacts(
      { gameIdOrSlug: gameId },
      PRODUCER_ACCESS,
    );
    const producerBody = producerList.cognitiveArtifacts as {
      ok: boolean;
      artifacts: Array<{ id: string }>;
    };
    expect(producerBody.ok).toBe(true);
    expect(producerBody.artifacts.map((a) => a.id).sort()).toEqual(
      [ownedThinking, peerThinking].sort(),
    );
  });

  test("cursor reuse across game/subject/filter/ownership fails; pagination is stable", async () => {
    const a = await seedCognitionOwnerGame(db);
    const b = await seedCognitionOwnerGame(db);

    for (const [i, id] of [randomUUID(), randomUUID(), randomUUID()].entries()) {
      await insertCognitionArtifact(db, {
        id,
        gameId: a.gameId,
        actorPlayerId: a.ownerA,
        actorUserId: a.userId,
        artifactType: "thinking",
        payload: { thinking: `a-${i}` },
        createdAt: `2026-07-21T10:00:0${i}.000Z`,
      });
    }

    const page1 = await readMatchCognitionPage(db, { gameIdOrSlug: a.gameId, limit: 1 }, {
      subjectUserId: a.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page1.ok).toBe(true);
    if (!page1.ok) throw new Error(page1.error);
    expect(page1.entries).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await readMatchCognitionPage(db, {
      gameIdOrSlug: a.gameId,
      cursor: page1.nextCursor!,
      limit: 1,
    }, {
      subjectUserId: a.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page2.ok).toBe(true);
    if (!page2.ok) throw new Error(page2.error);
    expect(page2.entries).toHaveLength(1);
    expect(page2.entries[0]!.id).not.toBe(page1.entries[0]!.id);

    // Cursor from game A reused against game B (B's owner) fails binding.
    const wrongGame = await readMatchCognitionPage(db, {
      gameIdOrSlug: b.gameId,
      cursor: page1.nextCursor!,
    }, {
      subjectUserId: b.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(wrongGame).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });

    // Same game, different subject fails binding (or access).
    const wrongSubject = await readMatchCognitionPage(db, {
      gameIdOrSlug: a.gameId,
      cursor: page1.nextCursor!,
    }, {
      subjectUserId: b.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(wrongSubject.ok).toBe(false);
    if (wrongSubject.ok) throw new Error("expected failure");
    expect(["cursor_invalid_or_stale", "not_accessible", "denied"]).toContain(wrongSubject.status);

    const wrongFilter = await readMatchCognitionPage(db, {
      gameIdOrSlug: a.gameId,
      cursor: page1.nextCursor!,
      artifactType: "strategy",
    }, {
      subjectUserId: a.userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(wrongFilter).toMatchObject({ ok: false, status: "cursor_invalid_or_stale" });
  });

  test("rejects reasoning filter and unknown keys; degraded cognition omits without fallback", async () => {
    const fixture = await seedCognitionOwnerGame(db);
    const { gameId, userId, ownerA } = fixture;

    const degradedId = randomUUID();
    const goodId = randomUUID();
    await insertCognitionArtifact(db, {
      id: degradedId,
      gameId,
      actorPlayerId: ownerA,
      actorUserId: userId,
      artifactType: "thinking",
      payload: {},
      visibilityStatus: "capture_degraded",
      createdAt: "2026-07-21T11:00:00.000Z",
    });
    await insertCognitionArtifact(db, {
      id: goodId,
      gameId,
      actorPlayerId: ownerA,
      actorUserId: userId,
      artifactType: "thinking",
      payload: { thinking: "good" },
      createdAt: "2026-07-21T10:00:00.000Z",
    });

    const page = await readMatchCognitionPage(db, { gameIdOrSlug: gameId }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) throw new Error(page.error);
    expect(page.entries.map((e) => e.id)).toEqual([goodId]);
    expect(JSON.stringify(page)).not.toContain(degradedId);

    const reasoningFilter = await readMatchCognitionPage(db, {
      gameIdOrSlug: gameId,
      artifactType: "reasoning",
    }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(reasoningFilter).toMatchObject({
      ok: false,
      status: "invalid_input",
      field: "artifactType",
    });

    const unknownKey = await readMatchCognitionPage(db, {
      gameIdOrSlug: gameId,
      unknownField: true,
    }, {
      subjectUserId: userId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(unknownKey).toMatchObject({ ok: false, status: "invalid_input" });
  });

  test("creator-only and inaccessible games are non-enumerating denied", async () => {
    const creatorId = randomUUID();
    await db.insert(schema.users).values({ id: creatorId });
    const gameId = await insertGame(db, {
      slug: `creator-only-${randomUUID().slice(0, 8)}`,
      status: "in_progress",
    });
    await db.update(schema.games).set({
      cognitiveArtifactCaptureVersion: 1,
      createdById: creatorId,
    }).where(eq(schema.games.id, gameId));

    const denied = await readMatchCognitionPage(db, { gameIdOrSlug: gameId }, {
      subjectUserId: creatorId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(denied).toMatchObject({ ok: false, status: "denied" });

    const unknown = await readMatchCognitionPage(db, { gameIdOrSlug: randomUUID() }, {
      subjectUserId: creatorId,
      cursorSecret: CURSOR_SECRET,
    });
    expect(unknown).toMatchObject({ ok: false, status: "not_accessible" });
  });
});

// ---------------------------------------------------------------------------
// U6 — match manifest via ProductionGameMcpReadModel
// ---------------------------------------------------------------------------

describe("ProductionGameMcpReadModel match manifest (U6)", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("readMatchManifest returns protocol-neutral lanes and follow-ups for owner", async () => {
    const { gameId, userId } = await seedModernOwnerGame(db, { watermark: 4 });
    const readModel = new ProductionGameMcpReadModel(db);
    const result = await readModel.readMatchManifest(
      { gameIdOrSlug: gameId },
      { userId, authProfile: "subject" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.schemaVersion).toBe(1);
    expect(result.manifest.lanes.facts.authority).toBe("canonical_facts");
    expect(result.manifest.lanes.transcript.authority).toBe("transcript");
    expect(result.manifest.lanes.cognition.authority).toBe("cognition");
    expect(result.manifest.formalSpeechParity.authority).toBe("formal_speech_parity");
    expect(result.manifest.lanes.transcript.readThrough.throughEntrySequence).toBe(4);
    expect(result.manifest.overall.live).toBe(true);
    expect(result.manifest.overall.state).not.toBe("complete");
    for (const cap of result.manifest.nextReads) {
      expect(cap.starterArguments.gameIdOrSlug).toBeTruthy();
      expect(JSON.stringify(cap)).not.toMatch(/"toolName"|read_match_manifest/);
    }
  });

  test("empty userId is non-enumerating not_accessible", async () => {
    const readModel = new ProductionGameMcpReadModel(db);
    const result = await readModel.readMatchManifest(
      { gameIdOrSlug: randomUUID() },
      { userId: "", authProfile: "subject" },
    );
    expect(result).toMatchObject({ ok: false, status: "not_accessible" });
  });
});

async function seedCognitionOwnerGame(db: DrizzleDB): Promise<{
  gameId: string;
  userId: string;
  ownerA: string;
  ownerB: string;
  peer: string;
}> {
  const userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    walletAddress: `0x${userId.replace(/-/g, "").slice(0, 40)}`,
  });
  const gameId = await insertGame(db, {
    slug: `cog-${randomUUID().slice(0, 8)}`,
    status: "in_progress",
  });
  await db.update(schema.games).set({
    cognitiveArtifactCaptureVersion: 1,
    transcriptCaptureVersion: 1,
  }).where(eq(schema.games.id, gameId));
  const ownerA = await insertGamePlayer(db, { gameId, userId, name: "OwnerA" });
  const ownerB = await insertGamePlayer(db, { gameId, userId, name: "OwnerB" });
  const peer = await insertGamePlayer(db, { gameId, name: "Peer" });
  return { gameId, userId, ownerA, ownerB, peer };
}

async function insertCognitionArtifact(
  db: DrizzleDB,
  params: {
    id: string;
    gameId: string;
    actorPlayerId: string;
    actorUserId?: string;
    artifactType: "reasoning" | "thinking" | "strategy";
    payload: Record<string, unknown>;
    createdAt?: string;
    visibilityStatus?: "active" | "capture_degraded";
  },
): Promise<void> {
  await db.insert(schema.gameCognitiveArtifacts).values({
    id: params.id,
    gameId: params.gameId,
    artifactType: params.artifactType,
    actorRole: "player",
    actorPlayerId: params.actorPlayerId,
    actorUserId: params.actorUserId,
    action: "vote",
    phase: "LOBBY",
    round: 1,
    payloadByteLength: Buffer.byteLength(JSON.stringify(params.payload), "utf8"),
    payload: params.payload,
    visibilityStatus: params.visibilityStatus ?? "active",
    ...(params.createdAt && { createdAt: params.createdAt }),
  });
}

async function seedModernOwnerGame(
  db: DrizzleDB,
  params: { watermark: number; slug?: string },
): Promise<{
  gameId: string;
  userId: string;
  ownerPlayerId: string;
  peerPlayerId: string;
}> {
  const userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    walletAddress: `0x${userId.replace(/-/g, "").slice(0, 40)}`,
  });
  const gameId = await insertGame(db, {
    slug: params.slug ?? `tx-${randomUUID().slice(0, 8)}`,
    status: "in_progress",
  });
  await db.update(schema.games).set({
    transcriptCaptureVersion: 1,
    formalSpeechCaptureVersion: 1,
  }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values({
    ...initialGameTranscriptStateValues(gameId, 1),
    durableSequence: params.watermark,
    durableCount: params.watermark,
  });
  const ownerPlayerId = await insertGamePlayer(db, { gameId, userId, name: "Owner" });
  const peerPlayerId = await insertGamePlayer(db, { gameId, name: "Peer" });
  return { gameId, userId, ownerPlayerId, peerPlayerId };
}

function modernPublicRow(
  gameId: string,
  sequence: number,
  text: string,
  timestamp: number,
  speakerPlayerId?: string,
) {
  return {
    gameId,
    round: 1,
    phase: "LOBBY",
    fromPlayerId: speakerPlayerId ?? null,
    scope: "public" as const,
    toPlayerIds: null,
    text,
    thinking: null as string | null,
    timestamp,
    entrySequence: sequence,
    speakerPlayerId: speakerPlayerId ?? null,
    audiencePlayerIds: [] as string[],
    captureVersion: 1,
    dialogueKind: "public_speech" as const,
    safeContext: { version: 1 as const },
  };
}

function modernMingleRow(
  gameId: string,
  sequence: number,
  params: {
    speakerPlayerId: string;
    audiencePlayerIds: string[];
    text: string;
    timestamp: number;
  },
) {
  return {
    gameId,
    round: 1,
    phase: "MINGLE_I",
    fromPlayerId: params.speakerPlayerId,
    scope: "mingle" as const,
    toPlayerIds: JSON.stringify(
      params.audiencePlayerIds.filter((id) => id !== params.speakerPlayerId),
    ),
    text: params.text,
    thinking: null as string | null,
    timestamp: params.timestamp,
    entrySequence: sequence,
    speakerPlayerId: params.speakerPlayerId,
    audiencePlayerIds: params.audiencePlayerIds,
    captureVersion: 1,
    dialogueKind: "mingle_speech" as const,
    safeContext: { version: 1 as const, roomId: 1 },
  };
}
