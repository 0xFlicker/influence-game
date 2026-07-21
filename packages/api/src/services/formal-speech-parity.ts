/**
 * Formal endgame / Judgment speech parity (U6).
 *
 * Compares accepted public speech facts against authorized transcript coverage.
 * Parity diagnoses only — it never repairs eventLogStatus, never appends rows,
 * and never reads private traces. Domain-neutral: no MCP tool names.
 */

import {
  buildFormalSpeechCorrelationKey,
  FORMAL_SPEECH_VOCABULARY,
  formalSpeechLaneForKind,
  type FormalSpeechKind,
  type FormalSpeechLane,
  type Phase,
} from "@influence/engine";
import { FORMAL_SPEECH_CAPTURE_VERSION } from "./transcript-capture.js";

// ---------------------------------------------------------------------------
// Observation shapes (protocol-neutral)
// ---------------------------------------------------------------------------

export type FormalSpeechParityFindingCode =
  | "missing_event"
  | "missing_transcript"
  | "mismatch"
  | "unknown_prerequisite"
  | "known_legacy_gap";

export type FormalSpeechParitySeverity = "info" | "warning" | "error";

export interface FormalSpeechParityFinding {
  code: FormalSpeechParityFindingCode;
  severity: FormalSpeechParitySeverity;
  message: string;
  /** Safe correlation key when known; never includes raw speech prose. */
  correlationKey?: string;
  lane?: FormalSpeechLane;
  kind?: FormalSpeechKind;
}

export interface FormalSpeechEventObservation {
  correlationKey: string;
  lane: FormalSpeechLane;
  kind: FormalSpeechKind;
  playerId: string;
  /** Accepted public text for mismatch detection only (not returned on findings). */
  text: string;
  phase: string;
  round: number;
  sequence: number;
}

export interface FormalSpeechTranscriptObservation {
  correlationKey: string;
  /** Display / public text for mismatch detection only. */
  text: string;
  phase: string;
  round: number;
  speakerPlayerId: string | null;
  entrySequence: number | null;
  rowId: number;
}

export type FormalSpeechParityPrerequisiteStatus =
  | "applicable"
  | "not_applicable"
  | "unknown"
  | "legacy";

export type FormalSpeechParityStatus =
  | "complete"
  | "partial"
  | "degraded"
  | "not_applicable"
  | "known_legacy_gap";

/**
 * Cross-lane formal-speech parity section for the match manifest.
 * Not a fourth authority — diagnostic only.
 */
export interface FormalSpeechParitySnapshot {
  /** Authority label for this diagnostic section. */
  authority: "formal_speech_parity";
  /** Game formal-speech capture version (0 = Season 0 / legacy). */
  contractVersion: number;
  /** Vocabulary contract this snapshot was built against. */
  vocabularyCaptureVersion: typeof FORMAL_SPEECH_VOCABULARY.currentCaptureVersion;
  prerequisiteStatus: FormalSpeechParityPrerequisiteStatus;
  /**
   * Expected dual-write count when derivable (e.g. Judgment base speeches).
   * Null when expectation is unknown or legacy (never invents counts).
   */
  expectedAuthorizedCount: number | null;
  observedEventCount: number;
  observedTranscriptCount: number;
  findings: FormalSpeechParityFinding[];
  status: FormalSpeechParityStatus;
}

export interface BuildFormalSpeechParityInput {
  formalSpeechCaptureVersion: number;
  /**
   * Trusted canonical events (already validated prefix). Parity does not re-run
   * integrity checks — callers pass the trusted lane result.
   */
  events: ReadonlyArray<{
    sequence: number;
    round: number;
    phase: string | null;
    type: string;
    payload: Record<string, unknown>;
  }>;
  /**
   * Authorized transcript observations that carry formal-speech correlation
   * keys (or legacy public endgame dialogue markers). Completeness never
   * re-runs visibility policy; pass already-authorized rows only.
   */
  transcriptObservations: readonly FormalSpeechTranscriptObservation[];
  /**
   * When true, the game reached a Judgment finale (jury.winner_determined).
   * Used only for expected Judgment base counts on current capture.
   */
  judgmentDetected?: boolean;
}

const FORMAL_SPEECH_KIND_SET = new Set<string>(FORMAL_SPEECH_VOCABULARY.allKinds);

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract formal-speech event observations from trusted canonical events.
 * Reconstructs Judgment correlation keys (events do not store them); uses
 * endgame payload.correlationKey when present.
 */
export function extractFormalSpeechEventObservations(
  events: BuildFormalSpeechParityInput["events"],
): FormalSpeechEventObservation[] {
  const out: FormalSpeechEventObservation[] = [];
  for (const event of events) {
    if (
      event.type !== FORMAL_SPEECH_VOCABULARY.eventTypes.judgment &&
      event.type !== FORMAL_SPEECH_VOCABULARY.eventTypes.endgame
    ) {
      continue;
    }
    const kindRaw = event.payload.speechKind;
    if (typeof kindRaw !== "string" || !FORMAL_SPEECH_KIND_SET.has(kindRaw)) continue;
    const kind = kindRaw as FormalSpeechKind;
    const playerId = typeof event.payload.playerId === "string" ? event.payload.playerId : "";
    if (!playerId) continue;
    const text = typeof event.payload.text === "string" ? event.payload.text : "";
    const phase = event.phase ?? "unknown";
    const round = event.round;
    const lane = formalSpeechLaneForKind(kind);

    let correlationKey: string;
    if (
      event.type === FORMAL_SPEECH_VOCABULARY.eventTypes.endgame &&
      typeof event.payload.correlationKey === "string" &&
      event.payload.correlationKey.length > 0
    ) {
      correlationKey = event.payload.correlationKey;
    } else {
      const targetId =
        typeof event.payload.targetId === "string" ? event.payload.targetId : undefined;
      const counterpartId =
        typeof event.payload.counterpartId === "string"
          ? event.payload.counterpartId
          : typeof event.payload.addresseeId === "string"
            ? event.payload.addresseeId
            : undefined;
      correlationKey = buildFormalSpeechCorrelationKey({
        kind,
        playerId,
        round,
        phase: phase as Phase,
        ...(targetId ? { targetId } : {}),
        ...(counterpartId ? { counterpartId } : {}),
      });
    }

    out.push({
      correlationKey,
      lane,
      kind,
      playerId,
      text,
      phase,
      round,
      sequence: event.sequence,
    });
  }
  return out;
}

/**
 * Build a transcript observation when a row carries a formal-speech correlation key.
 * Returns null when the key is absent (row is ordinary dialogue).
 */
export function formalSpeechObservationFromTranscriptRow(row: {
  id: number;
  entrySequence: number | null;
  round: number;
  phase: string;
  text: string;
  speakerPlayerId: string | null;
  safeContext: { formalSpeechCorrelationKey?: string } | null;
}): FormalSpeechTranscriptObservation | null {
  const key = row.safeContext?.formalSpeechCorrelationKey;
  if (typeof key !== "string" || key.length === 0) return null;
  return {
    correlationKey: key,
    text: row.text,
    phase: row.phase,
    round: row.round,
    speakerPlayerId: row.speakerPlayerId,
    entrySequence: row.entrySequence,
    rowId: row.id,
  };
}

// ---------------------------------------------------------------------------
// Parity composition
// ---------------------------------------------------------------------------

/**
 * Compare formal-speech events with authorized transcript coverage.
 * Season 0 (contractVersion 0): reports known_legacy_gap without inventing counts.
 * Current contract: set-diff on correlation keys; text mismatch when both present.
 */
export function buildFormalSpeechParity(
  input: BuildFormalSpeechParityInput,
): FormalSpeechParitySnapshot {
  const contractVersion = input.formalSpeechCaptureVersion;
  const eventObs = extractFormalSpeechEventObservations(input.events);
  const transcriptObs = input.transcriptObservations;

  // Season 0 / pre-contract: never invent expected counts; report historical gap.
  if (contractVersion < FORMAL_SPEECH_CAPTURE_VERSION) {
    const findings: FormalSpeechParityFinding[] = [
      {
        code: "known_legacy_gap",
        severity: "info",
        message:
          "Formal-speech dual-write was not in the capture contract for this game. " +
          "Authorized transcript dialogue (when present) remains readable; " +
          "missing Judgment/endgame speech events are a historical limitation, not event-log corruption.",
      },
    ];
    // If Judgment was reached but no speech events exist, call out missing event coverage.
    if (input.judgmentDetected && eventObs.length === 0) {
      findings.push({
        code: "missing_event",
        severity: "warning",
        message:
          "Judgment finale detected without formal-speech events (Season 0 / pre-contract capture).",
        lane: "judgment",
      });
    }
    return {
      authority: "formal_speech_parity",
      contractVersion,
      vocabularyCaptureVersion: FORMAL_SPEECH_VOCABULARY.currentCaptureVersion,
      prerequisiteStatus: "legacy",
      expectedAuthorizedCount: null,
      observedEventCount: eventObs.length,
      observedTranscriptCount: transcriptObs.length,
      findings,
      status: "known_legacy_gap",
    };
  }

  // Current capture without Judgment / endgame speech activity.
  if (!input.judgmentDetected && eventObs.length === 0 && transcriptObs.length === 0) {
    return {
      authority: "formal_speech_parity",
      contractVersion,
      vocabularyCaptureVersion: FORMAL_SPEECH_VOCABULARY.currentCaptureVersion,
      prerequisiteStatus: "not_applicable",
      expectedAuthorizedCount: null,
      observedEventCount: 0,
      observedTranscriptCount: 0,
      findings: [],
      status: "not_applicable",
    };
  }

  const findings: FormalSpeechParityFinding[] = [];
  const eventsByKey = new Map<string, FormalSpeechEventObservation>();
  for (const obs of eventObs) {
    // First event wins; duplicates are treated as the same observation for parity.
    if (!eventsByKey.has(obs.correlationKey)) {
      eventsByKey.set(obs.correlationKey, obs);
    }
  }
  const transcriptsByKey = new Map<string, FormalSpeechTranscriptObservation>();
  for (const obs of transcriptObs) {
    if (!transcriptsByKey.has(obs.correlationKey)) {
      transcriptsByKey.set(obs.correlationKey, obs);
    }
  }

  for (const [key, event] of eventsByKey) {
    const transcript = transcriptsByKey.get(key);
    if (!transcript) {
      findings.push({
        code: "missing_transcript",
        severity: "warning",
        message: `Accepted formal speech event has no matching authorized transcript row (${event.lane}:${event.kind}).`,
        correlationKey: key,
        lane: event.lane,
        kind: event.kind,
      });
      continue;
    }
    // Mismatch: both sides present but accepted text diverges.
    // Display wrappers may prefix labels — compare containment or exact equality.
    if (!textsAgree(event.text, transcript.text)) {
      findings.push({
        code: "mismatch",
        severity: "warning",
        message: `Formal speech event text and transcript text disagree for ${event.lane}:${event.kind}.`,
        correlationKey: key,
        lane: event.lane,
        kind: event.kind,
      });
    }
  }

  for (const [key] of transcriptsByKey) {
    if (eventsByKey.has(key)) continue;
    const parsed = parseCorrelationKeyLaneKind(key);
    findings.push({
      code: "missing_event",
      severity: "warning",
      message:
        "Authorized formal-speech transcript row has no matching accepted speech event. " +
        "Dialogue may be narrated; it is not evidence of a board mutation.",
      correlationKey: key,
      ...(parsed?.lane ? { lane: parsed.lane } : {}),
      ...(parsed?.kind ? { kind: parsed.kind } : {}),
    });
  }

  // Judgment base expectation when finale detected: 2 openings + 2 closings.
  let expectedAuthorizedCount: number | null = null;
  if (input.judgmentDetected) {
    const baseExpected = 4;
    // Plus any jury Q/A / endgame speeches observed on either side (variable).
    const variableKeys = new Set<string>();
    for (const obs of eventObs) {
      if (obs.kind !== "opening_statement" && obs.kind !== "closing_argument") {
        variableKeys.add(obs.correlationKey);
      }
    }
    for (const obs of transcriptObs) {
      const parsed = parseCorrelationKeyLaneKind(obs.correlationKey);
      if (
        parsed &&
        parsed.kind !== "opening_statement" &&
        parsed.kind !== "closing_argument"
      ) {
        variableKeys.add(obs.correlationKey);
      }
    }
    expectedAuthorizedCount = baseExpected + variableKeys.size;

    const openingEvents = eventObs.filter((o) => o.kind === "opening_statement").length;
    const closingEvents = eventObs.filter((o) => o.kind === "closing_argument").length;
    if (openingEvents < 2) {
      findings.push({
        code: "missing_event",
        severity: "warning",
        message: `Expected 2 Judgment opening statements but found ${openingEvents}.`,
        lane: "judgment",
        kind: "opening_statement",
      });
    }
    if (closingEvents < 2) {
      findings.push({
        code: "missing_event",
        severity: "warning",
        message: `Expected 2 Judgment closing arguments but found ${closingEvents}.`,
        lane: "judgment",
        kind: "closing_argument",
      });
    }
  } else if (eventObs.length > 0 || transcriptObs.length > 0) {
    // Endgame speech without Judgment winner yet — expectation equals union of observed keys.
    expectedAuthorizedCount = new Set([
      ...eventsByKey.keys(),
      ...transcriptsByKey.keys(),
    ]).size;
  }

  const status = deriveParityStatus(findings, {
    eventCount: eventObs.length,
    transcriptCount: transcriptObs.length,
    judgmentDetected: Boolean(input.judgmentDetected),
  });

  return {
    authority: "formal_speech_parity",
    contractVersion,
    vocabularyCaptureVersion: FORMAL_SPEECH_VOCABULARY.currentCaptureVersion,
    prerequisiteStatus: "applicable",
    expectedAuthorizedCount,
    observedEventCount: eventObs.length,
    observedTranscriptCount: transcriptObs.length,
    findings,
    status,
  };
}

function deriveParityStatus(
  findings: readonly FormalSpeechParityFinding[],
  counts: { eventCount: number; transcriptCount: number; judgmentDetected: boolean },
): FormalSpeechParityStatus {
  if (findings.length === 0) {
    if (counts.eventCount === 0 && counts.transcriptCount === 0 && !counts.judgmentDetected) {
      return "not_applicable";
    }
    return "complete";
  }
  const hasMismatch = findings.some((f) => f.code === "mismatch");
  const hasMissing = findings.some(
    (f) => f.code === "missing_event" || f.code === "missing_transcript",
  );
  if (hasMismatch) return "degraded";
  if (hasMissing) return "partial";
  return "partial";
}

/**
 * Event text is raw accepted speech; transcript may wrap with labels
 * (e.g. "Accusation against X: …"). Agree when equal or one contains the other.
 */
function textsAgree(eventText: string, transcriptText: string): boolean {
  const a = eventText.trim();
  const b = transcriptText.trim();
  if (a === b) return true;
  if (a.length === 0 || b.length === 0) return false;
  return b.includes(a) || a.includes(b);
}

function parseCorrelationKeyLaneKind(
  key: string,
): { lane: FormalSpeechLane; kind: FormalSpeechKind } | null {
  // Format: {lane}:{kind}:r{round}:{phase}:{playerId}...
  const parts = key.split(":");
  if (parts.length < 2) return null;
  const laneRaw = parts[0];
  const kindRaw = parts[1];
  if (laneRaw !== "judgment" && laneRaw !== "endgame") return null;
  if (!kindRaw || !FORMAL_SPEECH_KIND_SET.has(kindRaw)) return null;
  return { lane: laneRaw, kind: kindRaw as FormalSpeechKind };
}

export { FORMAL_SPEECH_VOCABULARY, FORMAL_SPEECH_CAPTURE_VERSION };
