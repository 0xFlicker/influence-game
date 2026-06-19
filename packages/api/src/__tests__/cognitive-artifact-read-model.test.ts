import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { CognitiveArtifactReadModel } from "../services/cognitive-artifact-read-model.js";
import { setupTestDB } from "./test-utils.js";

const PRODUCER_ACCESS = {
  userId: "producer-user",
  authProfile: "producer_mcp" as const,
};

describe("CognitiveArtifactReadModel", () => {
  let db: DrizzleDB;
  let readModel: CognitiveArtifactReadModel;

  beforeEach(async () => {
    db = await setupTestDB();
    await db.insert(schema.users).values({ id: PRODUCER_ACCESS.userId });
    readModel = new CognitiveArtifactReadModel(db);
  });

  test("allows own reasoning and participant-visible thinking/strategy only", async () => {
    const gameId = randomUUID();
    const ownerUserId = randomUUID();
    const participantUserId = randomUUID();
    const ownerPlayerId = randomUUID();
    const participantPlayerId = randomUUID();
    const reasoningId = randomUUID();
    const thinkingId = randomUUID();
    const strategyId = randomUUID();

    await insertUsers(ownerUserId, participantUserId);
    await insertGame(gameId, { captureVersion: 1 });
    await insertPlayer(gameId, ownerPlayerId, ownerUserId);
    await insertPlayer(gameId, participantPlayerId, participantUserId);
    await insertArtifact({
      id: reasoningId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "reasoning",
      payload: { reasoningContext: "owner-only native reasoning" },
    });
    await insertArtifact({
      id: thinkingId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "thinking",
      payload: { thinking: "participant-visible thinking" },
    });
    await insertArtifact({
      id: strategyId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "strategy",
      payload: { decisionLog: "participant-visible strategy" },
    });

    const participantAccess = {
      userId: participantUserId,
      authProfile: "games_subject" as const,
    };
    const participantList = await readModel.listArtifacts({ gameIdOrSlug: gameId }, participantAccess);
    expect(participantList.ok).toBe(true);
    if (!participantList.ok) throw new Error(participantList.error);
    expect(participantList.artifacts.map((artifact) => artifact.id).sort()).toEqual([strategyId, thinkingId].sort());

    const deniedReasoning = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: reasoningId,
      artifactType: "reasoning",
      actorPlayerId: ownerPlayerId,
    }, participantAccess);
    expect(deniedReasoning).toMatchObject({ ok: false, status: "denied" });

    const deniedReasoningWithoutContext = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: reasoningId,
    }, participantAccess);
    expect(deniedReasoningWithoutContext).toMatchObject({ ok: false, status: "denied" });

    const deniedMissingWithoutContext = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: randomUUID(),
    }, participantAccess);
    expect(deniedMissingWithoutContext).toMatchObject({ ok: false, status: "denied" });

    const thinking = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: thinkingId,
      artifactType: "thinking",
      actorPlayerId: ownerPlayerId,
    }, participantAccess);
    expect(thinking.ok).toBe(true);
    if (!thinking.ok) throw new Error(thinking.error);
    expect(thinking.artifact.payload).toEqual({ thinking: "participant-visible thinking" });

    const ownerReasoning = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: reasoningId,
      artifactType: "reasoning",
      actorPlayerId: ownerPlayerId,
    }, {
      userId: ownerUserId,
      authProfile: "games_subject" as const,
    });
    expect(ownerReasoning.ok).toBe(true);
    if (!ownerReasoning.ok) throw new Error(ownerReasoning.error);
    expect(ownerReasoning.artifact.payload).toEqual({ reasoningContext: "owner-only native reasoning" });

    const producerReasoning = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: reasoningId,
    }, PRODUCER_ACCESS);
    expect(producerReasoning.ok).toBe(true);
  });

  test("denies created-only users before exposing old-game no-capture state", async () => {
    const gameId = randomUUID();
    const creatorUserId = randomUUID();
    await db.insert(schema.users).values({ id: creatorUserId });
    await db.insert(schema.games).values({
      id: gameId,
      config: "{}",
      createdById: creatorUserId,
      cognitiveArtifactCaptureVersion: 0,
    });

    const result = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: randomUUID(),
      artifactType: "thinking",
      actorPlayerId: randomUUID(),
    }, {
      userId: creatorUserId,
      authProfile: "games_subject" as const,
    });

    expect(result).toMatchObject({ ok: false, status: "denied" });
    const reads = await db
      .select()
      .from(schema.gameCognitiveArtifactReads)
      .where(eq(schema.gameCognitiveArtifactReads.gameId, gameId));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.outcome).toBe("denied");
  });

  test("returns old-game no-capture only after participant authorization", async () => {
    const gameId = randomUUID();
    const userId = randomUUID();
    const playerId = randomUUID();
    await db.insert(schema.users).values({ id: userId });
    await insertGame(gameId, { captureVersion: 0 });
    await insertPlayer(gameId, playerId, userId);

    const result = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: randomUUID(),
      artifactType: "thinking",
      actorPlayerId: playerId,
    }, {
      userId,
      authProfile: "games_subject" as const,
    });

    expect(result).toMatchObject({ ok: false, status: "not_captured_for_game" });
    const reads = await db
      .select()
      .from(schema.gameCognitiveArtifactReads)
      .where(eq(schema.gameCognitiveArtifactReads.gameId, gameId));
    expect(reads[0]!.outcome).toBe("not_captured_for_game");
  });

  test("returns degraded diagnostics only to producer access", async () => {
    const gameId = randomUUID();
    const userId = randomUUID();
    const playerId = randomUUID();
    const artifactId = randomUUID();
    await db.insert(schema.users).values({ id: userId });
    await insertGame(gameId, { captureVersion: 1 });
    await insertPlayer(gameId, playerId, userId);
    await insertArtifact({
      id: artifactId,
      gameId,
      actorPlayerId: playerId,
      actorUserId: userId,
      artifactType: "thinking",
      payload: {},
      visibilityStatus: "capture_degraded",
      diagnostics: { reason: "payload_too_large" },
    });

    const userResult = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId,
      artifactType: "thinking",
      actorPlayerId: playerId,
    }, {
      userId,
      authProfile: "games_subject" as const,
    });
    expect(userResult).toMatchObject({ ok: false, status: "capture_degraded" });
    expect(userResult.ok ? undefined : userResult.diagnostics).toBeUndefined();

    const producerResult = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId,
    }, PRODUCER_ACCESS);
    expect(producerResult).toMatchObject({
      ok: false,
      status: "capture_degraded",
      diagnostics: { reason: "payload_too_large" },
    });
  });

  async function insertUsers(...ids: string[]): Promise<void> {
    await db.insert(schema.users).values(ids.map((id) => ({ id })));
  }

  async function insertGame(
    gameId: string,
    params: { captureVersion: number },
  ): Promise<void> {
    await db.insert(schema.games).values({
      id: gameId,
      config: "{}",
      status: "in_progress",
      cognitiveArtifactCaptureVersion: params.captureVersion,
    });
  }

  async function insertPlayer(
    gameId: string,
    playerId: string,
    userId: string,
  ): Promise<void> {
    await db.insert(schema.gamePlayers).values({
      id: playerId,
      gameId,
      userId,
      persona: "{}",
      agentConfig: "{}",
    });
  }

  async function insertArtifact(params: {
    id: string;
    gameId: string;
    actorPlayerId: string;
    actorUserId: string;
    artifactType: "reasoning" | "thinking" | "strategy";
    payload: Record<string, unknown>;
    visibilityStatus?: "active" | "capture_degraded";
    diagnostics?: Record<string, unknown>;
  }): Promise<void> {
    await db.insert(schema.gameCognitiveArtifacts).values({
      id: params.id,
      gameId: params.gameId,
      artifactType: params.artifactType,
      actorRole: "player",
      actorPlayerId: params.actorPlayerId,
      actorUserId: params.actorUserId,
      action: "vote",
      payloadByteLength: Buffer.byteLength(JSON.stringify(params.payload), "utf8"),
      payload: params.payload,
      visibilityStatus: params.visibilityStatus ?? "active",
      diagnostics: params.diagnostics,
    });
  }
});
