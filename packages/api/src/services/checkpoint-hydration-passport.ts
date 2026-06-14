/**
 * Checkpoint Hydration Passport
 *
 * Validator-derived readiness record for durable checkpoints.
 * Derives fail-closed verdicts and stamp diagnostics from persisted checkpoint
 * capsules, durable event/projection state, cursors, boundary identity, and
 * Runtime Snapshot v1 evidence.
 *
 * This module does NOT implement resume. `hydration_candidate` means the
 * checkpoint carries the v1 evidence required for a future hydration attempt.
 * It must never be interpreted as "safe to call GameRunner.fromCheckpoint()".
 */

import {
  PHASE_BOUNDARY_ACCUMULATOR_IDS,
  type AccumulatorEntryV1,
  type ActorWitnessV1,
  type CheckpointBoundaryIdentityV1,
  type PhaseAccumulatorRegistryV1,
  type RuntimeSnapshotV1,
  type TranscriptWatermarkV1,
} from "@influence/engine";
import type { DurableRunDiagnostic } from "./game-durable-run.js";

export type HydrationPassportVerdict = "forensic_only" | "blocked" | "hydration_candidate";

export type PassportStampId =
  | "eventLogReplay"
  | "projectionReplay"
  | "boundaryCertificate"
  | "snapshotManifest"
  | "actorWitness"
  | "accumulatorRegistry"
  | "transcriptCursor"
  | "tokenCursor"
  | "playerContinuity"
  | "houseContinuity"
  | "ownerEpoch"
  | "privacy";

export type PassportStampStatus =
  | "passed"
  | "failed"
  | "missing"
  | "malformed"
  | "unknown_version";

export interface PassportStamp {
  id: PassportStampId;
  status: PassportStampStatus;
  reason?: string;
  blocking: boolean;
}

export interface HydrationPassport {
  verdict: HydrationPassportVerdict;
  stamps: PassportStamp[];
}

export interface DerivePassportInput {
  lastEventSequence: number;
  checkpointKind: string;
  hydrateable: boolean;
  hydrationStatus: unknown;
  snapshot: unknown;
  transcriptCursor: unknown;
  tokenCostCursor: unknown;
  eventHeadHash: string;
  projectionHash: string;
  checkpointPhase: string | null;
  checkpointRound: number | null;
  checkpointOwnerEpoch: string;
  degradedReason?: string | null;
  createdAt: string;
  eventLogStatus: "empty" | "complete" | "invalid";
  projectionStatus: string;
  hasValidEventPrefixUpTo: (seq: number) => boolean;
  hasValidProjectionUpTo: (seq: number) => boolean;
}

export interface DerivePassportResult {
  passport: HydrationPassport;
  diagnostics: DurableRunDiagnostic[];
}

const REQUIRED_V1_STAMPS: PassportStampId[] = [
  "eventLogReplay",
  "projectionReplay",
  "boundaryCertificate",
  "snapshotManifest",
  "actorWitness",
  "accumulatorRegistry",
  "transcriptCursor",
  "tokenCursor",
  "playerContinuity",
  "houseContinuity",
  "ownerEpoch",
  "privacy",
];

const TOKEN_USAGE_KEYS = [
  "promptTokens",
  "cachedTokens",
  "completionTokens",
  "reasoningTokens",
  "totalTokens",
  "callCount",
  "emptyResponses",
] as const;

const FORBIDDEN_PRIVACY_KEYS = new Set([
  "thinking",
  "reasoningContext",
  "prompt",
  "prompts",
  "response",
  "responses",
  "rawPrompt",
  "rawResponse",
  "storageKey",
  "storage",
  "sourcePointers",
  "text",
  "message",
  "transcript",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTokenUsage(value: unknown): boolean {
  return isRecord(value) && TOKEN_USAGE_KEYS.every((key) => typeof value[key] === "number");
}

function isTokenCursor(value: unknown): boolean {
  return isRecord(value) &&
    value.version === 1 &&
    isTokenUsage(value.totals) &&
    isRecord(value.perSource) &&
    Object.values(value.perSource).every(isTokenUsage);
}

function isBoundaryReceipt(value: unknown, expectedSequence: number, expectedHash: string): boolean {
  return isRecord(value) &&
    value.sequence === expectedSequence &&
    typeof value.hash === "string" &&
    value.hash === expectedHash;
}

function containsForbiddenPrivacyKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenPrivacyKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    FORBIDDEN_PRIVACY_KEYS.has(key) || containsForbiddenPrivacyKey(nested)
  );
}

function parseBoundaryIdentity(value: unknown): CheckpointBoundaryIdentityV1 | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.ownerEpoch !== "string" ||
      typeof value.boundarySequence !== "number" ||
      typeof value.eventHeadHash !== "string" ||
      typeof value.projectionHash !== "string" ||
      typeof value.checkpointKind !== "string" ||
      typeof value.phase !== "string" ||
      typeof value.round !== "number") {
    return null;
  }
  return value as unknown as CheckpointBoundaryIdentityV1;
}

function boundaryMatchesRow(
  boundary: CheckpointBoundaryIdentityV1,
  input: DerivePassportInput,
): boolean {
  return boundary.boundarySequence === input.lastEventSequence &&
    boundary.ownerEpoch === input.checkpointOwnerEpoch &&
    boundary.eventHeadHash === input.eventHeadHash &&
    boundary.projectionHash === input.projectionHash &&
    boundary.checkpointKind === input.checkpointKind &&
    (input.checkpointPhase == null || boundary.phase === input.checkpointPhase) &&
    (input.checkpointRound == null || boundary.round === input.checkpointRound);
}

function parseRuntimeSnapshot(snapshot: Record<string, unknown> | null): RuntimeSnapshotV1 | null {
  const rs = snapshot?.runtimeSnapshot;
  if (!isRecord(rs) || rs.version !== 1) return null;
  return rs as unknown as RuntimeSnapshotV1;
}

function validateActorWitness(
  witness: ActorWitnessV1 | undefined,
  input: DerivePassportInput,
  projectionRound: number | null,
  projectionPhase: string | null,
): { status: PassportStampStatus; reason?: string } {
  if (!witness || witness.version !== 1) {
    return { status: "missing", reason: "actor witness absent" };
  }
  if (!boundaryMatchesRow(witness.boundary, input)) {
    return { status: "failed", reason: "actor witness boundary identity does not match checkpoint row" };
  }
  if (projectionRound != null && witness.contextSummary.round !== projectionRound) {
    return { status: "failed", reason: "actor witness round does not match projection facts" };
  }
  if (projectionPhase != null && witness.contextSummary.phase !== projectionPhase) {
    return { status: "failed", reason: "actor witness phase does not match projection facts" };
  }
  if (typeof witness.actorCoordinate !== "string" || witness.actorCoordinate.length === 0) {
    return { status: "malformed", reason: "actor witness missing phase-machine coordinate" };
  }
  return { status: "passed" };
}

function accumulatorStatusNeedsProof(status: string): boolean {
  return status === "empty" || status === "drained" || status === "not_v1_hydratable";
}

function validateAccumulatorRegistry(
  registry: PhaseAccumulatorRegistryV1 | undefined,
  input: DerivePassportInput,
): { status: PassportStampStatus; reason?: string } {
  if (!registry || registry.version !== 1) {
    return { status: "missing", reason: "accumulator registry absent" };
  }
  if (registry.boundaryClass !== "phase_boundary") {
    return { status: "malformed", reason: "unsupported accumulator registry boundary class" };
  }
  if (!boundaryMatchesRow(registry.boundary, input)) {
    return { status: "failed", reason: "accumulator registry boundary identity does not match checkpoint row" };
  }

  const entries = Array.isArray(registry.entries) ? registry.entries as AccumulatorEntryV1[] : [];
  const entryIds = new Set(entries.map((entry) => entry.id));
  const missingRequired = PHASE_BOUNDARY_ACCUMULATOR_IDS.filter((id) => !entryIds.has(id));
  if (missingRequired.length > 0) {
    return { status: "failed", reason: `accumulator registry missing required ids: ${missingRequired.join(", ")}` };
  }

  for (const entry of entries) {
    if (!entry.id || typeof entry.status !== "string") {
      return { status: "malformed", reason: `accumulator entry ${entry.id ?? "(unknown)"} is malformed` };
    }
    if (accumulatorStatusNeedsProof(entry.status) && !isRecord(entry.proof)) {
      return { status: "failed", reason: `accumulator ${entry.id} status ${entry.status} lacks required proof` };
    }
    if (entry.status === "not_v1_hydratable" && entry.proof?.kind !== "not_applicable_at_boundary") {
      return { status: "failed", reason: `accumulator ${entry.id} not_v1_hydratable without not_applicable proof` };
    }
    if (entry.status === "blocked" || entry.status === "malformed") {
      return { status: "failed", reason: `accumulator ${entry.id} is ${entry.status}` };
    }
  }

  return { status: "passed" };
}

function validateTranscriptWatermark(
  watermark: TranscriptWatermarkV1 | undefined,
  input: DerivePassportInput,
  transcriptCursor: unknown,
): { status: PassportStampStatus; reason?: string } {
  if (!watermark || watermark.version !== 1) {
    if (isRecord(transcriptCursor) &&
        typeof transcriptCursor.entries === "number" &&
        transcriptCursor.durableBoundary !== true) {
      return { status: "failed", reason: "transcript cursor is in-memory entry count only (not a durable boundary)" };
    }
    return { status: "missing", reason: "transcript watermark absent" };
  }
  if (!boundaryMatchesRow(watermark.boundary, input)) {
    return { status: "failed", reason: "transcript watermark boundary identity does not match checkpoint row" };
  }
  if (watermark.durableBoundary !== true || typeof watermark.boundaryDigest !== "string") {
    return { status: "malformed", reason: "transcript watermark missing durable boundary digest" };
  }
  if (containsForbiddenPrivacyKey(watermark)) {
    return { status: "failed", reason: "transcript watermark contains forbidden private content fields" };
  }
  return { status: "passed" };
}

function isTranscriptCursorFromWatermark(
  transcriptCursor: unknown,
  watermark: TranscriptWatermarkV1 | undefined,
): boolean {
  if (!isRecord(transcriptCursor) || !watermark) return false;
  return transcriptCursor.durableBoundary === true &&
    transcriptCursor.boundaryDigest === watermark.boundaryDigest &&
    transcriptCursor.lastCanonicalSequence === watermark.lastCanonicalSequence;
}

function isPlayerContinuityCapsule(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const relationships = value.relationships;
  return typeof value.playerId === "string" &&
    value.playerId.length > 0 &&
    typeof value.playerName === "string" &&
    value.playerName.length > 0 &&
    Array.isArray(value.notes) &&
    Array.isArray(value.commitments) &&
    isRecord(relationships) &&
    Array.isArray(relationships.allies) &&
    Array.isArray(relationships.threats) &&
    Array.isArray(value.roundHistory) &&
    (value.strategyPacket === null || isRecord(value.strategyPacket)) &&
    (value.reflectionSummary === null || isRecord(value.reflectionSummary));
}

function isHouseContinuityCapsule(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.revisionId === "string" &&
    value.revisionId.length > 0 &&
    (value.previousRevisionId === null || typeof value.previousRevisionId === "string") &&
    typeof value.updatedAtRound === "number" &&
    typeof value.updatedAtPhase === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.alliances) &&
    Array.isArray(value.tensions) &&
    Array.isArray(value.promises) &&
    Array.isArray(value.voteBlocs) &&
    Array.isArray(value.mingleDiscoveries) &&
    Array.isArray(value.playerTrajectories) &&
    Array.isArray(value.storyArcs) &&
    Array.isArray(value.droppedThreads) &&
    Array.isArray(value.openQuestions) &&
    typeof value.changedSincePrevious === "string";
}

function expectedActivePlayerIds(snapshot: Record<string, unknown> | null): string[] {
  const explicit = snapshot?.expectedActivePlayerIds;
  if (Array.isArray(explicit)) {
    return explicit.filter((id): id is string => typeof id === "string");
  }
  if (!snapshot || !isRecord(snapshot.state)) return [];
  const count = typeof snapshot.state.alivePlayerCount === "number" ? snapshot.state.alivePlayerCount : 0;
  const capsules = Array.isArray(snapshot.playerContinuityCapsules)
    ? snapshot.playerContinuityCapsules as unknown[]
    : [];
  if (count > 0 && capsules.length >= count) {
    return capsules
      .map((capsule) => isRecord(capsule) ? capsule.playerId : null)
      .filter((id): id is string => typeof id === "string");
  }
  return [];
}

function deriveManifestStamp(
  runtimeSnapshot: RuntimeSnapshotV1 | null,
  actorStatus: PassportStampStatus,
  accumulatorStatus: PassportStampStatus,
  transcriptStatus: PassportStampStatus,
  tokenStatus: PassportStampStatus,
  playerStatus: PassportStampStatus,
  houseStatus: PassportStampStatus,
  ownerStatus: PassportStampStatus,
): { status: PassportStampStatus; reason?: string } {
  if (!runtimeSnapshot) {
    return { status: "missing", reason: "no versioned runtime snapshot present (forensic capsule shape)" };
  }

  const componentChecks: Array<[string, PassportStampStatus]> = [
    ["projectionTruth", "passed"],
    ["xstateActor", actorStatus],
    ["phaseAccumulators", accumulatorStatus],
    ["playerContinuity", playerStatus === "passed" ? "passed" : playerStatus],
    ["houseContinuity", houseStatus],
    ["transcriptCursor", transcriptStatus],
    ["tokenCursor", tokenStatus],
    ["ownerEpoch", ownerStatus],
  ];

  const failed = componentChecks.filter(([, status]) => status !== "passed").map(([name]) => name);
  if (failed.length > 0) {
    return { status: "failed", reason: `manifest components not satisfied by runtime evidence: ${failed.join(", ")}` };
  }
  return { status: "passed" };
}

export function deriveHydrationPassport(input: DerivePassportInput): DerivePassportResult {
  const diagnostics: DurableRunDiagnostic[] = [];
  const stamps: PassportStamp[] = [];

  const addStamp = (
    id: PassportStampId,
    status: PassportStampStatus,
    reason?: string,
  ) => {
    const blocking = status !== "passed";
    stamps.push({ id, status, reason, blocking });
  };

  let parsedHydration: Record<string, unknown> | null = null;
  if (isRecord(input.hydrationStatus)) {
    parsedHydration = input.hydrationStatus;
  } else if (input.hydrationStatus != null) {
    diagnostics.push({
      code: "malformed_checkpoint_hydration_status",
      severity: "error",
      message: "Checkpoint hydration status cannot support hydrateable=true or is malformed",
      sequence: input.lastEventSequence,
    });
  }

  if (parsedHydration == null && input.hydrationStatus != null) {
    // malformed handled above
  } else if (input.hydrateable && (parsedHydration == null || Object.keys(parsedHydration).length === 0)) {
    diagnostics.push({
      code: "malformed_checkpoint_hydration_status",
      severity: "error",
      message: "Checkpoint hydration status cannot support hydrateable=true or is malformed",
      sequence: input.lastEventSequence,
    });
  }

  if (input.eventLogStatus === "complete" && input.hasValidEventPrefixUpTo(input.lastEventSequence)) {
    addStamp("eventLogReplay", "passed");
  } else if (input.eventLogStatus === "invalid" || !input.hasValidEventPrefixUpTo(input.lastEventSequence)) {
    addStamp("eventLogReplay", "failed", "event log replay failed or prefix does not cover checkpoint boundary");
  } else {
    addStamp("eventLogReplay", "missing", "no durable event log available for boundary validation");
  }

  const projSt = input.projectionStatus;
  if ((projSt === "replayed" || projSt === "complete") && input.hasValidProjectionUpTo(input.lastEventSequence)) {
    addStamp("projectionReplay", "passed");
  } else if (projSt === "invalid" || projSt === "stale" || projSt === "failed") {
    addStamp("projectionReplay", "failed", "projection replay invalid or stale at checkpoint boundary");
  } else {
    addStamp("projectionReplay", "missing", "no valid projection replay available for checkpoint");
  }

  const snap = isRecord(input.snapshot) ? input.snapshot : null;
  const runtimeSnapshot = parseRuntimeSnapshot(snap);
  const bc = (snap?.boundaryCertificate as Record<string, unknown> | undefined) ?? undefined;
  const projectionSummary = isRecord(snap?.projectionSummary) ? snap!.projectionSummary as Record<string, unknown> : null;
  const projectionRound = typeof projectionSummary?.round === "number" ? projectionSummary.round : input.checkpointRound;
  const projectionPhase = typeof projectionSummary?.phase === "string" ? projectionSummary.phase : input.checkpointPhase;

  const hasBoundaryEvidence =
    !!bc &&
    typeof bc.boundarySequence === "number" &&
    bc.boundarySequence === input.lastEventSequence &&
    bc.ownerEpoch === input.checkpointOwnerEpoch &&
    bc.noPendingEffectsAsserted === true &&
    (bc.projectionHash == null || bc.projectionHash === input.projectionHash) &&
    isBoundaryReceipt(bc.eventCommitReceipt, input.lastEventSequence, input.eventHeadHash);
  if (hasBoundaryEvidence) {
    addStamp("boundaryCertificate", "passed");
  } else if (bc) {
    const reason = bc.noPendingEffectsAsserted !== true
      ? "boundary certificate present but no-pending-effects assertion missing or false"
      : (bc.ownerEpoch !== input.checkpointOwnerEpoch
          ? "boundary certificate owner epoch does not match checkpoint row"
          : (bc.projectionHash != null && bc.projectionHash !== input.projectionHash
              ? "boundary certificate projection hash does not match checkpoint row"
              : (!isBoundaryReceipt(bc.eventCommitReceipt, input.lastEventSequence, input.eventHeadHash)
                  ? "boundary certificate missing matching durable event commit receipt"
                  : "boundary certificate incomplete")));
    addStamp("boundaryCertificate", "failed", reason);
  } else {
    addStamp("boundaryCertificate", "missing", "boundary certificate evidence absent");
  }

  const actorResult = validateActorWitness(runtimeSnapshot?.actorWitness, input, projectionRound, projectionPhase);
  addStamp("actorWitness", actorResult.status, actorResult.reason);

  const accumulatorResult = validateAccumulatorRegistry(runtimeSnapshot?.accumulatorRegistry, input);
  addStamp("accumulatorRegistry", accumulatorResult.status, accumulatorResult.reason);

  const transcriptResult = validateTranscriptWatermark(
    runtimeSnapshot?.transcriptWatermark,
    input,
    input.transcriptCursor,
  );
  if (transcriptResult.status === "passed" && !isTranscriptCursorFromWatermark(input.transcriptCursor, runtimeSnapshot?.transcriptWatermark)) {
    addStamp("transcriptCursor", "failed", "transcript cursor row does not match runtime snapshot watermark");
  } else {
    addStamp("transcriptCursor", transcriptResult.status, transcriptResult.reason);
  }

  if (isTokenCursor(input.tokenCostCursor)) {
    const tokenBoundary = parseBoundaryIdentity(
      isRecord(input.tokenCostCursor) ? (input.tokenCostCursor as Record<string, unknown>).boundary : null,
    );
    if (tokenBoundary && !boundaryMatchesRow(tokenBoundary, input)) {
      addStamp("tokenCursor", "failed", "token cursor boundary identity does not match checkpoint row");
    } else {
      addStamp("tokenCursor", "passed");
    }
  } else if (isRecord(input.tokenCostCursor)) {
    addStamp("tokenCursor", "malformed", "tokenCostCursor present but not a valid versioned cursor");
  } else if (input.tokenCostCursor != null) {
    addStamp("tokenCursor", "malformed", "tokenCostCursor present but not a valid cursor object");
  } else {
    addStamp("tokenCursor", "missing", "token cost cursor absent");
  }

  const pcs = Array.isArray(snap?.playerContinuityCapsules) ? (snap!.playerContinuityCapsules as unknown[]) : [];
  const hcc = snap?.houseContinuityCapsule ?? null;
  const expectedPlayers = expectedActivePlayerIds(snap);
  const capsulePlayerIds = new Set(
    pcs.map((capsule) => isRecord(capsule) ? capsule.playerId : null).filter((id): id is string => typeof id === "string"),
  );

  if (
    pcs.length > 0 &&
    pcs.every(isPlayerContinuityCapsule) &&
    (expectedPlayers.length === 0 || expectedPlayers.every((id) => capsulePlayerIds.has(id)))
  ) {
    addStamp("playerContinuity", "passed");
  } else if (pcs.length > 0) {
    const missingPlayers = expectedPlayers.filter((id) => !capsulePlayerIds.has(id));
    const reason = missingPlayers.length > 0
      ? `player continuity capsules missing expected active players: ${missingPlayers.join(", ")}`
      : "one or more player continuity capsules are malformed";
    addStamp("playerContinuity", missingPlayers.length > 0 ? "failed" : "malformed", reason);
  } else {
    addStamp("playerContinuity", "missing", "no structured player continuity capsules present");
  }

  if (isHouseContinuityCapsule(hcc)) {
    addStamp("houseContinuity", "passed");
  } else if (hcc) {
    addStamp("houseContinuity", "malformed", "House continuity capsule is malformed");
  } else {
    addStamp("houseContinuity", "missing", "no structured House continuity capsule present");
  }

  const ownerEpochStatus = hasBoundaryEvidence ? "passed" : "missing";
  addStamp(
    "ownerEpoch",
    ownerEpochStatus,
    ownerEpochStatus === "passed" ? undefined : "checkpoint boundary certificate does not prove owner epoch",
  );

  const privacyViolation =
    containsForbiddenPrivacyKey(pcs) ||
    containsForbiddenPrivacyKey(hcc) ||
    containsForbiddenPrivacyKey(runtimeSnapshot) ||
    containsForbiddenPrivacyKey(input.transcriptCursor);
  addStamp(
    "privacy",
    privacyViolation ? "failed" : "passed",
    privacyViolation ? "checkpoint evidence contains raw reasoning, prompt/response, storage, or transcript content fields" : undefined,
  );

  const manifestResult = deriveManifestStamp(
    runtimeSnapshot,
    actorResult.status,
    accumulatorResult.status,
    stamps.find((stamp) => stamp.id === "transcriptCursor")!.status,
    stamps.find((stamp) => stamp.id === "tokenCursor")!.status,
    stamps.find((stamp) => stamp.id === "playerContinuity")!.status,
    stamps.find((stamp) => stamp.id === "houseContinuity")!.status,
    ownerEpochStatus,
  );
  addStamp("snapshotManifest", manifestResult.status, manifestResult.reason);

  const allRequiredPassed = REQUIRED_V1_STAMPS.every((id) => {
    const stamp = stamps.find((entry) => entry.id === id);
    return stamp?.status === "passed";
  });

  let verdict: HydrationPassportVerdict;
  if (allRequiredPassed) {
    verdict = "hydration_candidate";
  } else {
    const hasCheckpointEvidence = input.snapshot != null || input.hydrationStatus != null || input.lastEventSequence >= 0;
    verdict = hasCheckpointEvidence ? "blocked" : "forensic_only";
  }

  return { passport: { verdict, stamps }, diagnostics };
}

export function forensicOnlyPassport(_sequence: number): HydrationPassport {
  const stamps: PassportStamp[] = REQUIRED_V1_STAMPS.map((id) => ({
    id,
    status: "missing" as PassportStampStatus,
    reason: "checkpoint capsule contains no hydration evidence",
    blocking: true,
  }));
  return { verdict: "forensic_only", stamps };
}