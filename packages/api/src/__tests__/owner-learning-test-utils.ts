import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type {
  OwnerLearningEvidenceProjection,
  OwnerLearningMaterializedEvidenceProjection,
} from "../services/owner-learning-evidence.js";
import type { OwnerLearningValidatedSelection } from "../services/owner-learning-eligibility.js";
import { resolveFreeTrackEffectiveRuntimeSnapshot } from "../services/agent-revisions.js";
import {
  REVISION_POLICY_VERSION,
  fingerprintEffectiveRuntimeSnapshot,
} from "../services/revision-policy.js";
import {
  startOwnerLearningReview,
  type OwnerLearningEvidenceProjector,
} from "../services/owner-learning-review.js";

export async function insertPlayedOwnerLearningAgent(
  db: DrizzleDB,
  input: {
    ownerUserId?: string;
    name?: string;
    completedAt?: string;
    trackType?: "free" | "custom";
  } = {},
): Promise<{
  ownerUserId: string;
  agentProfileId: string;
  revisionId: string;
  gameId: string;
  playerId: string;
  gameEvidenceId: string;
}> {
  const ownerUserId = input.ownerUserId ?? randomUUID();
  if (!input.ownerUserId) await db.insert(schema.users).values({ id: ownerUserId });
  const agentProfileId = randomUUID();
  const revisionId = randomUUID();
  const gameId = randomUUID();
  const playerId = randomUUID();
  const gameEvidenceId = randomUUID();
  const completedAt = input.completedAt ?? "2026-08-04T01:00:00.000Z";
  const profile = {
    id: agentProfileId,
    userId: ownerUserId,
    name: `${input.name ?? "Learning agent"} ${agentProfileId.slice(0, 8)}`,
    backstory: null,
    personality: "Observant",
    strategyStyle: "Build trust before committing.",
    personaKey: null,
  };
  await db.insert(schema.agentProfiles).values(profile);
  const effectiveRuntimeSnapshot = resolveFreeTrackEffectiveRuntimeSnapshot(profile);
  await db.insert(schema.agentRevisions).values({
    id: revisionId,
    agentProfileId,
    ordinal: 1,
    trigger: "profile_create",
    magnitude: "initial",
    fingerprint: fingerprintEffectiveRuntimeSnapshot(effectiveRuntimeSnapshot),
    behaviorSnapshot: {
      name: profile.name,
      personality: profile.personality,
      backstory: profile.backstory,
      strategyInstructions: profile.strategyStyle,
      personaKey: profile.personaKey,
    },
    effectiveRuntimeSnapshot: effectiveRuntimeSnapshot as unknown as Record<string, unknown>,
    revisionPolicyVersion: REVISION_POLICY_VERSION,
  });
  await db.update(schema.agentProfiles).set({ currentRevisionId: revisionId })
    .where(eq(schema.agentProfiles.id, agentProfileId));
  await db.insert(schema.games).values({
    id: gameId,
    slug: `learning-${gameId}`,
    config: "{}",
    status: "completed",
    trackType: input.trackType ?? "free",
    endedAt: completedAt,
    minPlayers: 2,
    maxPlayers: 4,
  });
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId,
    userId: ownerUserId,
    agentProfileId,
    agentRevisionId: revisionId,
    persona: JSON.stringify({ name: "Learner", personality: "Observant" }),
    agentConfig: "{}",
  });
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    roundsPlayed: 4,
    tokenUsage: "{}",
    finishedAt: completedAt,
  });
  await db.insert(schema.agentLearningGameEvidence).values({
    id: gameEvidenceId,
    ownerUserId,
    agentProfileId,
    analyticalRevisionId: revisionId,
    gameId,
    evidenceVersion: "owner-learning-evidence-v2",
    eligibilityPolicyVersion: "owner-learning-eligibility-v1",
    completionAt: completedAt,
    canonicalSnapshot: { reviewedPlayer: { eliminatedRound: 4 } },
    candidateMoments: [],
    sourceCaptureVersion: "postgame-v2:transcript-v0:cognition-v0",
    sourceHash: `sha256:${gameId}`,
  });
  return { ownerUserId, agentProfileId, revisionId, gameId, playerId, gameEvidenceId };
}

export function fakeOwnerLearningProjection(
  selection: OwnerLearningValidatedSelection,
  gameEvidenceIds: ReadonlyMap<string, string>,
  analysisTrack: OwnerLearningEvidenceProjection["analysisTrack"] = "evidence_rich",
): OwnerLearningMaterializedEvidenceProjection {
  return {
    analysisTrack,
    games: selection.games.map((game) => ({
      gameId: game.gameId,
      gameEvidenceId: gameEvidenceIds.get(game.gameId)!,
      canonicalFacts: {
        game: {
          id: game.gameId,
          slug: game.slug,
          completionAt: game.completionAt,
          roundCount: 4,
          playerCount: 8,
        },
        reviewedPlayer: {
          id: game.playerId,
          placement: 4,
          status: "eliminated",
          won: false,
          eliminatedRound: 4,
          readableSummary: "The agent reached round four.",
        },
        actionsByAgent: {
          votesCastByRound: [],
          formatBallotsCastByRound: [],
          councilVotesCast: [],
          powersUsed: [],
        },
        actionsAgainstAgent: {
          empowerVotesReceivedByRound: [],
          exposeVotesReceivedByRound: [],
          councilVotesReceived: [],
          timesNominated: [],
          shieldsReceived: [],
        },
        factAvailability: {
          overall: "available",
          actionsByAgent: "available",
          actionsAgainstAgent: "available",
        },
        diagnostics: [],
      },
      narrativeGroups: [],
      narrativeCoverage: "rich",
      candidateMoments: [],
      sourceHash: `sha256:${game.gameId}`,
      sourceCaptureVersion: "postgame-v2:transcript-v0:cognition-v0",
    })),
    reviewInput: {
      instructions: "Review the supplied evidence.",
      games: selection.games.map((game) => ({
        gameId: game.gameId,
        canonicalFacts: {},
        candidateMomentIds: [],
        narrativeGroups: [],
        omittedNarrativeGroupCount: 0,
      })),
    },
  };
}

export async function startFixtureOwnerLearningReview(
  db: DrizzleDB,
  fixture: Awaited<ReturnType<typeof insertPlayedOwnerLearningAgent>>,
  options: { now?: Date; idempotencyKey?: string } = {},
): Promise<string> {
  const projector: OwnerLearningEvidenceProjector = async (_db, selection) =>
    fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
  const result = await startOwnerLearningReview(db, {
    ownerUserId: fixture.ownerUserId,
    agentProfileId: fixture.agentProfileId,
    gameIds: [fixture.gameId],
    idempotencyKey: options.idempotencyKey ?? `fixture-${fixture.gameId}`,
  }, {
    projector,
    now: options.now ?? new Date("2026-08-04T03:00:00.000Z"),
  });
  if (!result.reviewId) throw new Error(`Expected fixture review, received ${result.status}`);
  return result.reviewId;
}
