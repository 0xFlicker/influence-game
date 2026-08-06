import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PostgamePlayerGameSummary } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { CompactV2Group } from "./match-narrative-compact-v2.js";
import {
  MATCH_NARRATIVE_MAX_LIMIT,
  readMatchNarrativePage,
} from "./match-narrative-read-model.js";
import {
  OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
  OWNER_LEARNING_EVIDENCE_VERSION,
  type OwnerLearningAnalysisTrack,
  type OwnerLearningEvidenceRef,
} from "./owner-learning-contracts.js";
import {
  classifyOwnerLearningEvidence,
  type OwnerLearningNarrativeCoverage,
  type OwnerLearningValidatedSelection,
} from "./owner-learning-eligibility.js";
import { getPostgameAnalysis } from "./postgame-analysis.js";
import { sha256StableJson, stableJson } from "./stable-hash.js";

export const OWNER_LEARNING_INPUT_TOKEN_LIMIT = 32_000;
export const OWNER_LEARNING_ENVELOPE_ALLOWANCE_TOKENS = 2_048;
export const OWNER_LEARNING_TOKEN_ESTIMATOR_CHARS_PER_TOKEN = 4;
export const OWNER_LEARNING_MOMENT_WINDOW_VERSION = "owner-learning-window-v1";
export const OWNER_LEARNING_MOMENT_NORMALIZATION_VERSION = "owner-learning-moment-v1";
export const OWNER_LEARNING_NARRATIVE_PAGE_LIMIT = MATCH_NARRATIVE_MAX_LIMIT;

export type OwnerLearningMomentAnchorKind =
  | "canonical_event"
  | "decision"
  | "dialogue"
  | "cognition";

export interface OwnerLearningMomentCoordinate {
  gameId: string;
  reviewedAgentProfileId: string;
  evidenceVersion: string;
  anchorKind: OwnerLearningMomentAnchorKind;
  sourceCoordinate: string;
  windowVersion: string;
}

export interface OwnerLearningCandidateMoment {
  id: string;
  gameId: string;
  anchorKind: OwnerLearningMomentAnchorKind;
  sourceCoordinate: string;
  sourceHash: string;
  round: number | null;
  phase: string | null;
}

export function mintOwnerLearningMomentId(coordinate: OwnerLearningMomentCoordinate): string {
  const digest = createHash("sha256")
    .update(stableJson({
      namespace: OWNER_LEARNING_MOMENT_NORMALIZATION_VERSION,
      ...coordinate,
    }))
    .digest("base64url");
  return `olm_${digest}`;
}

export function resolveOwnerLearningMoment(
  candidates: readonly OwnerLearningCandidateMoment[],
  requestedId: string,
): OwnerLearningCandidateMoment {
  const candidate = candidates.find((entry) => entry.id === requestedId);
  if (!candidate) throw new Error("Moment ID is not part of this review");
  return candidate;
}

export interface OwnerLearningCanonicalGameFacts {
  game: {
    id: string;
    slug: string;
    completionAt: string;
    roundCount: number;
    playerCount: number;
  };
  reviewedPlayer: {
    id: string;
    placement: number | null;
    status: PostgamePlayerGameSummary["status"];
    won: boolean;
    eliminatedRound: number | null;
    readableSummary: string;
  };
  actionsByAgent: {
    votesCastByRound: PostgamePlayerGameSummary["votesCastByRound"];
    formatBallotsCastByRound: PostgamePlayerGameSummary["formatBallotsCastByRound"];
    councilVotesCast: PostgamePlayerGameSummary["councilVotesCast"];
    powersUsed: PostgamePlayerGameSummary["powersUsed"];
  };
  actionsAgainstAgent: {
    empowerVotesReceivedByRound: PostgamePlayerGameSummary["empowerVotesReceivedByRound"];
    exposeVotesReceivedByRound: PostgamePlayerGameSummary["exposeVotesReceivedByRound"];
    councilVotesReceived: PostgamePlayerGameSummary["councilVotesReceived"];
    timesNominated: PostgamePlayerGameSummary["timesNominated"];
    shieldsReceived: PostgamePlayerGameSummary["shieldsReceived"];
  };
  factAvailability: {
    overall: "available" | "degraded";
    actionsByAgent: "available" | "partial";
    actionsAgainstAgent: "available" | "partial";
  };
  diagnostics: PostgamePlayerGameSummary["diagnostics"];
}

export interface OwnerLearningProjectedGameEvidence {
  gameId: string;
  canonicalFacts: OwnerLearningCanonicalGameFacts;
  narrativeGroups: CompactV2Group[];
  narrativeCoverage: OwnerLearningNarrativeCoverage;
  candidateMoments: OwnerLearningCandidateMoment[];
  sourceHash: string;
  sourceCaptureVersion: string;
}

export interface OwnerLearningMaterializedGameEvidence
  extends OwnerLearningProjectedGameEvidence {
  gameEvidenceId: string;
}

export interface OwnerLearningReviewInputGame {
  gameId: string;
  canonicalFacts: unknown;
  candidateMomentIds: string[];
  narrativeGroups: CompactV2Group[];
  omittedNarrativeGroupCount: number;
}

export interface OwnerLearningBudgetedInput {
  instructions: string;
  currentStrategyStyle?: string;
  games: OwnerLearningReviewInputGame[];
}

export interface BuildBudgetedOwnerLearningInputParams {
  instructions: string;
  currentStrategyStyle?: string | null;
  games: Array<{
    gameId: string;
    canonicalFacts: unknown;
    candidateMomentIds: string[];
    narrativeGroups: CompactV2Group[];
  }>;
}

export function buildBudgetedOwnerLearningInput(
  params: BuildBudgetedOwnerLearningInputParams,
): OwnerLearningBudgetedInput {
  if (params.games.length < 1 || params.games.length > 3) {
    throw new Error("Owner learning input requires one to three games");
  }
  const input: OwnerLearningBudgetedInput = {
    instructions: params.instructions,
    ...(params.currentStrategyStyle != null
      ? { currentStrategyStyle: params.currentStrategyStyle }
      : {}),
    games: params.games.map((game) => ({
      gameId: game.gameId,
      canonicalFacts: game.canonicalFacts,
      candidateMomentIds: [...game.candidateMomentIds],
      narrativeGroups: [...game.narrativeGroups],
      omittedNarrativeGroupCount: 0,
    })),
  };
  return input;
}

export interface OwnerLearningEvidenceProjection {
  analysisTrack: OwnerLearningAnalysisTrack;
  games: OwnerLearningProjectedGameEvidence[];
  reviewInput: OwnerLearningBudgetedInput;
}

export interface OwnerLearningMaterializedEvidenceProjection
  extends Omit<OwnerLearningEvidenceProjection, "games"> {
  games: OwnerLearningMaterializedGameEvidence[];
}

type OwnerLearningEvidenceMaterializationDB = Pick<DrizzleDB, "insert" | "select">;

export function ownerLearningIssuedEvidenceRefs(
  games: readonly OwnerLearningProjectedGameEvidence[],
): OwnerLearningEvidenceRef[] {
  return games.flatMap((game) => [
    {
      kind: "game_summary" as const,
      gameId: game.gameId,
      coordinate: "game-summary",
      sourceHash: game.sourceHash,
      sourceVersion: game.sourceCaptureVersion,
    },
    ...game.candidateMoments.map((moment) => ({
      kind: ownerLearningEvidenceKind(moment),
      gameId: game.gameId,
      coordinate: moment.id,
      sourceHash: moment.sourceHash,
      sourceVersion: game.sourceCaptureVersion,
    })),
  ]);
}

function ownerLearningEvidenceKind(
  moment: OwnerLearningCandidateMoment,
): OwnerLearningEvidenceRef["kind"] {
  if (moment.anchorKind === "canonical_event") return "canonical_event";
  if (moment.anchorKind === "decision") return "decision";
  if (moment.anchorKind === "dialogue") return "dialogue";
  return "cognition";
}

export async function projectOwnerLearningEvidence(
  db: DrizzleDB,
  selection: OwnerLearningValidatedSelection,
  options: {
    instructions: string;
    cursorSecret?: string;
  },
): Promise<OwnerLearningEvidenceProjection> {
  const projectedGames = await Promise.all(selection.games.map(async (
    selectedGame,
  ): Promise<OwnerLearningProjectedGameEvidence> => {
    const [postgame, narrativeGroups] = await Promise.all([
      getPostgameAnalysis(db, selectedGame.gameId, {
        includeEvidence: true,
        detailLevel: "full",
      }),
      loadReviewedProfileNarrative(db, {
        ownerUserId: selection.ownerUserId,
        agentProfileId: selection.agentProfileId,
        gameId: selectedGame.gameId,
        cursorSecret: options.cursorSecret,
      }),
    ]);
    if (!postgame.ok) throw new Error(`Canonical evidence unavailable: ${postgame.status}`);
    const playerSummary = postgame.analysis.playerSummaries.find((entry) =>
      entry.player.id === selectedGame.playerId
    );
    if (!playerSummary) throw new Error("Reviewed player is absent from canonical postgame evidence");

    const canonicalFacts: OwnerLearningCanonicalGameFacts = {
      game: {
        id: selectedGame.gameId,
        slug: selectedGame.slug,
        completionAt: selectedGame.completionAt,
        roundCount: postgame.game.roundCount,
        playerCount: postgame.game.playerCount,
      },
      reviewedPlayer: {
        id: playerSummary.player.id,
        placement: playerSummary.placement,
        status: playerSummary.status,
        won: playerSummary.won,
        eliminatedRound: playerSummary.eliminatedRound,
        readableSummary: playerSummary.readableSummary,
      },
      actionsByAgent: {
        votesCastByRound: playerSummary.votesCastByRound,
        formatBallotsCastByRound: playerSummary.formatBallotsCastByRound,
        councilVotesCast: playerSummary.councilVotesCast,
        powersUsed: playerSummary.powersUsed,
      },
      actionsAgainstAgent: {
        empowerVotesReceivedByRound: playerSummary.empowerVotesReceivedByRound,
        exposeVotesReceivedByRound: playerSummary.exposeVotesReceivedByRound,
        councilVotesReceived: playerSummary.councilVotesReceived,
        timesNominated: playerSummary.timesNominated,
        shieldsReceived: playerSummary.shieldsReceived,
      },
      factAvailability: {
        overall: postgame.analysis.availability.status === "available" ? "available" : "degraded",
        actionsByAgent: postgame.analysis.availability.status === "available" ? "available" : "partial",
        actionsAgainstAgent: postgame.analysis.availability.status === "available" ? "available" : "partial",
      },
      diagnostics: playerSummary.diagnostics,
    };
    const canonicalMoments = candidateMomentsFromCanonicalEvidence(
      selection.agentProfileId,
      selectedGame.gameId,
      playerSummary,
    );
    const narrativeMoments = candidateMomentsFromNarrative(
      selection.agentProfileId,
      selectedGame.gameId,
      narrativeGroups,
    );
    const candidateMoments = dedupeCandidateMoments([...canonicalMoments, ...narrativeMoments]);
    const sourceCaptureVersion = [
      "postgame-v2",
      `transcript-v${selectedGame.transcriptCaptureVersion}`,
      `cognition-v${selectedGame.cognitiveArtifactCaptureVersion}`,
    ].join(":");
    const sourceHash = sha256StableJson({
      canonicalFacts,
      candidateMoments,
      narrativeSourceHash: sha256StableJson(narrativeGroups),
      sourceCaptureVersion,
    });
    return {
      gameId: selectedGame.gameId,
      canonicalFacts,
      narrativeGroups,
      narrativeCoverage: narrativeGroups.length > 0 ? "rich" : "thin",
      candidateMoments,
      sourceHash,
      sourceCaptureVersion,
    };
  }));

  const analysisTrack = classifyOwnerLearningEvidence(projectedGames.map((game) => ({
    eliminatedRound: game.canonicalFacts.reviewedPlayer.eliminatedRound,
    narrativeCoverage: game.narrativeCoverage,
  })));
  const reviewInput = buildBudgetedOwnerLearningInput({
    instructions: options.instructions,
    ...(analysisTrack === "strategy_health_check"
      ? { currentStrategyStyle: selection.strategyStyle ?? "" }
      : {}),
    games: projectedGames.map((game) => ({
      gameId: game.gameId,
      canonicalFacts: game.canonicalFacts,
      candidateMomentIds: game.candidateMoments.map((moment) => moment.id),
      narrativeGroups: game.narrativeGroups,
    })),
  });
  return { analysisTrack, games: projectedGames, reviewInput };
}

export async function materializeOwnerLearningEvidenceProjection(
  db: OwnerLearningEvidenceMaterializationDB,
  selection: OwnerLearningValidatedSelection,
  projection: OwnerLearningEvidenceProjection,
): Promise<OwnerLearningMaterializedEvidenceProjection> {
  if (
    projection.games.length !== selection.games.length
    || projection.games.some((game, index) => game.gameId !== selection.games[index]?.gameId)
  ) {
    throw new Error("Owner learning projection does not match the selected games");
  }
  const games: OwnerLearningMaterializedGameEvidence[] = [];
  for (const game of projection.games) {
    games.push({
      ...game,
      gameEvidenceId: await materializeOwnerLearningGameEvidence(db, {
        selection,
        game,
      }),
    });
  }
  return { ...projection, games };
}

async function loadReviewedProfileNarrative(
  db: DrizzleDB,
  input: {
    ownerUserId: string;
    agentProfileId: string;
    gameId: string;
    cursorSecret?: string;
  },
): Promise<CompactV2Group[]> {
  const groups: CompactV2Group[] = [];
  let cursor: string | undefined;
  do {
    const page = await readMatchNarrativePage(db, {
      gameIdOrSlug: input.gameId,
      preset: "full_cognition",
      detail: "full",
      schemaVersion: 2,
      includeUnpaired: true,
      // Traverse the frozen read-through at the read model's largest bounded page
      // size. Later pages remain part of evidence identity and moment selection.
      limit: OWNER_LEARNING_NARRATIVE_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    }, {
      subjectUserId: input.ownerUserId,
      surface: "subject_owner",
      reviewedAgentProfileId: input.agentProfileId,
      cursorSecret: input.cursorSecret,
    });
    if (!page.ok) return [];
    if (page.schemaVersion !== 2) throw new Error("Owner learning narrative requires compact-v2");
    groups.push(...page.groups);
    cursor = page.nextCursor ?? undefined;
  } while (cursor != null);
  return groups;
}

function candidateMomentsFromCanonicalEvidence(
  reviewedAgentProfileId: string,
  gameId: string,
  player: PostgamePlayerGameSummary,
): OwnerLearningCandidateMoment[] {
  return (player.evidence ?? []).map((ref) => candidateMoment({
    reviewedAgentProfileId,
    gameId,
    anchorKind: "canonical_event",
    sourceCoordinate: `event:${ref.sequence}:${ref.eventType}`,
    round: ref.round,
    phase: null,
    source: ref,
  }));
}

function candidateMomentsFromNarrative(
  reviewedAgentProfileId: string,
  gameId: string,
  groups: readonly CompactV2Group[],
): OwnerLearningCandidateMoment[] {
  return groups.flatMap((group): OwnerLearningCandidateMoment[] => {
    const anchor = durableNarrativeAnchor(group);
    if (!anchor) return [];
    return [candidateMoment({
      reviewedAgentProfileId,
      gameId,
      anchorKind: anchor.kind,
      sourceCoordinate: anchor.coordinate,
      round: group.round ?? null,
      phase: group.phase ?? null,
      source: group,
    })];
  });
}

function durableNarrativeAnchor(group: CompactV2Group): {
  kind: "decision" | "dialogue" | "cognition";
  coordinate: string;
} | null {
  if (group.decisionId) return { kind: "decision", coordinate: `decision:${group.decisionId}` };
  if (group.refs?.dialogueRowId) {
    return { kind: "dialogue", coordinate: `dialogue:${group.refs.dialogueRowId}` };
  }
  if (group.refs?.thinkingId) {
    return { kind: "cognition", coordinate: `cognition:${group.refs.thinkingId}` };
  }
  if (group.refs?.strategyId) {
    return { kind: "cognition", coordinate: `cognition:${group.refs.strategyId}` };
  }
  if (group.seq != null) return { kind: "dialogue", coordinate: `dialogue-sequence:${group.seq}` };
  return null;
}

function candidateMoment(input: {
  reviewedAgentProfileId: string;
  gameId: string;
  anchorKind: OwnerLearningMomentAnchorKind;
  sourceCoordinate: string;
  round: number | null;
  phase: string | null;
  source: unknown;
}): OwnerLearningCandidateMoment {
  const coordinate: OwnerLearningMomentCoordinate = {
    gameId: input.gameId,
    reviewedAgentProfileId: input.reviewedAgentProfileId,
    evidenceVersion: OWNER_LEARNING_EVIDENCE_VERSION,
    anchorKind: input.anchorKind,
    sourceCoordinate: input.sourceCoordinate,
    windowVersion: OWNER_LEARNING_MOMENT_WINDOW_VERSION,
  };
  return {
    id: mintOwnerLearningMomentId(coordinate),
    gameId: input.gameId,
    anchorKind: input.anchorKind,
    sourceCoordinate: input.sourceCoordinate,
    sourceHash: sha256StableJson(input.source),
    round: input.round,
    phase: input.phase,
  };
}

function dedupeCandidateMoments(
  candidates: readonly OwnerLearningCandidateMoment[],
): OwnerLearningCandidateMoment[] {
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

async function materializeOwnerLearningGameEvidence(
  db: OwnerLearningEvidenceMaterializationDB,
  input: {
    selection: OwnerLearningValidatedSelection;
    game: OwnerLearningProjectedGameEvidence;
  },
): Promise<string> {
  const analyticalRevisionId = input.selection.games.find((game) => game.gameId === input.game.gameId)
    ?.analyticalRevisionId;
  if (!analyticalRevisionId) throw new Error("Owner learning selection is missing the projected game");
  await db.insert(schema.agentLearningGameEvidence).values({
    id: randomUUID(),
    ownerUserId: input.selection.ownerUserId,
    agentProfileId: input.selection.agentProfileId,
    analyticalRevisionId,
    gameId: input.game.gameId,
    evidenceVersion: OWNER_LEARNING_EVIDENCE_VERSION,
    eligibilityPolicyVersion: OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
    completionAt: input.game.canonicalFacts.game.completionAt,
    canonicalSnapshot: input.game.canonicalFacts as unknown as Record<string, unknown>,
    candidateMoments: input.game.candidateMoments as unknown as Array<Record<string, unknown>>,
    sourceCaptureVersion: input.game.sourceCaptureVersion,
    sourceHash: input.game.sourceHash,
  }).onConflictDoNothing();
  const row = (await db.select({
    id: schema.agentLearningGameEvidence.id,
    sourceCaptureVersion: schema.agentLearningGameEvidence.sourceCaptureVersion,
    sourceHash: schema.agentLearningGameEvidence.sourceHash,
  })
    .from(schema.agentLearningGameEvidence)
    .where(and(
      eq(schema.agentLearningGameEvidence.ownerUserId, input.selection.ownerUserId),
      eq(schema.agentLearningGameEvidence.agentProfileId, input.selection.agentProfileId),
      eq(schema.agentLearningGameEvidence.analyticalRevisionId, analyticalRevisionId),
      eq(schema.agentLearningGameEvidence.gameId, input.game.gameId),
      eq(schema.agentLearningGameEvidence.evidenceVersion, OWNER_LEARNING_EVIDENCE_VERSION),
      eq(schema.agentLearningGameEvidence.sourceCaptureVersion, input.game.sourceCaptureVersion),
      eq(schema.agentLearningGameEvidence.sourceHash, input.game.sourceHash),
    )).limit(1))[0];
  if (!row) throw new Error("Owner learning game evidence was not materialized");
  if (
    row.sourceCaptureVersion !== input.game.sourceCaptureVersion
    || row.sourceHash !== input.game.sourceHash
  ) {
    throw new Error("Owner learning evidence source changed after materialization");
  }
  return row.id;
}
