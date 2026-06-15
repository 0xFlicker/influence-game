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
  type CheckpointBoundaryIdentityV1,
} from "@influence/engine";
import type { DurableRunDiagnostic } from "./game-durable-run.js";

export type HydrationPassportVerdict = "forensic_only" | "blocked" | "hydration_candidate";

export type PassportStampId =
  | "eventLogReplay"
  | "projectionReplay"
  | "boundaryCertificate"
  | "runtimeSnapshot"
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
  snapshot: unknown;
  transcriptCursor: unknown;
  tokenCostCursor: unknown;
  eventHeadHash: string;
  projectionHash: string;
  checkpointPhase: string | null;
  checkpointRound: number | null;
  checkpointOwnerEpoch: string;
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
  "runtimeSnapshot",
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

const ACCUMULATOR_STATUSES = new Set([
  "empty",
  "drained",
  "blocked",
  "malformed",
  "not_v1_hydratable",
]);

const ACCUMULATOR_PROOF_KINDS = new Set([
  "empty_at_boundary",
  "drained_at_boundary",
  "not_applicable_at_boundary",
]);

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

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
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

function validateActorWitness(
  witness: unknown,
  input: DerivePassportInput,
  projectionRound: number | null,
  projectionPhase: string | null,
  expectedPlayerIds: readonly string[] | null,
): { status: PassportStampStatus; reason?: string } {
  if (witness == null) {
    return { status: "missing", reason: "actor witness absent" };
  }
  if (!isRecord(witness) || witness.version !== 1) {
    return { status: "malformed", reason: "actor witness is not a valid v1 object" };
  }
  const boundary = parseBoundaryIdentity(witness.boundary);
  if (!boundary) {
    return { status: "malformed", reason: "actor witness boundary identity is malformed" };
  }
  if (!boundaryMatchesRow(boundary, input)) {
    return { status: "failed", reason: "actor witness boundary identity does not match checkpoint row" };
  }
  const contextSummary = isRecord(witness.contextSummary) ? witness.contextSummary : null;
  if (!contextSummary ||
      typeof contextSummary.round !== "number" ||
      typeof contextSummary.phase !== "string" ||
      !Array.isArray(contextSummary.alivePlayerIds) ||
      !contextSummary.alivePlayerIds.every((id) => typeof id === "string")) {
    return { status: "malformed", reason: "actor witness context summary is malformed" };
  }
  if (projectionRound != null && contextSummary.round !== projectionRound) {
    return { status: "failed", reason: "actor witness round does not match projection facts" };
  }
  if (projectionPhase != null && contextSummary.phase !== projectionPhase) {
    return { status: "failed", reason: "actor witness phase does not match projection facts" };
  }
  if (expectedPlayerIds && !sameStringSet(contextSummary.alivePlayerIds, expectedPlayerIds)) {
    return { status: "failed", reason: "actor witness alive players do not match expected active player evidence" };
  }
  if (typeof witness.actorCoordinate !== "string" || witness.actorCoordinate.length === 0) {
    return { status: "malformed", reason: "actor witness missing phase-machine coordinate" };
  }
  if (witness.machineSchemaVersion !== "phase-machine-v1" ||
      (witness.actorStatus !== "active" && witness.actorStatus !== "done") ||
      witness.futureHydrationInputVersion !== 1) {
    return { status: "malformed", reason: "actor witness metadata is malformed" };
  }
  return { status: "passed" };
}

function accumulatorStatusNeedsProof(status: string): boolean {
  return status === "empty" || status === "drained" || status === "not_v1_hydratable";
}

function expectedAccumulatorProofKind(status: string): string | null {
  switch (status) {
    case "empty":
      return "empty_at_boundary";
    case "drained":
      return "drained_at_boundary";
    case "not_v1_hydratable":
      return "not_applicable_at_boundary";
    default:
      return null;
  }
}

function validateAccumulatorRegistry(
  registry: unknown,
  input: DerivePassportInput,
): { status: PassportStampStatus; reason?: string } {
  if (registry == null) {
    return { status: "missing", reason: "accumulator registry absent" };
  }
  if (!isRecord(registry) || registry.version !== 1) {
    return { status: "malformed", reason: "accumulator registry is not a valid v1 object" };
  }
  if (registry.boundaryClass !== "phase_boundary") {
    return { status: "malformed", reason: "unsupported accumulator registry boundary class" };
  }
  const boundary = parseBoundaryIdentity(registry.boundary);
  if (!boundary) {
    return { status: "malformed", reason: "accumulator registry boundary identity is malformed" };
  }
  if (!boundaryMatchesRow(boundary, input)) {
    return { status: "failed", reason: "accumulator registry boundary identity does not match checkpoint row" };
  }

  if (!Array.isArray(registry.entries)) {
    return { status: "malformed", reason: "accumulator registry entries are malformed" };
  }
  const entries = registry.entries;
  const entryIds = new Set(
    entries
      .map((entry) => isRecord(entry) && typeof entry.id === "string" ? entry.id : null)
      .filter((id): id is string => id !== null),
  );
  const missingRequired = PHASE_BOUNDARY_ACCUMULATOR_IDS.filter((id) => !entryIds.has(id));
  if (missingRequired.length > 0) {
    return { status: "failed", reason: `accumulator registry missing required ids: ${missingRequired.join(", ")}` };
  }

  for (const entry of entries) {
    const entryLabel = isRecord(entry) && typeof entry.id === "string" ? entry.id : "(unknown)";
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.status !== "string") {
      return { status: "malformed", reason: `accumulator entry ${entryLabel} is malformed` };
    }
    if (!PHASE_BOUNDARY_ACCUMULATOR_IDS.includes(entry.id as (typeof PHASE_BOUNDARY_ACCUMULATOR_IDS)[number])) {
      return { status: "failed", reason: `accumulator registry contains unknown id: ${entry.id}` };
    }
    if (!ACCUMULATOR_STATUSES.has(entry.status)) {
      return { status: "malformed", reason: `accumulator ${entry.id} has unknown status ${entry.status}` };
    }
    if (accumulatorStatusNeedsProof(entry.status) && !isRecord(entry.proof)) {
      return { status: "failed", reason: `accumulator ${entry.id} status ${entry.status} lacks required proof` };
    }
    if (isRecord(entry.proof) && (typeof entry.proof.kind !== "string" || !ACCUMULATOR_PROOF_KINDS.has(entry.proof.kind))) {
      return { status: "malformed", reason: `accumulator ${entry.id} proof is malformed` };
    }
    const expectedProofKind = expectedAccumulatorProofKind(entry.status);
    if (expectedProofKind && isRecord(entry.proof) && entry.proof.kind !== expectedProofKind) {
      return { status: "failed", reason: `accumulator ${entry.id} status ${entry.status} has mismatched proof kind` };
    }
    if (entry.status === "blocked" || entry.status === "malformed") {
      return { status: "failed", reason: `accumulator ${entry.id} is ${entry.status}` };
    }
  }

  return { status: "passed" };
}

function validateTranscriptWatermark(
  watermark: unknown,
  input: DerivePassportInput,
  transcriptCursor: unknown,
): { status: PassportStampStatus; reason?: string } {
  if (watermark == null) {
    if (isRecord(transcriptCursor) &&
        typeof transcriptCursor.entries === "number" &&
        transcriptCursor.durableBoundary !== true) {
      return { status: "failed", reason: "transcript cursor is in-memory entry count only (not a durable boundary)" };
    }
    return { status: "missing", reason: "transcript watermark absent" };
  }
  if (!isRecord(watermark) || watermark.version !== 1) {
    return { status: "malformed", reason: "transcript watermark is not a valid v1 object" };
  }
  const boundary = parseBoundaryIdentity(watermark.boundary);
  if (!boundary) {
    return { status: "malformed", reason: "transcript watermark boundary identity is malformed" };
  }
  if (!boundaryMatchesRow(boundary, input)) {
    return { status: "failed", reason: "transcript watermark boundary identity does not match checkpoint row" };
  }
  if (watermark.durableBoundary !== true ||
      typeof watermark.boundaryDigest !== "string" ||
      typeof watermark.lastCanonicalSequence !== "number" ||
      typeof watermark.entryCount !== "number") {
    return { status: "malformed", reason: "transcript watermark missing durable boundary digest" };
  }
  if (watermark.lastCanonicalSequence !== input.lastEventSequence) {
    return { status: "failed", reason: "transcript watermark does not cover checkpoint boundary" };
  }
  if (containsForbiddenPrivacyKey(watermark)) {
    return { status: "failed", reason: "transcript watermark contains forbidden private content fields" };
  }
  return { status: "passed" };
}

function isTranscriptCursorFromWatermark(
  transcriptCursor: unknown,
  watermark: unknown,
): boolean {
  if (!isRecord(transcriptCursor) || !isRecord(watermark)) return false;
  return transcriptCursor.version === 1 &&
    transcriptCursor.durableBoundary === true &&
    transcriptCursor.entries === watermark.entryCount &&
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

function expectedActivePlayerIds(snapshot: Record<string, unknown> | null): {
  status: PassportStampStatus;
  ids: string[];
  reason?: string;
} {
  const explicit = snapshot?.expectedActivePlayerIds;
  if (Array.isArray(explicit)) {
    if (!explicit.every((id) => typeof id === "string")) {
      return { status: "malformed", ids: [], reason: "expected active player ids must be strings" };
    }
    const ids = [...new Set(explicit)];
    const state = snapshot?.state;
    const alivePlayerCount = isRecord(state) && typeof state.alivePlayerCount === "number"
      ? state.alivePlayerCount
      : null;
    if (alivePlayerCount != null && alivePlayerCount > 0 && ids.length !== alivePlayerCount) {
      return { status: "failed", ids, reason: "expected active player ids do not match live player count" };
    }
    return { status: "passed", ids };
  }
  if (!snapshot || !isRecord(snapshot.state)) {
    return { status: "missing", ids: [], reason: "checkpoint state missing expected active player evidence" };
  }
  const count = typeof snapshot.state.alivePlayerCount === "number" ? snapshot.state.alivePlayerCount : 0;
  if (count > 0) {
    return { status: "failed", ids: [], reason: "expected active player ids absent for live players" };
  }
  return { status: "passed", ids: [] };
}

function parseRuntimeSnapshot(snapshot: Record<string, unknown> | null): {
  status: PassportStampStatus;
  value: Record<string, unknown> | null;
  reason?: string;
} {
  const rs = snapshot?.runtimeSnapshot;
  if (rs == null) {
    return { status: "missing", value: null, reason: "no versioned runtime snapshot present (forensic capsule shape)" };
  }
  if (!isRecord(rs)) {
    return { status: "malformed", value: null, reason: "runtime snapshot is not an object" };
  }
  if (rs.version !== 1) {
    return { status: "unknown_version", value: null, reason: "runtime snapshot version is unsupported" };
  }
  return { status: "passed", value: rs };
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
  const runtimeSnapshotResult = parseRuntimeSnapshot(snap);
  addStamp("runtimeSnapshot", runtimeSnapshotResult.status, runtimeSnapshotResult.reason);
  const runtimeSnapshot = runtimeSnapshotResult.value;
  const bc = (snap?.boundaryCertificate as Record<string, unknown> | undefined) ?? undefined;
  const projectionSummary = isRecord(snap?.projectionSummary) ? snap!.projectionSummary as Record<string, unknown> : null;
  const projectionRound = typeof projectionSummary?.round === "number" ? projectionSummary.round : input.checkpointRound;
  const projectionPhase = typeof projectionSummary?.phase === "string" ? projectionSummary.phase : input.checkpointPhase;
  const expectedPlayers = expectedActivePlayerIds(snap);

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

  const actorResult = validateActorWitness(
    runtimeSnapshot?.actorWitness,
    input,
    projectionRound,
    projectionPhase,
    expectedPlayers.status === "passed" ? expectedPlayers.ids : null,
  );
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
    if (!tokenBoundary) {
      addStamp("tokenCursor", "failed", "token cursor boundary identity absent or malformed");
    } else if (!boundaryMatchesRow(tokenBoundary, input)) {
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
  const capsulePlayerIds = new Set(
    pcs.map((capsule) => isRecord(capsule) ? capsule.playerId : null).filter((id): id is string => typeof id === "string"),
  );

  if (
    pcs.length > 0 &&
    pcs.every(isPlayerContinuityCapsule) &&
    expectedPlayers.status === "passed" &&
    expectedPlayers.ids.every((id) => capsulePlayerIds.has(id))
  ) {
    addStamp("playerContinuity", "passed");
  } else if (pcs.length > 0) {
    if (expectedPlayers.status !== "passed") {
      addStamp("playerContinuity", expectedPlayers.status, expectedPlayers.reason);
    } else {
      const missingPlayers = expectedPlayers.ids.filter((id) => !capsulePlayerIds.has(id));
      const reason = missingPlayers.length > 0
        ? `player continuity capsules missing expected active players: ${missingPlayers.join(", ")}`
        : "one or more player continuity capsules are malformed";
      addStamp("playerContinuity", missingPlayers.length > 0 ? "failed" : "malformed", reason);
    }
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
    containsForbiddenPrivacyKey(input.transcriptCursor) ||
    containsForbiddenPrivacyKey(input.tokenCostCursor);
  addStamp(
    "privacy",
    privacyViolation ? "failed" : "passed",
    privacyViolation ? "checkpoint evidence contains raw reasoning, prompt/response, storage, or transcript content fields" : undefined,
  );

  const allRequiredPassed = REQUIRED_V1_STAMPS.every((id) => {
    const stamp = stamps.find((entry) => entry.id === id);
    return stamp?.status === "passed";
  });

  let verdict: HydrationPassportVerdict;
  if (allRequiredPassed) {
    verdict = "hydration_candidate";
  } else {
    const hasCheckpointEvidence = input.snapshot != null || input.lastEventSequence >= 0;
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
