import type { TranscriptEntry } from "@influence/engine";
import { schema } from "../db/index.js";
import type { TranscriptDialogueKind, TranscriptSafeContext } from "../db/schema.js";
import {
  isCurrentTranscriptCapture,
  isDialogueTranscriptScope,
  isViewerSafeDialogueKind,
  TRANSCRIPT_CAPTURE_VERSION,
} from "./transcript-capture.js";

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
