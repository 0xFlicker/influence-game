import type { TranscriptEntry } from "@/lib/api";

export const HOUSE_SUMMARY_EXTRA_HOLD_MS = 5000;
export const JURY_OPENING_STATEMENTS_EXTRA_HOLD_MS = 5000;
export const JURY_QUESTIONS_EXTRA_HOLD_MS = JURY_OPENING_STATEMENTS_EXTRA_HOLD_MS;
export const JURY_CLOSING_STATEMENTS_EXTRA_HOLD_MS = JURY_OPENING_STATEMENTS_EXTRA_HOLD_MS;

const HOUSE_SUMMARY_MIN_WORDS = 32;
const HOUSE_SUMMARY_MIN_CHARS = 180;
const LEGACY_HOUSE_MC_PREFIX = "[House MC]";
const CURRENT_HOUSE_SUMMARY_PHASES = new Set(["POWER", "COUNCIL"]);
const JURY_OPENING_STATEMENTS_PHASE = "OPENING_STATEMENTS";
const JURY_QUESTIONS_PHASE = "JURY_QUESTIONS";
const JURY_CLOSING_STATEMENTS_PHASE = "CLOSING_ARGUMENTS";

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isShortHouseSystemAnnouncement(text: string): boolean {
  return /^(?:\*+\s*)?(?:ELIMINATED:|AUTO-ELIMINATE:|Empowered:|Council candidates:|Initial Council pair|Winner determined|GAME OVER|TIE|POWER TOKEN)/i.test(text);
}

export function isHouseSummaryMessage(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): boolean {
  const text = message.text.trim();
  if (message.scope !== "system" || !text) return false;
  if (messageIndex !== sceneMessages.length - 1) return false;
  if (text.startsWith(LEGACY_HOUSE_MC_PREFIX)) return true;
  if (!CURRENT_HOUSE_SUMMARY_PHASES.has(message.phase)) return false;
  if (message.fromPlayerId !== null) return false;
  if (isShortHouseSystemAnnouncement(text)) return false;
  return text.length >= HOUSE_SUMMARY_MIN_CHARS && wordCount(text) >= HOUSE_SUMMARY_MIN_WORDS;
}

export function getHouseSummaryExtraHoldMs(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): number {
  return isHouseSummaryMessage(message, sceneMessages, messageIndex) ? HOUSE_SUMMARY_EXTRA_HOLD_MS : 0;
}

export function isFinalJuryOpeningStatementMessage(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): boolean {
  return isFinalPublicMessageInPhase(message, sceneMessages, messageIndex, JURY_OPENING_STATEMENTS_PHASE);
}

export function getJuryOpeningStatementsExtraHoldMs(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): number {
  return isFinalJuryOpeningStatementMessage(message, sceneMessages, messageIndex)
    ? JURY_OPENING_STATEMENTS_EXTRA_HOLD_MS
    : 0;
}

export function isFinalJuryQuestionAnswerMessage(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): boolean {
  return isFinalPublicMessageInPhase(message, sceneMessages, messageIndex, JURY_QUESTIONS_PHASE);
}

export function getJuryQuestionsExtraHoldMs(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): number {
  return isFinalJuryQuestionAnswerMessage(message, sceneMessages, messageIndex)
    ? JURY_QUESTIONS_EXTRA_HOLD_MS
    : 0;
}

function isFinalPublicMessageInPhase(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
  phase: string,
): boolean {
  return message.phase === phase &&
    message.scope === "public" &&
    messageIndex === sceneMessages.length - 1;
}

export function isFinalJuryClosingStatementMessage(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): boolean {
  return isFinalPublicMessageInPhase(message, sceneMessages, messageIndex, JURY_CLOSING_STATEMENTS_PHASE);
}

export function getJuryClosingStatementsExtraHoldMs(
  message: TranscriptEntry,
  sceneMessages: readonly TranscriptEntry[],
  messageIndex: number,
): number {
  return isFinalJuryClosingStatementMessage(message, sceneMessages, messageIndex)
    ? JURY_CLOSING_STATEMENTS_EXTRA_HOLD_MS
    : 0;
}
