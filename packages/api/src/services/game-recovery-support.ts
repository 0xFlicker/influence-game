import {
  buildMingleInboxReplayFromTranscript,
  GameState,
  PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES,
  type CanonicalGameEvent,
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

function validateNonReplayableAccumulatorRegistry(runtimeSnapshot: RuntimeSnapshotV1): string | null {
  const registry = runtimeSnapshot.accumulatorRegistry;
  if (!registry || registry.version !== 1 || !Array.isArray(registry.entries)) return "unsafe_accumulator_registry";

  for (const entry of registry.entries) {
    if (entry.status === "empty" || entry.status === "drained") continue;
    if (entry.id === "mingleInbox" && entry.status === "blocked") continue;
    return "unsafe_accumulator_registry";
  }

  return null;
}

function validateMingleInboxReplay(
  runtimeSnapshot: RuntimeSnapshotV1,
  mingleInboxReplay: MingleInboxReplay,
): string | null {
  if (!hasBlockedMingleInbox(runtimeSnapshot)) return null;
  return mingleInboxReplay.entries.length > 0 && mingleInboxReplay.unresolvedRecipientNames.length === 0
    ? null
    : "unsafe_accumulator_registry";
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

function validateActorCoordinatePrerequisites(
  actorCoordinate: GameRunnerResumeActorCoordinate,
  canonicalEvents: readonly CanonicalGameEvent[],
): string | null {
  const hasRoundStarted = canonicalEvents.some((event) => event.type === "round.started");
  if (actorCoordinate === "lobby") {
    return hasRoundStarted ? "unsupported_lobby_after_round_started" : null;
  }
  if (!hasRoundStarted) return `${actorCoordinate}_missing_round_started`;
  if (actorCoordinate === "vote") return null;

  if (!hasResolvedEmpowered(canonicalEvents)) return `${actorCoordinate}_missing_empowered`;
  if (actorCoordinate === "mingle") return null;

  if (!canonicalEvents.some((event) => event.type === "mingle.rooms_allocated")) {
    return `${actorCoordinate}_missing_mingle_allocation`;
  }
  if (actorCoordinate === "power") return null;

  const candidateResolution = latestEvent(canonicalEvents, "power.candidates_resolved");
  if (!candidateResolution) return `${actorCoordinate}_missing_candidate_resolution`;
  if (candidateResolution.payload.autoEliminated) return `${actorCoordinate}_auto_eliminate_unsupported`;
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
  const nonReplayableAccumulatorReason = validateNonReplayableAccumulatorRegistry(runtimeSnapshot);
  if (nonReplayableAccumulatorReason) return { ok: false, reason: nonReplayableAccumulatorReason };

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
  const accumulatorReason = validateMingleInboxReplay(runtimeSnapshot, mingleInboxReplay);
  if (accumulatorReason) return { ok: false, reason: accumulatorReason };

  const prerequisiteReason = validateActorCoordinatePrerequisites(actorCoordinate, canonicalEvents);
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
