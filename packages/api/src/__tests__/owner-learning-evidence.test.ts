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
  buildBudgetedOwnerLearningInput,
  mintOwnerLearningMomentId,
  ownerLearningIssuedEvidenceRefs,
  projectOwnerLearningEvidence,
  resolveOwnerLearningMoment,
  type OwnerLearningEvidenceProjection,
} from "../services/owner-learning-evidence.js";
import { OWNER_LEARNING_INPUT_TOKEN_LIMIT } from "../services/owner-learning-evidence.js";
import {
  OWNER_LEARNING_FINAL_HARNESS_RESPONSE_SCHEMA,
  OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA,
} from "../services/owner-learning-harness.js";
import {
  buildBudgetedOwnerLearningProviderInput,
  estimateOwnerLearningProviderCallTokens,
} from "../services/owner-learning-provider-context.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("owner learning evidence", () => {
  test("mints stable opaque moment IDs from durable coordinates", () => {
    const coordinate = {
      gameId: "game-1",
      reviewedAgentProfileId: "profile-1",
      evidenceVersion: "owner-learning-evidence-v2",
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

  test("compacts three full endgame games under the complete provider budget", () => {
    const input = buildBudgetedOwnerLearningInput({
      instructions: "Analyze only the supplied evidence.",
      currentStrategyStyle: "Build trust before committing.",
      games: ["game-1", "game-2", "game-3"].map((gameId) => ({
        gameId,
        canonicalFacts: { placement: 4, eliminatedRound: 2 },
        candidateMomentIds: Array.from({ length: 240 }, (_, index) => `olm_${gameId}_${index}`),
        narrativeGroups: Array.from({ length: 240 }, (_, index) => ({
          corr: "exact" as const,
          decisionId: `${gameId}:decision:${index}`,
          round: index % 13 + 1,
          text: "x".repeat(600),
          thinking: "y".repeat(600),
          strategy: "z".repeat(600),
        })),
      })),
    });
    expect(input.games.map((game) => game.gameId)).toEqual(["game-1", "game-2", "game-3"]);
    expect(input.games.every((game) => game.narrativeGroups.length === 240)).toBe(true);

    const evidence = stressEvidenceProjection(input);
    const first = buildBudgetedOwnerLearningProviderInput({
      stage: "scanning_narratives",
      turn: {
        analysisTrack: "strategy_health_check",
        currentStrategyStyle: input.currentStrategyStyle,
        evidence: input,
        callBudget: { ordinal: 1, remainingAfterThisCall: 3, finalResultRequired: false },
      },
      evidence,
      responseSchema: OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA,
    });
    const second = buildBudgetedOwnerLearningProviderInput({
      stage: "scanning_narratives",
      turn: {
        analysisTrack: "strategy_health_check",
        currentStrategyStyle: input.currentStrategyStyle,
        evidence: input,
        callBudget: { ordinal: 1, remainingAfterThisCall: 3, finalResultRequired: false },
      },
      evidence,
      responseSchema: OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA,
    });
    expect(first.estimatedTokens).toBeLessThanOrEqual(OWNER_LEARNING_INPUT_TOKEN_LIMIT);
    expect(estimateOwnerLearningProviderCallTokens(first.input, OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA))
      .toBe(first.estimatedTokens);
    expect(first.input).toEqual(second.input);
    const serialized = JSON.stringify(first.input);
    expect(serialized).not.toContain("olm_");
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toContain("owner-learning-evidence-v2");
    expect(serialized).not.toContain("candidateMomentIds");
    expect(serialized).not.toContain("issuedEvidenceRefs");
    expect(serialized).toContain('"formatBallots"');
    const providerTurn = first.input.turn as {
      evidence: {
        games: Array<{
          game: string;
          summaryHandle: string;
          canonical: {
            actionsByAgent: {
              formatBallots: Array<{
                round: number;
                format: string;
                target: string | null;
                polarity: string | null;
              }>;
            };
          };
          moments: Array<{ round?: number; text?: string; thinking?: string }>;
          omittedMomentCount: number;
        }>;
      };
    };
    expect(providerTurn.evidence.games.map((game) => game.game)).toEqual(["g1", "g2", "g3"]);
    expect(providerTurn.evidence.games.every((game) => game.summaryHandle.endsWith(":s"))).toBe(true);
    expect(providerTurn.evidence.games[0]!.canonical.actionsByAgent.formatBallots[0]).toEqual({
      round: 1,
      format: "vote_bomb",
      target: "format-target-1 1",
      polarity: null,
    });
    expect(providerTurn.evidence.games.every((game) => game.moments.length > 0)).toBe(true);
    expect(providerTurn.evidence.games.every((game) => game.omittedMomentCount > 0)).toBe(true);
    expect(providerTurn.evidence.games.every((game) =>
      game.moments.some((moment) => (moment.round ?? 0) <= 4)
      && game.moments.some((moment) => (moment.round ?? 0) >= 5 && (moment.round ?? 0) <= 8)
      && game.moments.some((moment) => (moment.round ?? 0) >= 9)
      && game.moments.some((moment) => moment.text && moment.thinking)
    )).toBe(true);
    for (const game of providerTurn.evidence.games) {
      const bucketCounts = game.moments.reduce((counts, moment) => {
        const round = moment.round ?? 1;
        const bucket = round <= 4 ? 0 : round <= 8 ? 1 : 2;
        counts[bucket] = (counts[bucket] ?? 0) + 1;
        return counts;
      }, [0, 0, 0]);
      expect(Math.max(...bucketCounts) - Math.min(...bucketCounts)).toBeLessThanOrEqual(1);
    }

    const selectedGame = evidence.games[0]!;
    const selectedMoment = selectedGame.candidateMoments[0]!;
    const citedRef = ownerLearningIssuedEvidenceRefs(evidence.games).find((ref) =>
      ref.coordinate === selectedMoment.id
    )!;
    const finalDive = buildBudgetedOwnerLearningProviderInput({
      stage: "investigating_moments",
      turn: {
        analysisTrack: "strategy_health_check",
        currentStrategyStyle: input.currentStrategyStyle,
        provisionalThemes: ["initiative"],
        validatedFindings: [{
          evidenceRefs: [citedRef],
          observation: "The agent repeatedly yielded initiative. ".repeat(30),
          interpretation: "The current guidance lacks a concrete fallback. ".repeat(30),
        }],
        momentBundle: {
          moment: selectedMoment,
          canonicalFacts: selectedGame.canonicalFacts,
          surroundingDialogue: selectedGame.narrativeGroups.slice(0, 3),
        },
        evidence: input,
        callBudget: { ordinal: 4, remainingAfterThisCall: 0, finalResultRequired: true },
      },
      evidence,
      responseSchema: OWNER_LEARNING_FINAL_HARNESS_RESPONSE_SCHEMA,
    });
    expect(finalDive.estimatedTokens).toBeLessThanOrEqual(OWNER_LEARNING_INPUT_TOKEN_LIMIT);
    expect(JSON.stringify(finalDive.input)).not.toContain(selectedMoment.id);
    expect(JSON.stringify(finalDive.input)).not.toContain(citedRef.sourceHash);
    const compactDiveCanonical = ((finalDive.input.turn as {
      momentBundle: {
        canonical: {
          focusRound: number | null;
          actionsByAgent: Record<string, Array<{ round: number }>>;
          actionsAgainstAgent: Record<string, Array<{ round: number }>>;
        };
      };
    }).momentBundle.canonical);
    expect(compactDiveCanonical.focusRound).toBe(selectedMoment.round);
    const compactDiveRounds = [
      ...Object.values(compactDiveCanonical.actionsByAgent),
      ...Object.values(compactDiveCanonical.actionsAgainstAgent),
    ].flat().map((entry) => entry.round);
    expect(new Set(compactDiveRounds)).toEqual(new Set([selectedMoment.round!]));
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

function stressEvidenceProjection(
  reviewInput: OwnerLearningEvidenceProjection["reviewInput"],
): OwnerLearningEvidenceProjection {
  const games = reviewInput.games.map((inputGame, gameIndex) => {
    const gameId = inputGame.gameId;
    const player = (suffix: string) => ({ id: `${gameId}-${suffix}`, name: `${suffix} ${gameIndex + 1}` });
    const rounds = Array.from({ length: 13 }, (_, index) => index + 1);
    return {
      gameId,
      gameEvidenceId: `evidence-${gameId}`,
      canonicalFacts: {
        game: {
          id: gameId,
          slug: `full-endgame-${gameIndex + 1}`,
          completionAt: `2026-08-0${gameIndex + 1}T00:00:00.000Z`,
          roundCount: 13,
          playerCount: 12,
        },
        reviewedPlayer: {
          id: `${gameId}-reviewed-player`,
          placement: 2,
          status: "finalist" as const,
          won: false,
          eliminatedRound: null,
          readableSummary: "Reached the final council after thirteen rounds. ".repeat(20),
        },
        actionsByAgent: {
          votesCastByRound: rounds.map((round) => ({
            round,
            empowerTarget: player(`ally-${round}`),
            exposeTarget: player(`rival-${round}`),
            revoteEmpowerTarget: null,
          })),
          formatBallotsCastByRound: rounds.map((round) => ({
            round,
            formatId: "vote_bomb" as const,
            target: player(`format-target-${round}`),
            polarity: null,
          })),
          councilVotesCast: rounds.map((round) => ({ round, target: player(`target-${round}`) })),
          powersUsed: rounds.map((round) => ({ round, action: "protect" as const, target: player(`ally-${round}`) })),
        },
        actionsAgainstAgent: {
          empowerVotesReceivedByRound: rounds.map((round) => ({ round, votes: round % 4 })),
          exposeVotesReceivedByRound: rounds.map((round) => ({ round, votes: round % 3 })),
          councilVotesReceived: rounds.map((round) => ({ round, votes: round % 2 })),
          timesNominated: rounds.map((round) => ({
            round,
            candidates: Array.from({ length: 12 }, (_, candidateIndex) =>
              player(`candidate-${round}-${candidateIndex}-${"n".repeat(60)}`)
            ),
            eliminated: false,
          })),
          shieldsReceived: rounds.map((round) => ({ round, from: player(`ally-${round}`) })),
        },
        factAvailability: {
          overall: "available" as const,
          actionsByAgent: "available" as const,
          actionsAgainstAgent: "available" as const,
        },
        diagnostics: Array.from({ length: 40 }, (_, index) => ({
          code: `diagnostic-${index}`,
          severity: "warning" as const,
          message: "diagnostic detail ".repeat(30),
        })),
      },
      narrativeGroups: inputGame.narrativeGroups,
      narrativeCoverage: "rich" as const,
      candidateMoments: inputGame.narrativeGroups.map((group, index) => ({
        id: `olm_${gameId}_${index}`,
        gameId,
        anchorKind: index % 3 === 0
          ? "decision" as const
          : index % 3 === 1
            ? "dialogue" as const
            : "cognition" as const,
        sourceCoordinate: `decision:${gameId}:decision:${index}`,
        sourceHash: `sha256:${gameId}:${index}`,
        round: group.round ?? null,
        phase: "MINGLE",
      })),
      sourceHash: `sha256:${gameId}`,
      sourceCaptureVersion: "owner-learning-evidence-v2",
    };
  });
  return { analysisTrack: "strategy_health_check", games, reviewInput };
}

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
