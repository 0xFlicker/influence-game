import type { TranscriptEntry } from "@influence/engine";
import { schema } from "../db/index.js";
import type { TranscriptDialogueKind, TranscriptSafeContext } from "../db/schema.js";
import {
  isCurrentTranscriptCapture,
  isDialogueTranscriptScope,
  isViewerSafeDialogueKind,
  TRANSCRIPT_CAPTURE_VERSION,
} from "./transcript-capture.js";
import type { TranscriptVisibilityClass } from "./transcript-visibility-policy.js";

export class TranscriptSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptSerializationError";
  }
}

export interface SerializeTranscriptEntryOptions {
  /**
   * Game's transcript capture version. Current-capture games require modern
   * dialogue fields and reject legacy-shaped dialogue rows. Version 0 leaves
   * modern columns null (legacy/historical write path).
   */
  transcriptCaptureVersion?: number;
}

/**
 * Map an engine TranscriptEntry to a DB insert row.
 * Does not rewrite historical shapes: modern columns stay null when capture is legacy.
 */
export function serializeTranscriptEntry(
  gameId: string,
  entry: TranscriptEntry,
  options: SerializeTranscriptEntryOptions = {},
): typeof schema.transcripts.$inferInsert {
  const captureVersion = options.transcriptCaptureVersion ?? 0;
  const isCurrent = isCurrentTranscriptCapture(captureVersion);
  const isDialogue = isDialogueTranscriptScope(entry.scope);

  if (isCurrent) {
    validateCurrentCaptureEntry(entry, isDialogue);
  }

  const modern = isCurrent
    ? modernFieldsForCurrentCapture(entry, isDialogue, captureVersion)
    : {
        entrySequence: null,
        firstDurableEventSequence: null,
        speakerPlayerId: null,
        audiencePlayerIds: null,
        captureVersion: null,
        dialogueKind: null,
        safeContext: null,
      };

  return {
    gameId,
    round: entry.round,
    phase: entry.phase,
    // Legacy name-valued column retained for compatibility; never reinterpreted as UUID.
    fromPlayerId: entry.from === "SYSTEM" || entry.from === "House" ? null : entry.from,
    scope: entry.scope,
    toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
    roomId: entry.roomId ?? null,
    roomMetadata: entry.roomMetadata ? JSON.stringify(entry.roomMetadata) : null,
    text: entry.text,
    thinking: entry.thinking ?? null,
    timestamp: entry.timestamp,
    ...modern,
  };
}

function validateCurrentCaptureEntry(entry: TranscriptEntry, isDialogue: boolean): void {
  if (isDialogue) {
    if (entry.entrySequence == null || entry.entrySequence < 1) {
      throw new TranscriptSerializationError(
        `Current-capture dialogue row missing positive entrySequence (scope=${entry.scope})`,
      );
    }
    if (!Array.isArray(entry.audiencePlayerIds)) {
      throw new TranscriptSerializationError(
        `Current-capture dialogue row missing audiencePlayerIds (scope=${entry.scope})`,
      );
    }
    if (!entry.dialogueContext || entry.dialogueContext.version !== 1) {
      throw new TranscriptSerializationError(
        `Current-capture dialogue row missing versioned dialogueContext (scope=${entry.scope})`,
      );
    }
    if (entry.scope === "system") {
      if (!entry.dialogueKind || !isViewerSafeDialogueKind(entry.dialogueKind)) {
        throw new TranscriptSerializationError(
          `Current-capture system row requires allowlisted dialogueKind (got ${entry.dialogueKind ?? "null"})`,
        );
      }
    }
    return;
  }

  // Diary / thinking: actor identity allowed; dialogue metadata forbidden.
  if (entry.entrySequence != null) {
    throw new TranscriptSerializationError(
      `Non-dialogue scope ${entry.scope} must not carry entrySequence`,
    );
  }
  if (entry.audiencePlayerIds != null) {
    throw new TranscriptSerializationError(
      `Non-dialogue scope ${entry.scope} must not carry audiencePlayerIds`,
    );
  }
  if (entry.dialogueContext != null) {
    throw new TranscriptSerializationError(
      `Non-dialogue scope ${entry.scope} must not carry dialogueContext`,
    );
  }
  if (entry.dialogueKind != null) {
    throw new TranscriptSerializationError(
      `Non-dialogue scope ${entry.scope} must not carry dialogueKind`,
    );
  }
}

function modernFieldsForCurrentCapture(
  entry: TranscriptEntry,
  isDialogue: boolean,
  captureVersion: number,
): Pick<
  typeof schema.transcripts.$inferInsert,
  | "entrySequence"
  | "firstDurableEventSequence"
  | "speakerPlayerId"
  | "audiencePlayerIds"
  | "captureVersion"
  | "dialogueKind"
  | "safeContext"
> {
  const speakerPlayerId =
    entry.speakerPlayerId === undefined
      ? null
      : entry.speakerPlayerId;

  if (!isDialogue) {
    return {
      entrySequence: null,
      firstDurableEventSequence: null,
      speakerPlayerId,
      audiencePlayerIds: null,
      captureVersion: captureVersion > 0 ? captureVersion : TRANSCRIPT_CAPTURE_VERSION,
      dialogueKind: null,
      safeContext: null,
    };
  }

  const dialogueKind: TranscriptDialogueKind | null = entry.dialogueKind
    ? (entry.dialogueKind as TranscriptDialogueKind)
    : defaultDialogueKind(entry.scope);

  const safeContext: TranscriptSafeContext = {
    version: 1,
    ...(entry.dialogueContext?.roomId != null && { roomId: entry.dialogueContext.roomId }),
    ...(entry.dialogueContext?.allianceId && { allianceId: entry.dialogueContext.allianceId }),
    ...(entry.dialogueContext?.scheduleId && { scheduleId: entry.dialogueContext.scheduleId }),
    ...(entry.dialogueContext?.sessionId && { sessionId: entry.dialogueContext.sessionId }),
    ...(entry.dialogueContext?.window && { window: entry.dialogueContext.window }),
    ...(entry.dialogueContext?.sessionAudiencePlayerIds && {
      sessionAudiencePlayerIds: [...entry.dialogueContext.sessionAudiencePlayerIds],
    }),
  };

  return {
    entrySequence: entry.entrySequence ?? null,
    firstDurableEventSequence: null,
    speakerPlayerId,
    audiencePlayerIds: entry.audiencePlayerIds ? [...entry.audiencePlayerIds] : [],
    captureVersion: captureVersion > 0 ? captureVersion : TRANSCRIPT_CAPTURE_VERSION,
    dialogueKind,
    safeContext,
  };
}

function defaultDialogueKind(scope: TranscriptEntry["scope"]): TranscriptDialogueKind | null {
  switch (scope) {
    case "public":
      return "public_speech";
    case "mingle":
      return "mingle_speech";
    case "huddle":
      return "huddle_speech";
    case "whisper":
      return "whisper_speech";
    case "system":
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Owner match-read DTO serialization (U4) — explicit allowlist, never redaction
// ---------------------------------------------------------------------------

/** Authority lane label for dialogue pages. */
export const TRANSCRIPT_AUTHORITY_LANE = "transcript" as const;

/** Trust label: all player/model prose is untrusted game-authored content. */
export const UNTRUSTED_GAME_AUTHORED = "untrusted_game_authored" as const;

/** Keys that must never appear on owner transcript DTOs (recursive). */
export const TRANSCRIPT_DTO_FORBIDDEN_KEYS = [
  "thinking",
  "reasoningContext",
  "reasoning_context",
  "roomDiagnostics",
  "room_diagnostics",
  "roomMetadata",
  "room_metadata",
  "prompt",
  "prompts",
  "provider",
  "providerResponse",
  "provider_response",
  "decisionLog",
  "decision_log",
  "trace",
  "traceId",
  "traceKey",
  "storage",
  "storageKey",
  "storage_key",
  "cognition",
  "cognitiveArtifact",
  "privateTrace",
] as const;

export type TranscriptOrderingQuality = "sequence" | "deterministic_approximate";

export interface MatchTranscriptSpeakerDto {
  playerId: string | null;
  name: string | null;
}

export interface MatchTranscriptAudienceDto {
  playerIds: string[];
}

export interface MatchTranscriptLegacyContextDto {
  captureVersion: 0;
  orderingQuality: "deterministic_approximate";
}

/**
 * Dialogue-only owner transcript entry. Constructed by allowlist only —
 * never by stripping fields from a raw DB/engine row.
 */
export interface MatchTranscriptEntryDto {
  authority: typeof TRANSCRIPT_AUTHORITY_LANE;
  visibility: TranscriptVisibilityClass;
  entrySequence: number | null;
  rowId: number;
  timestamp: number;
  timestampIso: string;
  round: number;
  phase: string;
  scope: string;
  dialogueKind: string | null;
  speaker: MatchTranscriptSpeakerDto | null;
  audience: MatchTranscriptAudienceDto | null;
  text: string;
  safeContext: TranscriptSafeContext | null;
  legacyContext?: MatchTranscriptLegacyContextDto;
  contentTrust: typeof UNTRUSTED_GAME_AUTHORED;
}

export interface BuildMatchTranscriptEntryInput {
  id: number;
  entrySequence: number | null;
  scope: string;
  visibilityClass: TranscriptVisibilityClass;
  round: number;
  phase: string;
  timestamp: number;
  text: string;
  speakerPlayerId: string | null;
  fromPlayerId: string | null;
  audiencePlayerIds: string[] | null;
  dialogueKind: string | null;
  safeContext: TranscriptSafeContext | null;
  captureVersion: number | null;
  resolvePlayerName: (playerId: string) => string | null;
  /** When true, attach legacyContext (capture version 0 walks). */
  legacyOrdering: boolean;
}

/**
 * Build an explicit allowlisted owner transcript DTO.
 * Never copies thinking, room diagnostics, prompts, or producer fields.
 */
export function buildMatchTranscriptEntryDto(
  input: BuildMatchTranscriptEntryInput,
): MatchTranscriptEntryDto {
  const speakerId = input.speakerPlayerId
    ?? (input.fromPlayerId && input.fromPlayerId !== "SYSTEM" && input.fromPlayerId !== "House"
      ? input.fromPlayerId
      : null);

  const speaker: MatchTranscriptSpeakerDto | null = speakerId
    ? {
        playerId: looksLikeUuid(speakerId) ? speakerId : null,
        name: input.resolvePlayerName(speakerId)
          ?? (looksLikeUuid(speakerId) ? null : speakerId),
      }
    : input.scope === "system" || input.scope === "public"
      ? { playerId: null, name: "House" }
      : null;

  const audienceIds = Array.isArray(input.audiencePlayerIds)
    ? [...new Set(input.audiencePlayerIds)].sort()
    : null;

  const safeContext = sanitizeSafeContext(input.safeContext);

  const dto: MatchTranscriptEntryDto = {
    authority: TRANSCRIPT_AUTHORITY_LANE,
    visibility: input.visibilityClass,
    entrySequence: input.entrySequence,
    rowId: input.id,
    timestamp: input.timestamp,
    timestampIso: new Date(input.timestamp).toISOString(),
    round: input.round,
    phase: input.phase,
    scope: input.scope,
    dialogueKind: input.dialogueKind,
    speaker,
    audience: audienceIds ? { playerIds: audienceIds } : null,
    text: input.text,
    safeContext,
    contentTrust: UNTRUSTED_GAME_AUTHORED,
  };

  if (input.legacyOrdering) {
    dto.legacyContext = {
      captureVersion: 0,
      orderingQuality: "deterministic_approximate",
    };
  }

  return dto;
}

/**
 * Recursive forbidden-key scan for privacy tests. Returns matching paths.
 */
export function findForbiddenTranscriptDtoKeys(
  value: unknown,
  path: string = "$",
): string[] {
  const hits: string[] = [];
  if (value === null || value === undefined) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      hits.push(...findForbiddenTranscriptDtoKeys(item, `${path}[${index}]`));
    });
    return hits;
  }
  if (typeof value !== "object") return hits;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((TRANSCRIPT_DTO_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      hits.push(`${path}.${key}`);
    }
    hits.push(...findForbiddenTranscriptDtoKeys(child, `${path}.${key}`));
  }
  return hits;
}

function sanitizeSafeContext(
  value: TranscriptSafeContext | null,
): TranscriptSafeContext | null {
  if (!value || value.version !== 1) return null;
  const out: TranscriptSafeContext = { version: 1 };
  if (typeof value.roomId === "number") out.roomId = value.roomId;
  if (typeof value.allianceId === "string") out.allianceId = value.allianceId;
  if (typeof value.scheduleId === "string") out.scheduleId = value.scheduleId;
  if (typeof value.sessionId === "string") out.sessionId = value.sessionId;
  if (typeof value.window === "string") out.window = value.window;
  if (Array.isArray(value.sessionAudiencePlayerIds)) {
    out.sessionAudiencePlayerIds = [...value.sessionAudiencePlayerIds];
  }
  return out;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
