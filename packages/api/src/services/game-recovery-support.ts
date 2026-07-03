import {
  buildMingleInboxReplayFromTranscript,
  GameState,
  PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES,
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

export type SupportedRecoveryResumeInput = NonNullable<GameRunnerOptions["resumeFrom"]>;

export type SupportedRecoveryEvaluation =
  | { ok: true; resumeFrom: SupportedRecoveryResumeInput }
  | { ok: false; reason: string };

type PersistedEventsResult = Awaited<ReturnType<typeof getPersistedGameEvents>>;

type AccumulatorRecoveryValidation =
  | { ok: true; currentAccusations: CurrentAccusationsAccumulatorV1 | null }
  | { ok: false; reason: string };

const SUPPORTED_ACTOR_COORDINATES = new Set<string>(PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSupportedActorCoordinate(value: string): value is GameRunnerResumeActorCoordinate {
  return SUPPORTED_ACTOR_COORDINATES.has(value);
}

function isRuntimeSnapshotV1(value: unknown): value is RuntimeSnapshotV1 {
  return isRecord(value) &&
    value.version === 1 &&
    isRecord(value.actorWitness) &&
    value.actorWitness.version === 1 &&
    typeof value.actorWitness.actorCoordinate === "string";
}

function readTranscriptReplay(value: unknown): TranscriptEntry[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return null;
  return value.entries.map((entry) => ({ ...(entry as TranscriptEntry) }));
}

function readTokenCostCursor(value: unknown): TokenCostCursor | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.perSource)) return null;
  return value as unknown as TokenCostCursor;
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

  if (hasBlockedMingleInbox(runtimeSnapshot) &&
      (mingleInboxReplay.entries.length === 0 || mingleInboxReplay.unresolvedRecipientNames.length > 0)) {
    return { ok: false, reason: "unsafe_accumulator_registry" };
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
  if (actorCoordinate === "mingle_i" || actorCoordinate === "pre_vote_huddle") return null;
  if (actorCoordinate === "vote") return null;

  if (!hasResolvedEmpowered(canonicalEvents)) return `${actorCoordinate}_missing_empowered`;
  if (actorCoordinate === "post_vote_mingle") return null;

  if (!canonicalEvents.some((event) => event.type === "mingle.rooms_allocated")) {
    return `${actorCoordinate}_missing_mingle_allocation`;
  }
  if (actorCoordinate === "power") return null;

  const candidateResolution = latestEvent(canonicalEvents, "power.candidates_resolved");
  if (!candidateResolution) return `${actorCoordinate}_missing_candidate_resolution`;
  if (actorCoordinate === "reveal") {
    return candidateResolution.payload.autoEliminated ? `${actorCoordinate}_auto_eliminate_unsupported` : null;
  }
  if (actorCoordinate === "pre_council_huddle" || actorCoordinate === "council") {
    return candidateResolution.payload.autoEliminated ? `${actorCoordinate}_auto_eliminate_unsupported` : null;
  }
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
  return null;
}

export function evaluateSupportedRecovery(params: {
  gameStatus: GameStatus;
  checkpoint: {
    lastEventSequence: number;
    checkpointKind: string;
    snapshot: unknown;
    tokenCostCursor: unknown;
  };
  persistedEvents: PersistedEventsResult;
}): SupportedRecoveryEvaluation {
  if (params.gameStatus !== "suspended") return { ok: false, reason: `unsupported_game_status:${params.gameStatus}` };
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

  if (params.persistedEvents.status !== "complete") {
    return { ok: false, reason: `invalid_event_log:${params.persistedEvents.status}` };
  }
  if (params.persistedEvents.lastTrustedSequence !== params.checkpoint.lastEventSequence) {
    return { ok: false, reason: "checkpoint_not_at_event_head" };
  }

  const canonicalEvents = params.persistedEvents.events.map((event) => event.envelope);
  const gameState = GameState.fromCanonicalEvents(canonicalEvents);
  const mingleInboxReplay = buildMingleInboxReplayFromTranscript({
    transcriptReplay,
    players: gameState.getAllPlayers().map((player) => ({ id: player.id, name: player.name })),
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

  return {
    ok: true,
    resumeFrom: {
      kind: "phase_boundary",
      actorCoordinate,
      canonicalEvents,
      lastEventSequence: params.checkpoint.lastEventSequence,
      transcriptReplay,
      tokenCostCursor,
      mingleInboxReplay: hasBlockedMingleInbox(runtimeSnapshot) ? mingleInboxReplay : null,
      currentAccusations: accumulatorResult.currentAccusations,
      houseContinuityCapsule: isRecord(snapshot) && isRecord(snapshot.houseContinuityCapsule)
        ? snapshot.houseContinuityCapsule as unknown as SupportedRecoveryResumeInput["houseContinuityCapsule"]
        : null,
    },
  };
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
