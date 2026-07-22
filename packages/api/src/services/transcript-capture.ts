/**
 * Versioned transcript / formal-speech capture contract constants and helpers.
 *
 * Capture version 0 = legacy/historical (no product dialogue sequence identity).
 * Capture version 1 = current sequenced dialogue + durable watermark state.
 */

import { schema } from "../db/index.js";

/** Current product dialogue capture version stamped on new custom/free games. */
export const TRANSCRIPT_CAPTURE_VERSION = 1 as const;

/** Current formal endgame speech capture version stamped on new custom/free games. */
export const FORMAL_SPEECH_CAPTURE_VERSION = 1 as const;

/**
 * Genesis prefix digest for an empty product dialogue chain (no rows).
 * Domain-separated SHA-256 of `influence.transcript.prefix.v1:empty`; U2 chains from this predecessor.
 */
export const TRANSCRIPT_PREFIX_DIGEST_EMPTY =
  "sha256:3cd123a6894a89e60cabd3bcc4400a8028a7436d68e3090efc4729f47b24fd13" as const;

export const DIALOGUE_TRANSCRIPT_SCOPES = [
  "public",
  "mingle",
  "huddle",
  "whisper",
  "system",
] as const;

export type DialogueTranscriptScope = (typeof DIALOGUE_TRANSCRIPT_SCOPES)[number];

export const VIEWER_SAFE_DIALOGUE_KINDS = [
  "public_speech",
  "mingle_speech",
  "huddle_speech",
  "whisper_speech",
  "system_phase_banner",
  "system_room_allocation",
  "system_elimination",
  "system_announcement",
] as const;

export type ViewerSafeDialogueKind = (typeof VIEWER_SAFE_DIALOGUE_KINDS)[number];

const VIEWER_SAFE_DIALOGUE_KIND_SET = new Set<string>(VIEWER_SAFE_DIALOGUE_KINDS);
const DIALOGUE_SCOPE_SET = new Set<string>(DIALOGUE_TRANSCRIPT_SCOPES);

export function isDialogueTranscriptScope(scope: string): scope is DialogueTranscriptScope {
  return DIALOGUE_SCOPE_SET.has(scope);
}

export function isViewerSafeDialogueKind(kind: string): kind is ViewerSafeDialogueKind {
  return VIEWER_SAFE_DIALOGUE_KIND_SET.has(kind);
}

export function isCurrentTranscriptCapture(version: number): boolean {
  return version === TRANSCRIPT_CAPTURE_VERSION;
}

/** Insert values for the empty product-transcript state row. */
export function initialGameTranscriptStateValues(
  gameId: string,
  captureVersion: number = TRANSCRIPT_CAPTURE_VERSION,
): typeof schema.gameTranscriptStates.$inferInsert {
  return {
    gameId,
    captureVersion,
    ownerEpoch: null,
    durableEventSequence: 0,
    durableEventHash: null,
    durableSequence: 0,
    durableCount: 0,
    prefixDigest: TRANSCRIPT_PREFIX_DIGEST_EMPTY,
    terminalState: "unset",
    terminalCount: null,
    terminalDigest: null,
    safeDegradationCode: null,
  };
}

/** Values stamped onto newly created custom/free games. */
export function currentCaptureVersionFields(): {
  cognitiveArtifactCaptureVersion: 1;
  transcriptCaptureVersion: typeof TRANSCRIPT_CAPTURE_VERSION;
  formalSpeechCaptureVersion: typeof FORMAL_SPEECH_CAPTURE_VERSION;
} {
  return {
    cognitiveArtifactCaptureVersion: 1,
    transcriptCaptureVersion: TRANSCRIPT_CAPTURE_VERSION,
    formalSpeechCaptureVersion: FORMAL_SPEECH_CAPTURE_VERSION,
  };
}
