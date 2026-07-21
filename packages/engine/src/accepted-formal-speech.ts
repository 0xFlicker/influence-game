/**
 * Accepted formal endgame / Judgment speech value object.
 *
 * Owns raw accepted public text, provenance, actor, kind, safe counterpart/target,
 * and a deterministic correlation key. Private/cognitive fields are unrepresentable.
 *
 * Judgment continues to use `judgment.speech_recorded`; Reckoning/Tribunal use
 * `endgame.speech_recorded`. Both lanes share this construction path so U6 can
 * normalize parity without fuzzy text matching.
 */

import type {
  CanonicalGameEvent,
  CanonicalSourcePointer,
  EndgameSpeechKind,
  FormalSpeechProvenance,
  JudgmentSpeechKind,
} from "./canonical-events";
import type { GameState } from "./game-state";
import type { TranscriptLogger } from "./transcript-logger";
import type { Phase, UUID } from "./types";
import type { AgentTurnEvent } from "./game-runner.types";

export type { EndgameSpeechKind, FormalSpeechProvenance };

// ---------------------------------------------------------------------------
// Normalized formal-speech vocabulary (exported for U6 parity)
// ---------------------------------------------------------------------------

/** Canonical event type for Judgment accepted public speech. */
export const JUDGMENT_SPEECH_EVENT_TYPE = "judgment.speech_recorded" as const;

/** Canonical event type for Reckoning/Tribunal accepted public speech. */
export const ENDGAME_SPEECH_EVENT_TYPE = "endgame.speech_recorded" as const;

export const JUDGMENT_SPEECH_KINDS = [
  "opening_statement",
  "jury_question",
  "jury_answer",
  "closing_argument",
] as const satisfies readonly JudgmentSpeechKind[];

export const ENDGAME_SPEECH_KINDS = ["plea", "accusation", "defense"] as const satisfies readonly EndgameSpeechKind[];

/** All formal speech kinds that dual-write as accepted public speech facts. */
export const FORMAL_SPEECH_KINDS = [
  ...JUDGMENT_SPEECH_KINDS,
  ...ENDGAME_SPEECH_KINDS,
] as const;

export type FormalSpeechKind = (typeof FORMAL_SPEECH_KINDS)[number];

export type FormalSpeechLane = "judgment" | "endgame";

/** Stable formal-speech vocabulary for API parity (U6). */
export const FORMAL_SPEECH_VOCABULARY = {
  eventTypes: {
    judgment: JUDGMENT_SPEECH_EVENT_TYPE,
    endgame: ENDGAME_SPEECH_EVENT_TYPE,
  },
  lanes: ["judgment", "endgame"] as const satisfies readonly FormalSpeechLane[],
  judgmentKinds: JUDGMENT_SPEECH_KINDS,
  endgameKinds: ENDGAME_SPEECH_KINDS,
  allKinds: FORMAL_SPEECH_KINDS,
  provenances: ["agent", "timeout", "fallback"] as const satisfies readonly FormalSpeechProvenance[],
  /** Capture contract version that expects formal-speech dual-write. */
  currentCaptureVersion: 1 as const,
} as const;

export type FormalSpeechVocabulary = typeof FORMAL_SPEECH_VOCABULARY;

// ---------------------------------------------------------------------------
// AcceptedFormalSpeech value
// ---------------------------------------------------------------------------

/**
 * Immutable accepted public formal speech. Cognitive/private fields cannot be
 * represented on this type (no thinking, strategy, prompts, or traces).
 */
export interface AcceptedFormalSpeech {
  readonly lane: FormalSpeechLane;
  readonly kind: FormalSpeechKind;
  readonly playerId: UUID;
  readonly text: string;
  readonly provenance: FormalSpeechProvenance;
  readonly phase: Phase;
  readonly round: number;
  /**
   * Accusation target (accused). Required when kind is `accusation`.
   * Not used for plea.
   */
  readonly targetId?: UUID;
  /**
   * Safe counterpart: jury addressee, defense accuser, etc.
   * For defense this is the accuser whose accusation is being answered.
   * For jury_question this is the targeted finalist; for jury_answer the juror.
   */
  readonly counterpartId?: UUID;
  /** Deterministic correlation key shared with modern transcript context. */
  readonly correlationKey: string;
}

export interface CreateAcceptedFormalSpeechInput {
  kind: FormalSpeechKind;
  playerId: UUID;
  text: string;
  provenance: FormalSpeechProvenance;
  phase: Phase;
  round: number;
  targetId?: UUID;
  counterpartId?: UUID;
}

function isEndgameSpeechKind(kind: FormalSpeechKind): kind is EndgameSpeechKind {
  return (ENDGAME_SPEECH_KINDS as readonly string[]).includes(kind);
}

function isJudgmentSpeechKind(kind: FormalSpeechKind): kind is JudgmentSpeechKind {
  return (JUDGMENT_SPEECH_KINDS as readonly string[]).includes(kind);
}

export function formalSpeechLaneForKind(kind: FormalSpeechKind): FormalSpeechLane {
  return isEndgameSpeechKind(kind) ? "endgame" : "judgment";
}

/**
 * Build a deterministic correlation key for formal-speech parity.
 * Format: `{lane}:{kind}:r{round}:{phase}:{playerId}[:t{targetId}][:c{counterpartId}]`
 */
export function buildFormalSpeechCorrelationKey(input: {
  kind: FormalSpeechKind;
  playerId: UUID;
  round: number;
  phase: Phase;
  targetId?: UUID;
  counterpartId?: UUID;
}): string {
  const lane = formalSpeechLaneForKind(input.kind);
  const parts = [
    lane,
    input.kind,
    `r${input.round}`,
    String(input.phase),
    input.playerId,
  ];
  if (input.targetId) parts.push(`t${input.targetId}`);
  if (input.counterpartId) parts.push(`c${input.counterpartId}`);
  return parts.join(":");
}

/**
 * Validate and construct an AcceptedFormalSpeech value.
 * Private/cognitive fields are not accepted by this factory.
 */
export function createAcceptedFormalSpeech(
  input: CreateAcceptedFormalSpeechInput,
): AcceptedFormalSpeech {
  const { kind, playerId, text, provenance, phase, round, targetId, counterpartId } = input;

  if (!playerId) {
    throw new Error("createAcceptedFormalSpeech requires playerId");
  }
  if (!(FORMAL_SPEECH_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`createAcceptedFormalSpeech unsupported kind: ${String(kind)}`);
  }
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("createAcceptedFormalSpeech requires non-empty public text");
  }
  if (
    provenance !== "agent" &&
    provenance !== "timeout" &&
    provenance !== "fallback"
  ) {
    throw new Error(`createAcceptedFormalSpeech invalid provenance: ${String(provenance)}`);
  }
  if (!Number.isInteger(round) || round < 0) {
    throw new Error("createAcceptedFormalSpeech requires non-negative integer round");
  }
  if (kind === "accusation" && !targetId) {
    throw new Error("createAcceptedFormalSpeech accusation requires targetId");
  }
  if (kind === "jury_answer" && !counterpartId) {
    throw new Error("createAcceptedFormalSpeech jury_answer requires counterpartId (addressee)");
  }
  if (kind === "jury_question" && !counterpartId) {
    throw new Error("createAcceptedFormalSpeech jury_question requires counterpartId (targeted finalist)");
  }
  if (kind === "defense" && !counterpartId) {
    throw new Error("createAcceptedFormalSpeech defense requires counterpartId (accuser)");
  }

  const lane = formalSpeechLaneForKind(kind);
  const correlationKey = buildFormalSpeechCorrelationKey({
    kind,
    playerId,
    round,
    phase,
    ...(targetId ? { targetId } : {}),
    ...(counterpartId ? { counterpartId } : {}),
  });

  return Object.freeze({
    lane,
    kind,
    playerId,
    text,
    provenance,
    phase,
    round,
    ...(targetId ? { targetId } : {}),
    ...(counterpartId ? { counterpartId } : {}),
    correlationKey,
  });
}

// ---------------------------------------------------------------------------
// Display wrappers (transcript labels; events store raw text)
// ---------------------------------------------------------------------------

export function formalSpeechDisplayText(
  speech: AcceptedFormalSpeech,
  names: { targetName?: string; counterpartName?: string },
): string {
  switch (speech.kind) {
    case "accusation":
      return `[ACCUSES ${names.targetName ?? speech.targetId ?? "unknown"}] ${speech.text}`;
    case "defense":
      return `[DEFENSE] ${speech.text}`;
    case "jury_question":
      return `[QUESTION to ${names.counterpartName ?? speech.counterpartId ?? "unknown"}] ${speech.text}`;
    case "jury_answer":
      return `[ANSWER to ${names.counterpartName ?? speech.counterpartId ?? "unknown"}] ${speech.text}`;
    case "plea":
    case "opening_statement":
    case "closing_argument":
      return speech.text;
  }
}

// ---------------------------------------------------------------------------
// Phase commit helper — dual-write canonical event + transcript + agent turn
// ---------------------------------------------------------------------------

export interface FormalSpeechAgentTurnInput {
  action: string;
  actor: AgentTurnEvent["actor"];
  response: Record<string, unknown>;
  thinking?: string;
  reasoningContext?: string;
  /** Optional thinking/reasoning for transcript row (viewer-only). */
  transcriptThinking?: { thinking?: string; reasoningContext?: string };
}

export interface CommitAcceptedFormalSpeechResult {
  event: CanonicalGameEvent;
  displayText: string;
  correlationKey: string;
}

/**
 * Derive the correct canonical event, transcript display entry, and agent-turn
 * stream emission from an accepted formal speech value.
 *
 * Call order: record canonical → logPublic (with correlation) → emitAgentTurn.
 * Does not embed thinking/strategy into the canonical event payload.
 */
export function commitAcceptedFormalSpeech(
  deps: {
    gameState: GameState;
    logger: TranscriptLogger;
  },
  speech: AcceptedFormalSpeech,
  agentTurn: FormalSpeechAgentTurnInput,
  options?: {
    displayNames?: { targetName?: string; counterpartName?: string };
    sourcePointers?: CanonicalSourcePointer[];
  },
): CommitAcceptedFormalSpeechResult {
  const displayText = formalSpeechDisplayText(speech, options?.displayNames ?? {});
  const sourcePointers = options?.sourcePointers ?? [];

  let event: CanonicalGameEvent;
  if (speech.lane === "endgame" && isEndgameSpeechKind(speech.kind)) {
    event = deps.gameState.recordEndgameSpeech({
      speechKind: speech.kind,
      playerId: speech.playerId,
      text: speech.text,
      provenance: speech.provenance,
      phase: speech.phase,
      correlationKey: speech.correlationKey,
      ...(speech.targetId ? { targetId: speech.targetId } : {}),
      ...(speech.counterpartId ? { counterpartId: speech.counterpartId } : {}),
      sourcePointers,
    });
  } else if (speech.lane === "judgment" && isJudgmentSpeechKind(speech.kind)) {
    event = deps.gameState.recordJudgmentSpeech({
      speechKind: speech.kind,
      playerId: speech.playerId,
      text: speech.text,
      provenance: speech.provenance,
      phase: speech.phase,
      ...(speech.counterpartId ? { addresseeId: speech.counterpartId } : {}),
      sourcePointers,
    });
  } else {
    throw new Error(
      `commitAcceptedFormalSpeech cannot map lane=${speech.lane} kind=${speech.kind}`,
    );
  }

  deps.logger.logPublic(speech.playerId, displayText, speech.phase, {
    ...agentTurn.transcriptThinking,
    dialogueContext: {
      version: 1,
      formalSpeechCorrelationKey: speech.correlationKey,
    },
  });

  deps.logger.emitAgentTurn({
    phase: speech.phase,
    action: agentTurn.action,
    actor: agentTurn.actor,
    visibility: "public",
    response: agentTurn.response,
    ...(agentTurn.thinking ? { thinking: agentTurn.thinking } : {}),
    ...(agentTurn.reasoningContext ? { reasoningContext: agentTurn.reasoningContext } : {}),
    scope: "public",
    text: displayText,
  });

  return {
    event,
    displayText,
    correlationKey: speech.correlationKey,
  };
}
