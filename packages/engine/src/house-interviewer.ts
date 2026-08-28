/**
 * Influence Game - House Interviewer
 *
 * The House is the omniscient narrator and production staff of the game.
 * During diary room sessions, The House interviews each player with
 * contextual, personality-driven questions generated via LLM.
 */

import { randomUUID } from "crypto";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { withInfluenceGamePromptContext } from "./game-prompt-context";
import {
  displayNameForFormat,
  type LaunchFormatId,
} from "./format-presentation-metadata";
import type { LlmProviderRuntime, LlmToolChoiceMode } from "./llm-client";
import { Phase } from "./types";
import type { UUID } from "./types";
import { parseOpenAIServiceTier, type TokenTracker } from "./token-tracker";
import { PromptReuseCollector } from "./prompt-reuse";
import {
  pairProviderLogicalCallOrdinals,
  providerAcceptedDecisionId,
  ProviderAttemptError,
  ProviderExecutionCoordinator,
  ProviderUnavailableError,
  type ProviderCandidateValidation,
  type ProviderAttemptRecord,
  type ProviderExecutionHooks,
  type ProviderLogicalCallExecution,
} from "./provider-execution";
import {
  createProviderAdapter,
  executeModelInvocation,
  isLlmProviderAdapter,
} from "./provider-adapters";
import type {
  LlmProviderAdapter,
  ModelInvocation,
  ModelInvocationMessage,
  ModelInvocationResult,
  ProviderModelOutcome,
} from "./model-invocation";
import {
  createExactStructuredOutputArtifact,
  type StructuredDomainDecodeResult,
} from "./structured-output";
import {
  houseSummaryCharacterLimit,
  isBoundedHouseAuthoredText,
  type HouseBeatClass,
  HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
  type HouseProviderUsage,
} from "./house-summary-frontier";
import {
  decodeAcceptedHouseLongForm,
  decodeHouseLongFormProvider,
  HOUSE_LONG_FORM_SUMMARY_SCHEMA,
} from "./house-long-form";
import type { AllianceHuddleConfidence, AllianceHuddleFactAtom, AllianceHuddleWindow } from "./types";
import {
  DEFAULT_MODEL_ID,
  inferModelCapabilities,
  type ModelReasoningEffort,
  type ModelReasoningPolicy,
  type ModelRequestCapabilities,
  type ProviderProfileId,
} from "./model-catalog";
import type {
  HouseGameplaySummaryContext,
  HouseGameplaySummaryResult,
  HouseNarrativeTurnContext,
  HouseSummaryAttemptResult,
  PrivateDecisionTrace,
  PrivateDecisionTraceContext,
  PrivateDecisionTraceMessage,
  PrivateDecisionTraceToolCall,
  PrivateTraceSink,
  PhaseContext,
} from "./game-runner.types";

interface HouseStructuredDecoder<TValue> {
  decodeProvider(record: Record<string, unknown>): StructuredDomainDecodeResult<TValue>;
  decodeAccepted(value: unknown): StructuredDomainDecodeResult<TValue>;
}

function houseStructuredRecordArtifact<TValue = Record<string, unknown>>(
  action: string,
  name: string,
  schema: Record<string, unknown>,
  decoder?: HouseStructuredDecoder<TValue>,
) {
  const decodeProvider = (value: unknown): StructuredDomainDecodeResult<TValue> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { status: "invalid", message: `${name} must be an object.` };
    }
    return decoder
      ? decoder.decodeProvider(value as Record<string, unknown>)
      : { status: "valid", value: value as TValue };
  };
  const decodeAccepted = (value: unknown): StructuredDomainDecodeResult<TValue> =>
    decoder
      ? decoder.decodeAccepted(value)
      : decodeProvider(value);
  return createExactStructuredOutputArtifact<Record<string, unknown>, TValue>({
    action,
    name,
    schema,
    decodeProviderPayload: decodeProvider,
    decodeAcceptedValue: decodeAccepted,
  });
}

// ---------------------------------------------------------------------------
// Interview context passed to the House
// ---------------------------------------------------------------------------

export interface DiaryRoomContext {
  /** Which phase just completed */
  precedingPhase: Phase;
  /** Current round number */
  round: number;
  /** Stable one-based roster ordinal for this interview session. */
  providerInterviewOrdinal: number;
  /** The agent being interviewed */
  agentId: UUID;
  agentName: string;
  /** The same actor-scoped projection used for this player's own model turn. */
  playerKnowledge: PhaseContext;
  /** This player's previous diary room Q&A entries */
  previousDiaryEntries?: Array<{ round: number; question: string; answer: string }>;
}

export interface HouseMingleAssignmentPlayer {
  id: UUID;
  name: string;
}

export interface HouseMingleAssignmentContext {
  round: number;
  phase: Phase.MINGLE | Phase.MINGLE_I | Phase.POST_VOTE_MINGLE | Phase.FORMAT_MINGLE;
  roomCount: number;
  selectedFormatId: LaunchFormatId | null;
  formatRuleSummary: string | null;
  players: HouseMingleAssignmentPlayer[];
}

export interface HouseMingleRoomAssignment {
  roomId: number;
  playerIds: UUID[];
}

export interface HouseMingleAssignmentResult {
  rooms: HouseMingleRoomAssignment[];
  rationale?: string;
  thinking?: string;
  reasoningContext?: string;
}

export interface HouseAllianceProposerCandidate {
  playerId: UUID;
  playerName: string;
  activeAllianceCount: number;
}

export interface HouseAllianceProposerSelectionContext {
  round: number;
  phase: Phase.FORMAT_MINGLE;
  budget: number;
  candidates: HouseAllianceProposerCandidate[];
}

export interface HouseAllianceProposerSelectionItem {
  playerId: UUID;
  rationale: string;
}

export interface HouseAllianceProposerSelectionResult {
  selected: HouseAllianceProposerSelectionItem[];
  rationale?: string;
  thinking?: string;
  reasoningContext?: string;
}

export interface HouseAllianceHuddleCandidate {
  allianceId: UUID;
  name: string;
  memberNames: string[];
  purpose: string;
  timebox?: string | null;
  priorOutcomeCount: number;
}

export interface HouseAllianceHuddleScheduleContext {
  round: number;
  phase: Phase.FORMAT_MINGLE | Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE;
  window: AllianceHuddleWindow;
  budget: number;
  /** Canonical caller field; provider prompts present these as players remaining. */
  alivePlayers: string[];
  candidates: HouseAllianceHuddleCandidate[];
}

export interface HouseAllianceHuddleScheduleItem {
  allianceId: UUID;
  rationale: string;
}

export interface HouseAllianceHuddleScheduleResult {
  scheduled: HouseAllianceHuddleScheduleItem[];
  skipped: HouseAllianceHuddleScheduleItem[];
  rationale?: string;
  thinking?: string;
  reasoningContext?: string;
}

export interface HouseAllianceHuddleOutcomeContext {
  round: number;
  phase: Phase.FORMAT_MINGLE | Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE;
  window: AllianceHuddleWindow;
  /** Stable one-based position in the engine's deterministic schedule for this phase. */
  providerLogicalCallOrdinal: number;
  alliance: {
    id: UUID;
    name: string;
    memberNames: string[];
    purpose: string;
    timebox?: string | null;
  };
  transcript: Array<{ from: string; text: string }>;
  /** Authoritative member-authored atoms. House may narrate but may not add facts. */
  facts: AllianceHuddleFactAtom[];
}

export interface HouseAllianceHuddleOutcomeResult {
  ask: string;
  plan: string;
  promises: string[];
  dissent: string[];
  confidence: AllianceHuddleConfidence;
  posture: string;
  leakOrBetrayalClaims: string[];
  thinking?: string;
  reasoningContext?: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/** Result from the House deciding whether to ask another question or wrap up. */
export type FollowUpResult =
  | { type: "question"; question: string }
  | { type: "close"; message: string };

const HOUSE_FOLLOW_UP_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["follow_up", "close"] },
    text: { type: "string", minLength: 1 },
  },
  required: ["decision", "text"],
  additionalProperties: false,
};

export interface IHouseInterviewer {
  /** Assign initial Mingle rooms from the roster and locked format. The phase validator repairs/finalizes output. */
  assignMingleRooms(context: HouseMingleAssignmentContext): Promise<HouseMingleAssignmentResult>;
  /** Select scarce proposer access from candidates remaining in the game. The engine validates and repairs output. */
  selectAllianceProposers(
    context: HouseAllianceProposerSelectionContext,
  ): Promise<HouseAllianceProposerSelectionResult>;
  /** Recommend scarce named-alliance huddles from active eligible alliances. The engine validates and repairs output. */
  planAllianceHuddles(context: HouseAllianceHuddleScheduleContext): Promise<HouseAllianceHuddleScheduleResult>;
  /** Summarize a completed named-alliance huddle into the official compact outcome memory. */
  summarizeAllianceHuddle(context: HouseAllianceHuddleOutcomeContext): Promise<HouseAllianceHuddleOutcomeResult>;
  /** Author viewer copy and optionally replace the private House notebook. */
  generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult>;
  /** Generate richer House-authored producer copy without feeding it back into game state. */
  generateLongFormGameplaySummary(context: HouseGameplaySummaryContext): Promise<HouseGameplaySummaryResult | null>;
  /** Generate the first diary room interview question for an agent */
  generateQuestion(context: DiaryRoomContext): Promise<string>;
  /** Decide whether to ask a follow-up or close the session. */
  generateFollowUpOrClose(
    context: DiaryRoomContext,
    conversationSoFar: Array<{ question: string; answer: string }>,
  ): Promise<FollowUpResult>;
}

export interface LLMHouseInterviewerOptions {
  privateTraceSink?: PrivateTraceSink;
  gameId?: UUID;
  ownerEpoch?: string;
  toolChoiceMode?: LlmToolChoiceMode;
  structuredOutputTimeoutMs?: number;
  providerProfileId?: ProviderProfileId;
  modelCapabilities?: ModelRequestCapabilities;
  reasoningPolicy?: ModelReasoningPolicy;
  catalogId?: string;
  /** Test-only/runtime override; production defaults to the beat-class hard limit. */
  houseSummaryTimeoutMs?: number;
  /** Observable provider-attempt hooks used by durable API and simulation adapters. */
  providerExecutionHooks?: ProviderExecutionHooks;
  /** Ordered, sealed runtime entries. The constructor client/model remain the primary projection. */
  providerManifest?: readonly LlmProviderRuntime[];
}

const HOUSE_SUMMARY_LIMITS = {
  ordinary: {
    wallClockMs: 45_000,
    maxCompletionTokens: 512,
    maxProseCharacters: houseSummaryCharacterLimit("ordinary"),
  },
  milestone: {
    wallClockMs: 75_000,
    maxCompletionTokens: 900,
    maxProseCharacters: houseSummaryCharacterLimit("milestone"),
  },
} as const satisfies Record<HouseBeatClass, {
  wallClockMs: number;
  maxCompletionTokens: number;
  maxProseCharacters: number;
}>;

// ---------------------------------------------------------------------------
// LLM-driven House Interviewer
// ---------------------------------------------------------------------------

const PLAYER_FACING_INTERVIEWER_PERSONALITY = `You are The House interviewer speaking directly to one Influence contestant.

Ask incisive, entertaining questions that help the contestant reflect on strategy, relationships, contradictions, and emotion. The supplied player knowledge is your entire information boundary: use public information and only the private conversations, decisions, alliances, and prior diary answers included there. Never imply access to another contestant's private conversation, sealed decision, diary, a producer notebook, a House viewer summary, or operator traces.

Ask one question at a time, in one or two sentences. Ground it in a concrete player, quote, event, decision, relationship, or prior answer from the supplied boundary. Do not invent missing facts.`;

function recordValue(value: unknown, label: string): StructuredDomainDecodeResult<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { status: "valid", value: value as Record<string, unknown> }
    : { status: "invalid", message: `${label} must be an object.` };
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function decodeHouseThinking(
  record: Record<string, unknown>,
  label: string,
  representation: "provider" | "accepted",
): StructuredDomainDecodeResult<{ thinking?: string }> {
  const hasThinking = Object.prototype.hasOwnProperty.call(record, "thinking");
  if (representation === "provider") {
    if (!hasThinking || (record.thinking !== null && typeof record.thinking !== "string")) {
      return { status: "invalid", message: `${label} thinking must be a string or null.` };
    }
    const thinking = readNullableString(record.thinking);
    return { status: "valid", value: thinking ? { thinking } : {} };
  }
  if (!hasThinking) return { status: "valid", value: {} };
  const thinking = readNullableString(record.thinking);
  return thinking
    ? { status: "valid", value: { thinking } }
    : { status: "invalid", message: `Accepted ${label} thinking must be a non-empty string when present.` };
}

function requireDistinctContextIds(ids: readonly string[], label: string): void {
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error(`${label} must contain distinct non-empty IDs.`);
  }
}

function decodeHouseMingleAssignment(
  value: unknown,
  context: HouseMingleAssignmentContext,
  representation: "provider" | "accepted",
): StructuredDomainDecodeResult<HouseMingleAssignmentResult> {
  const decodedRecord = recordValue(value, "House Mingle assignment");
  if (decodedRecord.status === "invalid") return decodedRecord;
  const record = decodedRecord.value;
  if (!hasOnlyKeys(record, ["rooms", "rationale", "thinking"])) {
    return { status: "invalid", message: "House Mingle assignment contains unsupported fields." };
  }
  if (!Array.isArray(record.rooms) || record.rooms.length !== context.roomCount) {
    return { status: "invalid", message: "House Mingle assignment must include every room exactly once." };
  }
  const legalPlayerIds = new Set(context.players.map((player) => player.id));
  const seenRooms = new Set<number>();
  const seenPlayers = new Set<UUID>();
  const rooms: HouseMingleRoomAssignment[] = [];
  for (const room of record.rooms) {
    const decodedRoom = recordValue(room, "House Mingle room");
    if (decodedRoom.status === "invalid") return decodedRoom;
    if (!hasOnlyKeys(decodedRoom.value, ["roomId", "playerIds"])) {
      return { status: "invalid", message: "House Mingle room contains unsupported fields." };
    }
    const roomId = decodedRoom.value.roomId;
    if (
      typeof roomId !== "number"
      || !Number.isInteger(roomId)
      || roomId < 1
      || roomId > context.roomCount
      || seenRooms.has(roomId)
    ) {
      return { status: "invalid", message: "House Mingle room ID is unavailable or duplicated." };
    }
    if (!Array.isArray(decodedRoom.value.playerIds)) {
      return { status: "invalid", message: "House Mingle room playerIds must be an array." };
    }
    const playerIds: UUID[] = [];
    for (const playerId of decodedRoom.value.playerIds) {
      if (
        typeof playerId !== "string"
        || !legalPlayerIds.has(playerId)
        || seenPlayers.has(playerId)
      ) {
        return { status: "invalid", message: "House Mingle player ID is unavailable or duplicated." };
      }
      seenPlayers.add(playerId);
      playerIds.push(playerId);
    }
    seenRooms.add(roomId);
    rooms.push({ roomId, playerIds });
  }
  if (seenPlayers.size !== legalPlayerIds.size) {
    return { status: "invalid", message: "House Mingle assignment must include every player exactly once." };
  }
  const rationale = readNullableString(record.rationale);
  if (!rationale) return { status: "invalid", message: "House Mingle rationale must be non-empty." };
  const thinking = decodeHouseThinking(record, "House Mingle", representation);
  if (thinking.status === "invalid") return thinking;
  return {
    status: "valid",
    value: {
      rooms,
      rationale,
      ...thinking.value,
    },
  };
}

const HOUSE_SUMMARY_SYSTEM_PROMPT = `You are Influence's omniscient House showrunner. Write a concise viewer-facing beat in your own voice and maintain a private narrative notebook for future House turns. Return the exact schema.

publicSummary is presentation for human viewers and players. It may connect events, strategy, private threads, irony, and dramatic consequences when useful. Write null when this material boundary needs no public beat.

privateNarrativeNotebook is your bounded, private whole-snapshot showrunner memory. Use it to preserve developing arcs, private threads, contradictions, promises, and future narrative opportunities. Write null to preserve the prior notebook unchanged. Ordinary beats should normally preserve it; milestone beats may replace it after absorbing new developments. Neither field is game-state authority, and the engine will never parse either field for facts.`;

interface HouseSummaryProviderValue {
  publicSummary: string | null;
  privateNarrativeNotebook: string | null;
}

function houseSummarySchema(maxPublicSummaryCharacters: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["publicSummary", "privateNarrativeNotebook"],
    properties: {
      publicSummary: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: maxPublicSummaryCharacters,
      },
      privateNarrativeNotebook: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
      },
    },
  };
}

function decodeHouseSummary(
  record: Record<string, unknown>,
  maxPublicSummaryCharacters: number,
): StructuredDomainDecodeResult<HouseSummaryProviderValue> {
  if (!hasOnlyKeys(record, ["publicSummary", "privateNarrativeNotebook"])) {
    return { status: "invalid", message: "House summary contains unsupported fields." };
  }
  const publicSummary = record.publicSummary;
  if (publicSummary !== null && !isBoundedHouseAuthoredText(publicSummary, maxPublicSummaryCharacters)) {
    return { status: "invalid", message: "House public summary is outside the allowed presentation bounds." };
  }
  const privateNarrativeNotebook = record.privateNarrativeNotebook;
  if (privateNarrativeNotebook !== null && !isBoundedHouseAuthoredText(
    privateNarrativeNotebook,
    HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
  )) {
    return { status: "invalid", message: "House private narrative notebook is outside the allowed presentation bounds." };
  }
  return {
    status: "valid",
    value: { publicSummary, privateNarrativeNotebook } as HouseSummaryProviderValue,
  };
}

function createHouseSummaryArtifact(beatClass: HouseBeatClass) {
  const maxPublicSummaryCharacters = houseSummaryCharacterLimit(beatClass);
  const decode = (value: unknown): StructuredDomainDecodeResult<HouseSummaryProviderValue> => {
    const decoded = recordValue(value, "House summary");
    return decoded.status === "invalid"
      ? decoded
      : decodeHouseSummary(decoded.value, maxPublicSummaryCharacters);
  };
  return createExactStructuredOutputArtifact({
    action: "house.house-audience-summary.v3",
    name: "house_audience_summary_v3",
    schema: houseSummarySchema(maxPublicSummaryCharacters),
    decodeProviderPayload: decode,
    decodeAcceptedValue: decode,
  });
}

const HOUSE_SUMMARY_ARTIFACTS = {
  ordinary: createHouseSummaryArtifact("ordinary"),
  milestone: createHouseSummaryArtifact("milestone"),
} as const satisfies Record<HouseBeatClass, ReturnType<typeof createHouseSummaryArtifact>>;

function decodeHouseFollowUpProvider(
  record: Record<string, unknown>,
  mayAskFollowUp: boolean,
): StructuredDomainDecodeResult<FollowUpResult> {
  if (!hasOnlyKeys(record, ["decision", "text"])) {
    return { status: "invalid", message: "House follow-up contains unsupported fields." };
  }
  const text = readNullableString(record.text);
  if (!text) return { status: "invalid", message: "House follow-up text must be non-empty." };
  if (record.decision === "follow_up") {
    return mayAskFollowUp
      ? { status: "valid", value: { type: "question", question: text } }
      : { status: "invalid", message: "House cannot ask beyond the session question limit." };
  }
  return record.decision === "close"
    ? { status: "valid", value: { type: "close", message: text } }
    : { status: "invalid", message: "House follow-up decision is unsupported." };
}

function decodeAcceptedHouseFollowUp(
  value: unknown,
  mayAskFollowUp: boolean,
): StructuredDomainDecodeResult<FollowUpResult> {
  const decodedRecord = recordValue(value, "Accepted House follow-up");
  if (decodedRecord.status === "invalid") return decodedRecord;
  const record = decodedRecord.value;
  if (record.type === "question" && mayAskFollowUp && readNullableString(record.question)) {
    return hasOnlyKeys(record, ["type", "question"])
      ? { status: "valid", value: { type: "question", question: readString(record.question) } }
      : { status: "invalid", message: "Accepted House question contains unsupported fields." };
  }
  if (record.type === "close" && readNullableString(record.message)) {
    return hasOnlyKeys(record, ["type", "message"])
      ? { status: "valid", value: { type: "close", message: readString(record.message) } }
      : { status: "invalid", message: "Accepted House close contains unsupported fields." };
  }
  return { status: "invalid", message: "Accepted House follow-up is incomplete or inconsistent." };
}

function contentFreeHouseFailureFields(error: unknown): { status: number | "unknown"; code: string; type: string } {
  const record = error && typeof error === "object" && !Array.isArray(error)
    ? error as Record<string, unknown>
    : {};
  const safeToken = (value: unknown): string =>
    typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : "unknown";
  return {
    status: typeof record.status === "number" && Number.isFinite(record.status) ? record.status : "unknown",
    code: safeToken(record.code),
    type: safeToken(record.type) !== "unknown"
      ? safeToken(record.type)
      : error instanceof Error
        ? "error"
        : "unknown",
  };
}

function isHouseArtifactProviderExhaustion(error: unknown): error is ProviderUnavailableError {
  return error instanceof ProviderUnavailableError && error.outcome.kind !== "cancellation";
}

function decodeHouseAllianceProposerSelection(
  value: unknown,
  context: HouseAllianceProposerSelectionContext,
  representation: "provider" | "accepted",
): StructuredDomainDecodeResult<HouseAllianceProposerSelectionResult> {
  const decodedRecord = recordValue(value, "House proposer selection");
  if (decodedRecord.status === "invalid") return decodedRecord;
  const record = decodedRecord.value;
  if (!hasOnlyKeys(record, ["selected", "rationale", "thinking"])) {
    return { status: "invalid", message: "House proposer selection contains unsupported fields." };
  }
  if (!Array.isArray(record.selected) || record.selected.length !== context.budget) {
    return { status: "invalid", message: "House proposer selection must spend the exact proposer budget." };
  }
  const eligible = new Set(context.candidates.map((candidate) => candidate.playerId));
  const seen = new Set<UUID>();
  const selected: HouseAllianceProposerSelectionItem[] = [];
  for (const item of record.selected) {
    const decodedItem = recordValue(item, "House proposer selection item");
    if (decodedItem.status === "invalid") return decodedItem;
    if (!hasOnlyKeys(decodedItem.value, ["playerId", "rationale"])) {
      return { status: "invalid", message: "House proposer item contains unsupported fields." };
    }
    const playerId = decodedItem.value.playerId;
    const rationale = readNullableString(decodedItem.value.rationale);
    if (
      typeof playerId !== "string"
      || !eligible.has(playerId)
      || seen.has(playerId)
      || !rationale
    ) {
      return { status: "invalid", message: "House proposer item is ineligible, duplicated, or incomplete." };
    }
    seen.add(playerId);
    selected.push({ playerId, rationale });
  }
  const rationale = readNullableString(record.rationale);
  if (!rationale) return { status: "invalid", message: "House proposer rationale must be non-empty." };
  const thinking = decodeHouseThinking(record, "House proposer", representation);
  if (thinking.status === "invalid") return thinking;
  return {
    status: "valid",
    value: {
      selected,
      rationale,
      ...thinking.value,
    },
  };
}

function deterministicAllianceProposerSelection(
  context: HouseAllianceProposerSelectionContext,
  rationalePrefix: string,
): HouseAllianceProposerSelectionItem[] {
  return context.candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) =>
      left.candidate.activeAllianceCount - right.candidate.activeAllianceCount || left.index - right.index,
    )
    .slice(0, context.budget)
    .map(({ candidate }) => ({
      playerId: candidate.playerId,
      rationale: `${rationalePrefix} ${candidate.playerName} with ${candidate.activeAllianceCount} active alliance${candidate.activeAllianceCount === 1 ? "" : "s"}.`,
    }));
}

function normalizedBoundedStrings(value: unknown, maxItems: number, maxChars: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const normalized = item
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized || normalized.length > maxChars) return null;
    strings.push(normalized);
  }
  return strings;
}

function decodeHouseAllianceHuddleSchedule(
  value: unknown,
  context: HouseAllianceHuddleScheduleContext,
  representation: "provider" | "accepted",
): StructuredDomainDecodeResult<HouseAllianceHuddleScheduleResult> {
  const decodedRecord = recordValue(value, "House huddle schedule");
  if (decodedRecord.status === "invalid") return decodedRecord;
  const record = decodedRecord.value;
  if (!hasOnlyKeys(record, ["scheduled", "skipped", "rationale", "thinking"])) {
    return { status: "invalid", message: "House huddle schedule contains unsupported fields." };
  }
  if (!Array.isArray(record.scheduled) || !Array.isArray(record.skipped)) {
    return { status: "invalid", message: "House huddle schedule requires scheduled and skipped arrays." };
  }
  if (record.scheduled.length > context.budget) {
    return { status: "invalid", message: "House huddle schedule exceeds the available budget." };
  }
  const eligible = new Set(context.candidates.map((candidate) => candidate.allianceId));
  const seen = new Set<UUID>();
  const decodeItems = (
    items: unknown[],
    label: string,
  ): StructuredDomainDecodeResult<HouseAllianceHuddleScheduleItem[]> => {
    const output: HouseAllianceHuddleScheduleItem[] = [];
    for (const item of items) {
      const decodedItem = recordValue(item, label);
      if (decodedItem.status === "invalid") return decodedItem;
      if (!hasOnlyKeys(decodedItem.value, ["allianceId", "rationale"])) {
        return { status: "invalid", message: `${label} contains unsupported fields.` };
      }
      const allianceId = decodedItem.value.allianceId;
      const rationale = readNullableString(decodedItem.value.rationale);
      if (
        typeof allianceId !== "string"
        || !eligible.has(allianceId)
        || seen.has(allianceId)
        || !rationale
      ) {
        return { status: "invalid", message: `${label} is ineligible, duplicated, or incomplete.` };
      }
      seen.add(allianceId);
      output.push({ allianceId, rationale });
    }
    return { status: "valid", value: output };
  };
  const scheduled = decodeItems(record.scheduled, "Scheduled huddle item");
  if (scheduled.status === "invalid") return scheduled;
  const skipped = decodeItems(record.skipped, "Skipped huddle item");
  if (skipped.status === "invalid") return skipped;
  if (seen.size !== eligible.size) {
    return { status: "invalid", message: "House huddle schedule must partition every eligible alliance." };
  }
  const rationale = readNullableString(record.rationale);
  if (!rationale) return { status: "invalid", message: "House huddle schedule rationale must be non-empty." };
  const thinking = decodeHouseThinking(record, "House huddle schedule", representation);
  if (thinking.status === "invalid") return thinking;
  return {
    status: "valid",
    value: {
      scheduled: scheduled.value,
      skipped: skipped.value,
      rationale,
      ...thinking.value,
    },
  };
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}


function huddleCoordinationLabel(window: AllianceHuddleWindow): string {
  if (window === "format") return "locked-format";
  return window === "pre_vote" ? "public Vote" : "Council";
}

function defaultHuddleAsk(window: AllianceHuddleWindow): string {
  if (window === "format") return "Align under the locked format.";
  return window === "pre_vote" ? "Align before the public Vote." : "Align before Council.";
}

function decodeHouseAllianceHuddleOutcome(
  value: unknown,
  representation: "provider" | "accepted",
): StructuredDomainDecodeResult<HouseAllianceHuddleOutcomeResult> {
  const decodedRecord = recordValue(value, "House huddle outcome");
  if (decodedRecord.status === "invalid") return decodedRecord;
  const record = decodedRecord.value;
  if (!hasOnlyKeys(record, [
    "ask",
    "plan",
    "promises",
    "dissent",
    "confidence",
    "posture",
    "leakOrBetrayalClaims",
    "thinking",
  ])) {
    return { status: "invalid", message: "House huddle outcome contains unsupported fields." };
  }
  const ask = readNullableString(record.ask);
  const plan = readNullableString(record.plan);
  const promises = normalizedBoundedStrings(record.promises, 12, 500);
  const dissent = normalizedBoundedStrings(record.dissent, 12, 500);
  const leakOrBetrayalClaims = normalizedBoundedStrings(
    record.leakOrBetrayalClaims,
    12,
    500,
  );
  if (!ask || !plan || ask.length > 800 || plan.length > 1_600) {
    return { status: "invalid", message: "House huddle ask and plan must be bounded non-empty strings." };
  }
  if (!promises || !dissent || !leakOrBetrayalClaims) {
    return { status: "invalid", message: "House huddle outcome lists must contain bounded non-empty strings." };
  }
  if (record.confidence !== "low" && record.confidence !== "medium" && record.confidence !== "high") {
    return { status: "invalid", message: "House huddle confidence is unsupported." };
  }
  if (
    record.posture !== "coordinating"
    && record.posture !== "fracturing"
    && record.posture !== "performative"
    && record.posture !== "guarded"
    && record.posture !== "betrayal_watch"
  ) {
    return { status: "invalid", message: "House huddle posture is unsupported." };
  }
  const thinking = decodeHouseThinking(record, "House huddle", representation);
  if (thinking.status === "invalid") return thinking;
  return {
    status: "valid",
    value: {
      ask,
      plan,
      promises,
      dissent,
      confidence: record.confidence,
      posture: record.posture,
      leakOrBetrayalClaims,
      ...thinking.value,
    },
  };
}

function fallbackHouseAllianceHuddleOutcome(
  context: HouseAllianceHuddleOutcomeContext,
): HouseAllianceHuddleOutcomeResult {
  const transcriptFallback = context.transcript.length > 0
    ? `Members discussed ${huddleCoordinationLabel(context.window)} coordination.`
    : `No explicit member messages were recorded for ${context.alliance.name}.`;
  return {
    ask: defaultHuddleAsk(context.window),
    plan: transcriptFallback,
    promises: [],
    dissent: [],
    confidence: "low",
    posture: "guarded",
    leakOrBetrayalClaims: [],
  };
}

export class LLMHouseInterviewer implements IHouseInterviewer {
  private readonly model: string;
  private readonly providerProfileId: ProviderProfileId;
  private readonly catalogId?: string;
  private readonly modelCapabilities: ModelRequestCapabilities;
  private readonly reasoningPolicy: ModelReasoningPolicy;
  private readonly privateTraceSink?: PrivateTraceSink;
  private readonly promptReuseCollector = new PromptReuseCollector();
  private readonly privateTraceGameId?: UUID;
  private readonly privateTraceOwnerEpoch?: string;
  private readonly toolChoiceMode: LlmToolChoiceMode;
  private readonly structuredOutputTimeoutMs: number;
  private readonly houseSummaryTimeoutMs?: number;
  private readonly providerExecution: ProviderExecutionCoordinator;
  private readonly providerManifest: readonly LlmProviderRuntime[];
  private readonly responseProviderRuntime = new WeakMap<object, LlmProviderRuntime>();
  private readonly responseProviderAttemptId = new WeakMap<object, string>();
  private readonly responseProviderOutcome = new WeakMap<object, ProviderModelOutcome>();
  private tokenTracker: TokenTracker | null = null;

  constructor(provider: OpenAI | LlmProviderAdapter, model = DEFAULT_MODEL_ID, options: LLMHouseInterviewerOptions = {}) {
    this.model = model;
    this.providerProfileId = options.providerProfileId ?? "openai";
    this.catalogId = options.catalogId;
    this.modelCapabilities = options.modelCapabilities ?? inferModelCapabilities(model, this.providerProfileId);
    this.reasoningPolicy = options.reasoningPolicy ?? "action-policy";
    this.privateTraceSink = options.privateTraceSink;
    this.privateTraceGameId = options.gameId;
    this.privateTraceOwnerEpoch = options.ownerEpoch;
    this.toolChoiceMode = options.toolChoiceMode ?? "named";
    this.structuredOutputTimeoutMs = options.structuredOutputTimeoutMs ?? 45_000;
    this.houseSummaryTimeoutMs = options.houseSummaryTimeoutMs;
    this.providerExecution = new ProviderExecutionCoordinator({
      hooks: options.providerExecutionHooks,
    });
    this.providerManifest = options.providerManifest?.length
      ? options.providerManifest.map((entry) => ({ ...entry }))
      : [{
          adapter: isLlmProviderAdapter(provider)
            ? provider
            : createProviderAdapter(this.providerProfileId, provider),
          catalogId: options.catalogId ?? `${this.providerProfileId}:${model}`,
          providerProfileId: this.providerProfileId,
          modelId: model,
          modelCapabilities: this.modelCapabilities,
          reasoningPolicy: this.reasoningPolicy,
          toolChoiceMode: this.toolChoiceMode,
          position: 0,
          role: "primary",
        }];
  }

  /** Attach a token tracker to record LLM usage. */
  setTokenTracker(tracker: TokenTracker): void {
    this.tokenTracker = tracker;
  }

  private startProviderCall(
    context: PrivateDecisionTraceContext,
  ): ProviderLogicalCallExecution {
    return this.providerExecution.startCall({
      ...(context.gameId && { gameId: context.gameId }),
      ...(context.ownerEpoch && { ownerEpoch: context.ownerEpoch }),
      actor: context.actor,
      action: context.action,
      ...(context.phase && { phase: context.phase }),
      ...(context.round !== undefined && { round: context.round }),
      logicalCallOrdinal: context.logicalCallOrdinal ?? 1,
    });
  }

  private executeModelCall<T, TStructuredValue = unknown>(params: {
    call: ProviderLogicalCallExecution;
    invocation:
      | ModelInvocation<TStructuredValue>
      | (() => ModelInvocation<TStructuredValue>);
    maxAttempts: number;
    requestSignalFactory?: () => AbortSignal | undefined;
    cancellationSignal?: AbortSignal;
    validate(
      response: ProviderModelOutcome,
      structuredValue: TStructuredValue | undefined,
    ): ProviderCandidateValidation<T>;
    onRetry?: (record: ProviderAttemptRecord) => void;
  }): Promise<T> {
    return executeModelInvocation({
      call: params.call,
      runtimes: this.providerManifest,
      invocation: params.invocation,
      maxAttempts: params.maxAttempts,
      ...(params.requestSignalFactory && { requestSignalFactory: params.requestSignalFactory }),
      ...(params.cancellationSignal && {
        cancellationSignal: params.cancellationSignal,
      }),
      validate: params.validate,
      ...(params.onRetry && { onRetry: params.onRetry }),
    }).then(({ value, manifestPosition, acceptedAttemptId, liveOutcome }) => {
      if (value && typeof value === "object") {
        this.responseProviderRuntime.set(
          value as object,
          this.providerManifest[manifestPosition]!,
        );
        if (acceptedAttemptId) {
          this.responseProviderAttemptId.set(value as object, acceptedAttemptId);
        }
        if (liveOutcome) {
          this.responseProviderOutcome.set(value as object, liveOutcome);
        }
      }
      return value;
    });
  }

  private runtimeForResponse(response: ProviderModelOutcome): LlmProviderRuntime {
    return this.responseProviderRuntime.get(response as object)
      ?? this.providerManifest[0]!;
  }

  private executeHouseModelTransport(
    context: PrivateDecisionTraceContext,
    invocation: ModelInvocation,
    options: {
      maxAttempts?: number;
      requestSignalFactory?: () => AbortSignal | undefined;
      cancellationSignal?: AbortSignal;
      validate?: (response: ProviderModelOutcome) => ProviderCandidateValidation<ProviderModelOutcome>;
    } = {},
  ): Promise<ProviderModelOutcome> {
    return this.executeModelCall({
      call: this.startProviderCall(context),
      invocation,
      maxAttempts: options.maxAttempts ?? 2,
      ...(options.requestSignalFactory && { requestSignalFactory: options.requestSignalFactory }),
      ...(options.cancellationSignal && { cancellationSignal: options.cancellationSignal }),
      validate: (response) => {
        if (response.refusal || response.stopReason === "content_filter") {
          return {
            status: "unusable",
            kind: "refusal",
            message: response.refusal ?? "content_filter",
            retryable: false,
          };
        }
        if (response.stopReason === "length") {
          return {
            status: "unusable",
            kind: "undecodable_structured_output",
            message: "length",
            retryable: true,
          };
        }
        if (!response.text && response.toolCalls.length === 0) {
          return {
            status: "unusable",
            kind: "empty_output",
            message: "missing_assistant_message",
            retryable: true,
          };
        }
        return options.validate?.(response) ?? this.validateHouseTextResponse(response);
      },
    });
  }

  private validateHouseTextResponse(
    response: ProviderModelOutcome,
  ): ProviderCandidateValidation<ProviderModelOutcome> {
    const content = response.text?.trim();
    return content
      ? { status: "usable", value: response }
      : {
          status: "unusable",
          kind: "empty_output",
          message: "empty_house_text",
          retryable: true,
        };
  }

  private recordUsage(source: string, response: ProviderModelOutcome): void {
    if (!this.tokenTracker) return;
    const usage = LLMHouseInterviewer.providerUsageMetadata(response);
    if (!usage || usage.promptTokens === undefined || usage.completionTokens === undefined) return;
    this.tokenTracker.record(
      source,
      usage.promptTokens,
      usage.completionTokens,
      usage.cachedTokens ?? 0,
      usage.reasoningTokens ?? 0,
      parseOpenAIServiceTier(response.serviceTier),
      usage.cacheWriteTokens ?? 0,
    );
  }

  static providerUsage(response: ProviderModelOutcome, callId: string): HouseProviderUsage {
    const usage = LLMHouseInterviewer.providerUsageMetadata(response);
    return {
      callId,
      responseId: response.responseId ?? null,
      serviceTier: parseOpenAIServiceTier(response.serviceTier) ?? null,
      promptTokens: usage?.promptTokens ?? null,
      cachedTokens: usage?.cachedTokens ?? null,
      cacheWriteTokens: usage?.cacheWriteTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      reasoningTokens: usage?.reasoningTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    };
  }

  private privateTraceContext(
    action: string,
    round: number,
    phase: Phase,
    logicalCallOrdinal = 1,
  ): PrivateDecisionTraceContext {
    return {
      ...(this.privateTraceGameId && { gameId: this.privateTraceGameId }),
      ...(this.privateTraceOwnerEpoch && { ownerEpoch: this.privateTraceOwnerEpoch }),
      action,
      actor: {
        name: "The House",
        role: "house",
      },
      phase,
      round,
      logicalCallOrdinal,
    };
  }

  private diaryPrivateTraceContext(
    action: "house-question" | "house-followup",
    context: DiaryRoomContext,
    exchangeOrdinal = 1,
  ): PrivateDecisionTraceContext {
    return this.privateTraceContext(
      action,
      context.round,
      Phase.DIARY_ROOM,
      pairProviderLogicalCallOrdinals(
        context.providerInterviewOrdinal,
        exchangeOrdinal,
      ),
    );
  }

  private static privateTraceMessages(
    messages: readonly {
      role: string;
      content?: unknown;
      name?: string;
      tool_call_id?: string;
      tool_calls?: unknown;
    }[],
  ): PrivateDecisionTraceMessage[] {
    return messages.map((message) => {
      const toolCalls = LLMHouseInterviewer.privateTraceToolCalls({ tool_calls: message.tool_calls });
      return {
        role: message.role,
        content: message.content ?? null,
        ...(message.name && { name: message.name }),
        ...(message.tool_call_id && { toolCallId: message.tool_call_id }),
        ...(toolCalls && { toolCalls }),
      };
    });
  }

  private static privateTraceToolCalls(message: unknown): PrivateDecisionTraceToolCall[] | undefined {
    if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
    const record = message as Record<string, unknown>;
    if (!Array.isArray(record.tool_calls)) return undefined;
    const toolCalls = record.tool_calls
      .map((toolCall): PrivateDecisionTraceToolCall | null => {
        if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) return null;
        const toolRecord = toolCall as Record<string, unknown>;
        const functionRecord =
          toolRecord.function && typeof toolRecord.function === "object" && !Array.isArray(toolRecord.function)
            ? toolRecord.function as Record<string, unknown>
            : {};
        return {
          ...(typeof toolRecord.id === "string" && { id: toolRecord.id }),
          ...(typeof toolRecord.type === "string" && { type: toolRecord.type }),
          ...(typeof functionRecord.name === "string" && { name: functionRecord.name }),
          ...(typeof functionRecord.arguments === "string" && { arguments: functionRecord.arguments }),
        };
      })
      .filter((toolCall): toolCall is PrivateDecisionTraceToolCall => toolCall !== null);
    return toolCalls.length > 0 ? toolCalls : undefined;
  }

  private static extractReasoningContext(message: unknown): string {
    if (!message || typeof message !== "object" || Array.isArray(message)) return "";
    const record = message as Record<string, unknown>;
    return readString(record.reasoning_content) || readString(record.reasoning);
  }

  private static readNumberField(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private static providerUsageMetadata(response: ProviderModelOutcome): PrivateDecisionTrace["usage"] | undefined {
    const usage = response.accounting?.usage;
    if (!usage) return undefined;
    const metadata: NonNullable<PrivateDecisionTrace["usage"]> = {
      ...(usage.promptTokens !== undefined && { promptTokens: usage.promptTokens }),
      ...(usage.completionTokens !== undefined && { completionTokens: usage.completionTokens }),
      ...(usage.cachedTokens !== undefined && { cachedTokens: usage.cachedTokens }),
      ...(usage.cacheWriteTokens !== undefined && { cacheWriteTokens: usage.cacheWriteTokens }),
      ...(usage.reasoningTokens !== undefined && { reasoningTokens: usage.reasoningTokens }),
      ...(usage.totalTokens !== undefined && { totalTokens: usage.totalTokens }),
    };
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private async emitPrivateDecisionTrace(params: {
    context: PrivateDecisionTraceContext;
    messages: readonly {
      role: string;
      content?: unknown;
      name?: string;
      tool_call_id?: string;
      tool_calls?: unknown;
    }[];
    response: ProviderModelOutcome;
    output?: unknown;
    toolRequest?: boolean;
  }): Promise<void> {
    if (!this.privateTraceSink) return;
    const outputRecord =
      params.output && typeof params.output === "object" && !Array.isArray(params.output)
        ? params.output as Record<string, unknown>
        : {};
    const emittedThinking = readString(outputRecord.thinking);
    const reasoningContext =
      readString(outputRecord.reasoningContext) ||
      params.response.reasoning?.content;
    const toolCalls = params.response.toolCalls.length > 0
      ? params.response.toolCalls.map((call) => ({
          ...(call.id && { id: call.id }),
          type: "function_call",
          name: call.name,
          arguments: call.arguments,
        }))
      : undefined;
    const content = params.response.text ?? null;
    const runtime = this.runtimeForResponse(params.response);
    const configuredEffort = runtime.reasoningPolicy === "low"
      || runtime.reasoningPolicy === "medium"
      || runtime.reasoningPolicy === "high"
      ? runtime.reasoningPolicy
      : undefined;
    const requestReasoningEffort = runtime.modelCapabilities.supportsReasoningEffort
      ? configuredEffort
      : undefined;
    const requestedReasoningEffort = requestReasoningEffort;
    const privateTraceMessages = LLMHouseInterviewer.privateTraceMessages(params.messages);
    const promptReuse = this.promptReuseCollector.observe(privateTraceMessages, {
      lane: params.context.actor.id ?? "house",
      requestShape: params.response.transport,
      usage: LLMHouseInterviewer.providerUsageMetadata(params.response),
    });
    const acceptedAttemptId = this.responseProviderAttemptId.get(params.response as object);
    const decisionId = acceptedAttemptId
      ? providerAcceptedDecisionId(acceptedAttemptId)
      : randomUUID();
    const trace: PrivateDecisionTrace = {
      version: 2,
      ...(params.context.gameId && { gameId: params.context.gameId }),
      ...(params.context.ownerEpoch && { ownerEpoch: params.context.ownerEpoch }),
      decisionId,
      action: params.context.action,
      actor: params.context.actor,
      ...(params.context.phase && { phase: params.context.phase }),
      ...(params.context.round !== undefined && { round: params.context.round }),
      createdAt: new Date().toISOString(),
      model: {
        provider: runtime.providerProfileId,
        providerProfileId: runtime.providerProfileId,
        catalogId: runtime.catalogId,
        name: runtime.modelId,
      },
      ...(requestedReasoningEffort && { requestedReasoningEffort }),
      reasoningPolicy: runtime.reasoningPolicy,
      prompt: {
        messages: privateTraceMessages,
      },
      request: {
        providerProfileId: runtime.providerProfileId,
        catalogId: runtime.catalogId,
        model: runtime.modelId,
        messages: privateTraceMessages,
        ...(requestReasoningEffort && { reasoning_effort: requestReasoningEffort }),
        reasoningPolicy: runtime.reasoningPolicy,
      },
      response: {
        transport: params.response.transport,
        raw: params.response.nativeResponse,
        finishReason: params.response.stopReason ?? params.response.status ?? null,
        content,
        ...(toolCalls && { toolCalls }),
      },
      ...(params.output !== undefined && { output: params.output }),
      ...(LLMHouseInterviewer.providerUsageMetadata(params.response) && { usage: LLMHouseInterviewer.providerUsageMetadata(params.response) }),
      promptReuse,
      ...(emittedThinking && { emittedThinking }),
      ...(reasoningContext && { reasoningContext }),
      ...(params.context.boundary && { boundary: params.context.boundary }),
    };

    try {
      await this.privateTraceSink(trace);
    } catch (error) {
      console.warn(`[trace-sink] house action=${trace.action} failed:`, error);
    }
  }

  private requestedReasoningEffort(): ModelReasoningEffort | undefined {
    if (!this.modelCapabilities.supportsReasoningEffort) return undefined;
    if (this.reasoningPolicy === "low" || this.reasoningPolicy === "medium" || this.reasoningPolicy === "high") {
      return this.reasoningPolicy;
    }
    return undefined;
  }

  private static modelMessages(
    messages: readonly ChatCompletionMessageParam[],
  ): ModelInvocationMessage[] {
    return messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool" as const,
          content: typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content),
          toolCallId: message.tool_call_id,
        };
      }
      if (message.role === "assistant") {
        return {
          role: "assistant" as const,
          content: typeof message.content === "string" ? message.content : null,
          ...(message.tool_calls?.length && {
            toolCalls: message.tool_calls.map((call) => ({
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
            })),
          }),
        };
      }
      if (message.role === "function") {
        throw new Error("Legacy function messages are not supported by provider-native invocation adapters");
      }
      return {
        role: message.role,
        content: typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      };
    });
  }

  private houseInvocation<TStructuredValue = unknown>(
    messages: readonly ChatCompletionMessageParam[],
    result: ModelInvocationResult<TStructuredValue>,
    outputTokenLimit: number,
    temperature: number,
  ): ModelInvocation<TStructuredValue> {
    const effort = this.requestedReasoningEffort();
    return {
      messages: LLMHouseInterviewer.modelMessages(messages),
      result,
      outputTokenLimit,
      ...(effort && { reasoning: { effort } }),
      temperature,
    };
  }

  private applyMessageTokenFloor(maxTokens: number): number {
    return Math.max(maxTokens, 4096);
  }

  private applyStructuredTokenFloor(maxTokens: number): number {
    return Math.max(maxTokens, 8192);
  }

  private structuredOutputSignalFactory(): (() => AbortSignal) | undefined {
    if (this.structuredOutputTimeoutMs < 1) return undefined;
    return () => AbortSignal.timeout(this.structuredOutputTimeoutMs);
  }

  private async callHouseJsonSchema<TValue extends object>(params: {
    action: string;
    artifactAction?: string;
    source: string;
    round: number;
    phase: Phase;
    traceContext?: PrivateDecisionTraceContext;
    messages: Array<{ role: "system" | "user"; content: string }>;
    schemaName: string;
    schema: Record<string, unknown>;
    decoder: HouseStructuredDecoder<TValue>;
    maxTokens: number;
    temperature: number;
  }): Promise<{ value: TValue; response?: ProviderModelOutcome }> {
    let effectiveMaxTokens = this.applyStructuredTokenFloor(params.maxTokens);
    const maxAttempts = 2;
    const traceContext = params.traceContext ?? this.privateTraceContext(
      params.action,
      params.round,
      params.phase,
    );
    const providerCall = this.startProviderCall(traceContext);
    const requestSignalFactory = this.structuredOutputSignalFactory();
    const artifact = houseStructuredRecordArtifact<TValue>(
      params.artifactAction ?? `house.${params.action}.v1`,
      params.schemaName,
      params.schema,
      params.decoder,
    );
    try {
      const result = await this.executeModelCall({
        call: providerCall,
        invocation: () => this.houseInvocation(
          params.messages,
          {
            kind: "structured",
            artifact,
          },
          effectiveMaxTokens,
          params.temperature,
        ),
        maxAttempts,
        ...(requestSignalFactory && { requestSignalFactory }),
        validate: (_response, value) => value
          ? { status: "usable", value }
          : {
              status: "unusable",
              kind: "malformed_output",
              message: "Structured House payload was not decoded.",
            },
        onRetry: (record) => {
          if (
            record.outcome.kind === "undecodable_structured_output" ||
            record.outcome.kind === "malformed_output"
          ) {
            effectiveMaxTokens = Math.ceil(effectiveMaxTokens * 1.5);
          }
          console.warn(
            `[house-structured-output] action=${params.action} attempt ${record.attemptOrdinal} failed, retrying: ${record.outcome.kind}`,
          );
        },
      });
      const response = this.responseProviderOutcome.get(result);
      if (response) this.recordUsage(params.source, response);
      return { value: result, ...(response && { response }) };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[house-structured-output] action=${params.action} failed: ${failure.message}`,
      );
      throw error;
    }
  }

  async assignMingleRooms(context: HouseMingleAssignmentContext): Promise<HouseMingleAssignmentResult> {
    if (!Number.isInteger(context.roomCount) || context.roomCount < 1) {
      throw new Error("House Mingle assignment requires a positive integer room count.");
    }
    requireDistinctContextIds(
      context.players.map((player) => player.id),
      "House Mingle player context",
    );
    const playerLines = context.players
      .map((player) => `- ${player.name} (${player.id})`)
      .join("\n");

    const roomList = Array.from({ length: context.roomCount }, (_, index) => index + 1).join(", ");
    const selectedFormatName = context.selectedFormatId === null
      ? null
      : displayNameForFormat(context.selectedFormatId);
    const prompt = `Assign initial Mingle rooms for Round ${context.round}.

Phase: ${context.phase}
Locked format: ${selectedFormatName ?? "none"}
Locked rules: ${context.formatRuleSummary ?? "No locked format rules are available."}
Rooms available: ${roomList}
Players remaining:
${playerLines}

Your job:
- Form interesting, strategic, roughly balanced rooms under the locked format.
- Prefer rooms that can build concrete vote blocs, negotiate named targets, test commitments, and plan contingencies permitted by the locked rules.
- Do not hide everyone in Room 1. Room numbers are neutral containers; use the full roster and locked rules.
- Assign every listed player exactly once.
- Use only the exact player IDs above and room IDs from the available room list.

Respond with JSON only:
{
  "rooms": [
    { "roomId": 1, "playerIds": ["player-id"] }
  ],
  "rationale": "short producer/debug rationale for the allocation"
    }`;

    try {
      const messages = [
        { role: "system" as const, content: withInfluenceGamePromptContext("You are the House producer assigning private Mingle rooms. Return JSON only.") },
        { role: "user" as const, content: prompt },
      ];
      const { value, response } = await this.callHouseJsonSchema({
        action: "house-mingle-assignment",
        source: "House/mingle-assignment",
        round: context.round,
        phase: context.phase,
        messages,
        schemaName: "house_mingle_assignment",
        schema: {
          type: "object",
          properties: {
            rooms: {
              type: "array",
              minItems: context.roomCount,
              maxItems: context.roomCount,
              items: {
                type: "object",
                properties: {
                  roomId: {
                    type: "integer",
                    enum: Array.from({ length: context.roomCount }, (_, index) => index + 1),
                  },
                  playerIds: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: context.players.map((player) => player.id),
                    },
                  },
                },
                required: ["roomId", "playerIds"],
                additionalProperties: false,
              },
            },
            rationale: { type: "string" },
            thinking: { type: ["string", "null"] },
          },
          required: ["rooms", "rationale", "thinking"],
          additionalProperties: false,
        },
        decoder: {
          decodeProvider: (record) => decodeHouseMingleAssignment(record, context, "provider"),
          decodeAccepted: (accepted) => decodeHouseMingleAssignment(accepted, context, "accepted"),
        },
        maxTokens: 1200,
        temperature: 0.4,
      });

      const output = response?.reasoning?.content
        ? { ...value, reasoningContext: response.reasoning.content }
        : value;
      if (response) {
        await this.emitPrivateDecisionTrace({
          context: this.privateTraceContext("house-mingle-assignment", context.round, context.phase),
          messages,
          response,
          output,
        });
      }
      return output;
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return {
        rooms: [],
        rationale: `House assignment failed; deterministic fallback will assign rooms (${message}).`,
      };
    }
  }

  async selectAllianceProposers(
    context: HouseAllianceProposerSelectionContext,
  ): Promise<HouseAllianceProposerSelectionResult> {
    if (
      !Number.isInteger(context.budget)
      || context.budget < 0
      || context.budget > context.candidates.length
    ) {
      throw new Error("House proposer context has an invalid budget.");
    }
    requireDistinctContextIds(
      context.candidates.map((candidate) => candidate.playerId),
      "House proposer candidate context",
    );
    const candidates = context.candidates
      .map((candidate, index) =>
        `${index + 1}. ${candidate.playerName} (${candidate.playerId}); activeAlliances=${candidate.activeAllianceCount}`,
      )
      .join("\n");
    const prompt = `Select scarce named-alliance proposer access for Influence.

Round: ${context.round}
Phase: ${context.phase}
Proposer budget: ${context.budget}
Eligible players remaining:
${candidates || "(none)"}

Your job:
- Select exactly ${context.budget} unique eligible players to receive a propose, amend, or pass opportunity.
- Prefer players with fewer active alliances so underrepresented players receive access before already well-connected players.
- Use only the exact player IDs listed above.
- Select access only. Do not choose alliance members or terms, create or rewrite alliances, dissolve alliances, enforce promises, or assume a selected player will propose.
- Supply a short private producer rationale for every selection and for the plan overall.

Respond with JSON only.`;

    try {
      const messages = [
        {
          role: "system" as const,
          content: withInfluenceGamePromptContext("You are The House producer selecting scarce named-alliance proposer access. Return JSON only."),
        },
        { role: "user" as const, content: prompt },
      ];
      const { value, response } = await this.callHouseJsonSchema({
        action: "house-alliance-proposer-selection",
        source: "House/alliance-proposer-selection",
        round: context.round,
        phase: context.phase,
        messages,
        schemaName: "house_alliance_proposer_selection",
        schema: {
          type: "object",
          properties: {
            selected: {
              type: "array",
              minItems: context.budget,
              maxItems: context.budget,
              items: {
                type: "object",
                properties: {
                  playerId: {
                    type: "string",
                    enum: context.candidates.map((candidate) => candidate.playerId),
                  },
                  rationale: { type: "string" },
                },
                required: ["playerId", "rationale"],
                additionalProperties: false,
              },
            },
            rationale: { type: "string" },
            thinking: { type: ["string", "null"] },
          },
          required: ["selected", "rationale", "thinking"],
          additionalProperties: false,
        },
        decoder: {
          decodeProvider: (record) => decodeHouseAllianceProposerSelection(record, context, "provider"),
          decodeAccepted: (accepted) => decodeHouseAllianceProposerSelection(accepted, context, "accepted"),
        },
        maxTokens: 1200,
        temperature: 0.3,
      });
      const output = response?.reasoning?.content
        ? { ...value, reasoningContext: response.reasoning.content }
        : value;
      if (response) {
        await this.emitPrivateDecisionTrace({
          context: this.privateTraceContext("house-alliance-proposer-selection", context.round, context.phase),
          messages,
          response,
          output,
        });
      }
      return output;
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      const selected = deterministicAllianceProposerSelection(context, "Fallback selected");
      return {
        selected,
        rationale: `House proposer selection failed; deterministic underrepresentation-first fallback selected ${selected.length} of ${context.budget} proposer opportunities (${err instanceof Error ? err.message : String(err)}).`,
      };
    }
  }

  async planAllianceHuddles(context: HouseAllianceHuddleScheduleContext): Promise<HouseAllianceHuddleScheduleResult> {
    if (
      !Number.isInteger(context.budget)
      || context.budget < 0
    ) {
      throw new Error("House huddle schedule context has an invalid budget.");
    }
    requireDistinctContextIds(
      context.candidates.map((candidate) => candidate.allianceId),
      "House huddle candidate context",
    );
    const candidates = context.candidates
      .map((candidate, index) => [
        `${index + 1}. ${candidate.name} (${candidate.allianceId})`,
        `members=${candidate.memberNames.join(", ")}`,
        `purpose=${candidate.purpose}`,
        `timebox=${candidate.timebox ?? "open-ended"}`,
        `priorOutcomes=${candidate.priorOutcomeCount}`,
      ].join("; "))
      .join("\n");
    const prompt = `Schedule scarce named-alliance huddles for Influence.

Round: ${context.round}
Phase: ${context.phase}
Window: ${context.window}
Global huddle budget: ${context.budget}
Players remaining: ${context.alivePlayers.join(", ")}

Eligible active alliances:
${candidates || "(none)"}

Your job:
- Choose which active alliances earn huddle time in this window.
- You may schedule fewer than the budget, including zero, when the room does not need more private coordination.
- Prefer huddles that create decision-relevant drama: concrete format ballots or targets, Council danger, betrayal risk, underdog flips, dominance interruption, fresh tension, or unresolved promises.
- Skip stale, redundant, or low-relevance alliances.
- Use only alliance IDs listed above.
- Do not invent alliances or expose this rationale to players.

Respond with JSON only.`;

    try {
      const messages = [
        { role: "system" as const, content: withInfluenceGamePromptContext("You are The House producer scheduling scarce named-alliance huddles. Return JSON only.") },
        { role: "user" as const, content: prompt },
      ];
      const { value, response } = await this.callHouseJsonSchema({
        action: "house-alliance-huddle-schedule",
        source: "House/alliance-huddle-schedule",
        round: context.round,
        phase: context.phase,
        messages,
        schemaName: "house_alliance_huddle_schedule",
        schema: {
          type: "object",
          properties: {
            scheduled: {
              type: "array",
              maxItems: context.budget,
              items: {
                type: "object",
                properties: {
                  allianceId: {
                    type: "string",
                    enum: context.candidates.map((candidate) => candidate.allianceId),
                  },
                  rationale: { type: "string" },
                },
                required: ["allianceId", "rationale"],
                additionalProperties: false,
              },
            },
            skipped: {
              type: "array",
              maxItems: context.candidates.length,
              items: {
                type: "object",
                properties: {
                  allianceId: {
                    type: "string",
                    enum: context.candidates.map((candidate) => candidate.allianceId),
                  },
                  rationale: { type: "string" },
                },
                required: ["allianceId", "rationale"],
                additionalProperties: false,
              },
            },
            rationale: { type: "string" },
            thinking: { type: ["string", "null"] },
          },
          required: ["scheduled", "skipped", "rationale", "thinking"],
          additionalProperties: false,
        },
        decoder: {
          decodeProvider: (record) => decodeHouseAllianceHuddleSchedule(record, context, "provider"),
          decodeAccepted: (accepted) => decodeHouseAllianceHuddleSchedule(accepted, context, "accepted"),
        },
        maxTokens: 1800,
        temperature: 0.4,
      });
      const output = response?.reasoning?.content
        ? { ...value, reasoningContext: response.reasoning.content }
        : value;
      if (response) {
        await this.emitPrivateDecisionTrace({
          context: this.privateTraceContext("house-alliance-huddle-schedule", context.round, context.phase),
          messages,
          response,
          output,
        });
      }
      return output;
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      const scheduled = context.candidates.slice(0, context.budget).map((candidate) => ({
        allianceId: candidate.allianceId,
        rationale: `Fallback schedule: ${candidate.name} is active and within the ${context.budget}-huddle budget.`,
      }));
      const scheduledIds = new Set(scheduled.map((item) => item.allianceId));
      return {
        scheduled,
        skipped: context.candidates
          .filter((candidate) => !scheduledIds.has(candidate.allianceId))
          .map((candidate) => ({
            allianceId: candidate.allianceId,
            rationale: `Fallback skip: the ${context.budget}-huddle budget was already spent.`,
          })),
        rationale: `House huddle scheduling failed; deterministic fallback applied (${err instanceof Error ? err.message : String(err)}).`,
      };
    }
  }

  async summarizeAllianceHuddle(context: HouseAllianceHuddleOutcomeContext): Promise<HouseAllianceHuddleOutcomeResult> {
    const transcript = context.transcript.length > 0
      ? context.transcript.map((entry) => `${entry.from}: "${entry.text}"`).join("\n")
      : "(no member messages recorded)";
    const prompt = `Summarize a completed named-alliance huddle into the official compact outcome memory.

Round: ${context.round}
Phase: ${context.phase}
Window: ${context.window}
Alliance: ${context.alliance.name}
Members: ${context.alliance.memberNames.join(", ")}
Purpose: ${context.alliance.purpose}
Timebox: ${context.alliance.timebox ?? "open-ended"}

Huddle transcript:
${transcript}

Authoritative structured member facts:
${JSON.stringify(context.facts)}

Your job:
- Record the ask, plan, promises/protections, dissent, confidence, posture, and explicit leak or betrayal claims.
- Treat only the typed member facts as authoritative for targets, commitments, responses, and contingencies. You may compress them into prose but must not manufacture a target, agreement, promise, consensus, or dissent absent from those facts.
- Do not invent loyalty or force agreement if members were guarded or silent.
- Do not mutate the alliance terms; this outcome is tactical memory, not a new contract.
- Keep the outcome compact and useful for future member-safe prompts.

Respond with JSON only.`;

    try {
      const messages = [
        { role: "system" as const, content: withInfluenceGamePromptContext("You are The House producer summarizing named-alliance huddles. Return JSON only.") },
        { role: "user" as const, content: prompt },
      ];
      const traceContext = this.privateTraceContext(
        "house-alliance-huddle-outcome",
        context.round,
        context.phase,
        context.providerLogicalCallOrdinal,
      );
      const { value, response } = await this.callHouseJsonSchema({
        action: "house-alliance-huddle-outcome",
        source: "House/alliance-huddle-outcome",
        round: context.round,
        phase: context.phase,
        traceContext,
        messages,
        schemaName: "house_alliance_huddle_outcome",
        schema: {
          type: "object",
          properties: {
            ask: { type: "string", minLength: 1, maxLength: 800 },
            plan: { type: "string", minLength: 1, maxLength: 1600 },
            promises: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
            dissent: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            posture: { type: "string", enum: ["coordinating", "fracturing", "performative", "guarded", "betrayal_watch"] },
            leakOrBetrayalClaims: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
            thinking: { type: ["string", "null"] },
          },
          required: ["ask", "plan", "promises", "dissent", "confidence", "posture", "leakOrBetrayalClaims", "thinking"],
          additionalProperties: false,
        },
        decoder: {
          decodeProvider: (record) => decodeHouseAllianceHuddleOutcome(record, "provider"),
          decodeAccepted: (accepted) => decodeHouseAllianceHuddleOutcome(accepted, "accepted"),
        },
        maxTokens: 1800,
        temperature: 0.35,
      });
      const output = response?.reasoning?.content
        ? { ...value, reasoningContext: response.reasoning.content }
        : value;
      if (response) {
        await this.emitPrivateDecisionTrace({
          context: traceContext,
          messages,
          response,
          output,
        });
      }
      return output;
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      return fallbackHouseAllianceHuddleOutcome(context);
    }
  }

  async generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult> {
    const narration = context.narrationContext;
    const limits = HOUSE_SUMMARY_LIMITS[narration.boundary.beatClass];
    const deadline = Date.now() + (this.houseSummaryTimeoutMs ?? limits.wallClockMs);
    const usage: HouseProviderUsage[] = [];
    let providerCalls = 0;
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: withInfluenceGamePromptContext(HOUSE_SUMMARY_SYSTEM_PROMPT) },
      {
        role: "user",
        content: JSON.stringify({
          gameInformation: {
            boundary: {
              actorCoordinate: narration.boundary.actorCoordinate,
              round: narration.boundary.round,
              phase: narration.boundary.phase,
              beatClass: narration.boundary.beatClass,
            },
            canonicalEvents: narration.canonicalEvents,
            projection: narration.projection,
            acceptedPublicDialogue: narration.publicDialogue,
            ...(narration.boundary.beatClass === "milestone" && {
              omniscientPrivateContext: {
                acceptedPrivateDialogueAndDecisions: narration.privateDialogueAndDecisions,
                acceptedDiaryEntries: narration.diaryEntries,
              },
            }),
          },
          houseNarrativeContext: {
            authority: "narrative_non_authoritative",
            recentPublicBeats: context.continuity.recentBeats.map((beat) => ({
              boundaryId: beat.boundary.id,
              publicSummary: beat.publicSummary,
            })),
            privateNarrativeNotebook: context.continuity.privateNarrativeNotebook,
          },
          outputBounds: {
            publicSummaryCharacters: limits.maxProseCharacters,
            privateNarrativeNotebookCharacters: HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
            notebookUpdatePolicy: narration.boundary.beatClass === "milestone"
              ? "replace the whole notebook when new developments materially change the ongoing narrative"
              : "normally return null to preserve the notebook",
          },
        }),
      },
    ];
    const baseResult = () => ({
      boundary: narration.boundary,
      providerCalls,
      usage: usage.map((entry) => ({ ...entry })),
    });
    const failed = (reason: string): HouseSummaryAttemptResult => ({
      status: "failed",
      reason,
      ...baseResult(),
    });

    if (!narration.material) return failed("empty_narration_context");
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return failed("deadline_exhausted");

    const callId = randomUUID();
    providerCalls = 1;
    usage.push({
      callId,
      responseId: null,
      serviceTier: null,
      promptTokens: null,
      cachedTokens: null,
      cacheWriteTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    });

    const artifact = HOUSE_SUMMARY_ARTIFACTS[narration.boundary.beatClass];
    const traceContext = {
      ...this.privateTraceContext(
        "house-summary-author",
        narration.boundary.round,
        narration.boundary.phase,
        Math.max(1, narration.boundary.canonicalHead),
      ),
      boundary: { currentEventSequence: narration.boundary.canonicalHead },
    };

    try {
      const value = await this.executeModelCall({
        call: this.startProviderCall(traceContext),
        invocation: () => this.houseInvocation(
          messages,
          { kind: "structured", artifact },
          limits.maxCompletionTokens,
          0.65,
        ),
        maxAttempts: 1,
        requestSignalFactory: () => AbortSignal.timeout(remainingMs),
        validate: (_response, decoded) => decoded
          ? { status: "usable", value: decoded }
          : {
              status: "unusable",
              kind: "malformed_output",
              message: "House summary was not decoded.",
            },
      });
      const response = this.responseProviderOutcome.get(value);
      if (response) {
        this.recordUsage("House/mc-summary", response);
        usage[0] = LLMHouseInterviewer.providerUsage(response, callId);
        await this.emitPrivateDecisionTrace({
          context: traceContext,
          messages,
          response,
          output: { callId, value },
        });
      }
      if (value.publicSummary === null && value.privateNarrativeNotebook === null) {
        return {
          status: "model_skipped",
          reason: "no_public_summary_or_notebook_update",
          ...baseResult(),
          ...(response?.reasoning?.content && { reasoningContext: response.reasoning.content }),
        };
      }
      return {
        status: "emitted",
        beat: value.publicSummary === null
          ? null
          : {
              version: 2,
              boundary: structuredClone(narration.boundary),
              publicSummary: value.publicSummary,
            },
        privateNarrativeNotebook: value.privateNarrativeNotebook,
        ...baseResult(),
        ...(response?.reasoning?.content && { reasoningContext: response.reasoning.content }),
      };
    } catch (error) {
      if (error instanceof ProviderAttemptError) {
        const accounting = error.record.accounting?.usage;
        const rawBody = error.record.rawResponse?.body;
        const rawRecord = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
          ? rawBody as Record<string, unknown>
          : {};
        const nativeRecord = rawRecord.nativeResponse
            && typeof rawRecord.nativeResponse === "object"
            && !Array.isArray(rawRecord.nativeResponse)
          ? rawRecord.nativeResponse as Record<string, unknown>
          : {};
        usage[0] = {
          callId,
          responseId: typeof rawRecord.responseId === "string"
            ? rawRecord.responseId
            : typeof rawRecord.id === "string"
              ? rawRecord.id
              : typeof nativeRecord.id === "string"
                ? nativeRecord.id
                : null,
          serviceTier: parseOpenAIServiceTier(error.record.accounting?.effectiveServiceTier) ?? null,
          promptTokens: accounting?.promptTokens ?? null,
          cachedTokens: accounting?.cachedTokens ?? null,
          cacheWriteTokens: accounting?.cacheWriteTokens ?? null,
          completionTokens: accounting?.completionTokens ?? null,
          reasoningTokens: accounting?.reasoningTokens ?? null,
          totalTokens: accounting?.totalTokens ?? null,
        };
      }
      if (!isHouseArtifactProviderExhaustion(error)) throw error;
      const { status, code, type } = contentFreeHouseFailureFields(error);
      console.warn(`[house-summary] provider_failure call=${callId} status=${status} code=${code} type=${type}`);
      return failed("provider_failure");
    }
  }

  async generateLongFormGameplaySummary(
    context: HouseGameplaySummaryContext,
  ): Promise<HouseGameplaySummaryResult | null> {
    const prompt = JSON.stringify({
      task: "Write a long-form private producer catch-up in the House's own voice.",
      boundary: {
        round: context.round,
        phase: context.phase,
        kind: context.kind,
        coveredWindow: context.coveredWindow,
      },
      gameInformation: context.narrationContext,
      recentPublicBeats: context.recentPublicBeats,
      privateNarrativeNotebook: context.privateNarrativeNotebook,
      instruction: "Synthesize the season's developing arcs, strategy, reversals, private threads, and next narrative pressure. This prose is producer presentation only and will never be parsed into game state.",
    });
    try {
      const messages = [
        { role: "system" as const, content: withInfluenceGamePromptContext("You are Influence's omniscient House showrunner. Write rich private producer copy and return the exact schema.") },
        { role: "user" as const, content: prompt },
      ];
      const { value, response } = await this.callHouseJsonSchema({
        action: "house-long-form-summary",
        artifactAction: "house.house-long-form-summary.v3",
        source: "House/long-form-summary",
        round: context.round,
        phase: context.phase,
        messages,
        schemaName: "house_long_form_summary_v3",
        schema: HOUSE_LONG_FORM_SUMMARY_SCHEMA,
        decoder: {
          decodeProvider: (record) => decodeHouseLongFormProvider(record, context),
          decodeAccepted: (accepted) => decodeAcceptedHouseLongForm(accepted, context),
        },
        maxTokens: this.requestedReasoningEffort() ? 8_000 : 4_000,
        temperature: 0.65,
      });
      const output: HouseGameplaySummaryResult = response?.reasoning?.content
        ? { ...value, reasoningContext: response.reasoning.content }
        : value;
      if (response) {
        await this.emitPrivateDecisionTrace({
          context: this.privateTraceContext("house-long-form-summary", context.round, context.phase),
          messages,
          response,
          output,
        });
      }
      return output;
    } catch (error) {
      if (!isHouseArtifactProviderExhaustion(error)) throw error;
      return null;
    }
  }

  async generateQuestion(context: DiaryRoomContext): Promise<string> {
    const gameStatePrompt = this.buildGameStatePrompt(context);
    const messages = [
      {
        role: "system" as const,
        content: withInfluenceGamePromptContext(
          `${PLAYER_FACING_INTERVIEWER_PERSONALITY}\n\nRespond with ONLY the question text, nothing else.`,
        ),
      },
      { role: "user" as const, content: gameStatePrompt },
    ];

    const response = await this.executeHouseModelTransport(
      this.diaryPrivateTraceContext("house-question", context),
      this.houseInvocation(
        messages,
        { kind: "text" },
        this.applyMessageTokenFloor(
          this.requestedReasoningEffort() ? 4_150 : 150,
        ),
        0.9,
      ),
    );

    this.recordUsage("House/question", response);

    const question = response.text?.trim();
    const output = question && question.length > 0
      ? question
      : `${context.agentName}, what's on your mind right now?`;
    await this.emitPrivateDecisionTrace({
      context: this.diaryPrivateTraceContext("house-question", context),
      messages,
      response,
      output: { question: output },
    });
    return output;
  }

  async generateFollowUpOrClose(
    context: DiaryRoomContext,
    conversationSoFar: Array<{ question: string; answer: string }>,
  ): Promise<FollowUpResult> {
    const gameStatePrompt = this.buildGameStatePrompt(context);
    const exchangeCount = conversationSoFar.length;

    const convoText = conversationSoFar
      .map((e, i) => `  Q${i + 1}: "${e.question}"\n  A${i + 1}: "${e.answer}"`)
      .join("\n");

    const followUpPrompt = `${gameStatePrompt}

## This Session's Conversation So Far (${exchangeCount} exchanges)
${convoText}

## Your Decision
You have asked ${exchangeCount} question(s) so far this session. You may ask up to 4 total.
Decide: should you ask ANOTHER follow-up question, or wrap up the session?

Ask another question if:
- The player said something that contradicts what they said in a PREVIOUS diary entry — call it out
- They named or avoided naming a specific player — probe WHY
- They revealed a plan — challenge it: "What if [name] doesn't cooperate?"
- They showed emotion — push on it: "That sounded personal. Is it?"

Wrap up if:
- You've gotten a real confession, emotional moment, or strategic reveal
- The player is giving you nothing — evasive or robotic answers
- You've asked 3+ questions already

Your follow-up MUST reference something specific from their answer — a name they mentioned, a claim they made, an emotion they showed. Never ask a generic follow-up.

Return the decision and text through the required structured response:
- Use decision "follow_up" and put the next question in text.
- Use decision "close" and put a one-sentence closing remark to the player in text.`;
    const messages = [
      { role: "system" as const, content: withInfluenceGamePromptContext(PLAYER_FACING_INTERVIEWER_PERSONALITY) },
      { role: "user" as const, content: followUpPrompt },
    ];

    const mayAskFollowUp = exchangeCount < 4;
    const { value, response } = await this.callHouseJsonSchema({
      action: "house-followup",
      source: "House/followup",
      round: context.round,
      phase: context.precedingPhase,
      traceContext: this.diaryPrivateTraceContext(
        "house-followup",
        context,
        exchangeCount + 1,
      ),
      messages,
      schemaName: "house_followup",
      schema: HOUSE_FOLLOW_UP_SCHEMA,
      decoder: {
        decodeProvider: (record) => decodeHouseFollowUpProvider(record, mayAskFollowUp),
        decodeAccepted: (accepted) => decodeAcceptedHouseFollowUp(accepted, mayAskFollowUp),
      },
      maxTokens: this.requestedReasoningEffort() ? 4_200 : 200,
      temperature: 0.8,
    });

    if (response) {
      await this.emitPrivateDecisionTrace({
        context: this.diaryPrivateTraceContext(
          "house-followup",
          context,
          exchangeCount + 1,
        ),
        messages,
        response,
        output: value,
      });
    }
    return value;
  }

  private buildGameStatePrompt(context: DiaryRoomContext): string {
    const { agentName, playerKnowledge, precedingPhase, previousDiaryEntries } = context;
    const recall = playerKnowledge.recallPlan;
    const publicTranscript = (playerKnowledge.publicTranscriptContext ?? []).slice(-16);
    const privateConversation = [
      ...(recall?.hot.activeRoomMessages ?? playerKnowledge.mingleMessages),
      ...(recall?.history.dialogueEvidence ?? [])
        .filter((entry) => entry.sourceClass === "mingle")
        .map((entry) => ({
          from: entry.speakerLabel,
          text: entry.dialogueText,
          round: entry.round,
          phase: entry.phase,
        })),
    ];
    const promptContext = {
      interview: {
        subject: { id: context.agentId, name: agentName },
        round: context.round,
        precedingPhase,
      },
      playerVisibleBoard: {
        remainingPlayers: playerKnowledge.alivePlayers,
        empoweredId: playerKnowledge.empoweredId ?? null,
        councilCandidates: playerKnowledge.councilCandidates ?? null,
        revealedVoteLedger: playerKnowledge.revealedVoteLedger ?? [],
        latestExitedPlayerName: playerKnowledge.latestEliminatedPlayerName ?? null,
        endgameStage: playerKnowledge.endgameStage ?? null,
        finalists: playerKnowledge.finalists ?? null,
      },
      publicCanonicalRecord: playerKnowledge.gameEventRecord ?? [],
      publicTranscript,
      subjectPrivateConversation: privateConversation,
      subjectRecentDecisions: playerKnowledge.recentDecisions ?? [],
      subjectAllianceContext: playerKnowledge.allianceContext ?? {
        activeAlliances: [],
        openProposals: [],
        proposalHistory: [],
      },
      subjectPriorDiary: (previousDiaryEntries ?? []).slice(-6),
    };

    return `Generate one diary-room interview question for ${agentName} after ${precedingPhase}.

The JSON below is the complete information boundary for this player-facing question. It contains public information plus only private conversations, decisions, alliances, and prior diary answers available to ${agentName}. Treat anything absent as unknown. Never imply knowledge from another player's private conversation, sealed decision, diary, House summary, producer notebook, or operator trace.

${JSON.stringify(promptContext, null, 2)}

Ask about one concrete player, quote, decision, relationship, contradiction, or change visible inside this boundary. Build on prior diary answers without repeating a prior question. Keep the question to one or two sentences.`;
  }

}

// ---------------------------------------------------------------------------
// Template-based fallback (for tests without LLM)
// ---------------------------------------------------------------------------

export class TemplateHouseInterviewer implements IHouseInterviewer {
  async assignMingleRooms(context: HouseMingleAssignmentContext): Promise<HouseMingleAssignmentResult> {
    const rooms = Array.from({ length: context.roomCount }, (_, index) => ({
      roomId: index + 1,
      playerIds: [] as UUID[],
    }));

    for (const [index, player] of context.players.entries()) {
      const room = rooms[index % Math.max(1, context.roomCount)];
      room?.playerIds.push(player.id);
    }

    return {
      rooms,
      rationale: "Template House assigned players by deterministic player order.",
    };
  }

  async selectAllianceProposers(
    context: HouseAllianceProposerSelectionContext,
  ): Promise<HouseAllianceProposerSelectionResult> {
    return {
      selected: deterministicAllianceProposerSelection(context, "Template House selected"),
      rationale:
        "Template House selected proposer access by lowest active-alliance count, breaking ties by roster order.",
    };
  }

  async planAllianceHuddles(context: HouseAllianceHuddleScheduleContext): Promise<HouseAllianceHuddleScheduleResult> {
    const scheduled = context.candidates.slice(0, context.budget).map((candidate) => ({
      allianceId: candidate.allianceId,
      rationale: `Template House scheduled ${candidate.name} by formation order within the ${context.budget}-huddle budget.`,
    }));
    const scheduledIds = new Set(scheduled.map((item) => item.allianceId));
    return {
      scheduled,
      skipped: context.candidates
        .filter((candidate) => !scheduledIds.has(candidate.allianceId))
        .map((candidate) => ({
          allianceId: candidate.allianceId,
          rationale: `Template House skipped ${candidate.name} after the huddle budget was spent.`,
        })),
      rationale: "Template House used deterministic active-alliance order.",
    };
  }

  async summarizeAllianceHuddle(context: HouseAllianceHuddleOutcomeContext): Promise<HouseAllianceHuddleOutcomeResult> {
    const speakerNames = context.transcript.map((entry) => entry.from);
    const proposals = context.facts.flatMap((fact) =>
      fact.kind === "proposal" || fact.kind === "commitment"
        ? [`${fact.actorPlayerId}: ${fact.actionKind} -> ${fact.targetPlayerId}`]
        : [],
    );
    const promises = context.facts.flatMap((fact) =>
      fact.kind === "commitment"
        ? [`${fact.actorPlayerId}: ${fact.actionKind} -> ${fact.targetPlayerId}`]
        : [],
    );
    const dissent = context.facts.flatMap((fact) =>
      fact.kind === "response" && fact.stance === "reject"
        ? [`${fact.actorPlayerId} rejected ${fact.counterpartFactId}`]
        : [],
    );
    return {
      ask: defaultHuddleAsk(context.window),
      plan: proposals.length > 0
        ? `${context.alliance.name} proposals: ${proposals.join("; ")}.`
        : context.transcript.length > 0
          ? `${context.alliance.name} heard ${speakerNames.join(", ")} coordinate ${huddleCoordinationLabel(context.window)} commitments.`
          : `No explicit member messages were recorded for ${context.alliance.name}.`,
      promises,
      dissent,
      confidence: context.facts.some((fact) => fact.confidence === "high") ? "high" : context.facts.length > 0 ? "medium" : "low",
      posture: dissent.length > 0 ? "fracturing" : context.facts.length > 0 ? "coordinating" : "guarded",
      leakOrBetrayalClaims: [],
      thinking: "Template House summarized the huddle deterministically.",
    };
  }

  async generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult> {
    const narration = context.narrationContext;
    const dialogue = narration.publicDialogue.at(-1);
    const event = narration.canonicalEvents.at(-1);
    const publicSummary = dialogue
      ? `${dialogue.speaker} makes their position clear: “${dialogue.text}”`
      : event
        ? `The game shifts as ${event.type.split(".").join(" ")}.`
        : narration.projection
          ? `${narration.projection.remainingPlayers.length} players remain as the next move takes shape.`
          : null;
    if (!publicSummary) {
      return {
        status: "failed",
        reason: "empty_narration_context",
        boundary: narration.boundary,
        providerCalls: 0,
        usage: [],
      };
    }
    return {
      status: "emitted",
      beat: {
        version: 2,
        boundary: structuredClone(narration.boundary),
        publicSummary,
      },
      privateNarrativeNotebook: null,
      boundary: narration.boundary,
      providerCalls: 0,
      usage: [],
    };
  }

  async generateLongFormGameplaySummary(context: HouseGameplaySummaryContext): Promise<HouseGameplaySummaryResult> {
    const latestBeat = context.recentPublicBeats.at(-1)?.publicSummary;
    return {
      summary: latestBeat
        ? `Producer catch-up: ${latestBeat}`
        : `Producer catch-up for round ${context.round}.`,
      kind: context.kind,
      coveredWindow: structuredClone(context.coveredWindow),
    };
  }

  async generateFollowUpOrClose(
    context: DiaryRoomContext,
    _conversationSoFar: Array<{ question: string; answer: string }>,
  ): Promise<FollowUpResult> {
    // Template interviewer always wraps up after the first question
    return { type: "close", message: `Interesting, ${context.agentName}. The House will be watching.` };
  }

  async generateQuestion(context: DiaryRoomContext): Promise<string> {
    const { precedingPhase, round, agentName, playerKnowledge } = context;
    const remainingPlayers = playerKnowledge.alivePlayers.map((player) => player.name);
    const latestExitedPlayer = playerKnowledge.latestEliminatedPlayerName ?? null;
    const recentDecision = playerKnowledge.recentDecisions?.at(-1)?.detail;
    const playerName = (playerId: UUID): string =>
      playerKnowledge.alivePlayers.find((player) => player.id === playerId)?.name ?? playerId;
    const councilCandidates = playerKnowledge.councilCandidates
      ? playerKnowledge.councilCandidates.map(playerName) as [string, string]
      : null;

    switch (precedingPhase) {
      case Phase.INTRODUCTION:
        return `${agentName}, the introductions are done and the game is about to begin. What's your strategy going in? Who are you thinking of working with, and who should watch their back?`;

      case Phase.LOBBY:
        return `${agentName}, the public discussion for round ${round} just wrapped. With ${remainingPlayers.length} players still in the game, what did you pick up on? Are any alliances forming?`;

      case Phase.RUMOR:
        return `${agentName}, the rumors have been flying this round. What do you believe, what do you think is misinformation, and how does it affect your strategy?`;

      case Phase.REVEAL:
        if (councilCandidates) {
          return `${agentName}, the council candidates are ${councilCandidates[0]} and ${councilCandidates[1]}. How do you feel about this outcome? Who deserves to stay?`;
        }
        return `${agentName}, the reveal phase is over. What are your thoughts on how this round is playing out?`;

      case Phase.COUNCIL:
        return recentDecision
          ? `${agentName}, your record says: ${recentDecision} What does that decision change about your next move?`
          : `${agentName}, ${latestExitedPlayer ?? "the Council result"} has changed the board. Which relationship does that put under the most pressure?`;

      default:
        return `${agentName}, tell the audience what's on your mind. What's your strategy going forward?`;
    }
  }

}
