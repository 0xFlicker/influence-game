import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_GAME_ID,
  EDGE_SMOKE_DUSK_PLAYERS,
  createEdgeSmokeDuskEvents,
} from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { appendGameEvents } from "../services/game-events.js";
import {
  OWNER_LEARNING_INPUT_TOKEN_LIMIT,
  buildBudgetedOwnerLearningProviderInput,
  buildBudgetedOwnerLearningInput,
  estimateOwnerLearningInputTokens,
  mintOwnerLearningMomentId,
  projectOwnerLearningEvidence,
  resolveOwnerLearningMoment,
} from "../services/owner-learning-evidence.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("owner learning evidence", () => {
  test("mints stable opaque moment IDs from durable coordinates", () => {
    const coordinate = {
      gameId: "game-1",
      reviewedAgentProfileId: "profile-1",
      evidenceVersion: "owner-learning-evidence-v1",
      anchorKind: "decision" as const,
      sourceCoordinate: "decision:3c6a",
      windowVersion: "owner-learning-window-v1",
    };
    const first = mintOwnerLearningMomentId(coordinate);
    expect(mintOwnerLearningMomentId({ ...coordinate })).toBe(first);
    expect(mintOwnerLearningMomentId({
      ...coordinate,
      sourceCoordinate: "decision:other",
    })).not.toBe(first);
    expect(first).toMatch(/^olm_[A-Za-z0-9_-]{43}$/);
  });

  test("resolves only server-issued candidates", () => {
    const candidate = {
      id: "olm_candidate",
      gameId: "game-1",
      anchorKind: "canonical_event" as const,
      sourceCoordinate: "event:12",
      sourceHash: "sha256:source",
      round: 2,
      phase: "VOTE",
    };
    expect(resolveOwnerLearningMoment([candidate], candidate.id)).toEqual(candidate);
    expect(() => resolveOwnerLearningMoment([candidate], "olm_invented")).toThrow(
      "not part of this review",
    );
  });

  test("uses one estimator and retains every game when narratives need truncation", () => {
    const input = buildBudgetedOwnerLearningInput({
      instructions: "Analyze only the supplied evidence.",
      currentStrategyStyle: "Build trust before committing.",
      games: ["game-1", "game-2", "game-3"].map((gameId) => ({
        gameId,
        canonicalFacts: { placement: 4, eliminatedRound: 2 },
        candidateMomentIds: [`${gameId}:moment`],
        narrativeGroups: Array.from({ length: 120 }, (_, index) => ({
          corr: "exact" as const,
          decisionId: `${gameId}:decision:${index}`,
          text: "x".repeat(600),
          thinking: "y".repeat(600),
        })),
      })),
    });

    expect(estimateOwnerLearningInputTokens(input)).toBeLessThanOrEqual(
      OWNER_LEARNING_INPUT_TOKEN_LIMIT,
    );
    expect(input.games.map((game) => game.gameId)).toEqual(["game-1", "game-2", "game-3"]);
    expect(input.games.every((game) => game.omittedNarrativeGroupCount > 0)).toBe(true);
    expect(input.games.every((game) => game.candidateMomentIds.length === 1)).toBe(true);

    const providerInput = buildBudgetedOwnerLearningProviderInput("scanning_narratives", {
      analysisTrack: "strategy_health_check",
      evidence: input,
      issuedEvidenceRefs: Array.from({ length: 60 }, (_, index) => ({
        kind: "canonical_event",
        gameId: `game-${index % 3 + 1}`,
        coordinate: `olm_${"z".repeat(43)}_${index}`,
        sourceHash: `sha256:${"a".repeat(64)}`,
        sourceVersion: "owner-learning-evidence-v1",
      })),
    });
    expect(estimateOwnerLearningInputTokens(providerInput)).toBeLessThanOrEqual(
      OWNER_LEARNING_INPUT_TOKEN_LIMIT,
    );
    const providerTurn = providerInput.turn as { evidence: typeof input };
    expect(providerTurn.evidence.games.map((game) => game.gameId)).toEqual([
      "game-1",
      "game-2",
      "game-3",
    ]);
    expect(providerTurn.evidence.games.every((game) => game.omittedNarrativeGroupCount > 0)).toBe(true);
  });

  test("projects canonical facts, paginated dialogue, and only the reviewed Profile's cognition", async () => {
    const db = await setupTestDB();
    const fixture = await insertProjectionFixture(db);

    const projection = await projectOwnerLearningEvidence(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      agentProfileName: EDGE_SMOKE_DUSK_PLAYERS.lilith.name,
      currentRevisionId: fixture.revisionId,
      strategyStyle: "Build trust before committing.",
      games: [{
        gameId: EDGE_SMOKE_DUSK_GAME_ID,
        slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
        playerId: EDGE_SMOKE_DUSK_PLAYERS.lilith.id,
        completionAt: fixture.completionAt,
        analyticalRevisionId: fixture.revisionId,
        transcriptCaptureVersion: 1,
        cognitiveArtifactCaptureVersion: 1,
        previouslyAnalyzed: false,
      }],
    }, {
      instructions: "Review only the supplied evidence.",
      cursorSecret: "owner-learning-evidence-test-secret-aaaaaaaa",
    });

    expect(projection.analysisTrack).toBe("evidence_rich");
    expect(projection.games).toHaveLength(1);
    const game = projection.games[0]!;
    expect(game.canonicalFacts.reviewedPlayer.id).toBe(EDGE_SMOKE_DUSK_PLAYERS.lilith.id);
    expect(game.canonicalFacts.actionsByAgent.votesCastByRound.length).toBeGreaterThan(0);
    expect(game.narrativeGroups.length).toBeGreaterThan(50);
    const narrative = JSON.stringify(game.narrativeGroups);
    expect(narrative).toContain("PUBLIC_DIALOGUE_SENTINEL_55");
    expect(narrative).toContain("REVIEWED_PROFILE_COGNITION_SENTINEL");
    expect(narrative).not.toContain("OTHER_OWNED_PROFILE_COGNITION_SENTINEL");
    expect(narrative).not.toContain("OPPONENT_COGNITION_SENTINEL");
    expect(game.candidateMoments.every((moment) => moment.id.startsWith("olm_"))).toBe(true);
    expect(new Set(game.candidateMoments.map((moment) => moment.id)).size)
      .toBe(game.candidateMoments.length);
    expect(JSON.stringify(projection.reviewInput)).toContain("REVIEWED_PROFILE_COGNITION_SENTINEL");
    expect(JSON.stringify(projection.reviewInput)).not.toContain("OPPONENT_COGNITION_SENTINEL");

    const stored = (await db.select().from(schema.agentLearningGameEvidence))[0]!;
    expect(stored).toMatchObject({
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      analyticalRevisionId: fixture.revisionId,
      gameId: EDGE_SMOKE_DUSK_GAME_ID,
      sourceHash: game.sourceHash,
    });
    expect(stored.candidateMoments).toEqual(
      game.candidateMoments as unknown as Array<Record<string, unknown>>,
    );
  });
});

async function insertProjectionFixture(db: DrizzleDB): Promise<{
  ownerUserId: string;
  agentProfileId: string;
  revisionId: string;
  completionAt: string;
}> {
  const ownerUserId = "owner-learning-projection-owner";
  const agentProfileId = "owner-learning-projection-profile";
  const otherOwnedProfileId = "owner-learning-other-owned-profile";
  const revisionId = "owner-learning-projection-revision";
  const completionAt = "2026-07-01T00:00:00.000Z";
  await db.insert(schema.users).values({ id: ownerUserId });
  await db.insert(schema.agentProfiles).values([
    {
      id: agentProfileId,
      userId: ownerUserId,
      name: EDGE_SMOKE_DUSK_PLAYERS.lilith.name,
      personality: "Precise and patient.",
      strategyStyle: "Build trust before committing.",
    },
    {
      id: otherOwnedProfileId,
      userId: ownerUserId,
      name: "Other owned profile",
      personality: "Unrelated owned cognition.",
    },
  ]);
  await db.insert(schema.agentRevisions).values({
    id: revisionId,
    agentProfileId,
    ordinal: 1,
    trigger: "profile_create",
    magnitude: "initial",
    fingerprint: `sha256:${"a".repeat(64)}`,
    behaviorSnapshot: { strategyStyle: "Build trust before committing." },
    effectiveRuntimeSnapshot: {},
    revisionPolicyVersion: "agent-revision-v2",
  });
  await db.update(schema.agentProfiles).set({ currentRevisionId: revisionId })
    .where(eq(schema.agentProfiles.id, agentProfileId));
  await db.insert(schema.games).values({
    id: EDGE_SMOKE_DUSK_GAME_ID,
    slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
    config: JSON.stringify({ maxRounds: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed }),
    status: "completed",
    trackType: "free",
    transcriptCaptureVersion: 1,
    cognitiveArtifactCaptureVersion: 1,
    minPlayers: 8,
    maxPlayers: 8,
    endedAt: completionAt,
  });
  const otherOwnedPlayer = EDGE_SMOKE_DUSK_PLAYERS.shadowtech;
  await db.insert(schema.gamePlayers).values(Object.values(EDGE_SMOKE_DUSK_PLAYERS).map((player) => ({
    id: player.id,
    gameId: EDGE_SMOKE_DUSK_GAME_ID,
    userId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id || player.id === otherOwnedPlayer.id
      ? ownerUserId
      : null,
    agentProfileId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id
      ? agentProfileId
      : player.id === otherOwnedPlayer.id
        ? otherOwnedProfileId
        : null,
    agentRevisionId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id ? revisionId : null,
    persona: JSON.stringify({ name: player.name, personality: `${player.name} fixture persona` }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  })));
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId: EDGE_SMOKE_DUSK_GAME_ID,
    winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
    roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
    tokenUsage: "{}",
    finishedAt: completionAt,
  });
  const ownerEpoch = await insertOwner(db, EDGE_SMOKE_DUSK_GAME_ID);
  await appendGameEvents(db, {
    gameId: EDGE_SMOKE_DUSK_GAME_ID,
    ownerEpoch,
    events: createEdgeSmokeDuskEvents(EDGE_SMOKE_DUSK_GAME_ID),
  });
  await db.insert(schema.gameTranscriptStates).values({
    ...initialGameTranscriptStateValues(EDGE_SMOKE_DUSK_GAME_ID, 1),
    durableSequence: 55,
    durableCount: 55,
  });
  await db.insert(schema.transcripts).values(Array.from({ length: 55 }, (_, index) => ({
    gameId: EDGE_SMOKE_DUSK_GAME_ID,
    round: 1,
    phase: "LOBBY",
    fromPlayerId: EDGE_SMOKE_DUSK_PLAYERS.lilith.id,
    scope: "public" as const,
    text: `PUBLIC_DIALOGUE_SENTINEL_${index + 1}`,
    thinking: null,
    timestamp: 1_000 + index,
    entrySequence: index + 1,
    speakerPlayerId: EDGE_SMOKE_DUSK_PLAYERS.lilith.id,
    audiencePlayerIds: [],
    captureVersion: 1,
    dialogueKind: "public_speech" as const,
    safeContext: { version: 1 as const },
  })));
  await db.insert(schema.gameCognitiveArtifacts).values([
    cognitionRow({
      id: "reviewed-cognition",
      playerId: EDGE_SMOKE_DUSK_PLAYERS.lilith.id,
      userId: ownerUserId,
      agentProfileId,
      thinking: "REVIEWED_PROFILE_COGNITION_SENTINEL",
    }),
    cognitionRow({
      id: "other-owned-cognition",
      playerId: otherOwnedPlayer.id,
      userId: ownerUserId,
      agentProfileId: otherOwnedProfileId,
      thinking: "OTHER_OWNED_PROFILE_COGNITION_SENTINEL",
    }),
    cognitionRow({
      id: "opponent-cognition",
      playerId: EDGE_SMOKE_DUSK_PLAYERS.ember.id,
      thinking: "OPPONENT_COGNITION_SENTINEL",
    }),
  ]);
  return { ownerUserId, agentProfileId, revisionId, completionAt };
}

function cognitionRow(input: {
  id: string;
  playerId: string;
  userId?: string;
  agentProfileId?: string;
  thinking: string;
}) {
  const payload = { thinking: input.thinking };
  return {
    id: input.id,
    gameId: EDGE_SMOKE_DUSK_GAME_ID,
    artifactType: "thinking" as const,
    actorRole: "player" as const,
    actorPlayerId: input.playerId,
    actorUserId: input.userId,
    actorAgentProfileId: input.agentProfileId,
    action: "mingle-turn",
    phase: "LOBBY",
    round: 1,
    payloadByteLength: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    payload,
    visibilityStatus: "active" as const,
    createdAt: "2026-07-01T00:00:01.000Z",
  };
}
