import {
  isCanonicalGameEventType,
  type CanonicalEventSource,
  type CanonicalEventVisibility,
  type CanonicalGameEvent,
  type CanonicalGameEventType,
  type CanonicalSourcePointer,
} from "./canonical-events";
import {
  parseHouseNarrativeContinuity,
  type HouseNarrativeContinuityV2,
} from "./house-summary-frontier";
import { parsePlayerContinuityCapsule } from "./player-continuity";
import type {
  PlayerContinuityCapsule,
  TranscriptEntry,
} from "./game-runner.types";
import type { LaunchFormatId } from "./formats";
import { Phase, type AllianceHuddleFactAtom } from "./types";
import type { ProviderSemanticCoordinateV1 } from "./provider-execution";

export const DURABLE_GAME_TURN_CONTRACT_VERSION = 1 as const;

export type DurableJsonPrimitive = string | number | boolean | null;
export type DurableJsonValue =
  | DurableJsonPrimitive
  | DurableJsonValue[]
  | { [key: string]: DurableJsonValue };
export type DurableJsonObject = { [key: string]: DurableJsonValue };

export interface GameTurnHeadsV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  turnSequence: number;
  eventSequence: number;
  eventHash: string | null;
  dialogueSequence: number;
  publicationSequence: number;
}

export const RUNTIME_ACTOR_COORDINATES = [
  "introduction", "lobby", "mingle_i", "pre_vote_huddle", "vote",
  "format_menu", "format_pick", "format_mingle", "format_resolve",
  "post_vote_mingle", "power", "reveal", "pre_council_huddle", "council",
  "reckoning_lobby", "reckoning_plea", "reckoning_vote", "tribunal_lobby",
  "tribunal_accusation", "tribunal_defense", "tribunal_vote", "judgment_opening",
  "judgment_jury_questions", "judgment_closing", "judgment_jury_vote",
] as const;

export type RuntimeActorCoordinate = (typeof RUNTIME_ACTOR_COORDINATES)[number];

export const PARALLEL_BATCH_KINDS = [
  "introduction", "empower_vote", "empower_revote", "power_lobby",
  "council_normal_vote", "reckoning_plea", "reckoning_vote",
  "tribunal_accusation", "tribunal_defense", "judgment_opening",
  "judgment_closing", "judgment_jury_vote", "format_ballot",
  "diary_question", "diary_answer", "diary_followup_plan",
] as const;

export type ParallelBatchKind = (typeof PARALLEL_BATCH_KINDS)[number];

export const SERIAL_ACTOR_LANES = [
  "lobby_speech", "mingle_speech", "alliance_action", "huddle_speech",
  "safety_bounce_pointer", "jury_question", "jury_answer",
  "council_empowered_tiebreak",
] as const;

export type SerialActorLane = (typeof SERIAL_ACTOR_LANES)[number];

export const RULES_OPERATIONS_V1 = [
  "bootstrap_roster", "round_start", "phase_close", "empower_tally", "empower_resolve",
  "format_menu", "mingle_beat_open", "mingle_beat_movement", "mingle_complete",
  "alliance_window_close", "huddle_schedule_commit", "huddle_session_complete",
  "format_tally", "format_tiebreak", "format_resolution", "power_resolution",
  "council_resolution", "elimination_apply", "elimination_message", "round_result",
  "jury_tally",
] as const;

export type RulesOperationV1 = (typeof RULES_OPERATIONS_V1)[number];

export const HOUSE_OPERATIONS_V1 = [
  "mingle_assignment", "alliance_proposer_plan", "huddle_plan",
  "huddle_interpretation", "diary_question", "diary_followup_or_close",
  "phase_beat", "long_form",
] as const;

export type HouseOperationV1 = (typeof HOUSE_OPERATIONS_V1)[number];

export interface MingleRoomProgressV1 {
  version: 1;
  roomId: number;
  playerIds: string[];
}

export interface MingleBeatAllocationV1 {
  version: 1;
  beat: number;
  rooms: MingleRoomProgressV1[];
  excludedPlayerIds: string[];
}

export interface MingleMovementRequestV1 {
  version: 1;
  playerId: string;
  gotoPlayerId: string | null;
  preferredRoomSize: 2 | 3 | null;
}

export interface MingleProgressV1 {
  version: 1;
  phase: Phase.MINGLE_I | Phase.FORMAT_MINGLE | Phase.POST_VOTE_MINGLE;
  totalBeats: number;
  currentBeat: number;
  roomIndex: number;
  speakerIndex: number;
  currentAllocation: MingleBeatAllocationV1 | null;
  roomByPlayerId: Record<string, number>;
  priorBeatAllocations: MingleBeatAllocationV1[];
  movementRequests: MingleMovementRequestV1[];
}

export interface AllianceProgressV1 {
  version: 1;
  proposerIds: string[];
  proposerIndex: number;
  actionOrdinal: number;
  activeLineageId: string | null;
  activeVersionId: string | null;
  askedMemberIdsByVersion: Record<string, string[]>;
}

export interface HuddleProgressV1 {
  version: 1;
  scheduleIds: string[];
  scheduleIndex: number;
  sessionId: string | null;
  speakerIds: string[];
  speakerIndex: number;
  factAtoms: AllianceHuddleFactAtom[];
}

export type FormatProgressStageV1 =
  | "select"
  | "ballots"
  | "safety_bounce_start"
  | "safety_bounce_pointer"
  | "tiebreak"
  | "resolve";

export interface SafetyBounceProgressV1 {
  version: 1;
  starterId: string;
  pointerIndex: number;
  safePlayerIds: string[];
  vulnerablePlayerIds: string[];
}

export interface FormatProgressV1 {
  version: 1;
  selectedFormatId: LaunchFormatId | null;
  stage: FormatProgressStageV1;
  safetyBounce: SafetyBounceProgressV1 | null;
  tiedPlayerIds: string[];
}

export type TwoNamesProgressStageV1 =
  | "setup"
  | "initial_mingle"
  | "override"
  | "final_mingle"
  | "plea"
  | "ballots"
  | "tiebreak"
  | "resolve";

export interface TwoNamesProgressV1 {
  version: 1;
  stage: TwoNamesProgressStageV1;
  pleaIndex: 0 | 1 | 2;
}

export type DiaryInterviewRoleV1 = "player" | "juror" | "finalist";
export type DiaryInterviewStatusV1 =
  | "question"
  | "answer"
  | "followup_plan"
  | "followup_answer"
  | "closed";

export interface DiaryExchangeV1 {
  version: 1;
  question: string;
  answer: string | null;
}

export interface DiaryInterviewProgressV1 {
  version: 1;
  participantId: string;
  role: DiaryInterviewRoleV1;
  status: DiaryInterviewStatusV1;
  questionIndex: number;
  exchanges: DiaryExchangeV1[];
}

export interface DiaryProgressV1 {
  version: 1;
  precedingPhase: Phase;
  interviews: DiaryInterviewProgressV1[];
}

/** Closed program counter; handler-local state cannot hide in an arbitrary bag. */
export type GameExecutionCursorV1 =
  | { version: 1; kind: "phase_enter"; actor: RuntimeActorCoordinate }
  | { version: 1; kind: "parallel_batch"; batch: ParallelBatchKind }
  | {
      version: 1;
      kind: "serial_actor";
      lane: SerialActorLane;
      actorIds: string[];
      actorIndex: number;
      pass?: number;
    }
  | { version: 1; kind: "mingle"; progress: MingleProgressV1 }
  | { version: 1; kind: "alliance"; progress: AllianceProgressV1 }
  | { version: 1; kind: "huddle"; progress: HuddleProgressV1 }
  | { version: 1; kind: "format"; progress: FormatProgressV1 }
  | { version: 1; kind: "two_names"; progress: TwoNamesProgressV1 }
  | { version: 1; kind: "diary"; progress: DiaryProgressV1 }
  | { version: 1; kind: "rules"; operation: RulesOperationV1 }
  | { version: 1; kind: "house"; operation: HouseOperationV1 }
  | { version: 1; kind: "terminal"; stage: "commit_game" };

export interface GameExecutionRetryV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  attempt: number;
  retryReadyAt: string;
  safeCode: string;
}

export type GameExecutionStatusV1 =
  | "ready"
  | "waiting_retry"
  | "terminal"
  | "repair_required";

/**
 * Complete durable orchestration authority for one committed game head.
 * Canonical game facts remain in the event log; this state is only the typed
 * program counter and private continuity needed to choose the next turn.
 */
export interface GameExecutionStateV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  gameId: string;
  ownerEpoch: string;
  status: GameExecutionStatusV1;
  heads: GameTurnHeadsV1;
  lastPresentationPhase: Phase | null;
  nextPublicationAvailableAt: string | null;
  xstateSnapshot: DurableJsonObject;
  cursor: GameExecutionCursorV1;
  playerContinuityCapsules: PlayerContinuityCapsule[];
  houseNarrativeContinuity: HouseNarrativeContinuityV2 | null;
  retry: GameExecutionRetryV1 | null;
}

export type GameTurnBranchKindV1 =
  | "engine"
  | "single_provider"
  | "parallel_provider_batch"
  | "house";

export interface GameTurnBranchV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  kind: GameTurnBranchKindV1;
  action: string;
}

export interface GameTurnProviderSubcallV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  slot: number;
  logicalCallId: string;
  /**
   * Present on all newly planned turns. Planned turns written before R33 omit
   * this field; their coordinate is derived from the immutable turn id + slot
   * by durableProviderSemanticCoordinateForSubcall during recovery.
   */
  semanticCoordinate?: Extract<ProviderSemanticCoordinateV1, { kind: "durable_turn" }>;
  actorId: string | null;
  action: string;
  contractId: string;
}

/** Exact, immutable description of the work admitted for one logical turn. */
export interface GameTurnIntentV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  gameId: string;
  turnId: string;
  turnSequence: number;
  seed: string;
  baseHeads: GameTurnHeadsV1;
  branch: GameTurnBranchV1;
  actorIds: string[];
  targetIds: string[];
  handles: string[];
  participantIds: string[];
  providerSubcalls: GameTurnProviderSubcallV1[];
}

/** Canonical fact without commit-owned game id, sequence, hash, or timestamp. */
export interface GameTurnCanonicalEventDraftV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  round: number;
  phase: Phase | null;
  type: CanonicalGameEventType;
  source: CanonicalEventSource;
  visibility: CanonicalEventVisibility;
  payloadVersion: 1 | 2;
  sourcePointers: CanonicalSourcePointer[];
  payload: DurableJsonObject;
}

/** Transcript entry without commit-owned sequence or timestamp. */
export type GameTurnTranscriptDraftV1 = Omit<
  TranscriptEntry,
  "entrySequence" | "timestamp"
> & {
  entrySequence?: never;
  timestamp?: never;
};

export type GamePublicationDraftV1 =
  | {
      version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
      kind: "canonical_event";
      eventIndex: number;
      availableAt: string | null;
    }
  | {
      version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
      kind: "transcript_entry";
      transcriptIndex: number;
      availableAt: string | null;
    }
  | {
      version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
      kind: "completion";
      eventIndex: number | null;
      availableAt: string | null;
    };

export interface GameTurnNextExecutionV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  status: GameExecutionStatusV1;
  lastPresentationPhase: Phase | null;
  nextPublicationAvailableAt: string | null;
  xstateSnapshot: DurableJsonObject;
  cursor: GameExecutionCursorV1;
  playerContinuityCapsules: PlayerContinuityCapsule[];
  houseNarrativeContinuity: HouseNarrativeContinuityV2 | null;
  retry: GameExecutionRetryV1 | null;
}

/** Complete staged effect set. Nothing here is visible before atomic commit. */
export interface GameTurnCommitDraftV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  gameId: string;
  turnId: string;
  turnSequence: number;
  intentHash: string;
  expectedBaseHeads: GameTurnHeadsV1;
  nextExecution: GameTurnNextExecutionV1;
  canonicalEvents: GameTurnCanonicalEventDraftV1[];
  transcriptEntries: GameTurnTranscriptDraftV1[];
  publications: GamePublicationDraftV1[];
  acceptedProviderCallIds: string[];
}

export type GamePublicationPayloadV1 =
  | {
      version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
      kind: "canonical_event";
      eventSequence: number;
    }
  | {
      version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
      kind: "transcript_entry";
      turnId: string;
      transcriptOrdinal: number;
    }
  | {
      version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
      kind: "completion";
      eventSequence: number | null;
    };

export interface GamePublicationV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  gameId: string;
  sequence: number;
  turnId: string;
  turnSequence: number;
  turnPublicationOrdinal: number;
  availableAt: string | null;
  payload: GamePublicationPayloadV1;
}

export interface CommittedCanonicalEventV1 {
  sequence: number;
  eventHash: string;
  event: CanonicalGameEvent;
}

export interface GameTurnCommitResultV1 {
  version: typeof DURABLE_GAME_TURN_CONTRACT_VERSION;
  gameId: string;
  turnId: string;
  turnSequence: number;
  intentHash: string;
  effectHash: string;
  committedAt: string;
  state: GameExecutionStateV1;
  canonicalEvents: CommittedCanonicalEventV1[];
  dialogueSequences: number[];
  publications: GamePublicationV1[];
  alreadyCommitted: boolean;
}

export interface DurableContractValidationResult {
  ok: boolean;
  errors: string[];
}

const PHASES = new Set<string>(Object.values(Phase));
const RUNTIME_ACTORS = new Set<string>(RUNTIME_ACTOR_COORDINATES);
const PARALLEL_BATCHES = new Set<string>(PARALLEL_BATCH_KINDS);
const SERIAL_LANES = new Set<string>(SERIAL_ACTOR_LANES);
const RULES_OPERATIONS = new Set<string>(RULES_OPERATIONS_V1);
const HOUSE_OPERATIONS = new Set<string>(HOUSE_OPERATIONS_V1);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_CURSOR_ITEMS = 256;

export function validateGameExecutionStateV1(
  value: unknown,
): DurableContractValidationResult {
  const errors: string[] = [];
  if (!exactRecord(value, [
    "version", "gameId", "ownerEpoch", "status", "heads", "lastPresentationPhase",
    "nextPublicationAvailableAt", "xstateSnapshot",
    "cursor", "playerContinuityCapsules", "houseNarrativeContinuity", "retry",
  ])) {
    return { ok: false, errors: ["execution state fields are not exact"] };
  }
  if (value.version !== 1) errors.push("execution state version must be 1");
  requireString(value.gameId, "execution state gameId", errors);
  requireString(value.ownerEpoch, "execution state ownerEpoch", errors);
  if (value.status !== "ready" && value.status !== "waiting_retry" && value.status !== "terminal" &&
    value.status !== "repair_required") {
    errors.push("execution state status is invalid");
  }
  errors.push(...validateHeads(value.heads, "execution state heads"));
  if (value.lastPresentationPhase !== null &&
    (typeof value.lastPresentationPhase !== "string" || !PHASES.has(value.lastPresentationPhase))) {
    errors.push("lastPresentationPhase is invalid");
  }
  if (!isNullableTimestamp(value.nextPublicationAvailableAt)) {
    errors.push("nextPublicationAvailableAt must be a canonical timestamp or null");
  }
  if (!isJsonObject(value.xstateSnapshot)) errors.push("xstateSnapshot must be a JSON object");
  errors.push(...validateCursor(value.cursor));
  errors.push(...validateContinuity(
    value.playerContinuityCapsules,
    value.houseNarrativeContinuity,
    typeof value.gameId === "string" ? value.gameId : null,
    "execution state",
  ));
  errors.push(...validateRetry(value.retry, value.status));
  return { ok: errors.length === 0, errors };
}

export function assertGameExecutionStateV1(
  value: unknown,
): asserts value is GameExecutionStateV1 {
  const result = validateGameExecutionStateV1(value);
  if (!result.ok) throw new Error(`Invalid durable execution state: ${result.errors.join("; ")}`);
}

export function validateGameTurnIntentV1(value: unknown): DurableContractValidationResult {
  const errors: string[] = [];
  if (!exactRecord(value, [
    "version", "gameId", "turnId", "turnSequence", "seed", "baseHeads", "branch",
    "actorIds", "targetIds", "handles", "participantIds", "providerSubcalls",
  ])) {
    return { ok: false, errors: ["turn intent fields are not exact"] };
  }
  if (value.version !== 1) errors.push("turn intent version must be 1");
  requireString(value.gameId, "turn intent gameId", errors);
  requireString(value.turnId, "turn intent turnId", errors);
  requirePositiveInteger(value.turnSequence, "turn intent turnSequence", errors);
  requireString(value.seed, "turn intent seed", errors);
  errors.push(...validateHeads(value.baseHeads, "turn intent baseHeads"));
  errors.push(...validateBranch(value.branch));
  for (const key of ["actorIds", "targetIds", "handles", "participantIds"] as const) {
    if (!isUniqueStringArray(value[key])) errors.push(`${key} must be an array of unique non-empty strings`);
  }
  if (!Array.isArray(value.providerSubcalls)) {
    errors.push("providerSubcalls must be an array");
  } else {
    const slots = new Set<number>();
    const logicalCallIds = new Set<string>();
    value.providerSubcalls.forEach((entry, index) => {
      errors.push(...validateProviderSubcall(entry, index));
      if (isRecord(entry) && Number.isInteger(entry.slot)) slots.add(Number(entry.slot));
      if (isRecord(entry) && typeof entry.logicalCallId === "string") logicalCallIds.add(entry.logicalCallId);
    });
    if (slots.size !== value.providerSubcalls.length) errors.push("provider subcall slots must be unique");
    if (logicalCallIds.size !== value.providerSubcalls.length) errors.push("provider logicalCallIds must be unique");
  }
  if (Number.isInteger(value.turnSequence) && isRecord(value.baseHeads)) {
    if (value.turnSequence !== Number(value.baseHeads.turnSequence) + 1) {
      errors.push("turnSequence must immediately follow baseHeads.turnSequence");
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertGameTurnIntentV1(value: unknown): asserts value is GameTurnIntentV1 {
  const result = validateGameTurnIntentV1(value);
  if (!result.ok) throw new Error(`Invalid durable turn intent: ${result.errors.join("; ")}`);
}

export function validateGameTurnCommitDraftV1(
  value: unknown,
): DurableContractValidationResult {
  const errors: string[] = [];
  if (!exactRecord(value, [
    "version", "gameId", "turnId", "turnSequence", "intentHash", "expectedBaseHeads",
    "nextExecution", "canonicalEvents", "transcriptEntries", "publications",
    "acceptedProviderCallIds",
  ])) {
    return { ok: false, errors: ["turn commit draft fields are not exact"] };
  }
  if (value.version !== 1) errors.push("turn commit draft version must be 1");
  requireString(value.gameId, "turn commit gameId", errors);
  requireString(value.turnId, "turn commit turnId", errors);
  requirePositiveInteger(value.turnSequence, "turn commit turnSequence", errors);
  if (typeof value.intentHash !== "string" || !HASH_PATTERN.test(value.intentHash)) {
    errors.push("turn commit intentHash must be a sha256 digest");
  }
  errors.push(...validateHeads(value.expectedBaseHeads, "turn commit expectedBaseHeads"));
  errors.push(...validateNextExecution(
    value.nextExecution,
    typeof value.gameId === "string" ? value.gameId : null,
  ));
  if (!Array.isArray(value.canonicalEvents)) {
    errors.push("canonicalEvents must be an array");
  } else {
    value.canonicalEvents.forEach((event, index) => errors.push(...validateEventDraft(event, index)));
  }
  if (!Array.isArray(value.transcriptEntries)) {
    errors.push("transcriptEntries must be an array");
  } else {
    value.transcriptEntries.forEach((entry, index) => errors.push(...validateTranscriptDraft(entry, index)));
  }
  if (!Array.isArray(value.publications)) {
    errors.push("publications must be an array");
  } else {
    value.publications.forEach((publication, index) =>
      errors.push(...validatePublicationDraft(publication, index))
    );
  }
  if (!isUniqueStringArray(value.acceptedProviderCallIds)) {
    errors.push("acceptedProviderCallIds must be an array of unique non-empty strings");
  }
  return { ok: errors.length === 0, errors };
}

export function assertGameTurnCommitDraftV1(
  value: unknown,
): asserts value is GameTurnCommitDraftV1 {
  const result = validateGameTurnCommitDraftV1(value);
  if (!result.ok) throw new Error(`Invalid durable turn commit draft: ${result.errors.join("; ")}`);
}

function validateHeads(value: unknown, label: string): string[] {
  if (!exactRecord(value, [
    "version", "turnSequence", "eventSequence", "eventHash", "dialogueSequence",
    "publicationSequence",
  ])) return [`${label} fields are not exact`];
  const errors: string[] = [];
  if (value.version !== 1) errors.push(`${label} version must be 1`);
  for (const key of ["turnSequence", "eventSequence", "dialogueSequence", "publicationSequence"] as const) {
    requireNonNegativeInteger(value[key], `${label}.${key}`, errors);
  }
  if (value.eventSequence === 0) {
    if (value.eventHash !== null) errors.push(`${label}.eventHash must be null at sequence 0`);
  } else if (typeof value.eventHash !== "string" || !HASH_PATTERN.test(value.eventHash)) {
    errors.push(`${label}.eventHash must be a sha256 digest after sequence 0`);
  }
  return errors;
}

function validateCursor(value: unknown): string[] {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== "string") {
    return ["execution cursor requires version 1 and a closed kind"];
  }
  const errors: string[] = [];
  switch (value.kind) {
    case "phase_enter":
      if (!exactRecord(value, ["version", "kind", "actor"])) return ["phase_enter cursor fields are not exact"];
      if (typeof value.actor !== "string" || !RUNTIME_ACTORS.has(value.actor)) errors.push("phase_enter actor is invalid");
      break;
    case "parallel_batch":
      if (!exactRecord(value, ["version", "kind", "batch"])) return ["parallel_batch cursor fields are not exact"];
      if (typeof value.batch !== "string" || !PARALLEL_BATCHES.has(value.batch)) errors.push("parallel_batch kind is invalid");
      break;
    case "serial_actor":
      if (!exactRecord(value, ["version", "kind", "lane", "actorIds", "actorIndex"], ["pass"])) {
        return ["serial_actor cursor fields are not exact"];
      }
      if (typeof value.lane !== "string" || !SERIAL_LANES.has(value.lane)) errors.push("serial_actor lane is invalid");
      validateBoundedUniqueStrings(value.actorIds, "serial_actor actorIds", errors);
      requireBoundedIndex(value.actorIndex, value.actorIds, true, "serial_actor actorIndex", errors);
      if (value.pass !== undefined) requirePositiveInteger(value.pass, "serial_actor pass", errors);
      break;
    case "mingle":
      if (!exactRecord(value, ["version", "kind", "progress"])) return ["mingle cursor fields are not exact"];
      errors.push(...validateMingleProgress(value.progress));
      break;
    case "alliance":
      if (!exactRecord(value, ["version", "kind", "progress"])) return ["alliance cursor fields are not exact"];
      errors.push(...validateAllianceProgress(value.progress));
      break;
    case "huddle":
      if (!exactRecord(value, ["version", "kind", "progress"])) return ["huddle cursor fields are not exact"];
      errors.push(...validateHuddleProgress(value.progress));
      break;
    case "format":
      if (!exactRecord(value, ["version", "kind", "progress"])) return ["format cursor fields are not exact"];
      errors.push(...validateFormatProgress(value.progress));
      break;
    case "two_names":
      if (!exactRecord(value, ["version", "kind", "progress"])) return ["Two Names cursor fields are not exact"];
      errors.push(...validateTwoNamesProgress(value.progress));
      break;
    case "diary":
      if (!exactRecord(value, ["version", "kind", "progress"])) return ["diary cursor fields are not exact"];
      errors.push(...validateDiaryProgress(value.progress));
      break;
    case "rules":
      if (!exactRecord(value, ["version", "kind", "operation"])) return ["rules cursor fields are not exact"];
      if (typeof value.operation !== "string" || !RULES_OPERATIONS.has(value.operation)) errors.push("rules operation is invalid");
      break;
    case "house":
      if (!exactRecord(value, ["version", "kind", "operation"])) return ["house cursor fields are not exact"];
      if (typeof value.operation !== "string" || !HOUSE_OPERATIONS.has(value.operation)) errors.push("house operation is invalid");
      break;
    case "terminal":
      if (!exactRecord(value, ["version", "kind", "stage"])) return ["terminal cursor fields are not exact"];
      if (value.stage !== "commit_game") errors.push("terminal stage is invalid");
      break;
    default:
      errors.push("execution cursor kind is invalid");
  }
  return errors;
}

function validateMingleProgress(value: unknown): string[] {
  if (!exactRecord(value, [
    "version", "phase", "totalBeats", "currentBeat", "roomIndex", "speakerIndex",
    "currentAllocation", "roomByPlayerId", "priorBeatAllocations", "movementRequests",
  ])) return ["mingle progress fields are not exact"];
  const errors: string[] = [];
  if (value.version !== 1) errors.push("mingle progress version must be 1");
  if (value.phase !== Phase.MINGLE_I && value.phase !== Phase.FORMAT_MINGLE && value.phase !== Phase.POST_VOTE_MINGLE) {
    errors.push("mingle progress phase is invalid");
  }
  requirePositiveInteger(value.totalBeats, "mingle totalBeats", errors);
  requirePositiveInteger(value.currentBeat, "mingle currentBeat", errors);
  if (Number.isInteger(value.totalBeats) && Number.isInteger(value.currentBeat) && Number(value.currentBeat) > Number(value.totalBeats)) {
    errors.push("mingle currentBeat exceeds totalBeats");
  }
  requireNonNegativeInteger(value.roomIndex, "mingle roomIndex", errors);
  requireNonNegativeInteger(value.speakerIndex, "mingle speakerIndex", errors);
  if (value.currentAllocation !== null) errors.push(...validateMingleAllocation(value.currentAllocation, "currentAllocation"));
  if (!isRecord(value.roomByPlayerId) || Object.keys(value.roomByPlayerId).length > MAX_CURSOR_ITEMS ||
    !Object.values(value.roomByPlayerId).every((roomId) => Number.isInteger(roomId) && Number(roomId) > 0)) {
    errors.push("mingle roomByPlayerId is invalid or unbounded");
  }
  if (!Array.isArray(value.priorBeatAllocations) || value.priorBeatAllocations.length > MAX_CURSOR_ITEMS) {
    errors.push("mingle priorBeatAllocations is invalid or unbounded");
  } else {
    value.priorBeatAllocations.forEach((entry, index) => errors.push(...validateMingleAllocation(entry, `priorBeatAllocations[${index}]`)));
  }
  if (!Array.isArray(value.movementRequests) || value.movementRequests.length > MAX_CURSOR_ITEMS) {
    errors.push("mingle movementRequests is invalid or unbounded");
  } else {
    value.movementRequests.forEach((entry, index) => errors.push(...validateMovementRequest(entry, index)));
  }
  return errors;
}

function validateMingleAllocation(value: unknown, label: string): string[] {
  if (!exactRecord(value, ["version", "beat", "rooms", "excludedPlayerIds"])) return [`mingle ${label} fields are not exact`];
  const errors: string[] = [];
  if (value.version !== 1) errors.push(`mingle ${label} version must be 1`);
  requirePositiveInteger(value.beat, `mingle ${label} beat`, errors);
  validateBoundedUniqueStrings(value.excludedPlayerIds, `mingle ${label} excludedPlayerIds`, errors);
  if (!Array.isArray(value.rooms) || value.rooms.length > MAX_CURSOR_ITEMS) {
    errors.push(`mingle ${label} rooms is invalid or unbounded`);
  } else {
    value.rooms.forEach((room, index) => {
      if (!exactRecord(room, ["version", "roomId", "playerIds"])) {
        errors.push(`mingle ${label} rooms[${index}] fields are not exact`);
        return;
      }
      if (room.version !== 1) errors.push(`mingle ${label} rooms[${index}] version must be 1`);
      requirePositiveInteger(room.roomId, `mingle ${label} rooms[${index}] roomId`, errors);
      validateBoundedUniqueStrings(room.playerIds, `mingle ${label} rooms[${index}] playerIds`, errors);
    });
  }
  return errors;
}

function validateMovementRequest(value: unknown, index: number): string[] {
  if (!exactRecord(value, ["version", "playerId", "gotoPlayerId", "preferredRoomSize"])) {
    return [`mingle movementRequests[${index}] fields are not exact`];
  }
  const errors: string[] = [];
  if (value.version !== 1) errors.push(`mingle movementRequests[${index}] version must be 1`);
  requireString(value.playerId, `mingle movementRequests[${index}] playerId`, errors);
  if (value.gotoPlayerId !== null) requireString(value.gotoPlayerId, `mingle movementRequests[${index}] gotoPlayerId`, errors);
  if (value.preferredRoomSize !== null && value.preferredRoomSize !== 2 && value.preferredRoomSize !== 3) {
    errors.push(`mingle movementRequests[${index}] preferredRoomSize is invalid`);
  }
  return errors;
}

function validateAllianceProgress(value: unknown): string[] {
  if (!exactRecord(value, [
    "version", "proposerIds", "proposerIndex", "actionOrdinal", "activeLineageId",
    "activeVersionId", "askedMemberIdsByVersion",
  ])) return ["alliance progress fields are not exact"];
  const errors: string[] = [];
  if (value.version !== 1) errors.push("alliance progress version must be 1");
  validateBoundedUniqueStrings(value.proposerIds, "alliance proposerIds", errors);
  requireBoundedIndex(value.proposerIndex, value.proposerIds, true, "alliance proposerIndex", errors);
  requirePositiveInteger(value.actionOrdinal, "alliance actionOrdinal", errors);
  if (value.activeLineageId !== null) requireString(value.activeLineageId, "alliance activeLineageId", errors);
  if (value.activeVersionId !== null) requireString(value.activeVersionId, "alliance activeVersionId", errors);
  if (!isRecord(value.askedMemberIdsByVersion) || Object.keys(value.askedMemberIdsByVersion).length > MAX_CURSOR_ITEMS) {
    errors.push("alliance askedMemberIdsByVersion is invalid or unbounded");
  } else {
    for (const [versionId, memberIds] of Object.entries(value.askedMemberIdsByVersion)) {
      requireString(versionId, "alliance askedMemberIdsByVersion key", errors);
      validateBoundedUniqueStrings(memberIds, `alliance asked members for ${versionId}`, errors);
    }
  }
  return errors;
}

function validateHuddleProgress(value: unknown): string[] {
  if (!exactRecord(value, [
    "version", "scheduleIds", "scheduleIndex", "sessionId", "speakerIds", "speakerIndex",
    "factAtoms",
  ])) return ["huddle progress fields are not exact"];
  const errors: string[] = [];
  if (value.version !== 1) errors.push("huddle progress version must be 1");
  validateBoundedUniqueStrings(value.scheduleIds, "huddle scheduleIds", errors);
  requireBoundedIndex(value.scheduleIndex, value.scheduleIds, true, "huddle scheduleIndex", errors);
  if (value.sessionId !== null) requireString(value.sessionId, "huddle sessionId", errors);
  validateBoundedUniqueStrings(value.speakerIds, "huddle speakerIds", errors);
  requireBoundedIndex(value.speakerIndex, value.speakerIds, true, "huddle speakerIndex", errors);
  if (!Array.isArray(value.factAtoms) || value.factAtoms.length > MAX_CURSOR_ITEMS || !isJsonValue(value.factAtoms)) {
    errors.push("huddle factAtoms is invalid or unbounded");
  }
  return errors;
}

function validateFormatProgress(value: unknown): string[] {
  if (!exactRecord(value, ["version", "selectedFormatId", "stage", "safetyBounce", "tiedPlayerIds"])) {
    return ["format progress fields are not exact"];
  }
  const errors: string[] = [];
  if (value.version !== 1) errors.push("format progress version must be 1");
  if (value.selectedFormatId !== null) requireString(value.selectedFormatId, "format selectedFormatId", errors);
  if (value.stage !== "select" && value.stage !== "ballots" && value.stage !== "safety_bounce_start" &&
    value.stage !== "safety_bounce_pointer" && value.stage !== "tiebreak" && value.stage !== "resolve") {
    errors.push("format progress stage is invalid");
  }
  validateBoundedUniqueStrings(value.tiedPlayerIds, "format tiedPlayerIds", errors);
  if (value.safetyBounce !== null) {
    if (!exactRecord(value.safetyBounce, [
      "version", "starterId", "pointerIndex", "safePlayerIds", "vulnerablePlayerIds",
    ])) {
      errors.push("format safetyBounce fields are not exact");
    } else {
      if (value.safetyBounce.version !== 1) errors.push("format safetyBounce version must be 1");
      requireString(value.safetyBounce.starterId, "format safetyBounce starterId", errors);
      requireNonNegativeInteger(value.safetyBounce.pointerIndex, "format safetyBounce pointerIndex", errors);
      validateBoundedUniqueStrings(value.safetyBounce.safePlayerIds, "format safetyBounce safePlayerIds", errors);
      validateBoundedUniqueStrings(value.safetyBounce.vulnerablePlayerIds, "format safetyBounce vulnerablePlayerIds", errors);
    }
  }
  return errors;
}

function validateTwoNamesProgress(value: unknown): string[] {
  if (!exactRecord(value, ["version", "stage", "pleaIndex"])) {
    return ["Two Names progress fields are not exact"];
  }
  const errors: string[] = [];
  if (value.version !== 1) errors.push("Two Names progress version must be 1");
  if (
    value.stage !== "setup"
    && value.stage !== "initial_mingle"
    && value.stage !== "override"
    && value.stage !== "final_mingle"
    && value.stage !== "plea"
    && value.stage !== "ballots"
    && value.stage !== "tiebreak"
    && value.stage !== "resolve"
  ) errors.push("Two Names progress stage is invalid");
  if (value.pleaIndex !== 0 && value.pleaIndex !== 1 && value.pleaIndex !== 2) {
    errors.push("Two Names pleaIndex must be 0, 1, or 2");
  }
  return errors;
}

function validateDiaryProgress(value: unknown): string[] {
  if (!exactRecord(value, ["version", "precedingPhase", "interviews"])) return ["diary progress fields are not exact"];
  const errors: string[] = [];
  if (value.version !== 1) errors.push("diary progress version must be 1");
  if (typeof value.precedingPhase !== "string" || !PHASES.has(value.precedingPhase)) errors.push("diary precedingPhase is invalid");
  if (!Array.isArray(value.interviews) || value.interviews.length > MAX_CURSOR_ITEMS) {
    errors.push("diary interviews is invalid or unbounded");
  } else {
    value.interviews.forEach((interview, index) => {
      if (!exactRecord(interview, [
        "version", "participantId", "role", "status", "questionIndex", "exchanges",
      ])) {
        errors.push(`diary interviews[${index}] fields are not exact`);
        return;
      }
      if (interview.version !== 1) errors.push(`diary interviews[${index}] version must be 1`);
      requireString(interview.participantId, `diary interviews[${index}] participantId`, errors);
      if (interview.role !== "player" && interview.role !== "juror" && interview.role !== "finalist") {
        errors.push(`diary interviews[${index}] role is invalid`);
      }
      if (interview.status !== "question" && interview.status !== "answer" &&
        interview.status !== "followup_plan" && interview.status !== "followup_answer" &&
        interview.status !== "closed") {
        errors.push(`diary interviews[${index}] status is invalid`);
      }
      requireNonNegativeInteger(interview.questionIndex, `diary interviews[${index}] questionIndex`, errors);
      if (!Array.isArray(interview.exchanges) || interview.exchanges.length > MAX_CURSOR_ITEMS) {
        errors.push(`diary interviews[${index}] exchanges is invalid or unbounded`);
      } else {
        interview.exchanges.forEach((exchange, exchangeIndex) => {
          if (!exactRecord(exchange, ["version", "question", "answer"])) {
            errors.push(`diary interviews[${index}] exchanges[${exchangeIndex}] fields are not exact`);
            return;
          }
          if (exchange.version !== 1) errors.push(`diary exchange version must be 1`);
          requireString(exchange.question, `diary exchange question`, errors);
          if (exchange.answer !== null) requireString(exchange.answer, `diary exchange answer`, errors);
        });
      }
    });
  }
  return errors;
}

function validateRetry(value: unknown, status: unknown): string[] {
  if (value === null) return status === "waiting_retry" ? ["waiting_retry requires retry state"] : [];
  if (!exactRecord(value, ["version", "attempt", "retryReadyAt", "safeCode"])) {
    return ["retry fields are not exact"];
  }
  const errors: string[] = [];
  if (status !== "waiting_retry") errors.push("retry state is only valid while waiting_retry");
  if (value.version !== 1) errors.push("retry version must be 1");
  requirePositiveInteger(value.attempt, "retry attempt", errors);
  if (!isIsoTimestamp(value.retryReadyAt)) errors.push("retryReadyAt must be a canonical timestamp");
  requireString(value.safeCode, "retry safeCode", errors);
  return errors;
}

function validateBranch(value: unknown): string[] {
  if (!exactRecord(value, ["version", "kind", "action"])) return ["turn branch fields are not exact"];
  const errors: string[] = [];
  if (value.version !== 1) errors.push("turn branch version must be 1");
  if (value.kind !== "engine" && value.kind !== "single_provider" &&
    value.kind !== "parallel_provider_batch" && value.kind !== "house") {
    errors.push("turn branch kind is invalid");
  }
  requireString(value.action, "turn branch action", errors);
  return errors;
}

function validateProviderSubcall(value: unknown, index: number): string[] {
  if (!exactRecord(value, ["version", "slot", "logicalCallId", "actorId", "action", "contractId"])
    && !exactRecord(value, ["version", "slot", "logicalCallId", "semanticCoordinate", "actorId", "action", "contractId"])) {
    return [`providerSubcalls[${index}] fields are not exact`];
  }
  const errors: string[] = [];
  if (value.version !== 1) errors.push(`providerSubcalls[${index}].version must be 1`);
  requirePositiveInteger(value.slot, `providerSubcalls[${index}].slot`, errors);
  requireString(value.logicalCallId, `providerSubcalls[${index}].logicalCallId`, errors);
  if ("semanticCoordinate" in value) {
    if (!isDurableTurnSemanticCoordinate(value.semanticCoordinate)) {
      errors.push(`providerSubcalls[${index}].semanticCoordinate must be an exact durable-turn coordinate`);
    } else if (value.semanticCoordinate.subcallSlot !== value.slot) {
      errors.push(`providerSubcalls[${index}].semanticCoordinate.subcallSlot must equal slot`);
    }
  }
  if (value.actorId !== null) requireString(value.actorId, `providerSubcalls[${index}].actorId`, errors);
  requireString(value.action, `providerSubcalls[${index}].action`, errors);
  requireString(value.contractId, `providerSubcalls[${index}].contractId`, errors);
  return errors;
}

/** Resolves the deterministic coordinate for both current and pre-R33 planned turns. */
export function durableProviderSemanticCoordinateForSubcall(
  turnId: string,
  subcall: Pick<GameTurnProviderSubcallV1, "slot" | "semanticCoordinate">,
): Extract<ProviderSemanticCoordinateV1, { kind: "durable_turn" }> {
  return subcall.semanticCoordinate ?? {
    version: 1,
    kind: "durable_turn",
    turnId,
    subcallSlot: subcall.slot,
  };
}

function isDurableTurnSemanticCoordinate(
  value: unknown,
): value is Extract<ProviderSemanticCoordinateV1, { kind: "durable_turn" }> {
  if (!exactRecord(value, ["version", "kind", "turnId", "subcallSlot"])) return false;
  return value.version === 1
    && value.kind === "durable_turn"
    && typeof value.turnId === "string"
    && value.turnId.trim().length > 0
    && Number.isSafeInteger(value.subcallSlot)
    && (value.subcallSlot as number) > 0;
}

function validateNextExecution(value: unknown, gameId: string | null): string[] {
  if (!exactRecord(value, [
    "version", "status", "lastPresentationPhase", "nextPublicationAvailableAt",
    "xstateSnapshot", "cursor", "playerContinuityCapsules",
    "houseNarrativeContinuity", "retry",
  ])) return ["nextExecution fields are not exact"];
  const errors: string[] = [];
  if (value.version !== 1) errors.push("nextExecution version must be 1");
  if (value.status !== "ready" && value.status !== "waiting_retry" && value.status !== "terminal" &&
    value.status !== "repair_required") {
    errors.push("nextExecution status is invalid");
  }
  if (value.lastPresentationPhase !== null &&
    (typeof value.lastPresentationPhase !== "string" || !PHASES.has(value.lastPresentationPhase))) {
    errors.push("nextExecution.lastPresentationPhase is invalid");
  }
  if (!isNullableTimestamp(value.nextPublicationAvailableAt)) {
    errors.push("nextExecution.nextPublicationAvailableAt must be a canonical timestamp or null");
  }
  if (!isJsonObject(value.xstateSnapshot)) errors.push("nextExecution.xstateSnapshot must be a JSON object");
  errors.push(...validateCursor(value.cursor));
  errors.push(...validateContinuity(
    value.playerContinuityCapsules,
    value.houseNarrativeContinuity,
    gameId,
    "nextExecution",
  ));
  errors.push(...validateRetry(value.retry, value.status));
  return errors;
}

function validateEventDraft(value: unknown, index: number): string[] {
  if (!exactRecord(value, [
    "version", "round", "phase", "type", "source", "visibility", "payloadVersion",
    "sourcePointers", "payload",
  ])) return [`canonicalEvents[${index}] fields are not exact`];
  const errors: string[] = [];
  if (value.version !== 1) errors.push(`canonicalEvents[${index}].version must be 1`);
  requireNonNegativeInteger(value.round, `canonicalEvents[${index}].round`, errors);
  if (value.phase !== null && (typeof value.phase !== "string" || !PHASES.has(value.phase))) {
    errors.push(`canonicalEvents[${index}].phase is invalid`);
  }
  if (!isCanonicalGameEventType(value.type)) {
    errors.push(`canonicalEvents[${index}].type is invalid`);
  }
  if (value.source !== "engine" && value.source !== "phase" && value.source !== "simulator" &&
    value.source !== "replay" && value.source !== "mcp") {
    errors.push(`canonicalEvents[${index}].source is invalid`);
  }
  if (value.visibility !== "public" && value.visibility !== "player" &&
    value.visibility !== "producer" && value.visibility !== "system") {
    errors.push(`canonicalEvents[${index}].visibility is invalid`);
  }
  if (value.payloadVersion !== 1 && value.payloadVersion !== 2) {
    errors.push(`canonicalEvents[${index}].payloadVersion is invalid`);
  }
  if (!isJsonValue(value.sourcePointers) || !Array.isArray(value.sourcePointers)) {
    errors.push(`canonicalEvents[${index}].sourcePointers must be a JSON array`);
  }
  if (!isJsonObject(value.payload)) errors.push(`canonicalEvents[${index}].payload must be a JSON object`);
  return errors;
}

function validateTranscriptDraft(value: unknown, index: number): string[] {
  const required = ["round", "phase", "from", "scope", "text"];
  const optional = [
    "to", "thinking", "reasoningContext", "anonymous", "displayOrder", "roomId",
    "roomMetadata", "speakerPlayerId", "dialogueKind", "audiencePlayerIds", "dialogueContext",
  ];
  if (!exactRecord(value, required, optional)) return [`transcriptEntries[${index}] fields are not exact`];
  const errors: string[] = [];
  requireNonNegativeInteger(value.round, `transcriptEntries[${index}].round`, errors);
  if (typeof value.phase !== "string" || !PHASES.has(value.phase)) errors.push(`transcriptEntries[${index}].phase is invalid`);
  requireString(value.from, `transcriptEntries[${index}].from`, errors);
  requireString(value.text, `transcriptEntries[${index}].text`, errors);
  if (!isJsonValue(value)) errors.push(`transcriptEntries[${index}] must be JSON-safe`);
  return errors;
}

function validatePublicationDraft(value: unknown, index: number): string[] {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== "string") {
    return [`publications[${index}] is invalid`];
  }
  if (value.kind === "canonical_event") {
    return exactRecord(value, ["version", "kind", "eventIndex", "availableAt"]) && Number.isInteger(value.eventIndex) && Number(value.eventIndex) >= 0 && isNullableTimestamp(value.availableAt)
      ? []
      : [`publications[${index}] canonical_event fields are invalid`];
  }
  if (value.kind === "transcript_entry") {
    return exactRecord(value, ["version", "kind", "transcriptIndex", "availableAt"]) && Number.isInteger(value.transcriptIndex) && Number(value.transcriptIndex) >= 0 && isNullableTimestamp(value.availableAt)
      ? []
      : [`publications[${index}] transcript_entry fields are invalid`];
  }
  if (value.kind === "completion") {
    return exactRecord(value, ["version", "kind", "eventIndex", "availableAt"]) &&
      (value.eventIndex === null || (Number.isInteger(value.eventIndex) && Number(value.eventIndex) >= 0)) &&
      isNullableTimestamp(value.availableAt)
      ? []
      : [`publications[${index}] ${value.kind} fields are invalid`];
  }
  return [`publications[${index}].kind is invalid`];
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is DurableJsonObject {
  return isRecord(value) && isJsonValue(value);
}

function isJsonValue(value: unknown): value is DurableJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(value).size === value.length;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function validateContinuity(
  playerCapsules: unknown,
  houseContinuity: unknown,
  gameId: string | null,
  label: string,
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(playerCapsules) || playerCapsules.length > MAX_CURSOR_ITEMS) {
    errors.push(`${label}.playerContinuityCapsules must be a bounded array`);
  } else {
    const parsed = playerCapsules.map(parsePlayerContinuityCapsule);
    if (parsed.some((capsule) => capsule === null)) {
      errors.push(`${label}.playerContinuityCapsules contain an invalid capsule`);
    } else {
      const playerIds = parsed.map((capsule) => capsule!.playerId);
      if (new Set(playerIds).size !== playerIds.length) {
        errors.push(`${label}.playerContinuityCapsules contain duplicate players`);
      }
    }
  }
  if (houseContinuity !== null) {
    const parsed = parseHouseNarrativeContinuity(houseContinuity);
    if (parsed.status !== "valid") {
      errors.push(`${label}.houseNarrativeContinuity is invalid`);
    } else if (gameId !== null && parsed.value.gameId !== gameId) {
      errors.push(`${label}.houseNarrativeContinuity belongs to another game`);
    }
  }
  return errors;
}

function validateBoundedUniqueStrings(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (!isUniqueStringArray(value) || value.length > MAX_CURSOR_ITEMS) {
    errors.push(`${label} must be a bounded array of unique non-empty strings`);
  }
}

function requireBoundedIndex(
  value: unknown,
  collection: unknown,
  allowAtEnd: boolean,
  label: string,
  errors: string[],
): void {
  if (!Number.isInteger(value) || Number(value) < 0 || !Array.isArray(collection)) {
    errors.push(`${label} must be a non-negative collection index`);
    return;
  }
  const limit = allowAtEnd ? collection.length : collection.length - 1;
  if (Number(value) > limit) errors.push(`${label} exceeds its collection`);
}

function requireString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${label} must be a non-empty string`);
}

function requireNonNegativeInteger(value: unknown, label: string, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 0) errors.push(`${label} must be a non-negative integer`);
}

function requirePositiveInteger(value: unknown, label: string, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 1) errors.push(`${label} must be a positive integer`);
}
