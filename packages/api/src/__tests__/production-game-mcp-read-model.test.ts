import { beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
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
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  createResolvedRoundCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";

const PRODUCER_ACCESS = {
  userId: "producer-reviewer",
  authProfile: "producer" as const,
};

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
  });

  test("reads LLM-native postgame surfaces for edge-smoke-dusk", async () => {
    await insertEdgeSmokeDuskFixture(db);

    const readModel = new ProductionGameMcpReadModel(db);
    const brief = await readModel.readGameBrief({
      gameIdOrSlug: EDGE_SMOKE_DUSK_EXPECTED.slug,
    }, PRODUCER_ACCESS);

    expect(brief.ok).toBe(true);
    if (!brief.ok) return;
    expect(brief.postgame.summary.winner).toEqual({
      id: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
      name: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
    });
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
    const endgameDiagnostics = brief.postgame.roundSummaries
      .filter((round) => round.round >= 6)
      .flatMap((round) => round.diagnostics.map((diagnostic) => diagnostic.code));
    expect(endgameDiagnostics).not.toContain("standard_vote_not_yet_resolved");
    expect(endgameDiagnostics).not.toContain("power_not_yet_resolved");
    expect(endgameDiagnostics).not.toContain("council_not_yet_resolved");
    expect(brief.postgame.derivedVoteCohorts.length).toBeGreaterThan(0);
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

    const player = await readModel.readPlayerGameSummary({
      gameIdOrSlug: EDGE_SMOKE_DUSK_GAME_ID,
      player: "Lilith Voss",
    }, PRODUCER_ACCESS);
    expect(player.ok).toBe(true);
    if (!player.ok) return;
    expect(player.player.won).toBe(true);
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
    expect(createdFacts.canonicalGameFacts.roundFacts.power.status).toBe("available");
    expect(createdFacts.canonicalGameFacts.roundFacts.council.status).toBe("available");
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
    expect(joinedFacts.canonicalGameFacts.roundFacts.council.status).toBe("available");

    const producerFacts = await readModel.readRoundFacts({ gameIdOrSlug: unrelatedGameId }, PRODUCER_ACCESS);
    expect(producerFacts.canonicalGameFacts.roundFacts.standardVote.status).toBe("available");

    await expect(readModel.readRoundFacts({ gameIdOrSlug: unrelatedGameId }, gamesAccess)).rejects.toThrow(
      /^Game is not accessible for MCP scope: games:read$/,
    );
    await expect(readModel.readRoundFacts({ gameIdOrSlug: "missing-game" }, gamesAccess)).rejects.toThrow(
      /^Game is not accessible for MCP scope: games:read$/,
    );
  });

  test("blocks producer event visibility for games-scope reads", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xgamescope000000000000000000000000000003",
    });
    const gameId = await insertGame(db, { slug: "visibility-scope" });
    await insertGamePlayer(db, { gameId, userId });

    const readModel = new ProductionGameMcpReadModel(db);
    await expect(readModel.filterEvents({
      gameIdOrSlug: gameId,
      visibilityMode: "producer",
    }, {
      userId,
      authProfile: "subject" as const,
    })).rejects.toThrow("producer visibility requires MCP scope: producer");
  });

  test("reads and searches private trace evidence through DB manifests and storage", async () => {
    const gameId = await insertGame(db, { slug: "mcp-private-trace" });
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();
    const manifestId = await insertPrivateTraceManifest(db, storage, {
      gameId,
      ownerEpoch,
      body: JSON.stringify({
        reasoningContext: "the secret plan is to shield Mira",
        toolArguments: { expose: "Vera" },
      }),
    });

    const readModel = new ProductionGameMcpReadModel(
      db,
      new PrivateTraceReadModel(db, () => storage),
    );

    const manifests = await readModel.listTraceManifests(gameId, PRODUCER_ACCESS);
    expect(asRecord(manifests.developerEvidence)).toMatchObject({
      gameId,
      totalCount: 1,
      manifests: [{
        id: manifestId,
        gameId,
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
});

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
      modelTier: "budget",
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

async function insertPrivateTraceManifest(
  db: DrizzleDB,
  storage: FakePrivateTraceStorage,
  params: {
    gameId: string;
    ownerEpoch: string;
    body: string;
  },
): Promise<string> {
  const manifestId = randomUUID();
  const bucket = "private-trace-bucket";
  const key = `content/${params.gameId}/private-traces/test-${manifestId}.json`;
  const byteLength = Buffer.byteLength(params.body, "utf8");
  storage.setObject(bucket, key, params.body);

  await db.insert(schema.gameEvidenceManifests).values({
    id: manifestId,
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
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
  },
): Promise<string> {
  const playerId = randomUUID();
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId: params.gameId,
    userId: params.userId,
    agentProfileId: params.agentProfileId,
    persona: JSON.stringify({ name: "Test Player", personality: "careful" }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  });
  return playerId;
}
