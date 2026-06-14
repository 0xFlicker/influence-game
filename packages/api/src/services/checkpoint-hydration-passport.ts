/**
 * Checkpoint Hydration Passport
 *
 * Validator-derived readiness record for durable checkpoints.
 * Derives fail-closed verdicts and stamp diagnostics from persisted checkpoint
 * capsules, durable event/projection state, cursors, and (in later units) boundary
 * + continuity evidence.
 *
 * This module does NOT implement resume. `hydration_candidate` means the
 * checkpoint carries the v1 evidence required for a future hydration attempt.
 * It must never be interpreted as "safe to call GameRunner.fromCheckpoint()".
 */

import type { DurableRunDiagnostic } from "./game-durable-run.js";

export type HydrationPassportVerdict = "forensic_only" | "blocked" | "hydration_candidate";

export type PassportStampId =
  | "eventLogReplay"
  | "projectionReplay"
  | "boundaryCertificate"
  | "snapshotManifest"
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
  /** Raw checkpoint row fields (from game_checkpoints) */
  lastEventSequence: number;
  checkpointKind: string;
  hydrateable: boolean;
  hydrationStatus: unknown;
  snapshot: unknown;
  transcriptCursor: unknown;
  tokenCostCursor: unknown;
  eventHeadHash: string;
  checkpointOwnerEpoch: string;
  degradedReason?: string | null;
  createdAt: string;

  /** Context from durable run inspection for cross-validation */
  eventLogStatus: "empty" | "complete" | "invalid";
  projectionStatus: string;
  /** Whether top-level event/projection replay for the run succeeded for this boundary */
  hasValidEventPrefixUpTo: (seq: number) => boolean;
  hasValidProjectionUpTo: (seq: number) => boolean;
}

export interface DerivePassportResult {
  passport: HydrationPassport;
  diagnostics: DurableRunDiagnostic[];
}

/**
 * Required stamps for v1 hydration candidate.
 * Order is conventional for diagnostics.
 */
const REQUIRED_V1_STAMPS: PassportStampId[] = [
  "eventLogReplay",
  "projectionReplay",
  "boundaryCertificate",
  "snapshotManifest",
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

const FORBIDDEN_CONTINUITY_KEYS = new Set([
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
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTokenUsage(value: unknown): boolean {
  return isRecord(value) && TOKEN_USAGE_KEYS.every((key) => typeof value[key] === "number");
}

function isTokenCursor(value: unknown): boolean {
  if (!isRecord(value) || value.version !== 1 || !isTokenUsage(value.totals) || !isRecord(value.perSource)) {
    return false;
  }
  return Object.values(value.perSource).every(isTokenUsage);
}

function isBoundaryReceipt(value: unknown, expectedSequence: number, expectedHash: string): boolean {
  return isRecord(value) &&
    value.sequence === expectedSequence &&
    typeof value.hash === "string" &&
    value.hash === expectedHash;
}

function containsForbiddenContinuityKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenContinuityKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    FORBIDDEN_CONTINUITY_KEYS.has(key) || containsForbiddenContinuityKey(nested)
  );
}

function expectedActivePlayerCount(snapshot: Record<string, unknown> | null): number | null {
  if (!snapshot || !isRecord(snapshot.state)) return null;
  return typeof snapshot.state.alivePlayerCount === "number" ? snapshot.state.alivePlayerCount : null;
}

function componentStatus(value: unknown): string | null {
  return isRecord(value) && typeof value.status === "string" ? value.status : null;
}

function isCapturedManifestComponent(id: string, value: unknown): boolean {
  const status = componentStatus(value);
  if (status === "captured") return true;
  return (id === "playerContinuity" || id === "houseContinuity") && status === "private_reference_only";
}

function isMalformedManifestComponent(value: unknown): boolean {
  return !isRecord(value) || typeof value.status !== "string";
}

function isTranscriptCursor(value: unknown): boolean {
  return isRecord(value) &&
    (value.durableBoundary === true || typeof value.lastEntryId === "string" || typeof value.lastOutboxId === "string");
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

/**
 * Derive a hydration passport for a single checkpoint.
 * Fail-closed on malformed data, unknown versions, or missing required evidence.
 * Current (pre-manifest) forensic capsules always produce non-candidate verdicts
 * with explicit missing-stamp diagnostics.
 */
export function deriveHydrationPassport(input: DerivePassportInput): DerivePassportResult {
  const diagnostics: DurableRunDiagnostic[] = [];
  const stamps: PassportStamp[] = [];

  // Helper to push a stamp + optional diagnostic
  const addStamp = (
    id: PassportStampId,
    status: PassportStampStatus,
    reason?: string,
    alsoDiagnostic?: boolean,
  ) => {
    const blocking = status !== "passed";
    stamps.push({ id, status, reason, blocking });
    if (alsoDiagnostic && reason) {
      diagnostics.push({
        code: "malformed_checkpoint_hydration_status", // reuse existing diagnostic family for now; future may specialize
        severity: "error",
        message: `Passport stamp ${id}: ${reason}`,
        sequence: input.lastEventSequence,
      });
    }
  };

  // 1. Parse/validate existing hydrationStatus shape (compat + malformed detection)
  let parsedHydration: Record<string, unknown> | null = null;
  let malformedHydration = false;
  if (isRecord(input.hydrationStatus)) {
    parsedHydration = input.hydrationStatus as Record<string, unknown>;
  } else if (input.hydrationStatus != null) {
    malformedHydration = true;
  }

  if (malformedHydration || (input.hydrateable && (parsedHydration == null || Object.keys(parsedHydration).length === 0))) {
    diagnostics.push({
      code: "malformed_checkpoint_hydration_status",
      severity: "error",
      message: "Checkpoint hydration status cannot support hydrateable=true or is malformed",
      sequence: input.lastEventSequence,
    });
  }

  // 2. Event log replay stamp (cross-check boundary against persisted log)
  if (input.eventLogStatus === "complete" && input.hasValidEventPrefixUpTo(input.lastEventSequence)) {
    addStamp("eventLogReplay", "passed");
  } else if (input.eventLogStatus === "invalid" || !input.hasValidEventPrefixUpTo(input.lastEventSequence)) {
    addStamp("eventLogReplay", "failed", "event log replay failed or prefix does not cover checkpoint boundary");
  } else {
    addStamp("eventLogReplay", "missing", "no durable event log available for boundary validation");
  }

  // 3. Projection replay stamp
  const projSt = input.projectionStatus;
  if ((projSt === "replayed" || projSt === "complete") && input.hasValidProjectionUpTo(input.lastEventSequence)) {
    addStamp("projectionReplay", "passed");
  } else if (projSt === "invalid" || projSt === "stale" || projSt === "failed") {
    addStamp("projectionReplay", "failed", "projection replay invalid or stale at checkpoint boundary");
  } else {
    addStamp("projectionReplay", "missing", "no valid projection replay available for checkpoint");
  }

  // 4. Boundary certificate (U3+): look for embedded evidence in snapshot payload or future dedicated.
  const snapForBoundary = isRecord(input.snapshot) ? input.snapshot : null;
  const bc = (snapForBoundary?.boundaryCertificate as Record<string, unknown> | undefined) ?? undefined;
  const hasBoundaryEvidence =
    !!bc &&
    typeof bc.boundarySequence === "number" &&
    bc.boundarySequence === input.lastEventSequence &&
    bc.ownerEpoch === input.checkpointOwnerEpoch &&
    bc.noPendingEffectsAsserted === true &&
    isBoundaryReceipt(bc.eventCommitReceipt, input.lastEventSequence, input.eventHeadHash);
  if (hasBoundaryEvidence) {
    addStamp("boundaryCertificate", "passed");
  } else if (bc) {
    const reason = bc.noPendingEffectsAsserted !== true
      ? "boundary certificate present but no-pending-effects assertion missing or false"
      : (bc.ownerEpoch !== input.checkpointOwnerEpoch
          ? "boundary certificate owner epoch does not match checkpoint row"
      : (!isBoundaryReceipt(bc.eventCommitReceipt, input.lastEventSequence, input.eventHeadHash)
          ? "boundary certificate missing matching durable event commit receipt"
          : "boundary certificate incomplete"));
    addStamp("boundaryCertificate", "failed", reason);
  } else {
    addStamp("boundaryCertificate", "missing", "boundary certificate evidence absent (no owner epoch proof, sequence alignment, or no-pending-effect assertion)");
  }

  // 5. Snapshot manifest (v1: pre-manifest capsules use loose snapshot blob -> unknown or missing)
  const snapshot = input.snapshot;
  let manifestVersion: number | null = null;
  let hasManifestShape = false;
  let components: Record<string, unknown> | null = null;
  if (isRecord(snapshot)) {
    const s = snapshot;
    const directVersion = typeof s.manifestVersion === "number" ? s.manifestVersion : null;
    const nested = s.manifest && typeof s.manifest === "object" ? (s.manifest as Record<string, unknown>) : null;
    if (directVersion != null) {
      manifestVersion = directVersion;
      hasManifestShape = true;
      if (nested && isRecord(nested.components)) {
        components = nested.components as Record<string, unknown>;
      }
    } else if (nested && typeof nested.version === "number") {
      manifestVersion = nested.version as number;
      hasManifestShape = true;
      if (isRecord(nested.components)) {
        components = nested.components as Record<string, unknown>;
      }
    } else if (isRecord(s.components)) {
      // direct components (edge)
      hasManifestShape = true;
      components = s.components as Record<string, unknown>;
    }
  }

  if (manifestVersion != null && manifestVersion === 1 && hasManifestShape) {
    // In full U2+ all required components present with proper ids; for now require the key set exists
    const expectedIds = ["projectionTruth", "xstateActor", "phaseAccumulators", "playerContinuity", "houseContinuity", "transcriptCursor", "tokenCursor", "ownerEpoch"];
    const hasAllKeys = components != null && expectedIds.every((k) => Object.prototype.hasOwnProperty.call(components, k));
    const malformedComponents = components != null
      ? expectedIds.filter((id) => isMalformedManifestComponent(components?.[id]))
      : [];
    const missingComponents = components != null
      ? expectedIds.filter((id) => !isCapturedManifestComponent(id, components?.[id]))
      : expectedIds;
    if (hasAllKeys && malformedComponents.length === 0 && missingComponents.length === 0) {
      addStamp("snapshotManifest", "passed");
    } else if (malformedComponents.length > 0) {
      addStamp("snapshotManifest", "malformed", `manifest v1 has malformed component entries: ${malformedComponents.join(", ")}`);
    } else {
      addStamp("snapshotManifest", "failed", `manifest v1 has missing or blocked components: ${missingComponents.join(", ")}`);
    }
  } else if (manifestVersion != null && manifestVersion !== 1) {
    addStamp("snapshotManifest", "unknown_version", `unsupported manifest version ${manifestVersion}`);
  } else if (hasManifestShape) {
    addStamp("snapshotManifest", "malformed", "snapshot claims manifest shape but lacks version or required components");
  } else {
    // Current forensic shape: snapshot is {eventCount, state, projectionSummary} or wrapped legacy
    addStamp("snapshotManifest", "missing", "no versioned snapshot manifest present (forensic capsule shape)");
  }

  // 6. Transcript cursor (U4): require durable boundary marker (not just in-memory entries count) to pass.
  // Live engine writes emit entry counts only -> treated as failed for this stamp (keeps live blocked until durable transcript cursoring lands).
  const tc = input.transcriptCursor;
  if (isRecord(tc)) {
    const t = tc;
    if (isTranscriptCursor(t)) {
      addStamp("transcriptCursor", "passed");
    } else if (typeof t.entries === "number") {
      addStamp("transcriptCursor", "failed", "transcript cursor is in-memory entry count only (not a durable boundary)");
    } else {
      addStamp("transcriptCursor", "malformed", "transcriptCursor present but missing durable boundary marker");
    }
  } else if (tc != null) {
    addStamp("transcriptCursor", "malformed", "transcriptCursor is not an object");
  } else {
    addStamp("transcriptCursor", "missing", "transcript cursor absent");
  }

  // 7. Token cursor
  const tk = input.tokenCostCursor;
  if (isTokenCursor(tk)) {
    addStamp("tokenCursor", "passed");
  } else if (isRecord(tk)) {
    addStamp("tokenCursor", "malformed", "tokenCostCursor present but not a valid versioned cursor");
  } else if (tk != null) {
    addStamp("tokenCursor", "malformed", "tokenCostCursor present but not a valid cursor object");
  } else {
    addStamp("tokenCursor", "missing", "token cost cursor absent");
  }

  // 8/9. Continuity capsules (player + house) U5+
  const snap = isRecord(input.snapshot) ? input.snapshot : null;
  const pcs = Array.isArray(snap?.playerContinuityCapsules) ? (snap!.playerContinuityCapsules as unknown[]) : [];
  const hcc = snap?.houseContinuityCapsule && typeof snap.houseContinuityCapsule === "object" ? snap.houseContinuityCapsule : null;
  const expectedPlayers = expectedActivePlayerCount(snap);

  if (
    pcs.length > 0 &&
    pcs.every(isPlayerContinuityCapsule) &&
    (expectedPlayers == null || new Set(pcs.map((capsule) => (capsule as Record<string, unknown>).playerId)).size >= expectedPlayers)
  ) {
    addStamp("playerContinuity", "passed");
  } else if (pcs.length > 0) {
    const reason = expectedPlayers != null && pcs.length < expectedPlayers
      ? "player continuity capsules do not cover every expected active player"
      : "one or more player continuity capsules are malformed";
    addStamp("playerContinuity", "malformed", reason);
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

  const ownerEpochStatus = isRecord(bc) && bc.ownerEpoch === input.checkpointOwnerEpoch ? "passed" : "missing";
  addStamp(
    "ownerEpoch",
    ownerEpochStatus,
    ownerEpochStatus === "passed" ? undefined : "checkpoint boundary certificate does not prove owner epoch",
  );

  const privacyViolation = containsForbiddenContinuityKey(pcs) || containsForbiddenContinuityKey(hcc);
  addStamp(
    "privacy",
    privacyViolation ? "failed" : "passed",
    privacyViolation ? "continuity capsules contain raw reasoning, prompt/response, storage, or source-pointer fields" : undefined,
  );

  // Derive verdict
  const allRequiredPassed = REQUIRED_V1_STAMPS.every((id) => {
    const s = stamps.find((x) => x.id === id);
    return s?.status === "passed";
  });

  let verdict: HydrationPassportVerdict;
  if (allRequiredPassed) {
    verdict = "hydration_candidate";
  } else {
    // Has checkpoint evidence (row existed) -> blocked, else forensic_only
    const hasCheckpointEvidence = input.snapshot != null || input.hydrationStatus != null || input.lastEventSequence >= 0;
    verdict = hasCheckpointEvidence ? "blocked" : "forensic_only";
  }

  // Unknown manifest version already produced unknown_version stamps (blocking).

  // If the old hydrateable field lies (true while missingInputs), the earlier diagnostics caught it.

  return { passport: { verdict, stamps }, diagnostics };
}

/**
 * Convenience: produce a minimal "no evidence" forensic passport for rows that have no capsule payload at all.
 */
export function forensicOnlyPassport(_sequence: number): HydrationPassport {
  const stamps: PassportStamp[] = REQUIRED_V1_STAMPS.map((id) => ({
    id,
    status: "missing" as PassportStampStatus,
    reason: "checkpoint capsule contains no hydration evidence",
    blocking: true,
  }));
  return { verdict: "forensic_only", stamps };
}
