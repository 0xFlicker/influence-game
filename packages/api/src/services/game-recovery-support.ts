import {
  admitHouseContinuityForRecovery,
  buildMingleInboxReplayFromTranscript,
  GameState,
  isFormatResumeCoordinate,
  mingleInboxSessionForResumeTarget,
  PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES,
  validateFormatResumePrerequisites,
  validatePlayerContinuitySetForRecovery,
  type CanonicalGameEvent,
  type CurrentAccusationsAccumulatorV1,
  type GameRunnerOptions,
  type GameRunnerResumeActorCoordinate,
  type MingleInboxReplay,
  type RuntimeSnapshotV1,
  type TokenCostCursor,
  type TranscriptEntry,
} from "@influence/engine";
import type { GameStatus } from "../db/schema.js";
import type { getPersistedGameEvents } from "./game-event-read-model.js";
import { sha256StableJson } from "./stable-hash.js";

export type SupportedRecoveryResumeInput = NonNullable<GameRunnerOptions["resumeFrom"]>;

export type SupportedRecoveryEvaluation =
  | { ok: true; resumeFrom: SupportedRecoveryResumeInput }
  | { ok: false; reason: string };

type PersistedEventsResult = Awaited<ReturnType<typeof getPersistedGameEvents>>;

export interface HistoricalCheckpointIntegrityInput {
  lastEventSequence: number;
  checkpointKind: string;
  snapshot: unknown;
  tokenCostCursor: unknown;
  ownerEpoch?: string;
  actorCoordinate?: string;
  phase?: string | null;
  round?: number | null;
  eventHeadHash?: string;
  projectionHash?: string;
  transcriptCursor?: unknown;
}

type AccumulatorRecoveryValidation =
  | { ok: true; currentAccusations: CurrentAccusationsAccumulatorV1 | null }
  | { ok: false; reason: string };

/**
 * Coordinates the runner can actually resume after format-kernel cutover.
 * Format phase-entry coordinates are supported when canonical prerequisites pass.
 * Classic Power→Council mid-round coordinates remain retired.
 */
const RESUME_SUPPORTED_ACTOR_COORDINATES = new Set<string>(
  PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES.filter((coordinate) =>
    coordinate !== "mingle_i" &&
    coordinate !== "pre_vote_huddle" &&
    coordinate !== "post_vote_mingle" &&
    coordinate !== "power" &&
    coordinate !== "reveal" &&
    coordinate !== "pre_council_huddle" &&
    coordinate !== "council"
  ),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSupportedActorCoordinate(value: string): value is GameRunnerResumeActorCoordinate {
  return RESUME_SUPPORTED_ACTOR_COORDINATES.has(value);
}

function isRuntimeSnapshotV1(value: unknown): value is RuntimeSnapshotV1 {
  return isRecord(value) &&
    value.version === 1 &&
    isRecord(value.actorWitness) &&
    value.actorWitness.version === 1 &&
    typeof value.actorWitness.actorCoordinate === "string";
}

function readTranscriptReplay(value: unknown): TranscriptEntry[] | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  // V1 = legacy safe-entry shape; V2 = normalized dialogue identity fields.
  if (value.version !== 1 && value.version !== 2) return null;
  return value.entries.map((entry) => ({ ...(entry as TranscriptEntry) }));
}

function readTokenCostCursor(value: unknown): TokenCostCursor | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.perSource)) return null;
  return value as unknown as TokenCostCursor;
}

function validateStoredCheckpointIdentity(params: {
  checkpoint: HistoricalCheckpointIntegrityInput;
  runtimeSnapshot: RuntimeSnapshotV1;
  persistedEvents: PersistedEventsResult;
}): string | null {
  const { checkpoint, runtimeSnapshot, persistedEvents } = params;
  const boundary = runtimeSnapshot.boundary;
  if (boundary.boundarySequence !== checkpoint.lastEventSequence) {
    return "checkpoint_boundary_sequence_mismatch";
  }
  if (boundary.checkpointKind !== checkpoint.checkpointKind) {
    return "checkpoint_boundary_kind_mismatch";
  }
  if (checkpoint.ownerEpoch !== undefined && boundary.ownerEpoch !== checkpoint.ownerEpoch) {
    return "checkpoint_owner_mismatch";
  }
  if (checkpoint.actorCoordinate !== undefined &&
      runtimeSnapshot.actorWitness.actorCoordinate !== checkpoint.actorCoordinate) {
    return "checkpoint_actor_coordinate_mismatch";
  }
  if (checkpoint.phase !== undefined && checkpoint.phase !== null && boundary.phase !== checkpoint.phase) {
    return "checkpoint_phase_mismatch";
  }
  if (checkpoint.round !== undefined && checkpoint.round !== null && boundary.round !== checkpoint.round) {
    return "checkpoint_round_mismatch";
  }

  const boundaryEvent = persistedEvents.events.find(
    (event) => event.sequence === checkpoint.lastEventSequence,
  );
  if (!boundaryEvent) return "checkpoint_event_boundary_missing";
  if (checkpoint.eventHeadHash !== undefined &&
      checkpoint.eventHeadHash !== boundaryEvent.eventHash) {
    return "checkpoint_event_hash_mismatch";
  }
  if (boundary.eventHeadHash !== boundaryEvent.eventHash) {
    return "runtime_snapshot_event_hash_mismatch";
  }

  const canonicalPrefix = persistedEvents.events
    .filter((event) => event.sequence <= checkpoint.lastEventSequence)
    .map((event) => event.envelope);
  const projection = GameState.fromCanonicalEvents(canonicalPrefix).getDomainProjection();
  if (projection.gameId !== persistedEvents.gameId ||
      projection.lastSequence !== checkpoint.lastEventSequence) {
    return "checkpoint_projection_identity_mismatch";
  }
  const projectionHash = sha256StableJson(projection);
  if (checkpoint.projectionHash !== undefined && checkpoint.projectionHash !== projectionHash) {
    return "checkpoint_projection_hash_mismatch";
  }
  if (boundary.projectionHash !== projectionHash) {
    return "runtime_snapshot_projection_hash_mismatch";
  }

  if (!sameBoundaryIdentity(runtimeSnapshot.actorWitness.boundary, boundary) ||
      !sameBoundaryIdentity(runtimeSnapshot.accumulatorRegistry.boundary, boundary) ||
      !sameBoundaryIdentity(runtimeSnapshot.transcriptWatermark.boundary, boundary)) {
    return "runtime_snapshot_boundary_identity_mismatch";
  }
  return null;
}

function validateTranscriptCursor(
  cursor: unknown,
  runtimeSnapshot: RuntimeSnapshotV1,
): string | null {
  if (cursor === undefined) return null;
  if (!isRecord(cursor) || cursor.entries !== runtimeSnapshot.transcriptWatermark.entryCount) {
    return "transcript_replay_cursor_mismatch";
  }
  if (cursor.version !== undefined && cursor.version !== 1) {
    return "transcript_replay_cursor_mismatch";
  }
  if (cursor.durableBoundary !== undefined && cursor.durableBoundary !== true) {
    return "transcript_replay_cursor_mismatch";
  }
  if (cursor.boundaryDigest !== undefined &&
      cursor.boundaryDigest !== runtimeSnapshot.transcriptWatermark.boundaryDigest) {
    return "transcript_replay_cursor_mismatch";
  }
  if (cursor.lastCanonicalSequence !== undefined &&
      cursor.lastCanonicalSequence !== runtimeSnapshot.transcriptWatermark.lastCanonicalSequence) {
    return "transcript_replay_cursor_mismatch";
  }
  return null;
}

function hasBlockedMingleInbox(runtimeSnapshot: RuntimeSnapshotV1): boolean {
  return runtimeSnapshot.accumulatorRegistry.entries.some((entry) =>
    entry.id === "mingleInbox" && entry.status === "blocked"
  );
}

function sameBoundaryIdentity(
  left: RuntimeSnapshotV1["boundary"],
  right: RuntimeSnapshotV1["boundary"],
): boolean {
  return left.version === right.version &&
    left.ownerEpoch === right.ownerEpoch &&
    left.boundarySequence === right.boundarySequence &&
    left.eventHeadHash === right.eventHeadHash &&
    left.projectionHash === right.projectionHash &&
    left.checkpointKind === right.checkpointKind &&
    left.phase === right.phase &&
    left.round === right.round;
}

function validateCurrentAccusationsPayload(
  payload: unknown,
  runtimeSnapshot: RuntimeSnapshotV1,
  gameState: GameState,
): CurrentAccusationsAccumulatorV1 | null {
  if (!isRecord(payload) || payload.version !== 1 || !isRecord(payload.boundary) || !Array.isArray(payload.items)) {
    return null;
  }
  const candidate = payload as unknown as CurrentAccusationsAccumulatorV1;
  if (!sameBoundaryIdentity(candidate.boundary, runtimeSnapshot.boundary)) return null;

  const activePlayerIds = new Set(gameState.getAlivePlayers().map((player) => player.id));
  const seenTargets = new Set<string>();
  for (const item of candidate.items) {
    if (!item ||
        typeof item.targetId !== "string" ||
        typeof item.targetName !== "string" ||
        typeof item.accuserId !== "string" ||
        typeof item.accuserName !== "string" ||
        typeof item.accusation !== "string") {
      return null;
    }
    if (!activePlayerIds.has(item.targetId) || !activePlayerIds.has(item.accuserId)) return null;
    if (item.targetName !== gameState.getPlayerName(item.targetId)) return null;
    if (item.accuserName !== gameState.getPlayerName(item.accuserId)) return null;
    if (item.accusation.trim().length === 0) return null;
    if (seenTargets.has(item.targetId)) return null;
    seenTargets.add(item.targetId);
  }
  return candidate.items.length > 0 ? candidate : null;
}

function validateAccumulatorRegistryForRecovery(params: {
  runtimeSnapshot: RuntimeSnapshotV1;
  gameState: GameState;
  mingleInboxReplay: MingleInboxReplay;
}): AccumulatorRecoveryValidation {
  const { runtimeSnapshot, gameState, mingleInboxReplay } = params;
  const registry = runtimeSnapshot.accumulatorRegistry;
  if (!registry || registry.version !== 1 || !Array.isArray(registry.entries)) {
    return { ok: false, reason: "unsafe_accumulator_registry" };
  }

  let currentAccusations: CurrentAccusationsAccumulatorV1 | null = null;
  const actorCoordinate = runtimeSnapshot.actorWitness.actorCoordinate;
  const mingleSession = mingleInboxSessionForResumeTarget(actorCoordinate);
  for (const entry of registry.entries) {
    if (entry.status === "empty" || entry.status === "drained") continue;
    if (entry.id === "mingleInbox" && entry.status === "blocked") continue;
    if (entry.id === "currentAccusations" && entry.status === "captured") {
      if (actorCoordinate !== "tribunal_defense") {
        return { ok: false, reason: "unsafe_accumulator_registry" };
      }
      currentAccusations = validateCurrentAccusationsPayload(entry.payload, runtimeSnapshot, gameState);
      if (!currentAccusations) return { ok: false, reason: "unsafe_accumulator_registry" };
      continue;
    }
    return { ok: false, reason: "unsafe_accumulator_registry" };
  }

  if (hasBlockedMingleInbox(runtimeSnapshot)) {
    // format_mingle clears the inbox on entry; a blocked pre-handler registry is
    // safe to discard rather than requiring an irrelevant Mingle I rebuild.
    if (mingleSession === "none") {
      // intentionally empty
    } else {
      if (mingleInboxReplay.unresolvedRecipientNames.length > 0) {
        return { ok: false, reason: "mingle_inbox_unresolved_recipients" };
      }
      if (mingleInboxReplay.entries.length === 0) {
        return { ok: false, reason: "mingle_inbox_rebuild_empty" };
      }
    }
  }

  if (actorCoordinate === "tribunal_defense" && !currentAccusations) {
    return { ok: false, reason: "unsafe_accumulator_registry" };
  }

  return { ok: true, currentAccusations };
}

function latestEvent<TType extends CanonicalGameEvent["type"]>(
  canonicalEvents: readonly CanonicalGameEvent[],
  type: TType,
): Extract<CanonicalGameEvent, { type: TType }> | null {
  for (let i = canonicalEvents.length - 1; i >= 0; i -= 1) {
    const event = canonicalEvents[i];
    if (event?.type === type) return event as Extract<CanonicalGameEvent, { type: TType }>;
  }
  return null;
}

function hasResolvedEmpowered(canonicalEvents: readonly CanonicalGameEvent[]): boolean {
  if (latestEvent(canonicalEvents, "vote.empowered_set")) return true;
  const tally = latestEvent(canonicalEvents, "vote.empower_tally_resolved");
  return tally?.payload.tied === null;
}

function requireAliveCount(
  actorCoordinate: GameRunnerResumeActorCoordinate,
  gameState: GameState,
  expected: number,
): string | null {
  const actual = gameState.getAlivePlayers().length;
  return actual === expected ? null : `${actorCoordinate}_requires_${expected}_alive`;
}

function requireEndgameStage(
  actorCoordinate: GameRunnerResumeActorCoordinate,
  gameState: GameState,
  expected: "reckoning" | "tribunal" | "judgment" | null,
): string | null {
  return gameState.endgameStage === expected
    ? null
    : `${actorCoordinate}_requires_${expected ?? "pre_endgame"}_state`;
}

function requireJury(
  actorCoordinate: GameRunnerResumeActorCoordinate,
  gameState: GameState,
): string | null {
  return gameState.jury.length > 0 ? null : `${actorCoordinate}_missing_jury`;
}

function validateActorCoordinatePrerequisites(
  actorCoordinate: GameRunnerResumeActorCoordinate,
  canonicalEvents: readonly CanonicalGameEvent[],
  gameState: GameState,
): string | null {
  const hasRoundStarted = canonicalEvents.some((event) => event.type === "round.started");
  if (actorCoordinate === "lobby") {
    return hasRoundStarted ? "unsupported_lobby_after_round_started" : null;
  }
  if (!hasRoundStarted) return `${actorCoordinate}_missing_round_started`;
  if (actorCoordinate === "vote") return null;

  // Endgame checkpoints are valid after either legacy Council elimination or a
  // format-kernel elimination. Validate their endgame state directly before
  // applying prerequisites that only exist on the retired Power/Council path.
  if (actorCoordinate === "reckoning_lobby") {
    if (!canonicalEvents.some((event) => event.type === "player.eliminated")) {
      return "reckoning_lobby_missing_elimination";
    }
    const aliveCountError = requireAliveCount(actorCoordinate, gameState, 4);
    if (aliveCountError) return "reckoning_lobby_requires_four_alive";
    return requireEndgameStage(actorCoordinate, gameState, null);
  }
  if (actorCoordinate === "reckoning_plea" || actorCoordinate === "reckoning_vote") {
    return requireAliveCount(actorCoordinate, gameState, 4) ??
      requireEndgameStage(actorCoordinate, gameState, "reckoning");
  }
  if (actorCoordinate === "tribunal_lobby") {
    return requireAliveCount(actorCoordinate, gameState, 3) ??
      requireEndgameStage(actorCoordinate, gameState, "reckoning");
  }
  if (actorCoordinate === "tribunal_accusation" || actorCoordinate === "tribunal_defense" || actorCoordinate === "tribunal_vote") {
    return requireAliveCount(actorCoordinate, gameState, 3) ??
      requireEndgameStage(actorCoordinate, gameState, "tribunal");
  }
  if (actorCoordinate === "judgment_opening") {
    return requireAliveCount(actorCoordinate, gameState, 2) ??
      requireEndgameStage(actorCoordinate, gameState, "tribunal") ??
      requireJury(actorCoordinate, gameState);
  }
  if (
    actorCoordinate === "judgment_jury_questions" ||
    actorCoordinate === "judgment_closing" ||
    actorCoordinate === "judgment_jury_vote"
  ) {
    return requireAliveCount(actorCoordinate, gameState, 2) ??
      requireEndgameStage(actorCoordinate, gameState, "judgment") ??
      requireJury(actorCoordinate, gameState);
  }

  // Format phase-entry coordinates: empowered + current-round menu/selection coherence.
  if (isFormatResumeCoordinate(actorCoordinate)) {
    return validateFormatResumePrerequisites(actorCoordinate, canonicalEvents);
  }

  // Classic Power→Council spine is retired. Old checkpoints at these coordinates
  // remain inspectable but fail closed for startup resume (runner also rejects).
  if (
    actorCoordinate === "post_vote_mingle" ||
    actorCoordinate === "power" ||
    actorCoordinate === "reveal" ||
    actorCoordinate === "pre_council_huddle" ||
    actorCoordinate === "council"
  ) {
    return `unsupported_actor_coordinate:${actorCoordinate}`;
  }

  if (!hasResolvedEmpowered(canonicalEvents)) return `${actorCoordinate}_missing_empowered`;
  return null;
}

function evaluateCheckpointIntegrity(params: {
  checkpoint: HistoricalCheckpointIntegrityInput;
  persistedEvents: PersistedEventsResult;
  requireCurrentHead: boolean;
}): SupportedRecoveryEvaluation {
  if (params.checkpoint.checkpointKind !== "phase_boundary") {
    return { ok: false, reason: `unsupported_checkpoint_kind:${params.checkpoint.checkpointKind}` };
  }

  const snapshot = params.checkpoint.snapshot;
  const runtimeSnapshot = isRecord(snapshot) ? snapshot.runtimeSnapshot : null;
  if (!isRuntimeSnapshotV1(runtimeSnapshot)) return { ok: false, reason: "missing_runtime_snapshot" };

  const actorCoordinate = runtimeSnapshot.actorWitness.actorCoordinate;
  if (!isSupportedActorCoordinate(actorCoordinate)) {
    return { ok: false, reason: `unsupported_actor_coordinate:${actorCoordinate}` };
  }
  const transcriptReplay = readTranscriptReplay(isRecord(snapshot) ? snapshot.transcriptReplay : null);
  if (!transcriptReplay) return { ok: false, reason: "missing_transcript_replay" };
  if (transcriptReplay.length !== runtimeSnapshot.transcriptWatermark.entryCount) {
    return { ok: false, reason: "transcript_replay_cursor_mismatch" };
  }
  const transcriptCursorReason = validateTranscriptCursor(
    params.checkpoint.transcriptCursor,
    runtimeSnapshot,
  );
  if (transcriptCursorReason) return { ok: false, reason: transcriptCursorReason };

  if (params.persistedEvents.status !== "complete") {
    return { ok: false, reason: `invalid_event_log:${params.persistedEvents.status}` };
  }
  if (params.requireCurrentHead &&
      params.persistedEvents.lastTrustedSequence !== params.checkpoint.lastEventSequence) {
    return { ok: false, reason: "checkpoint_not_at_event_head" };
  }
  if (params.checkpoint.lastEventSequence > params.persistedEvents.lastTrustedSequence) {
    return { ok: false, reason: "checkpoint_event_boundary_missing" };
  }

  const checkpointIdentityReason = validateStoredCheckpointIdentity({
    checkpoint: params.checkpoint,
    runtimeSnapshot,
    persistedEvents: params.persistedEvents,
  });
  if (checkpointIdentityReason) return { ok: false, reason: checkpointIdentityReason };

  const canonicalEvents = params.persistedEvents.events
    .filter((event) => event.sequence <= params.checkpoint.lastEventSequence)
    .map((event) => event.envelope);
  const gameState = GameState.fromCanonicalEvents(canonicalEvents);
  const mingleSession = mingleInboxSessionForResumeTarget(actorCoordinate);
  const mingleInboxReplay = buildMingleInboxReplayFromTranscript({
    transcriptReplay,
    players: gameState.getAllPlayers().map((player) => ({ id: player.id, name: player.name })),
    session: mingleSession,
  });
  const accumulatorResult = validateAccumulatorRegistryForRecovery({
    runtimeSnapshot,
    gameState,
    mingleInboxReplay,
  });
  if (!accumulatorResult.ok) return { ok: false, reason: accumulatorResult.reason };

  const prerequisiteReason = validateActorCoordinatePrerequisites(actorCoordinate, canonicalEvents, gameState);
  if (prerequisiteReason) return { ok: false, reason: prerequisiteReason };

  const tokenCostCursor = readTokenCostCursor(params.checkpoint.tokenCostCursor);
  if (!tokenCostCursor) return { ok: false, reason: "missing_token_cost_cursor" };
  if (isRecord(tokenCostCursor.boundary) &&
      !sameBoundaryIdentity(
        tokenCostCursor.boundary as unknown as RuntimeSnapshotV1["boundary"],
        runtimeSnapshot.boundary,
      )) {
    return { ok: false, reason: "token_cost_cursor_boundary_mismatch" };
  }

  const alivePlayers = gameState.getAlivePlayers().map((player) => ({
    id: player.id,
    name: player.name,
  }));
  const playerContinuityResult = validatePlayerContinuitySetForRecovery({
    capsules: isRecord(snapshot) ? snapshot.playerContinuityCapsules : undefined,
    expectedPlayers: alivePlayers,
  });
  if (!playerContinuityResult.ok) {
    return { ok: false, reason: playerContinuityResult.reason };
  }

  const houseContinuityResult = admitHouseContinuityForRecovery({
    requirement: isRecord(snapshot) ? snapshot.houseContinuityRequirement : undefined,
    capsule: isRecord(snapshot) ? snapshot.houseContinuityCapsule : null,
  });
  if (!houseContinuityResult.ok) {
    return { ok: false, reason: houseContinuityResult.reason };
  }

  const shouldReplayMingleInbox =
    hasBlockedMingleInbox(runtimeSnapshot) &&
    mingleSession !== "none" &&
    mingleInboxReplay.entries.length > 0;

  return {
    ok: true,
    resumeFrom: {
      kind: "phase_boundary",
      actorCoordinate,
      canonicalEvents,
      lastEventSequence: params.checkpoint.lastEventSequence,
      transcriptReplay,
      tokenCostCursor,
      mingleInboxReplay: shouldReplayMingleInbox ? mingleInboxReplay : null,
      currentAccusations: accumulatorResult.currentAccusations,
      houseContinuityCapsule: houseContinuityResult.capsule,
      houseContinuityRequirement: houseContinuityResult.requirement,
      playerContinuityCapsules: playerContinuityResult.capsules,
    },
  };
}

/**
 * Validates an exact historical checkpoint against a complete canonical event
 * chain without applying live recovery's game-status/current-head admission.
 * This is intentionally read-only and does not imply that the game can resume.
 */
export function evaluateHistoricalCheckpointIntegrity(params: {
  checkpoint: HistoricalCheckpointIntegrityInput;
  persistedEvents: PersistedEventsResult;
}): SupportedRecoveryEvaluation {
  return evaluateCheckpointIntegrity({
    ...params,
    requireCurrentHead: false,
  });
}

export function evaluateSupportedRecovery(params: {
  gameStatus: GameStatus;
  checkpoint: HistoricalCheckpointIntegrityInput;
  persistedEvents: PersistedEventsResult;
}): SupportedRecoveryEvaluation {
  if (params.gameStatus !== "suspended") {
    return { ok: false, reason: `unsupported_game_status:${params.gameStatus}` };
  }
  return evaluateCheckpointIntegrity({
    checkpoint: params.checkpoint,
    persistedEvents: params.persistedEvents,
    requireCurrentHead: true,
  });
}

export function checkpointHasImplementedResumeSupport(params: {
  gameStatus: GameStatus;
  checkpoint: {
    lastEventSequence: number;
    checkpointKind: string;
    snapshot: unknown;
    tokenCostCursor: unknown;
  };
  persistedEvents: PersistedEventsResult;
}): boolean {
  return evaluateSupportedRecovery(params).ok;
}
