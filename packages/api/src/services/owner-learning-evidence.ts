import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PostgamePlayerGameSummary } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { CompactV2Group } from "./match-narrative-compact-v2.js";
import { readMatchNarrativePage } from "./match-narrative-read-model.js";
import {
  OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
  OWNER_LEARNING_EVIDENCE_VERSION,
  type OwnerLearningAnalysisTrack,
  type OwnerLearningEvidenceRef,
  type OwnerLearningStage,
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
  gameEvidenceId: string;
  canonicalFacts: OwnerLearningCanonicalGameFacts;
  narrativeGroups: CompactV2Group[];
  narrativeCoverage: OwnerLearningNarrativeCoverage;
  candidateMoments: OwnerLearningCandidateMoment[];
  sourceHash: string;
  sourceCaptureVersion: string;
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

export function estimateOwnerLearningInputTokens(value: unknown): number {
  const serializedChars = stableJson(value).length;
  return Math.ceil(serializedChars / OWNER_LEARNING_TOKEN_ESTIMATOR_CHARS_PER_TOKEN)
    + OWNER_LEARNING_ENVELOPE_ALLOWANCE_TOKENS;
}

export function buildBudgetedOwnerLearningProviderInput(
  stage: OwnerLearningStage,
  turn: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    protocol: "owner-learning-harness-v1",
    stage,
    turn: structuredClone(turn),
  };
  while (estimateOwnerLearningInputTokens(input) > OWNER_LEARNING_INPUT_TOKEN_LIMIT) {
    const games = mutableEvidenceGames(input);
    let target: { narrativeGroups: unknown[]; omittedNarrativeGroupCount: number } | null = null;
    for (const game of games) {
      if (game.narrativeGroups.length === 0) continue;
      if (!target || game.narrativeGroups.length > target.narrativeGroups.length) target = game;
    }
    if (!target) throw new Error("Owner learning canonical request exceeds the input budget");
    target.narrativeGroups.pop();
    target.omittedNarrativeGroupCount += 1;
  }
  return input;
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
      narrativeGroups: [],
      omittedNarrativeGroupCount: game.narrativeGroups.length,
    })),
  };
  if (estimateOwnerLearningInputTokens(input) > OWNER_LEARNING_INPUT_TOKEN_LIMIT) {
    throw new Error("Owner learning canonical evidence exceeds the input budget");
  }

  const serializedBudgetChars = (
    OWNER_LEARNING_INPUT_TOKEN_LIMIT - OWNER_LEARNING_ENVELOPE_ALLOWANCE_TOKENS
  ) * OWNER_LEARNING_TOKEN_ESTIMATOR_CHARS_PER_TOKEN;
  const fixedChars = stableJson(input).length;
  const perGameShareChars = Math.max(
    0,
    Math.floor((serializedBudgetChars - fixedChars) / params.games.length),
  );

  for (let gameIndex = 0; gameIndex < params.games.length; gameIndex += 1) {
    const source = params.games[gameIndex]!;
    const target = input.games[gameIndex]!;
    let usedChars = 0;
    for (const group of source.narrativeGroups) {
      const groupChars = stableJson(group).length + 1;
      if (usedChars + groupChars > perGameShareChars) break;
      target.narrativeGroups.push(group);
      usedChars += groupChars;
    }
    target.omittedNarrativeGroupCount = source.narrativeGroups.length - target.narrativeGroups.length;
  }

  while (estimateOwnerLearningInputTokens(input) > OWNER_LEARNING_INPUT_TOKEN_LIMIT) {
    const target = [...input.games]
      .sort((left, right) => right.narrativeGroups.length - left.narrativeGroups.length)
      .find((game) => game.narrativeGroups.length > 0);
    if (!target) throw new Error("Owner learning evidence exceeds the input budget");
    target.narrativeGroups.pop();
    target.omittedNarrativeGroupCount += 1;
  }
  return input;
}

export interface OwnerLearningEvidenceProjection {
  analysisTrack: OwnerLearningAnalysisTrack;
  games: OwnerLearningProjectedGameEvidence[];
  reviewInput: OwnerLearningBudgetedInput;
}

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

function mutableEvidenceGames(input: Record<string, unknown>): Array<{
  narrativeGroups: unknown[];
  omittedNarrativeGroupCount: number;
}> {
  const turn = recordValue(input.turn);
  const evidence = recordValue(turn?.evidence);
  if (!Array.isArray(evidence?.games)) return [];
  return evidence.games.flatMap((value) => {
    const game = recordValue(value);
    if (!game || !Array.isArray(game.narrativeGroups)) return [];
    const omitted = game.omittedNarrativeGroupCount;
    if (typeof omitted !== "number" || !Number.isSafeInteger(omitted) || omitted < 0) return [];
    return [{
      narrativeGroups: game.narrativeGroups,
      get omittedNarrativeGroupCount() {
        return game.omittedNarrativeGroupCount as number;
      },
      set omittedNarrativeGroupCount(next: number) {
        game.omittedNarrativeGroupCount = next;
      },
    }];
  });
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  const projectedGames: OwnerLearningProjectedGameEvidence[] = [];
  for (const selectedGame of selection.games) {
    const postgame = await getPostgameAnalysis(db, selectedGame.gameId, {
      includeEvidence: true,
      detailLevel: "full",
    });
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
    const narrativeGroups = await loadReviewedProfileNarrative(db, {
      ownerUserId: selection.ownerUserId,
      agentProfileId: selection.agentProfileId,
      gameId: selectedGame.gameId,
      cursorSecret: options.cursorSecret,
    });
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
      "postgame-v1",
      `transcript-v${selectedGame.transcriptCaptureVersion}`,
      `cognition-v${selectedGame.cognitiveArtifactCaptureVersion}`,
    ].join(":");
    const sourceHash = sha256StableJson({
      canonicalFacts,
      candidateMoments,
      narrativeSourceHash: sha256StableJson(narrativeGroups),
      sourceCaptureVersion,
    });
    const gameEvidenceId = await materializeOwnerLearningGameEvidence(db, {
      selection,
      gameId: selectedGame.gameId,
      completionAt: selectedGame.completionAt,
      canonicalFacts,
      candidateMoments,
      sourceCaptureVersion,
      sourceHash,
    });
    projectedGames.push({
      gameId: selectedGame.gameId,
      gameEvidenceId,
      canonicalFacts,
      narrativeGroups,
      narrativeCoverage: narrativeGroups.length > 0 ? "rich" : "thin",
      candidateMoments,
      sourceHash,
      sourceCaptureVersion,
    });
  }

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
      limit: 50,
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
  db: DrizzleDB,
  input: {
    selection: OwnerLearningValidatedSelection;
    gameId: string;
    completionAt: string;
    canonicalFacts: OwnerLearningCanonicalGameFacts;
    candidateMoments: OwnerLearningCandidateMoment[];
    sourceCaptureVersion: string;
    sourceHash: string;
  },
): Promise<string> {
  await db.insert(schema.agentLearningGameEvidence).values({
    id: randomUUID(),
    ownerUserId: input.selection.ownerUserId,
    agentProfileId: input.selection.agentProfileId,
    analyticalRevisionId: input.selection.currentRevisionId,
    gameId: input.gameId,
    evidenceVersion: OWNER_LEARNING_EVIDENCE_VERSION,
    eligibilityPolicyVersion: OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
    completionAt: input.completionAt,
    canonicalSnapshot: input.canonicalFacts as unknown as Record<string, unknown>,
    candidateMoments: input.candidateMoments as unknown as Array<Record<string, unknown>>,
    sourceCaptureVersion: input.sourceCaptureVersion,
    sourceHash: input.sourceHash,
  }).onConflictDoNothing();
  const row = (await db.select({ id: schema.agentLearningGameEvidence.id })
    .from(schema.agentLearningGameEvidence)
    .where(and(
      eq(schema.agentLearningGameEvidence.ownerUserId, input.selection.ownerUserId),
      eq(schema.agentLearningGameEvidence.agentProfileId, input.selection.agentProfileId),
      eq(schema.agentLearningGameEvidence.analyticalRevisionId, input.selection.currentRevisionId),
      eq(schema.agentLearningGameEvidence.gameId, input.gameId),
      eq(schema.agentLearningGameEvidence.evidenceVersion, OWNER_LEARNING_EVIDENCE_VERSION),
    )).limit(1))[0];
  if (!row) throw new Error("Owner learning game evidence was not materialized");
  return row.id;
}
