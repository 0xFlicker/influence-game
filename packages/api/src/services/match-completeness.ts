/**
 * Match manifest and lane completeness model (U6).
 *
 * One first call reports which authority lanes are readable, how current they
 * are, what to call next, and where divergence exists. Protocol-neutral:
 * domain model does not import MCP tool names or catalog descriptors.
 *
 * Completeness composes already-authorized lane inputs — it never re-runs
 * visibility policy, never repairs one lane from another, and never reads
 * private traces.
 */

import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import {
  getPersistedGameProjection,
  getPersistedGameProjectionBeforeTerminalOutcome,
  type ProjectionReplayStatus,
} from "./game-projection-read-model.js";
import {
  getGameCompletionSettlementSummary,
  type GameCompletionSettlementSummary,
} from "./game-completion-settlement.js";
import {
  buildFinaleIntegrity,
  type DurableRunFinaleIntegrity,
} from "./game-durable-run.js";
import {
  withMatchAccessSnapshot,
  hasPrivateMatchLaneAccess,
  type MatchAccessContext,
} from "./match-access-context.js";
import {
  evaluateTranscriptLaneAccess,
  loadTrustedHuddleSessions,
  type TrustedHuddleSessionLoad,
} from "./transcript-visibility-policy.js";
import {
  readGameTranscriptState,
  type LockedTranscriptState,
} from "./game-transcript-persistence.js";
import {
  isCurrentTranscriptCapture,
  FORMAL_SPEECH_CAPTURE_VERSION,
  TRANSCRIPT_CAPTURE_VERSION,
} from "./transcript-capture.js";
import { COGNITIVE_ARTIFACT_CAPTURE_VERSION } from "./cognitive-artifact-writer.js";
import {
  buildFormalSpeechParity,
  formalSpeechObservationFromTranscriptRow,
  type FormalSpeechParitySnapshot,
  type FormalSpeechTranscriptObservation,
} from "./formal-speech-parity.js";

// ---------------------------------------------------------------------------
// Protocol-neutral follow-up capabilities (U8 maps kinds → tool names)
// ---------------------------------------------------------------------------

/**
 * Abstract follow-up capability kinds. Domain code must not import MCP catalog
 * descriptors; U8 maps these to registered tool constants.
 */
export type MatchFollowUpCapabilityKind =
  | "canonical_events"
  | "canonical_projection"
  | "round_facts"
  | "player_timeline"
  | "postgame_analysis"
  | "agent_alliances"
  | "match_transcript"
  | "owned_match_cognition";

export interface MatchFollowUpCapability {
  kind: MatchFollowUpCapabilityKind;
  /** Human-readable purpose for this follow-up. */
  purpose: string;
  /**
   * Schema-valid abstract starter arguments (game identity, optional filters).
   * Never derived from player/model prose. No MCP tool names.
   */
  starterArguments: MatchFollowUpStarterArguments;
}

/** Closed starter argument bag shared by follow-up capabilities. */
export interface MatchFollowUpStarterArguments {
  gameIdOrSlug: string;
  /** Optional event type filter for canonical event reads. */
  eventType?: string;
  /** Optional phase filter. */
  phase?: string;
  /** Optional round filter. */
  round?: number;
  /** Optional player token (name or id) for player-scoped reads. */
  player?: string;
  /** Optional detail level for postgame. */
  detailLevel?: "brief" | "standard" | "full";
  /** Optional transcript scope filter. */
  scope?: "public" | "system" | "mingle" | "whisper" | "huddle";
  /** Optional cognition artifact type filter. */
  artifactType?: "thinking" | "strategy";
}

// ---------------------------------------------------------------------------
// Lane status vocabulary (stable fields per KTD12 / R35)
// ---------------------------------------------------------------------------

export type MatchLaneAuthority = "canonical_facts" | "transcript" | "cognition";

export type MatchLaneAuthorization =
  | "authorized"
  | "denied"
  | "not_applicable";

export type MatchLaneAvailability =
  | "available"
  | "partial"
  | "unavailable"
  | "denied"
  | "not_applicable";

/**
 * Per-lane completeness. Live lanes use `current` (never `complete`).
 */
export type MatchLaneCompleteness =
  | "complete"
  | "current"
  | "partial"
  | "degraded"
  | "unavailable"
  | "denied"
  | "not_applicable";

/** Overall match watchability (R35) — derived without flattening lanes. */
export type MatchOverallState =
  | "complete"
  | "live_current"
  | "watchable_with_diagnostics"
  | "degraded"
  | "unavailable"
  | "denied";

export interface MatchLaneDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface MatchFactLaneStatus {
  authority: "canonical_facts";
  authorization: MatchLaneAuthorization;
  availability: MatchLaneAvailability;
  completeness: MatchLaneCompleteness;
  captureVersion: null;
  eventLogStatus: "empty" | "complete" | "invalid";
  projectionStatus: ProjectionReplayStatus;
  lastTrustedSequence: number;
  projectionLastSequence: number | null;
  /** Settlement-safe note when terminal settlement is pending. */
  settlementSafeProjection: boolean;
  diagnostics: MatchLaneDiagnostic[];
  followUpCapabilities: MatchFollowUpCapability[];
}

export interface MatchTranscriptLaneStatus {
  authority: "transcript";
  authorization: MatchLaneAuthorization;
  availability: MatchLaneAvailability;
  completeness: MatchLaneCompleteness;
  captureVersion: number;
  /** Live watermark or completed terminal boundary (safe numbers only). */
  readThrough: {
    mode: "live_watermark" | "completed_terminal" | "legacy_terminal" | "none";
    throughEntrySequence: number | null;
    durableEventSequence: number | null;
    terminalState: string | null;
    durableCount: number | null;
    terminalCount: number | null;
  };
  /** Authorized huddle prerequisite health only — never hidden-row counts. */
  huddlePrerequisite: {
    status: "healthy" | "degraded" | "unknown" | "not_applicable" | "denied";
    trustedPrefixHealthy: boolean | null;
    lastTrustedSequence: number | null;
  };
  limitations: Array<{
    code: "legacy_system_dialogue_unclassified";
    message: string;
    scope: "capture_version";
  }>;
  diagnostics: MatchLaneDiagnostic[];
  followUpCapabilities: MatchFollowUpCapability[];
}

export interface MatchCognitionLaneStatus {
  authority: "cognition";
  authorization: MatchLaneAuthorization;
  availability: MatchLaneAvailability;
  completeness: MatchLaneCompleteness;
  captureVersion: number;
  /**
   * Optional overlay: missing cognition never degrades an otherwise watchable
   * match and never exposes non-owned capture counts.
   */
  optional: true;
  diagnostics: MatchLaneDiagnostic[];
  followUpCapabilities: MatchFollowUpCapability[];
}

export interface MatchManifestGameIdentity {
  id: string;
  slug: string;
  status: string;
  transcriptCaptureVersion: number;
  formalSpeechCaptureVersion: number;
  cognitiveArtifactCaptureVersion: number;
}

export interface MatchManifestAccessSummary {
  hasCanonicalAccess: boolean;
  hasParticipatingOwnership: boolean;
  isCreator: boolean;
  /** Owned seat count only — never player IDs (non-enumerating for peers). */
  ownedSeatCount: number;
}

/**
 * Protocol-neutral match-read manifest. U8 maps follow-up capabilities to tools.
 */
export interface MatchManifest {
  schemaVersion: 1;
  game: MatchManifestGameIdentity;
  access: MatchManifestAccessSummary;
  overall: {
    state: MatchOverallState;
    live: boolean;
    summary: string;
  };
  lanes: {
    facts: MatchFactLaneStatus;
    transcript: MatchTranscriptLaneStatus;
    cognition: MatchCognitionLaneStatus;
  };
  /** Cross-lane diagnostic — not a fourth authority. */
  formalSpeechParity: FormalSpeechParitySnapshot;
  /**
   * Existing durable finaleIntegrity diagnostic (Judgment openings/closings).
   * Preserved alongside event-log health; speech gaps do not corrupt the log.
   */
  finaleIntegrity: DurableRunFinaleIntegrity;
  completionSettlement: GameCompletionSettlementSummary;
  /** Flat list of recommended next reads (subset of lane capabilities). */
  nextReads: MatchFollowUpCapability[];
}

export type MatchManifestResult =
  | { ok: true; manifest: MatchManifest }
  | { ok: false; status: "not_accessible"; error: string }
  | { ok: false; status: "invalid_input"; error: string; field?: string };

// ---------------------------------------------------------------------------
// Pure composition inputs (table-driven tests target composeMatchManifest)
// ---------------------------------------------------------------------------

export interface MatchCompletenessComposeInput {
  game: MatchManifestGameIdentity;
  access: MatchManifestAccessSummary;
  eventLog: {
    status: "empty" | "complete" | "invalid";
    lastTrustedSequence: number;
    eventCount: number;
  };
  projection: {
    status: ProjectionReplayStatus;
    lastSequence: number | null;
    settlementSafe: boolean;
  };
  completionSettlement: GameCompletionSettlementSummary;
  transcriptState: LockedTranscriptState | null;
  privateLaneAuthorized: boolean;
  huddlePrerequisite: TrustedHuddleSessionLoad | null;
  formalSpeechParity: FormalSpeechParitySnapshot;
  finaleIntegrity: DurableRunFinaleIntegrity;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Pure composition of the match manifest from already-loaded lane inputs.
 * Prefer this for table-driven unit tests; production uses readMatchManifest.
 */
export function composeMatchManifest(input: MatchCompletenessComposeInput): MatchManifest {
  const gameRef = input.game.slug || input.game.id;
  const live = isLiveGameStatus(input.game.status);

  const facts = buildFactLane(input, gameRef);
  const transcript = buildTranscriptLane(input, gameRef);
  const cognition = buildCognitionLane(input, gameRef);

  const overallState = deriveOverallState({
    live,
    privateAuthorized: input.privateLaneAuthorized,
    facts,
    transcript,
    cognition,
    formalSpeechParity: input.formalSpeechParity,
  });

  const nextReads = collectNextReads({
    facts,
    transcript,
    cognition,
    live,
    gameStatus: input.game.status,
  });

  return {
    schemaVersion: 1,
    game: input.game,
    access: input.access,
    overall: {
      state: overallState,
      live,
      summary: overallSummary(overallState, live),
    },
    lanes: {
      facts,
      transcript,
      cognition,
    },
    formalSpeechParity: input.formalSpeechParity,
    finaleIntegrity: input.finaleIntegrity,
    completionSettlement: input.completionSettlement,
    nextReads,
  };
}

function buildFactLane(
  input: MatchCompletenessComposeInput,
  gameRef: string,
): MatchFactLaneStatus {
  const { eventLog, projection } = input;
  const diagnostics: MatchLaneDiagnostic[] = [];

  if (eventLog.status === "invalid") {
    diagnostics.push({
      code: "event_log_invalid",
      severity: "error",
      message:
        "Canonical event log has an integrity break. Trusted prefix remains usable; " +
        "do not treat transcript prose as board-fact repair.",
    });
  }
  if (projection.status === "failed") {
    diagnostics.push({
      code: "projection_failed",
      severity: "error",
      message: "Projection replay failed. Prefer trusted event prefix and settlement-safe reads.",
    });
  }
  if (projection.settlementSafe) {
    diagnostics.push({
      code: "settlement_safe_projection",
      severity: "info",
      message:
        "Terminal settlement is pending or repair-required; projection excludes unsettled terminal outcomes.",
    });
  }

  let availability: MatchLaneAvailability = "available";
  let completeness: MatchLaneCompleteness = "complete";

  if (eventLog.status === "empty" && eventLog.eventCount === 0) {
    if (isLiveGameStatus(input.game.status)) {
      // Just-started live games may have an empty trusted log; still current through 0.
      availability = "available";
      completeness = "current";
    } else if (input.game.status === "waiting") {
      availability = "not_applicable";
      completeness = "not_applicable";
    } else {
      availability = "unavailable";
      completeness = "unavailable";
    }
  } else if (eventLog.status === "invalid" || projection.status === "failed") {
    availability = "partial";
    completeness = "degraded";
  } else if (isLiveGameStatus(input.game.status)) {
    availability = "available";
    completeness = "current";
  } else if (eventLog.status === "complete" && (projection.status === "complete" || projection.status === "empty")) {
    availability = "available";
    completeness = "complete";
  } else {
    availability = "partial";
    completeness = "partial";
  }

  const followUpCapabilities: MatchFollowUpCapability[] = [];
  if (availability !== "unavailable" && availability !== "not_applicable") {
    followUpCapabilities.push({
      kind: "canonical_events",
      purpose: "Read accepted board-fact events (votes, eliminations, winners, formal speech facts).",
      starterArguments: { gameIdOrSlug: gameRef },
    });
    followUpCapabilities.push({
      kind: "canonical_projection",
      purpose: "Read settlement-safe projection of player status, votes, and accepted outcomes.",
      starterArguments: { gameIdOrSlug: gameRef },
    });
    followUpCapabilities.push({
      kind: "round_facts",
      purpose: "Read revealed round facts for board outcomes without dialogue prose.",
      starterArguments: { gameIdOrSlug: gameRef },
    });
    if (!isLiveGameStatus(input.game.status) && input.game.status === "completed") {
      followUpCapabilities.push({
        kind: "postgame_analysis",
        purpose: "Read compact postgame analysis built from canonical facts.",
        starterArguments: { gameIdOrSlug: gameRef, detailLevel: "standard" },
      });
    }
  }

  return {
    authority: "canonical_facts",
    authorization: input.access.hasCanonicalAccess ? "authorized" : "denied",
    availability: input.access.hasCanonicalAccess ? availability : "denied",
    completeness: input.access.hasCanonicalAccess ? completeness : "denied",
    captureVersion: null,
    eventLogStatus: eventLog.status,
    projectionStatus: projection.status,
    lastTrustedSequence: eventLog.lastTrustedSequence,
    projectionLastSequence: projection.lastSequence,
    settlementSafeProjection: projection.settlementSafe,
    diagnostics,
    followUpCapabilities: input.access.hasCanonicalAccess ? followUpCapabilities : [],
  };
}

function buildTranscriptLane(
  input: MatchCompletenessComposeInput,
  gameRef: string,
): MatchTranscriptLaneStatus {
  if (!input.privateLaneAuthorized) {
    return {
      authority: "transcript",
      authorization: "denied",
      availability: "denied",
      completeness: "denied",
      captureVersion: input.game.transcriptCaptureVersion,
      readThrough: {
        mode: "none",
        throughEntrySequence: null,
        durableEventSequence: null,
        terminalState: null,
        durableCount: null,
        terminalCount: null,
      },
      huddlePrerequisite: {
        status: "denied",
        trustedPrefixHealthy: null,
        lastTrustedSequence: null,
      },
      limitations: [],
      diagnostics: [
        {
          code: "private_lane_denied",
          severity: "info",
          message:
            "Authorized transcript requires participating ownership of at least one seat. " +
            "Creator-only access does not open member-private dialogue.",
        },
      ],
      followUpCapabilities: [],
    };
  }

  const captureVersion = input.game.transcriptCaptureVersion;
  const modern = isCurrentTranscriptCapture(captureVersion);
  const state = input.transcriptState;
  const live = isLiveGameStatus(input.game.status);
  const limitations: MatchTranscriptLaneStatus["limitations"] = [];
  const diagnostics: MatchLaneDiagnostic[] = [];

  if (!modern) {
    limitations.push({
      code: "legacy_system_dialogue_unclassified",
      message:
        "Capture version 0 has no trustworthy system-row safe-kind discriminator; " +
        "all system rows are omitted from the owner transcript without counts.",
      scope: "capture_version",
    });
  }

  // Huddle prerequisite: degrades only authorized huddle coverage, not public dialogue.
  let huddleStatus: MatchTranscriptLaneStatus["huddlePrerequisite"]["status"] = "not_applicable";
  let trustedPrefixHealthy: boolean | null = null;
  let lastTrustedSequence: number | null = null;
  if (input.huddlePrerequisite) {
    trustedPrefixHealthy = input.huddlePrerequisite.trustedPrefixHealthy;
    lastTrustedSequence = input.huddlePrerequisite.lastTrustedSequence;
    if (!input.huddlePrerequisite.trustedPrefixHealthy) {
      huddleStatus = "degraded";
      diagnostics.push({
        code: "huddle_prerequisite_degraded",
        severity: "warning",
        message:
          "Trusted canonical prefix is unhealthy for some huddle sessions. " +
          "Public and Mingle dialogue remain independently readable; " +
          "untrusted huddles fail closed without enumeration.",
      });
    } else {
      huddleStatus = "healthy";
    }
  } else if (modern) {
    huddleStatus = "unknown";
    diagnostics.push({
      code: "huddle_prerequisite_unknown",
      severity: "info",
      message: "Huddle prerequisite health was not loaded for this composition.",
    });
  }

  let availability: MatchLaneAvailability = "available";
  let completeness: MatchLaneCompleteness = "current";
  let readThrough: MatchTranscriptLaneStatus["readThrough"] = {
    mode: "none",
    throughEntrySequence: null,
    durableEventSequence: null,
    terminalState: null,
    durableCount: null,
    terminalCount: null,
  };

  if (modern && state) {
    if (live) {
      readThrough = {
        mode: "live_watermark",
        throughEntrySequence: state.durableSequence,
        durableEventSequence: state.durableEventSequence,
        terminalState: state.terminalState,
        durableCount: state.durableCount,
        terminalCount: state.terminalCount,
      };
      availability = "available";
      completeness = "current";
    } else {
      readThrough = {
        mode: "completed_terminal",
        throughEntrySequence: state.durableSequence,
        durableEventSequence: state.durableEventSequence,
        terminalState: state.terminalState,
        durableCount: state.durableCount,
        terminalCount: state.terminalCount,
      };
      const terminal = state.terminalState;
      if (terminal === "complete") {
        // complete only after terminal count/digest/state agree (sealed by settlement)
        const countsAgree =
          state.terminalCount != null &&
          state.terminalCount === state.durableCount &&
          state.terminalCount === state.durableSequence;
        if (countsAgree && state.terminalDigest === state.prefixDigest) {
          availability = "available";
          completeness = "complete";
        } else {
          availability = "partial";
          completeness = "degraded";
          diagnostics.push({
            code: "terminal_settlement_inconsistent",
            severity: "error",
            message:
              "Terminal transcript state claims complete but count/digest disagree with durable watermark.",
          });
        }
      } else if (terminal === "partial" || terminal === "degraded") {
        availability = "partial";
        completeness = terminal === "degraded" ? "degraded" : "partial";
        diagnostics.push({
          code: `terminal_${terminal}`,
          severity: "warning",
          message: `Terminal transcript settlement is ${terminal}.`,
        });
      } else if (terminal === "unavailable") {
        availability = "unavailable";
        completeness = "unavailable";
      } else {
        // unset on a completed game
        availability = "partial";
        completeness = "partial";
        diagnostics.push({
          code: "terminal_unset",
          severity: "warning",
          message: "Completed game has unset terminal transcript settlement.",
        });
      }
    }
  } else if (!modern) {
    // Legacy completed: walkable when rows exist; never claim modern completeness.
    if (live) {
      availability = "unavailable";
      completeness = "unavailable";
      diagnostics.push({
        code: "legacy_live_unavailable",
        severity: "warning",
        message: "Legacy capture does not support live watermark completeness claims.",
      });
    } else {
      readThrough = {
        mode: "legacy_terminal",
        throughEntrySequence: null,
        durableEventSequence: null,
        terminalState: null,
        durableCount: null,
        terminalCount: null,
      };
      availability = "available";
      completeness = "partial";
      diagnostics.push({
        code: "legacy_transcript_partial",
        severity: "info",
        message:
          "Capture version 0 transcript is watchable when authorized rows exist, " +
          "with deterministic_approximate ordering and system-row omission.",
      });
    }
  } else {
    // Modern capture but missing state row
    availability = "unavailable";
    completeness = "unavailable";
    diagnostics.push({
      code: "transcript_state_missing",
      severity: "error",
      message: "Current-capture game is missing game_transcript_states row.",
    });
  }

  // Formal-speech missing transcript findings degrade narrative completeness when current capture.
  if (
    modern &&
    input.formalSpeechParity.findings.some((f) => f.code === "missing_transcript") &&
    completeness === "complete"
  ) {
    completeness = "partial";
    availability = "partial";
    diagnostics.push({
      code: "formal_speech_transcript_gap",
      severity: "warning",
      message:
        "Accepted formal speech events lack matching transcript rows; narrative coverage is partial.",
    });
  }

  if (huddleStatus === "degraded" && completeness === "complete") {
    completeness = "partial";
    // Public dialogue still available — availability stays available/partial not unavailable.
    if (availability === "available") availability = "partial";
  }

  const followUpCapabilities: MatchFollowUpCapability[] = [];
  if (availability !== "unavailable") {
    followUpCapabilities.push({
      kind: "match_transcript",
      purpose:
        "Page authorized dialogue (public, safe system, Mingle, owned huddles) through the durable boundary.",
      starterArguments: { gameIdOrSlug: gameRef },
    });
    followUpCapabilities.push({
      kind: "agent_alliances",
      purpose: "Drill into owned-agent alliance records and huddle context for a selected player.",
      starterArguments: { gameIdOrSlug: gameRef },
    });
  }

  return {
    authority: "transcript",
    authorization: "authorized",
    availability,
    completeness,
    captureVersion,
    readThrough,
    huddlePrerequisite: {
      status: huddleStatus,
      trustedPrefixHealthy,
      lastTrustedSequence,
    },
    limitations,
    diagnostics,
    followUpCapabilities,
  };
}

function buildCognitionLane(
  input: MatchCompletenessComposeInput,
  gameRef: string,
): MatchCognitionLaneStatus {
  if (!input.privateLaneAuthorized) {
    return {
      authority: "cognition",
      authorization: "denied",
      availability: "denied",
      completeness: "denied",
      captureVersion: input.game.cognitiveArtifactCaptureVersion,
      optional: true,
      diagnostics: [
        {
          code: "private_lane_denied",
          severity: "info",
          message:
            "Owned cognition requires participating ownership. Non-owned thinking/strategy is never enumerated.",
        },
      ],
      followUpCapabilities: [],
    };
  }

  const captureVersion = input.game.cognitiveArtifactCaptureVersion;
  const diagnostics: MatchLaneDiagnostic[] = [];
  let availability: MatchLaneAvailability;
  let completeness: MatchLaneCompleteness;

  if (captureVersion !== COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
    availability = "unavailable";
    completeness = "unavailable";
    diagnostics.push({
      code: "cognition_not_captured",
      severity: "info",
      message:
        "Cognitive artifacts were not captured for this game. Match remains watchable without them.",
    });
  } else if (isLiveGameStatus(input.game.status)) {
    availability = "available";
    completeness = "current";
  } else {
    // Optional: absence of artifacts is not a completeness failure for the match.
    availability = "available";
    completeness = "partial";
    diagnostics.push({
      code: "cognition_optional",
      severity: "info",
      message:
        "Owned thinking/strategy is optional. Empty results mean no owned artifacts, not non-owned presence.",
    });
  }

  const followUpCapabilities: MatchFollowUpCapability[] = [];
  if (availability !== "unavailable") {
    followUpCapabilities.push({
      kind: "owned_match_cognition",
      purpose:
        "Page owned-agent thinking and strategy artifacts only (never non-owned cognition).",
      starterArguments: { gameIdOrSlug: gameRef },
    });
  }

  return {
    authority: "cognition",
    authorization: "authorized",
    availability,
    completeness,
    captureVersion,
    optional: true,
    diagnostics,
    followUpCapabilities,
  };
}

/**
 * Derive R35 overall state without flattening lane objects.
 * Optional cognition never forces overall degraded when facts+transcript are healthy.
 */
export function deriveOverallState(params: {
  live: boolean;
  privateAuthorized: boolean;
  facts: MatchFactLaneStatus;
  transcript: MatchTranscriptLaneStatus;
  cognition: MatchCognitionLaneStatus;
  formalSpeechParity: FormalSpeechParitySnapshot;
}): MatchOverallState {
  const { live, privateAuthorized, facts, transcript, formalSpeechParity } = params;

  // No canonical access should not reach compose, but keep a safe branch.
  if (facts.authorization === "denied" && !privateAuthorized) {
    return "denied";
  }

  // Integrity corruption is fatal; empty/missing facts with a readable transcript
  // remain watchable (Season 0 transcript-first historical games).
  const factsCorrupt =
    facts.eventLogStatus === "invalid" ||
    facts.projectionStatus === "failed" ||
    facts.completeness === "degraded";
  const factsMissing = facts.completeness === "unavailable";

  const transcriptFatal =
    privateAuthorized &&
    (transcript.completeness === "degraded" || transcript.completeness === "unavailable");

  const transcriptWatchable =
    privateAuthorized &&
    (transcript.availability === "available" ||
      transcript.availability === "partial" ||
      transcript.completeness === "partial" ||
      transcript.completeness === "complete" ||
      transcript.completeness === "current");

  const transcriptPartial =
    privateAuthorized &&
    (transcript.completeness === "partial" ||
      transcript.availability === "partial" ||
      transcript.limitations.length > 0 ||
      transcript.huddlePrerequisite.status === "degraded");

  const parityDiagnostic =
    formalSpeechParity.status === "partial" ||
    formalSpeechParity.status === "degraded" ||
    formalSpeechParity.status === "known_legacy_gap";

  const parityDegraded = formalSpeechParity.status === "degraded";

  if ((factsCorrupt || factsMissing) && transcriptFatal) {
    return "unavailable";
  }
  if (factsCorrupt || transcriptFatal || parityDegraded) {
    return "degraded";
  }
  if (factsMissing && transcriptWatchable) {
    return "watchable_with_diagnostics";
  }

  if (live) {
    if (
      facts.completeness === "current" &&
      (!privateAuthorized || transcript.completeness === "current")
    ) {
      if (transcriptPartial || parityDiagnostic || !privateAuthorized) {
        return "watchable_with_diagnostics";
      }
      return "live_current";
    }
    if (transcriptPartial || parityDiagnostic) {
      return "watchable_with_diagnostics";
    }
    return "live_current";
  }

  // Completed / terminal game
  const factsComplete = facts.completeness === "complete" || facts.completeness === "not_applicable";
  const transcriptComplete =
    !privateAuthorized || transcript.completeness === "complete";

  if (factsComplete && transcriptComplete && !parityDiagnostic && privateAuthorized) {
    return "complete";
  }

  // Creator-only completed: facts complete, private denied — watchable with diagnostics
  if (factsComplete && !privateAuthorized) {
    return "watchable_with_diagnostics";
  }

  if (factsComplete && (transcriptPartial || parityDiagnostic || transcript.completeness === "partial")) {
    return "watchable_with_diagnostics";
  }

  if (facts.availability === "unavailable" && transcript.availability === "unavailable") {
    return "unavailable";
  }

  if (transcriptPartial || parityDiagnostic || !factsComplete) {
    return "watchable_with_diagnostics";
  }

  return "watchable_with_diagnostics";
}

function collectNextReads(params: {
  facts: MatchFactLaneStatus;
  transcript: MatchTranscriptLaneStatus;
  cognition: MatchCognitionLaneStatus;
  live: boolean;
  gameStatus: string;
}): MatchFollowUpCapability[] {
  const next: MatchFollowUpCapability[] = [];
  // Prefer transcript first when authorized (guided three-lane load).
  next.push(...params.transcript.followUpCapabilities.filter((c) => c.kind === "match_transcript"));
  next.push(...params.facts.followUpCapabilities.filter((c) => c.kind === "canonical_events"));
  next.push(...params.facts.followUpCapabilities.filter((c) => c.kind === "round_facts"));
  next.push(...params.cognition.followUpCapabilities);
  next.push(...params.transcript.followUpCapabilities.filter((c) => c.kind === "agent_alliances"));
  if (!params.live && params.gameStatus === "completed") {
    next.push(...params.facts.followUpCapabilities.filter((c) => c.kind === "postgame_analysis"));
  }
  // Deduplicate by kind
  const seen = new Set<string>();
  return next.filter((cap) => {
    if (seen.has(cap.kind)) return false;
    seen.add(cap.kind);
    return true;
  });
}

function overallSummary(state: MatchOverallState, live: boolean): string {
  switch (state) {
    case "complete":
      return "Match story is complete across healthy fact and settled transcript lanes. Optional cognition may still be partial.";
    case "live_current":
      return "Live match is current through reported fact/transcript watermarks. Never treat live as complete.";
    case "watchable_with_diagnostics":
      return live
        ? "Match is watchable with non-fatal lane diagnostics. Inspect per-lane status before narrating gaps."
        : "Match is watchable with non-fatal diagnostics (historical gaps, partial transcript, or denied private lanes).";
    case "degraded":
      return "One or more required lanes are degraded. Prefer canonical facts for board outcomes; do not repair lanes from each other.";
    case "unavailable":
      return "Core match lanes are unavailable for this subject.";
    case "denied":
      return "Match read is denied for this subject.";
  }
}

export function isLiveGameStatus(status: string): boolean {
  return status === "in_progress";
}

// ---------------------------------------------------------------------------
// IO: readMatchManifest
// ---------------------------------------------------------------------------

export interface ReadMatchManifestInput {
  gameIdOrSlug: string;
}

export interface ReadMatchManifestOptions {
  subjectUserId: string;
}

/**
 * Load one match-read manifest for an accessible game.
 * Rebuilds MatchAccessContext inside a single ownership snapshot.
 */
export async function readMatchManifest(
  db: DrizzleDB,
  rawInput: unknown,
  options: ReadMatchManifestOptions,
): Promise<MatchManifestResult> {
  const parsed = parseReadMatchManifestInput(rawInput);
  if (!parsed.ok) return parsed;

  return withMatchAccessSnapshot(
    db,
    {
      subjectUserId: options.subjectUserId,
      gameIdOrSlug: parsed.value.gameIdOrSlug,
    },
    async ({ tx, resolution }) => {
      if (resolution.status !== "resolved") {
        return {
          ok: false as const,
          status: "not_accessible" as const,
          error: "Game is not accessible",
        };
      }

      const context = resolution.context;
      const captureFields = await loadCaptureVersions(tx, context.gameId);
      if (!captureFields) {
        return {
          ok: false as const,
          status: "not_accessible" as const,
          error: "Game is not accessible",
        };
      }

      const privateAuthorized = hasPrivateMatchLaneAccess(context);
      const laneAccess = evaluateTranscriptLaneAccess(context);

      const persistedEvents = await getPersistedGameEvents(tx, context.gameId);
      const completionSettlement = await getGameCompletionSettlementSummary(tx, context.gameId);
      const sealedNonfinal =
        completionSettlement.state === "pending" ||
        completionSettlement.state === "repair_required";
      const projection = sealedNonfinal
        ? getPersistedGameProjectionBeforeTerminalOutcome(persistedEvents)
        : getPersistedGameProjection(persistedEvents);

      const transcriptState = isCurrentTranscriptCapture(context.transcriptCaptureVersion)
        ? await readGameTranscriptState(tx, context.gameId)
        : null;

      let huddlePrerequisite: TrustedHuddleSessionLoad | null = null;
      if (privateAuthorized && laneAccess.status === "authorized") {
        huddlePrerequisite = await loadTrustedHuddleSessions(tx, context.gameId);
      }

      const transcriptObservations = privateAuthorized
        ? await loadAuthorizedFormalSpeechTranscriptObservations(tx, context)
        : [];

      const eventPayloads = persistedEvents.events.map((event) => ({
        sequence: event.sequence,
        round: event.envelope.round,
        phase: event.envelope.phase ?? null,
        type: event.envelope.type,
        payload: event.envelope.payload as Record<string, unknown>,
      }));

      const finaleIntegrity = buildFinaleIntegrity(
        eventPayloads.map((e) => ({ type: e.type, payload: e.payload })),
      );

      const formalSpeechParity = buildFormalSpeechParity({
        formalSpeechCaptureVersion: captureFields.formalSpeechCaptureVersion,
        events: eventPayloads,
        transcriptObservations,
        judgmentDetected: finaleIntegrity.judgmentDetected,
      });

      const manifest = composeMatchManifest({
        game: {
          id: context.gameId,
          slug: context.gameSlug,
          status: context.gameStatus,
          transcriptCaptureVersion: context.transcriptCaptureVersion,
          formalSpeechCaptureVersion: captureFields.formalSpeechCaptureVersion,
          cognitiveArtifactCaptureVersion: captureFields.cognitiveArtifactCaptureVersion,
        },
        access: {
          hasCanonicalAccess: context.hasCanonicalAccess,
          hasParticipatingOwnership: context.hasParticipatingOwnership,
          isCreator: context.isCreator,
          ownedSeatCount: context.ownedSeats.length,
        },
        eventLog: {
          status: persistedEvents.status,
          lastTrustedSequence: persistedEvents.lastTrustedSequence,
          eventCount: persistedEvents.eventCount,
        },
        projection: {
          status: projection.status,
          lastSequence: projection.summary?.lastSequence ?? null,
          settlementSafe: sealedNonfinal,
        },
        completionSettlement,
        transcriptState,
        privateLaneAuthorized: privateAuthorized,
        huddlePrerequisite,
        formalSpeechParity,
        finaleIntegrity,
      });

      return { ok: true as const, manifest };
    },
  );
}

function parseReadMatchManifestInput(
  raw: unknown,
): { ok: true; value: ReadMatchManifestInput } | Extract<MatchManifestResult, { ok: false }> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: "invalid_input", error: "Input must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const known = new Set(["gameIdOrSlug"]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      return {
        ok: false,
        status: "invalid_input",
        error: `Unknown field: ${key}`,
        field: key,
      };
    }
  }
  if (typeof obj.gameIdOrSlug !== "string" || obj.gameIdOrSlug.trim().length === 0) {
    return {
      ok: false,
      status: "invalid_input",
      error: "gameIdOrSlug is required",
      field: "gameIdOrSlug",
    };
  }
  if (obj.gameIdOrSlug.length > 128) {
    return {
      ok: false,
      status: "invalid_input",
      error: "gameIdOrSlug exceeds maximum length",
      field: "gameIdOrSlug",
    };
  }
  return { ok: true, value: { gameIdOrSlug: obj.gameIdOrSlug.trim() } };
}

async function loadCaptureVersions(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<{
  formalSpeechCaptureVersion: number;
  cognitiveArtifactCaptureVersion: number;
} | null> {
  const row = (await db
    .select({
      formalSpeechCaptureVersion: schema.games.formalSpeechCaptureVersion,
      cognitiveArtifactCaptureVersion: schema.games.cognitiveArtifactCaptureVersion,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1))[0];
  return row ?? null;
}

/**
 * Load formal-speech transcript observations for authorized public rows only.
 * Does not re-run full visibility policy for all scopes — formal speech is public.
 * Never returns non-authorized private rows.
 */
async function loadAuthorizedFormalSpeechTranscriptObservations(
  db: Pick<DrizzleDB, "select">,
  context: MatchAccessContext,
): Promise<FormalSpeechTranscriptObservation[]> {
  // Formal speech dual-writes as public dialogue. For participating owners, public
  // rows are authorized. Use JSON correlation key presence for modern capture.
  if (!isCurrentTranscriptCapture(context.transcriptCaptureVersion)) {
    // Season 0: no correlation keys; parity reports known_legacy_gap without transcript key matches.
    return [];
  }

  const rows = await db
    .select({
      id: schema.transcripts.id,
      entrySequence: schema.transcripts.entrySequence,
      round: schema.transcripts.round,
      phase: schema.transcripts.phase,
      text: schema.transcripts.text,
      speakerPlayerId: schema.transcripts.speakerPlayerId,
      safeContext: schema.transcripts.safeContext,
      scope: schema.transcripts.scope,
    })
    .from(schema.transcripts)
    .where(
      and(
        eq(schema.transcripts.gameId, context.gameId),
        eq(schema.transcripts.scope, "public"),
        sql`${schema.transcripts.safeContext} IS NOT NULL`,
      ),
    );

  const out: FormalSpeechTranscriptObservation[] = [];
  for (const row of rows) {
    const obs = formalSpeechObservationFromTranscriptRow({
      id: row.id,
      entrySequence: row.entrySequence,
      round: row.round,
      phase: row.phase,
      text: row.text,
      speakerPlayerId: row.speakerPlayerId,
      safeContext: row.safeContext,
    });
    if (obs) out.push(obs);
  }
  return out;
}

/** Exported for tests and durable inspection alignment. */
export {
  FORMAL_SPEECH_CAPTURE_VERSION,
  TRANSCRIPT_CAPTURE_VERSION,
  COGNITIVE_ARTIFACT_CAPTURE_VERSION,
};

/** Re-export parity types for consumers. */
export type {
  FormalSpeechParitySnapshot,
  FormalSpeechParityFinding,
  FormalSpeechParityStatus,
} from "./formal-speech-parity.js";
