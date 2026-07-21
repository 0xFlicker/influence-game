import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { CognitiveArtifactReadModel } from "../services/cognitive-artifact-read-model.js";
import { buildMatchAccessContext } from "../services/match-access-context.js";
import { setupTestDB } from "./test-utils.js";

const PRODUCER_ACCESS = {
  userId: "producer-user",
  authProfile: "producer" as const,
  surfaceCapability: "producer" as const,
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
      authProfile: "subject" as const,
      surfaceCapability: "participant_web" as const,
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
      authProfile: "subject" as const,
      surfaceCapability: "participant_web" as const,
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

  test("keeps alliance action and huddle cognitive artifacts owner-only for subject access", async () => {
    const gameId = randomUUID();
    const ownerUserId = randomUUID();
    const participantUserId = randomUUID();
    const ownerPlayerId = randomUUID();
    const participantPlayerId = randomUUID();
    const allianceActionThinkingId = randomUUID();
    const allianceActionStrategyId = randomUUID();
    const huddleThinkingId = randomUUID();
    const huddleStrategyId = randomUUID();
    const publicThinkingId = randomUUID();

    await insertUsers(ownerUserId, participantUserId);
    await insertGame(gameId, { captureVersion: 1 });
    await insertPlayer(gameId, ownerPlayerId, ownerUserId);
    await insertPlayer(gameId, participantPlayerId, participantUserId);
    await insertArtifact({
      id: allianceActionThinkingId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "thinking",
      action: "alliance-action",
      phase: "MINGLE_I",
      payload: { thinking: "private alliance proposal thought" },
    });
    await insertArtifact({
      id: allianceActionStrategyId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "strategy",
      action: "alliance-action",
      phase: "MINGLE_I",
      payload: { decisionLog: "private alliance proposal strategy" },
    });
    await insertArtifact({
      id: huddleThinkingId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "thinking",
      action: "alliance-huddle-turn",
      phase: "PRE_VOTE_HUDDLE",
      payload: { thinking: "private huddle thought" },
    });
    await insertArtifact({
      id: huddleStrategyId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "strategy",
      action: "alliance-huddle-turn",
      phase: "PRE_VOTE_HUDDLE",
      payload: { decisionLog: "private huddle strategy" },
    });
    await insertArtifact({
      id: publicThinkingId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "thinking",
      payload: { thinking: "ordinary participant-visible thought" },
    });

    const participantAccess = {
      userId: participantUserId,
      authProfile: "subject" as const,
      surfaceCapability: "participant_web" as const,
    };
    const participantList = await readModel.listArtifacts({ gameIdOrSlug: gameId }, participantAccess);
    expect(participantList.ok).toBe(true);
    if (!participantList.ok) throw new Error(participantList.error);
    expect(participantList.artifacts.map((artifact) => artifact.id)).toEqual([publicThinkingId]);

    const deniedAllianceThinking = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: allianceActionThinkingId,
      artifactType: "thinking",
      actorPlayerId: ownerPlayerId,
    }, participantAccess);
    expect(deniedAllianceThinking).toMatchObject({ ok: false, status: "denied" });

    const deniedHuddleThinking = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: huddleThinkingId,
      artifactType: "thinking",
      actorPlayerId: ownerPlayerId,
    }, participantAccess);
    expect(deniedHuddleThinking).toMatchObject({ ok: false, status: "denied" });

    const ownerHuddleStrategy = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: huddleStrategyId,
      artifactType: "strategy",
      actorPlayerId: ownerPlayerId,
    }, {
      userId: ownerUserId,
      authProfile: "subject" as const,
      surfaceCapability: "participant_web" as const,
    });
    expect(ownerHuddleStrategy.ok).toBe(true);

    const ownerAllianceStrategy = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: allianceActionStrategyId,
      artifactType: "strategy",
      actorPlayerId: ownerPlayerId,
    }, {
      userId: ownerUserId,
      authProfile: "subject" as const,
      surfaceCapability: "participant_web" as const,
    });
    expect(ownerAllianceStrategy.ok).toBe(true);

    const producerHuddleThinking = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: huddleThinkingId,
    }, PRODUCER_ACCESS);
    expect(producerHuddleThinking.ok).toBe(true);
  });

  test("subject_owner hides non-owned thinking/strategy and survives non-owned scan pressure", async () => {
    const gameId = randomUUID();
    const ownerUserId = randomUUID();
    const otherUserId = randomUUID();
    const ownerPlayerId = randomUUID();
    const otherPlayerId = randomUUID();
    const ownedThinkingId = randomUUID();
    const ownedStrategyId = randomUUID();
    const ownedReasoningId = randomUUID();

    await insertUsers(ownerUserId, otherUserId);
    await insertGame(gameId, { captureVersion: 1 });
    await insertPlayer(gameId, ownerPlayerId, ownerUserId);
    await insertPlayer(gameId, otherPlayerId, otherUserId);

    // Hundreds of newer non-owned rows must not hide older owned artifacts.
    const nonOwnedIds: string[] = [];
    for (let i = 0; i < 120; i++) {
      const id = randomUUID();
      nonOwnedIds.push(id);
      await insertArtifact({
        id,
        gameId,
        actorPlayerId: otherPlayerId,
        actorUserId: otherUserId,
        artifactType: i % 2 === 0 ? "thinking" : "strategy",
        payload: { thinking: `noise-${i}` },
        createdAt: `2026-07-21T12:00:${String(i % 60).padStart(2, "0")}.000Z`,
      });
    }
    await insertArtifact({
      id: ownedThinkingId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "thinking",
      payload: { thinking: "owned thought" },
      createdAt: "2026-07-21T10:00:00.000Z",
    });
    await insertArtifact({
      id: ownedStrategyId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "strategy",
      payload: { decisionLog: "owned strategy" },
      createdAt: "2026-07-21T10:00:01.000Z",
    });
    await insertArtifact({
      id: ownedReasoningId,
      gameId,
      actorPlayerId: ownerPlayerId,
      actorUserId: ownerUserId,
      artifactType: "reasoning",
      payload: { reasoningContext: "owned reasoning" },
      createdAt: "2026-07-21T10:00:02.000Z",
    });

    const matchAccess = buildMatchAccessContext({
      subjectUserId: ownerUserId,
      gameId,
      gameSlug: `test-${gameId}`,
      gameStatus: "in_progress",
      transcriptCaptureVersion: 1,
      isCreator: false,
      hasParticipatingOwnership: true,
      hasCanonicalAccess: true,
      ownedPlayerIds: new Set([ownerPlayerId]),
      ownedAgentProfileIds: new Set(),
      ownedSeats: [{ playerId: ownerPlayerId, name: "Owner", agentProfileId: null }],
      roster: [
        { id: ownerPlayerId, name: "Owner", userId: ownerUserId, agentProfileId: null },
        { id: otherPlayerId, name: "Other", userId: otherUserId, agentProfileId: null },
      ],
    });

    const subjectOwnerAccess = {
      userId: ownerUserId,
      authProfile: "subject" as const,
      surfaceCapability: "subject_owner" as const,
      matchAccess,
    };

    const listed = await readModel.listArtifacts({ gameIdOrSlug: gameId, limit: 10 }, subjectOwnerAccess);
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error);
    const listedIds = listed.artifacts.map((a) => a.id).sort();
    expect(listedIds).toEqual([ownedReasoningId, ownedStrategyId, ownedThinkingId].sort());
    for (const noiseId of nonOwnedIds.slice(0, 5)) {
      expect(listedIds).not.toContain(noiseId);
    }

    const deniedOtherThinking = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: nonOwnedIds[0]!,
      artifactType: "thinking",
      actorPlayerId: otherPlayerId,
    }, subjectOwnerAccess);
    expect(deniedOtherThinking).toMatchObject({ ok: false, status: "denied" });

    // Non-owned artifact id with owned actor context is non-enumerating.
    const missingAsNotCaptured = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: nonOwnedIds[0]!,
      artifactType: "thinking",
      actorPlayerId: ownerPlayerId,
    }, subjectOwnerAccess);
    expect(missingAsNotCaptured).toMatchObject({ ok: false, status: "not_captured" });

    const ownedReasoning = await readModel.readArtifact({
      gameIdOrSlug: gameId,
      artifactId: ownedReasoningId,
      artifactType: "reasoning",
      actorPlayerId: ownerPlayerId,
    }, subjectOwnerAccess);
    expect(ownedReasoning.ok).toBe(true);

    // Producer/sysop metadata on subject_owner must not widen access.
    const elevatedSubject = {
      ...subjectOwnerAccess,
      roles: ["sysop", "producer"],
      permissions: ["view_admin", "manage_roles"],
    };
    const stillOwnerOnly = await readModel.listArtifacts({ gameIdOrSlug: gameId, limit: 50 }, elevatedSubject);
    expect(stillOwnerOnly.ok).toBe(true);
    if (!stillOwnerOnly.ok) throw new Error(stillOwnerOnly.error);
    expect(stillOwnerOnly.artifacts.every((a) =>
      a.actorPlayerId === ownerPlayerId
    )).toBe(true);
    expect(stillOwnerOnly.artifacts.map((a) => a.id).sort()).toEqual(
      [ownedReasoningId, ownedStrategyId, ownedThinkingId].sort(),
    );
  });

  test("denies created-only users before exposing old-game no-capture state", async () => {
    const gameId = randomUUID();
    const creatorUserId = randomUUID();
    await db.insert(schema.users).values({ id: creatorUserId });
    await db.insert(schema.games).values({
      id: gameId,
      slug: `test-${gameId}`,
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
      authProfile: "subject" as const,
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
      authProfile: "subject" as const,
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
      authProfile: "subject" as const,
      surfaceCapability: "participant_web" as const,
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
      slug: `test-${gameId}`,
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
    action?: string;
    phase?: string;
    visibilityStatus?: "active" | "capture_degraded";
    diagnostics?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    await db.insert(schema.gameCognitiveArtifacts).values({
      id: params.id,
      gameId: params.gameId,
      artifactType: params.artifactType,
      actorRole: "player",
      actorPlayerId: params.actorPlayerId,
      actorUserId: params.actorUserId,
      action: params.action ?? "vote",
      phase: params.phase,
      payloadByteLength: Buffer.byteLength(JSON.stringify(params.payload), "utf8"),
      payload: params.payload,
      visibilityStatus: params.visibilityStatus ?? "active",
      diagnostics: params.diagnostics,
      ...(params.createdAt && { createdAt: params.createdAt }),
    });
  }
});
