import { describe, expect, test, beforeEach } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { PrivateDecisionTrace } from "@influence/engine";
import { Phase } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  COGNITIVE_ARTIFACT_CAPTURE_VERSION,
  MAX_COGNITIVE_ARTIFACT_PAYLOAD_BYTES,
  extractCognitiveArtifactDrafts,
  writeCognitiveArtifactsForTrace,
} from "../services/cognitive-artifact-writer.js";
import { setupTestDB } from "./test-utils.js";

describe("cognitive artifact writer", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  async function createGamePlayer() {
    const gameId = randomUUID();
    const userId = randomUUID();
    const agentProfileId = randomUUID();
    const playerId = randomUUID();

    await db.insert(schema.users)
      .values({ id: userId, displayName: "Artifact Owner" });
    await db.insert(schema.agentProfiles)
      .values({
        id: agentProfileId,
        userId,
        name: "Atlas",
        personality: "strategic",
      });
    await db.insert(schema.games)
      .values({
        id: gameId,
        config: "{}",
        status: "in_progress",
        cognitiveArtifactCaptureVersion: COGNITIVE_ARTIFACT_CAPTURE_VERSION,
      });
    await db.insert(schema.gamePlayers)
      .values({
        id: playerId,
        gameId,
        userId,
        agentProfileId,
        persona: JSON.stringify({ name: "Atlas" }),
        agentConfig: "{}",
      });

    return { gameId, userId, agentProfileId, playerId };
  }

  function traceForPlayer(playerId: string): PrivateDecisionTrace {
    return {
      version: 2,
      action: "vote",
      actor: {
        id: playerId,
        name: "Atlas",
        role: "player",
      },
      phase: Phase.VOTE,
      round: 2,
      createdAt: new Date("2026-06-19T12:00:00.000Z").toISOString(),
      model: {
        provider: "test",
        name: "gpt-test",
      },
      prompt: {
        messages: [
          { role: "system", content: "SECRET PROMPT SHOULD NOT BE STORED" },
          { role: "user", content: "Visible context" },
        ],
      },
      response: {
        raw: { content: "RAW RESPONSE SECRET SHOULD NOT BE STORED" },
        finishReason: "stop",
        content: "model content secret should not be stored",
      },
      output: {
        arbitrarySecret: "OUTPUT SECRET SHOULD NOT BE STORED",
        thinking: "emit the decoy from raw output",
      },
      emittedThinking: "I should vote against the unstable coalition.",
      reasoningContext: "Native reasoning says the vote math points at Vera.",
      toolName: "cast_vote",
      toolArguments: {
        apiKeyLikeValue: "TOOL ARG SECRET SHOULD NOT BE STORED",
      },
      decisionLog: "Vera is gaining too much cover, so I am applying pressure.",
      strategicLens: "vote_math",
      strategicLensRationale: "The expose and empower incentives make Vera the highest leverage vote.",
      strategyPacketRevision: "r2-vote-1",
      strategyPacketSummary: {
        revisionId: "r2-vote-1",
        previousRevisionId: "r1-reflection-1",
        updatedAtRound: 2,
        updatedAtPhase: Phase.VOTE,
        objective: "Keep the coalition flexible while testing Vera.",
        targetPosture: "Pressure Vera unless new evidence clears her.",
        coalitionPosture: "Stay close to Mira without overcommitting.",
        nextSocialProbe: "Ask Finn whether Vera promised protection.",
        strategicLens: "vote_math",
        strategicLensRationale: "Vote incentives are exposing the real coalition.",
        uncertainty: "Mira may be shielding Vera.",
        reviseTrigger: "Vera loses room traffic support.",
        changedSincePrevious: "The vote board made Vera more central.",
      },
    };
  }

  test("extracts only whitelisted reasoning, thinking, and strategy fields", async () => {
    const { gameId, playerId, userId, agentProfileId } = await createGamePlayer();
    const trace = traceForPlayer(playerId);

    const drafts = extractCognitiveArtifactDrafts(trace);
    expect(drafts.map((draft) => draft.artifactType).sort()).toEqual(["reasoning", "strategy", "thinking"]);

    const result = await writeCognitiveArtifactsForTrace(db, {
      gameId,
      trace,
      captureVersion: COGNITIVE_ARTIFACT_CAPTURE_VERSION,
    });

    expect(result.ok).toBe(true);
    expect(result.artifactIds).toHaveLength(3);

    const rows = await db
      .select()
      .from(schema.gameCognitiveArtifacts)
      .where(eq(schema.gameCognitiveArtifacts.gameId, gameId));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.actorPlayerId === playerId)).toBe(true);
    expect(rows.every((row) => row.actorUserId === userId)).toBe(true);
    expect(rows.every((row) => row.actorAgentProfileId === agentProfileId)).toBe(true);

    const serializedPayloads = JSON.stringify(rows.map((row) => row.payload));
    expect(serializedPayloads).toContain("Native reasoning says the vote math points at Vera.");
    expect(serializedPayloads).toContain("I should vote against the unstable coalition.");
    expect(serializedPayloads).toContain("Vera is gaining too much cover");
    expect(serializedPayloads).toContain("strategyPacketSummary");
    expect(serializedPayloads).not.toContain("SECRET PROMPT SHOULD NOT BE STORED");
    expect(serializedPayloads).not.toContain("RAW RESPONSE SECRET SHOULD NOT BE STORED");
    expect(serializedPayloads).not.toContain("TOOL ARG SECRET SHOULD NOT BE STORED");
    expect(serializedPayloads).not.toContain("OUTPUT SECRET SHOULD NOT BE STORED");
  });

  test("skips games without capture enabled", async () => {
    const { gameId, playerId } = await createGamePlayer();

    const result = await writeCognitiveArtifactsForTrace(db, {
      gameId,
      trace: traceForPlayer(playerId),
      captureVersion: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.skippedReason).toBe("capture_disabled");

    const rows = await db
      .select()
      .from(schema.gameCognitiveArtifacts)
      .where(eq(schema.gameCognitiveArtifacts.gameId, gameId));
    expect(rows).toHaveLength(0);
  });

  test("stores oversized payloads as degraded diagnostics without partial payload", async () => {
    const { gameId, playerId } = await createGamePlayer();
    const trace: PrivateDecisionTrace = {
      ...traceForPlayer(playerId),
      emittedThinking: "x".repeat(MAX_COGNITIVE_ARTIFACT_PAYLOAD_BYTES + 1),
      reasoningContext: undefined,
      decisionLog: undefined,
      strategicLens: undefined,
      strategicLensRationale: undefined,
      strategyPacketRevision: undefined,
      strategyPacketSummary: undefined,
    };

    const result = await writeCognitiveArtifactsForTrace(db, {
      gameId,
      trace,
      captureVersion: COGNITIVE_ARTIFACT_CAPTURE_VERSION,
    });

    expect(result.ok).toBe(true);
    expect(result.artifactIds).toHaveLength(0);
    expect(result.degradedArtifactIds).toHaveLength(1);

    const rows = await db
      .select()
      .from(schema.gameCognitiveArtifacts)
      .where(eq(schema.gameCognitiveArtifacts.gameId, gameId));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.visibilityStatus).toBe("capture_degraded");
    expect(rows[0]!.payloadByteLength).toBe(0);
    expect(rows[0]!.payload).toEqual({});
    expect(rows[0]!.diagnostics).toMatchObject({
      reason: "payload_too_large",
      maxPayloadByteLength: MAX_COGNITIVE_ARTIFACT_PAYLOAD_BYTES,
    });
  });
});
