/**
 * Versioned private player continuity validation for supported checkpoint recovery.
 * Capsules are the only restart authority for private strategy; never invent from
 * transcript prose or operational MemoryStore rows.
 */

import type { Phase, StrategicLens } from "./types";
import {
  PLAYER_CONTINUITY_CAPSULE_VERSION,
  type HouseContinuityCapsule,
  type HouseContinuityRequirement,
  type PlayerContinuityCapsule,
  type PlayerPowerActionMemoryEntry,
  type PlayerRoundHistoryEntry,
  type StrategicDecisionReceipt,
  type StrategicReflectionSummary,
  type StrategyPacketSummary,
} from "./game-runner.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

const STRATEGIC_LENSES = new Set<string>([
  "vote_math",
  "room_traffic",
  "promise_debt",
  "power_position",
  "private_inconsistency",
  "coalition_geometry",
  "information_control",
  "jury_threat",
  "loyalty_stress",
  "retaliation_risk",
  "social_cover",
  "timing_pattern",
  "presentation_read",
  "relationship_repair",
  "broad_read",
]);

function isStrategicLens(value: unknown): value is StrategicLens {
  return typeof value === "string" && STRATEGIC_LENSES.has(value);
}

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && value.length > 0;
}

function isStrategyPacketSummary(value: unknown): value is StrategyPacketSummary {
  if (!isRecord(value)) return false;
  return typeof value.revisionId === "string" &&
    value.revisionId.length > 0 &&
    (value.previousRevisionId === null || typeof value.previousRevisionId === "string") &&
    typeof value.updatedAtRound === "number" &&
    isPhase(value.updatedAtPhase) &&
    typeof value.objective === "string" &&
    typeof value.targetPosture === "string" &&
    typeof value.coalitionPosture === "string" &&
    typeof value.nextSocialProbe === "string" &&
    isStrategicLens(value.strategicLens) &&
    typeof value.strategicLensRationale === "string" &&
    typeof value.uncertainty === "string" &&
    typeof value.reviseTrigger === "string" &&
    typeof value.changedSincePrevious === "string";
}

function isStrategicReflectionSummary(value: unknown): value is StrategicReflectionSummary {
  if (!isRecord(value)) return false;
  return isStringArray(value.certainties) &&
    isStringArray(value.suspicions) &&
    isStringArray(value.allies) &&
    isStringArray(value.threats) &&
    typeof value.plan === "string" &&
    isStrategicLens(value.strategicLens) &&
    typeof value.strategicLensRationale === "string";
}

function isPowerActionMemoryEntry(value: unknown): value is PlayerPowerActionMemoryEntry {
  if (!isRecord(value)) return false;
  return typeof value.round === "number" &&
    (value.action === "eliminate" || value.action === "protect" || value.action === "pass") &&
    typeof value.target === "string";
}

function isRoundHistoryEntry(value: unknown): value is PlayerRoundHistoryEntry {
  if (!isRecord(value) || !isRecord(value.myVotes)) return false;
  return typeof value.round === "number" &&
    typeof value.myVotes.empower === "string" &&
    (value.eliminated === undefined || typeof value.eliminated === "string") &&
    (value.empowered === undefined || typeof value.empowered === "string");
}

function isStrategicDecisionReceipt(value: unknown): value is StrategicDecisionReceipt {
  if (!isRecord(value)) return false;
  return typeof value.round === "number" &&
    isPhase(value.phase) &&
    typeof value.action === "string" &&
    typeof value.label === "string" &&
    typeof value.decisionLog === "string";
}

function hasForbiddenPrivateFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenPrivateFields);
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      lower === "thinking" ||
      lower === "reasoningcontext" ||
      lower === "prompt" ||
      lower === "response" ||
      lower === "rawprompt" ||
      lower === "rawresponse"
    ) {
      return true;
    }
    if (hasForbiddenPrivateFields(child)) return true;
  }
  return false;
}

/**
 * Structural validation for a single versioned player continuity capsule.
 * Does not check roster coverage — use validatePlayerContinuitySetForRecovery for that.
 */
export function parsePlayerContinuityCapsule(value: unknown): PlayerContinuityCapsule | null {
  if (!isRecord(value)) return null;
  if (value.version !== PLAYER_CONTINUITY_CAPSULE_VERSION) return null;
  if (typeof value.playerId !== "string" || value.playerId.length === 0) return null;
  if (typeof value.playerName !== "string" || value.playerName.length === 0) return null;
  if (value.strategyPacket !== null && !isStrategyPacketSummary(value.strategyPacket)) return null;
  if (value.reflectionSummary !== null && !isStrategicReflectionSummary(value.reflectionSummary)) return null;
  if (!Array.isArray(value.notes) || !value.notes.every((note) =>
    isRecord(note) && typeof note.subject === "string" && typeof note.note === "string"
  )) {
    return null;
  }
  if (!isStringArray(value.commitments)) return null;
  if (!isRecord(value.relationships)) return null;
  if (!isStringArray(value.relationships.allies) || !isStringArray(value.relationships.threats)) {
    return null;
  }
  if (!Array.isArray(value.powerActionMemory) || !value.powerActionMemory.every(isPowerActionMemoryEntry)) {
    return null;
  }
  if (!Array.isArray(value.roundHistory) || !value.roundHistory.every(isRoundHistoryEntry)) {
    return null;
  }
  if (
    !Array.isArray(value.recentStrategicDecisions) ||
    !value.recentStrategicDecisions.every(isStrategicDecisionReceipt)
  ) {
    return null;
  }
  if (
    typeof value.strategyPacketRevisionCounter !== "number" ||
    !Number.isInteger(value.strategyPacketRevisionCounter) ||
    value.strategyPacketRevisionCounter < 0
  ) {
    return null;
  }
  if (hasForbiddenPrivateFields(value)) return null;

  return {
    version: PLAYER_CONTINUITY_CAPSULE_VERSION,
    playerId: value.playerId,
    playerName: value.playerName,
    strategyPacket: value.strategyPacket,
    reflectionSummary: value.reflectionSummary,
    notes: value.notes.map((note) => {
      const entry = note as { subject: string; note: string };
      return { subject: entry.subject, note: entry.note };
    }),
    commitments: [...value.commitments],
    relationships: {
      allies: [...value.relationships.allies],
      threats: [...value.relationships.threats],
    },
    powerActionMemory: value.powerActionMemory.map((entry) => ({
      round: entry.round,
      action: entry.action,
      target: entry.target,
    })),
    roundHistory: value.roundHistory.map((entry) => ({
      round: entry.round,
      ...(entry.eliminated !== undefined && { eliminated: entry.eliminated }),
      ...(entry.empowered !== undefined && { empowered: entry.empowered }),
      myVotes: { empower: entry.myVotes.empower },
    })),
    recentStrategicDecisions: value.recentStrategicDecisions.map((receipt) => ({
      round: receipt.round,
      phase: receipt.phase,
      action: receipt.action,
      label: receipt.label,
      decisionLog: receipt.decisionLog,
    })),
    strategyPacketRevisionCounter: value.strategyPacketRevisionCounter,
  };
}

export type PlayerContinuitySetValidation =
  | { ok: true; capsules: PlayerContinuityCapsule[] }
  | { ok: false; reason: string };

/**
 * Fail-closed validation of the complete active-player continuity set for recovery admission.
 */
export function validatePlayerContinuitySetForRecovery(params: {
  capsules: unknown;
  expectedPlayers: ReadonlyArray<{ id: string; name: string }>;
}): PlayerContinuitySetValidation {
  if (!Array.isArray(params.capsules)) {
    return { ok: false, reason: "player_continuity_missing" };
  }
  if (params.capsules.length === 0 && params.expectedPlayers.length > 0) {
    return { ok: false, reason: "player_continuity_missing" };
  }

  const parsed: PlayerContinuityCapsule[] = [];
  const seenIds = new Set<string>();
  for (const raw of params.capsules) {
    if (isRecord(raw) && "version" in raw && raw.version !== PLAYER_CONTINUITY_CAPSULE_VERSION) {
      return { ok: false, reason: "player_continuity_unsupported_version" };
    }
    const capsule = parsePlayerContinuityCapsule(raw);
    if (!capsule) {
      return { ok: false, reason: "player_continuity_malformed" };
    }
    if (seenIds.has(capsule.playerId)) {
      return { ok: false, reason: "player_continuity_duplicate" };
    }
    seenIds.add(capsule.playerId);
    parsed.push(capsule);
  }

  const expectedIds = new Set(params.expectedPlayers.map((player) => player.id));
  if (parsed.length !== expectedIds.size) {
    return { ok: false, reason: "player_continuity_coverage_mismatch" };
  }

  const byId = new Map(params.expectedPlayers.map((player) => [player.id, player]));
  for (const capsule of parsed) {
    const expected = byId.get(capsule.playerId);
    if (!expected) {
      return { ok: false, reason: "player_continuity_extra" };
    }
    if (expected.name !== capsule.playerName) {
      return { ok: false, reason: "player_continuity_identity_mismatch" };
    }
  }

  return { ok: true, capsules: parsed };
}

export function isHouseContinuityRequirement(value: unknown): value is HouseContinuityRequirement {
  return value === "disabled" ||
    value === "awaiting_first_valid_update" ||
    value === "required";
}

export function sealHouseContinuityRequirement(params: {
  bibleEnabled: boolean;
  hasValidHousePacket: boolean;
}): HouseContinuityRequirement {
  if (!params.bibleEnabled) return "disabled";
  if (!params.hasValidHousePacket) return "awaiting_first_valid_update";
  return "required";
}

export function isHouseContinuityCapsuleShape(value: unknown): value is HouseContinuityCapsule {
  return isRecord(value) &&
    typeof value.revisionId === "string" &&
    value.revisionId.length > 0 &&
    (value.previousRevisionId === null || typeof value.previousRevisionId === "string") &&
    typeof value.updatedAtRound === "number" &&
    typeof value.updatedAtPhase === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.alliances) &&
    Array.isArray(value.tensions) &&
    Array.isArray(value.promises) &&
    Array.isArray(value.voteBlocs) &&
    Array.isArray(value.mingleDiscoveries) &&
    Array.isArray(value.playerTrajectories) &&
    Array.isArray(value.storyArcs) &&
    Array.isArray(value.droppedThreads) &&
    Array.isArray(value.openQuestions) &&
    typeof value.changedSincePrevious === "string" &&
    !hasForbiddenPrivateFields(value);
}

export type HouseContinuityAdmission =
  | { ok: true; capsule: HouseContinuityCapsule | null; requirement: HouseContinuityRequirement }
  | { ok: false; reason: string };

/**
 * Admit House continuity for recovery using the sealed checkpoint-time requirement.
 * Legacy checkpoints without a requirement marker keep the historical null-tolerant path
 * only when a valid capsule is present or when null is explicitly allowed by absence of
 * a "required" contract (null accepted for recovery runtime, passport handles diagnostics).
 */
export function admitHouseContinuityForRecovery(params: {
  requirement: unknown;
  capsule: unknown;
}): HouseContinuityAdmission {
  const requirement = isHouseContinuityRequirement(params.requirement)
    ? params.requirement
    : null;

  if (params.capsule != null && !isHouseContinuityCapsuleShape(params.capsule)) {
    return { ok: false, reason: "house_continuity_malformed" };
  }

  const validCapsule = params.capsule != null && isHouseContinuityCapsuleShape(params.capsule)
    ? params.capsule
    : null;

  if (requirement === "required") {
    if (!validCapsule) {
      return { ok: false, reason: "house_continuity_required_missing" };
    }
    return { ok: true, capsule: validCapsule, requirement };
  }

  if (requirement === "disabled" || requirement === "awaiting_first_valid_update") {
    // Optional by contract: null is intentional; a present packet must still be well-formed
    // (malformed already rejected above).
    return {
      ok: true,
      capsule: validCapsule,
      requirement,
    };
  }

  // Legacy: no sealed requirement. Accept valid capsule or intentional null for runtime
  // (passport still distinguishes diagnostic readiness separately).
  return {
    ok: true,
    capsule: validCapsule,
    requirement: validCapsule ? "required" : "disabled",
  };
}
