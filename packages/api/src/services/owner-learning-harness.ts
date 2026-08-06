import {
  OWNER_LEARNING_MAX_DIVES,
  OWNER_LEARNING_MAX_LOGICAL_CALLS,
  OWNER_LEARNING_PROMPT_VERSION,
  OWNER_LEARNING_SCHEMA_VERSION,
  fingerprintOwnerLearningValue,
  parseOwnerLearningReviewResult,
  type OwnerLearningAnalysisTrack,
  type OwnerLearningCheckpoint,
  type OwnerLearningEvidenceRef,
  type OwnerLearningReviewResult,
  type OwnerLearningStage,
} from "./owner-learning-contracts.js";
import {
  ownerLearningIssuedEvidenceRefs,
  resolveOwnerLearningMoment,
  type OwnerLearningCandidateMoment,
  type OwnerLearningEvidenceProjection,
  type OwnerLearningProjectedGameEvidence,
} from "./owner-learning-evidence.js";
import {
  buildBudgetedOwnerLearningProviderInput,
  hydrateOwnerLearningProviderOutput,
} from "./owner-learning-provider-context.js";

export const OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA = ownerLearningHarnessResponseSchema(false);
export const OWNER_LEARNING_FINAL_HARNESS_RESPONSE_SCHEMA = ownerLearningHarnessResponseSchema(true);

function ownerLearningHarnessResponseSchema(finalResultRequired: boolean) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["provisionalThemes", "selectedMomentHandles", "findings", "finalResult"],
    properties: {
      provisionalThemes: { type: "array", maxItems: 3, items: { type: "string", maxLength: 240 } },
      selectedMomentHandles: { type: "array", maxItems: 3, items: { type: "string", maxLength: 24 } },
      findings: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
            required: ["evidenceHandles", "observation", "interpretation"],
          properties: {
              evidenceHandles: { type: "array", maxItems: 6, items: evidenceHandleSchema() },
            observation: { type: "string", maxLength: 800 },
            interpretation: { type: "string", maxLength: 800 },
          },
        },
      },
      finalResult: finalResultRequired
        ? ownerLearningFinalResultSchema()
        : { anyOf: [ownerLearningFinalResultSchema(), { type: "null" }] },
    },
  } as const;
}

interface OwnerLearningHarnessFinding {
  evidenceRefs: OwnerLearningEvidenceRef[];
  observation: string;
  interpretation: string;
}

export interface OwnerLearningHarnessInvocation {
  ordinal: number;
  stage: OwnerLearningStage;
  isDive: boolean;
  request: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
}

export interface RunOwnerLearningHarnessInput {
  reviewId: string;
  analysisTrack: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
  currentStrategyStyle: string | null;
  evidence: OwnerLearningEvidenceProjection;
  checkpoint?: OwnerLearningCheckpoint | null;
  logicalCallCount?: number;
  diveCount?: number;
  invoke(input: OwnerLearningHarnessInvocation): Promise<unknown>;
  resumeValidatedTurn?(
    input: OwnerLearningHarnessInvocation,
  ): Promise<OwnerLearningCheckpoint | null>;
  onTurnValidated?(
    input: OwnerLearningHarnessInvocation,
    checkpoint: OwnerLearningCheckpoint,
  ): Promise<void>;
  onCheckpoint?(checkpoint: OwnerLearningCheckpoint): Promise<void>;
}

export interface OwnerLearningHarnessResult {
  result: OwnerLearningReviewResult;
  checkpoint: OwnerLearningCheckpoint;
  proposalFingerprint: string | null;
  logicalCallsUsed: number;
  divesUsed: number;
}

export async function runOwnerLearningHarness(
  input: RunOwnerLearningHarnessInput,
): Promise<OwnerLearningHarnessResult> {
  if (input.evidence.analysisTrack !== input.analysisTrack) {
    throw new Error("Owner learning analysis track changed after purchase");
  }
  const allowedMomentIds = new Set(
    input.evidence.games.flatMap((game) => game.candidateMoments.map((moment) => moment.id)),
  );
  const allowedEvidenceRefs = ownerLearningIssuedEvidenceRefs(input.evidence.games);
  let checkpoint = input.checkpoint ?? initialCheckpoint();
  let logicalCallsUsed = input.logicalCallCount ?? checkpoint.logicalCallCount;
  let divesUsed = input.diveCount ?? checkpoint.diveCount;

  if (checkpoint.lastCompletedStage === "complete") {
    if (!checkpoint.completion) {
      throw new Error("Owner learning complete checkpoint is missing its result");
    }
    return completed(checkpoint.completion);
  }

  if (checkpoint.lastCompletedStage === "evidence_ready") {
    const turn = await invokeTurn("scanning_narratives", false, {
      analysisTrack: input.analysisTrack,
      currentStrategyStyle: input.currentStrategyStyle ?? "",
      evidence: input.evidence.reviewInput,
    });
    const final = await advanceCheckpoint(turn, (parsed, completion) => ({
      ...checkpoint,
      selectedMomentIds: parsed.selectedMomentIds,
      provisionalThemes: parsed.provisionalThemes,
      validatedFindings: parsed.findings,
      lastCompletedStage: completion ? "complete" : "scanning_narratives",
    }));
    if (final) return completed(final);
  }

  while (checkpoint.nextMomentCursor < checkpoint.selectedMomentIds.length) {
    if (divesUsed >= OWNER_LEARNING_MAX_DIVES) throw new Error("Owner learning dive budget exhausted");
    const momentId = checkpoint.selectedMomentIds[checkpoint.nextMomentCursor]!;
    const bundle = buildMomentBundle(input.evidence, momentId);
    const turn = await invokeTurn("investigating_moments", true, {
      analysisTrack: input.analysisTrack,
      currentStrategyStyle: input.currentStrategyStyle ?? "",
      provisionalThemes: checkpoint.provisionalThemes,
      validatedFindings: checkpoint.validatedFindings,
      momentBundle: bundle,
    });
    const final = await advanceCheckpoint(turn, (parsed, completion) => ({
      ...checkpoint,
      nextMomentCursor: checkpoint.nextMomentCursor + 1,
      provisionalThemes: parsed.provisionalThemes.length > 0
        ? parsed.provisionalThemes
        : checkpoint.provisionalThemes,
      validatedFindings: [...checkpoint.validatedFindings, ...parsed.findings],
      lastCompletedStage: completion ? "complete" : "investigating_moments",
    }));
    if (final) return completed(final);
  }

  if (logicalCallsUsed < OWNER_LEARNING_MAX_LOGICAL_CALLS) {
    const turn = await invokeTurn("drafting_recommendations", false, {
      analysisTrack: input.analysisTrack,
      currentStrategyStyle: input.currentStrategyStyle ?? "",
      provisionalThemes: checkpoint.provisionalThemes,
      validatedFindings: checkpoint.validatedFindings,
      evidence: input.evidence.reviewInput,
    });
    const final = await advanceCheckpoint(turn, (parsed, completion) => {
      if (!completion) throw new Error("Owner learning final turn did not contain a result");
      return {
        ...checkpoint,
        provisionalThemes: parsed.provisionalThemes,
        validatedFindings: [...checkpoint.validatedFindings, ...parsed.findings],
        lastCompletedStage: "complete",
      };
    });
    if (!final) throw new Error("Owner learning final turn did not contain a result");
    return completed(final);
  }
  throw new Error("Owner learning logical call budget exhausted before a final result");

  async function advanceCheckpoint(
    turn: Awaited<ReturnType<typeof invokeTurn>>,
    build: (
      parsed: ReturnType<typeof parseHarnessTurn>,
      completion: OwnerLearningCheckpoint["completion"],
    ) => Omit<OwnerLearningCheckpoint, "logicalCallCount" | "diveCount" | "completion">,
  ): Promise<OwnerLearningCheckpoint["completion"]> {
    if (turn.resumedCheckpoint) {
      assertResumedCheckpoint(turn.invocation, turn.resumedCheckpoint);
      checkpoint = turn.resumedCheckpoint;
    } else {
      const parsed = parseHarnessTurn(turn.output, allowedMomentIds, allowedEvidenceRefs);
      assertRequiredFinalResult(parsed.finalResult);
      const completion = parsed.finalResult
        ? finalizeHarnessResult(parsed.finalResult)
        : null;
      checkpoint = {
        ...build(parsed, completion),
        logicalCallCount: logicalCallsUsed,
        diveCount: divesUsed,
        completion,
      };
      await input.onTurnValidated?.(turn.invocation, checkpoint);
    }
    await input.onCheckpoint?.(checkpoint);
    return checkpoint.completion;
  }

  async function invokeTurn(
    stage: OwnerLearningStage,
    isDive: boolean,
    request: Record<string, unknown>,
  ): Promise<{
    invocation: OwnerLearningHarnessInvocation;
    output: unknown;
    resumedCheckpoint: OwnerLearningCheckpoint | null;
  }> {
    if (logicalCallsUsed >= OWNER_LEARNING_MAX_LOGICAL_CALLS) {
      throw new Error("Owner learning logical call budget exhausted");
    }
    logicalCallsUsed += 1;
    if (isDive) divesUsed += 1;
    const finalResultRequired = logicalCallsUsed === OWNER_LEARNING_MAX_LOGICAL_CALLS;
    const responseSchema = finalResultRequired
      ? OWNER_LEARNING_FINAL_HARNESS_RESPONSE_SCHEMA
      : OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA;
    const context = buildBudgetedOwnerLearningProviderInput({
      stage,
      turn: {
        ...request,
        ...(finalResultRequired && request.evidence == null
          ? { evidence: input.evidence.reviewInput }
          : {}),
        callBudget: {
          ordinal: logicalCallsUsed,
          remainingAfterThisCall: OWNER_LEARNING_MAX_LOGICAL_CALLS - logicalCallsUsed,
          finalResultRequired,
        },
      },
      evidence: input.evidence,
      responseSchema,
    });
    const invocation: OwnerLearningHarnessInvocation = {
      ordinal: logicalCallsUsed,
      stage,
      isDive,
      request: context.input,
      responseSchema,
    };
    const resumedCheckpoint = await input.resumeValidatedTurn?.(invocation) ?? null;
    if (resumedCheckpoint) {
      return { invocation, output: null, resumedCheckpoint };
    }
    const output = await input.invoke(invocation);
    return {
      invocation,
      output: hydrateOwnerLearningProviderOutput(output, context),
      resumedCheckpoint: null,
    };
  }

  function assertResumedCheckpoint(
    invocation: OwnerLearningHarnessInvocation,
    resumed: OwnerLearningCheckpoint,
  ): void {
    if (
      resumed.version !== 1
      || resumed.logicalCallCount !== invocation.ordinal
      || resumed.diveCount !== divesUsed
      || resumed.promptHash !== fingerprintOwnerLearningValue(OWNER_LEARNING_PROMPT_VERSION)
      || resumed.schemaHash !== fingerprintOwnerLearningValue(OWNER_LEARNING_SCHEMA_VERSION)
      || (resumed.lastCompletedStage === "complete") !== (resumed.completion != null)
    ) {
      throw new Error("Owner learning validated turn receipt is inconsistent");
    }
    const expectedStages: OwnerLearningStage[] = invocation.stage === "drafting_recommendations"
      ? ["complete"]
      : [invocation.stage, "complete"];
    if (!expectedStages.includes(resumed.lastCompletedStage)) {
      throw new Error("Owner learning validated turn receipt changed stage");
    }
  }

  function assertRequiredFinalResult(finalResult: unknown): void {
    if (logicalCallsUsed === OWNER_LEARNING_MAX_LOGICAL_CALLS && finalResult == null) {
      throw new Error("Owner learning final logical call must contain a result");
    }
  }

  function finalizeHarnessResult(value: unknown): {
    result: OwnerLearningReviewResult;
    proposalFingerprint: string | null;
  } {
    const result = validateOwnerLearningHarnessResult(normalizeNullableFinalResult(value), {
      reviewId: input.reviewId,
      analysisTrack: input.analysisTrack,
      currentStrategyStyle: input.currentStrategyStyle ?? "",
      allowedEvidenceRefs,
    });
    return {
      result,
      proposalFingerprint: result.proposal
        ? fingerprintOwnerLearningValue({ reviewId: input.reviewId, proposal: result.proposal })
        : null,
    };
  }

  function completed(final: {
    result: OwnerLearningReviewResult;
    proposalFingerprint: string | null;
  }): OwnerLearningHarnessResult {
    return {
      ...final,
      checkpoint,
      logicalCallsUsed,
      divesUsed,
    };
  }
}

export function validateOwnerLearningHarnessResult(
  value: unknown,
  input: {
    reviewId: string;
    analysisTrack: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
    currentStrategyStyle: string;
    allowedEvidenceRefs: readonly OwnerLearningEvidenceRef[];
  },
): OwnerLearningReviewResult {
  const parsed = parseOwnerLearningReviewResult(value);
  if (parsed.analysisTrack !== input.analysisTrack) {
    throw new Error("Generated result changed the purchased analysis track");
  }
  const allowed = new Set(input.allowedEvidenceRefs.map(evidenceRefKey));
  for (const recommendation of parsed.recommendations) {
    for (const ref of recommendation.evidenceRefs) {
      if (!allowed.has(evidenceRefKey(ref))) throw new Error("Generated result contains an unknown evidence ref");
    }
  }
  if (parsed.proposal && parsed.proposal.before !== input.currentStrategyStyle) {
    throw new Error("Generated strategy proposal does not start from the reviewed strategy");
  }
  const changeRecommendations = parsed.recommendations.filter((recommendation) =>
    recommendation.disposition === "change"
  );
  if (parsed.proposal && changeRecommendations.length === 0) {
    throw new Error("Generated strategy proposal requires a change recommendation");
  }
  if (parsed.noChange && changeRecommendations.length > 0) {
    throw new Error("Generated no-change result cannot contain a change recommendation");
  }
  if (input.analysisTrack === "strategy_health_check") {
    if (!parsed.strategyHealthClassification) {
      throw new Error("strategyHealthClassification is required for Strategy Health Check");
    }
    if (parsed.noChange && /insufficient|not enough|need more evidence/i.test(parsed.noChange.rationale)) {
      throw new Error("Strategy Health Check no-change must specifically defend the current guidance");
    }
  }
  return {
    ...parsed,
    recommendations: parsed.recommendations.map((recommendation, index) => ({
      ...recommendation,
      id: `olrec_${fingerprintOwnerLearningValue({
        reviewId: input.reviewId,
        index,
        title: recommendation.title,
        evidenceRefs: recommendation.evidenceRefs,
      }).slice("sha256:".length, "sha256:".length + 24)}`,
    })),
  };
}

function initialCheckpoint(): OwnerLearningCheckpoint {
  return {
    version: 1,
    logicalCallCount: 0,
    diveCount: 0,
    selectedMomentIds: [],
    nextMomentCursor: 0,
    provisionalThemes: [],
    validatedFindings: [],
    lastCompletedStage: "evidence_ready",
    promptHash: fingerprintOwnerLearningValue(OWNER_LEARNING_PROMPT_VERSION),
    schemaHash: fingerprintOwnerLearningValue(OWNER_LEARNING_SCHEMA_VERSION),
    completion: null,
  };
}

function parseHarnessTurn(
  value: unknown,
  allowedMomentIds: ReadonlySet<string>,
  allowedEvidenceRefs: readonly OwnerLearningEvidenceRef[],
): {
  provisionalThemes: string[];
  selectedMomentIds: string[];
  findings: OwnerLearningHarnessFinding[];
  finalResult?: unknown;
} {
  const record = objectValue(value, "harness turn");
  const provisionalThemes = boundedStringArray(record.provisionalThemes, "provisionalThemes", 3, 240);
  const selectedMomentIds = boundedStringArray(record.selectedMomentIds, "selectedMomentIds", 3, 200);
  if (new Set(selectedMomentIds).size !== selectedMomentIds.length) {
    throw new Error("selectedMomentIds must be distinct");
  }
  for (const momentId of selectedMomentIds) {
    if (!allowedMomentIds.has(momentId)) throw new Error("Generated turn selected an unknown moment ID");
  }
  const allowedRefs = new Set(allowedEvidenceRefs.map(evidenceRefKey));
  const findings = record.findings === undefined
    ? []
    : arrayValue(record.findings, "findings", 3).map((entry, index) => {
      const finding = objectValue(entry, `findings[${index}]`);
      const evidenceRefs = arrayValue(finding.evidenceRefs, `findings[${index}].evidenceRefs`, 6)
        .map((ref) => parseEvidenceRef(ref));
      if (evidenceRefs.some((ref) => !allowedRefs.has(evidenceRefKey(ref)))) {
        throw new Error("Generated finding contains an unknown evidence ref");
      }
      return {
        evidenceRefs,
        observation: boundedString(finding.observation, `findings[${index}].observation`, 800),
        interpretation: boundedString(finding.interpretation, `findings[${index}].interpretation`, 800),
      };
    });
  return {
    provisionalThemes,
    selectedMomentIds,
    findings,
    ...(record.finalResult != null ? { finalResult: record.finalResult } : {}),
  };
}

function buildMomentBundle(
  evidence: OwnerLearningEvidenceProjection,
  momentId: string,
): Record<string, unknown> {
  const game = evidence.games.find((candidate) =>
    candidate.candidateMoments.some((moment) => moment.id === momentId)
  );
  if (!game) throw new Error("Moment ID is not part of the projected evidence");
  const moment = resolveOwnerLearningMoment(game.candidateMoments, momentId);
  const narrativeIndex = game.narrativeGroups.findIndex((group) =>
    group.decisionId && moment.sourceCoordinate === `decision:${group.decisionId}`
      || group.seq != null && moment.sourceCoordinate === `dialogue-sequence:${group.seq}`
      || group.refs?.dialogueRowId && moment.sourceCoordinate === `dialogue:${group.refs.dialogueRowId}`
      || group.refs?.thinkingId && moment.sourceCoordinate === `cognition:${group.refs.thinkingId}`
      || group.refs?.strategyId && moment.sourceCoordinate === `cognition:${group.refs.strategyId}`
  );
  const surroundingDialogue = narrativeIndex < 0
    ? []
    : game.narrativeGroups.slice(Math.max(0, narrativeIndex - 1), narrativeIndex + 2);
  return {
    moment,
    canonicalFacts: canonicalFactsForMoment(game, moment),
    surroundingDialogue,
  };
}

function canonicalFactsForMoment(
  game: OwnerLearningProjectedGameEvidence,
  moment: OwnerLearningCandidateMoment,
): Record<string, unknown> {
  if (moment.round == null) return { reviewedPlayer: game.canonicalFacts.reviewedPlayer };
  const round = moment.round;
  return {
    reviewedPlayer: game.canonicalFacts.reviewedPlayer,
    actionsByAgent: {
      votesCastByRound: game.canonicalFacts.actionsByAgent.votesCastByRound.filter((entry) => entry.round === round),
      councilVotesCast: game.canonicalFacts.actionsByAgent.councilVotesCast.filter((entry) => entry.round === round),
      powersUsed: game.canonicalFacts.actionsByAgent.powersUsed.filter((entry) => entry.round === round),
    },
    actionsAgainstAgent: {
      empowerVotesReceivedByRound: game.canonicalFacts.actionsAgainstAgent.empowerVotesReceivedByRound.filter((entry) => entry.round === round),
      exposeVotesReceivedByRound: game.canonicalFacts.actionsAgainstAgent.exposeVotesReceivedByRound.filter((entry) => entry.round === round),
      councilVotesReceived: game.canonicalFacts.actionsAgainstAgent.councilVotesReceived.filter((entry) => entry.round === round),
      timesNominated: game.canonicalFacts.actionsAgainstAgent.timesNominated.filter((entry) => entry.round === round),
      shieldsReceived: game.canonicalFacts.actionsAgainstAgent.shieldsReceived.filter((entry) => entry.round === round),
    },
  };
}

function evidenceRefKey(ref: OwnerLearningEvidenceRef): string {
  return [ref.kind, ref.gameId, ref.coordinate, ref.sourceHash, ref.sourceVersion].join("\u001f");
}

function parseEvidenceRef(value: unknown): OwnerLearningEvidenceRef {
  const record = objectValue(value, "evidence ref");
  const kind = boundedString(record.kind, "evidenceRef.kind", 40);
  if (!["canonical_event", "decision", "dialogue", "cognition", "game_summary"].includes(kind)) {
    throw new Error("evidenceRef.kind is invalid");
  }
  return {
    kind: kind as OwnerLearningEvidenceRef["kind"],
    gameId: boundedString(record.gameId, "evidenceRef.gameId", 200),
    coordinate: boundedString(record.coordinate, "evidenceRef.coordinate", 240),
    sourceHash: boundedString(record.sourceHash, "evidenceRef.sourceHash", 200),
    sourceVersion: boundedString(record.sourceVersion, "evidenceRef.sourceVersion", 200),
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must contain at most ${max} entries`);
  return value;
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new Error(`${label} must contain 1-${max} characters`);
  }
  return value;
}

function boundedStringArray(value: unknown, label: string, maxItems: number, maxChars: number): string[] {
  return arrayValue(value, label, maxItems).map((entry, index) =>
    boundedString(entry, `${label}[${index}]`, maxChars)
  );
}

function evidenceHandleSchema(): Record<string, unknown> {
  return { type: "string", maxLength: 24 };
}

function ownerLearningFinalResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "diagnosis",
      "analysisTrack",
      "strategyHealthClassification",
      "recommendations",
      "proposal",
      "noChange",
    ],
    properties: {
      diagnosis: { type: "string", maxLength: 1_200 },
      analysisTrack: { type: "string", enum: ["evidence_rich", "strategy_health_check"] },
      strategyHealthClassification: {
        anyOf: [{
          type: "string",
          enum: ["guidance_gap", "execution_gap", "no_clear_strategy_defect"],
        }, { type: "null" }],
      },
      recommendations: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
            required: ["title", "disposition", "confidence", "rationale", "keepGuidance", "evidenceHandles", "proof"],
          properties: {
            title: { type: "string", maxLength: 160 },
            disposition: { type: "string", enum: ["change", "keep", "gather_more_evidence"] },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            rationale: { type: "string", maxLength: 1_200 },
            keepGuidance: { anyOf: [{ type: "string", maxLength: 800 }, { type: "null" }] },
              evidenceHandles: { type: "array", maxItems: 8, items: evidenceHandleSchema() },
            proof: {
              anyOf: [{
                type: "object",
                additionalProperties: false,
                required: [
                  "kind",
                  "rubricCategory",
                  "observedEvidence",
                  "strategicInterpretation",
                  "proposedGuidance",
                  "exactGuidanceTarget",
                ],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["observed_pattern", "prompt_guidance_defect", "combined"],
                  },
                  rubricCategory: {
                    anyOf: [{
                      type: "string",
                      enum: [
                        "ambiguous_priority",
                        "conflicting_instructions",
                        "missing_contingency",
                        "non_actionable_guidance",
                        "missing_social_plan",
                        "missing_vote_plan",
                      ],
                    }, { type: "null" }],
                  },
                  observedEvidence: { type: "string", maxLength: 800 },
                  strategicInterpretation: { type: "string", maxLength: 800 },
                  proposedGuidance: { type: "string", maxLength: 800 },
                  exactGuidanceTarget: { type: "string", maxLength: 400 },
                },
              }, { type: "null" }],
            },
          },
        },
      },
      proposal: {
        anyOf: [{
          type: "object",
          additionalProperties: false,
          required: ["field", "before", "after"],
          properties: {
            field: { type: "string", const: "strategyStyle" },
            before: { type: "string", maxLength: 2_000 },
            after: { type: "string", maxLength: 2_000 },
          },
        }, { type: "null" }],
      },
      noChange: {
        anyOf: [{
          type: "object",
          additionalProperties: false,
          required: ["rationale"],
          properties: { rationale: { type: "string", maxLength: 1_200 } },
        }, { type: "null" }],
      },
    },
  };
}

function normalizeNullableFinalResult(value: unknown): unknown {
  const result = structuredClone(value);
  const record = objectValue(result, "final result");
  for (const key of ["strategyHealthClassification", "proposal", "noChange"] as const) {
    if (record[key] === null) delete record[key];
  }
  if (Array.isArray(record.recommendations)) {
    for (const recommendationValue of record.recommendations) {
      const recommendation = objectValue(recommendationValue, "recommendation");
      if (recommendation.keepGuidance === null) delete recommendation.keepGuidance;
      if (recommendation.proof === null) {
        delete recommendation.proof;
      } else if (recommendation.proof !== undefined) {
        const proof = objectValue(recommendation.proof, "recommendation proof");
        if (proof.rubricCategory === null) delete proof.rubricCategory;
      }
    }
  }
  return record;
}
