/**
 * Versioned private player continuity validation for supported checkpoint recovery.
 * Capsules are the only restart authority for private strategy; never invent from
 * transcript prose or operational MemoryStore rows.
 */

import {
  PLAYER_CONTINUITY_CAPSULE_VERSION,
  type PlayerContinuityCapsule,
  type PlayerPowerActionMemoryEntry,
  type PlayerRoundHistoryEntry,
} from "./game-runner.types";
import {
  cloneCompactStrategyState,
  isValidCompactStrategyState,
} from "./strategy-state";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

const POWER_ACTION_MEMORY_KEYS = new Set(["round", "action", "target"]);
const ROUND_HISTORY_KEYS = new Set(["round", "eliminated", "empowered", "myVotes"]);
const VOTE_MEMORY_KEYS = new Set(["empower"]);
const NOTE_KEYS = new Set(["subject", "note"]);
const RELATIONSHIP_KEYS = new Set(["allies", "threats"]);

function isPowerActionMemoryEntry(value: unknown): value is PlayerPowerActionMemoryEntry {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, POWER_ACTION_MEMORY_KEYS) &&
    Number.isInteger(value.round) &&
    (value.round as number) >= 0 &&
    (value.action === "eliminate" || value.action === "protect" || value.action === "pass") &&
    typeof value.target === "string";
}

function isRoundHistoryEntry(value: unknown): value is PlayerRoundHistoryEntry {
  if (!isRecord(value) || !isRecord(value.myVotes)) return false;
  return hasOnlyKeys(value, ROUND_HISTORY_KEYS) &&
    hasOnlyKeys(value.myVotes, VOTE_MEMORY_KEYS) &&
    Number.isInteger(value.round) &&
    (value.round as number) >= 0 &&
    typeof value.myVotes.empower === "string" &&
    (value.eliminated === undefined || typeof value.eliminated === "string") &&
    (value.empowered === undefined || typeof value.empowered === "string");
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
      lower === "rawresponse" ||
      lower === "strategypacket" ||
      lower === "reflectionsummary" ||
      lower === "recentstrategicdecisions" ||
      lower === "strategypacketrevisioncounter" ||
      lower === "strategicevidenceversion" ||
      lower === "decisionlog"
    ) {
      return true;
    }
    if (hasForbiddenPrivateFields(child)) return true;
  }
  return false;
}

const PLAYER_CONTINUITY_KEYS = new Set([
  "version",
  "playerId",
  "playerName",
  "compactStrategy",
  "notes",
  "relationships",
  "powerActionMemory",
  "roundHistory",
]);

function hasOnlyPlayerContinuityKeys(value: Record<string, unknown>): boolean {
  return hasOnlyKeys(value, PLAYER_CONTINUITY_KEYS);
}

/**
 * Structural validation for a single versioned player continuity capsule.
 * Does not check roster coverage — use validatePlayerContinuitySetForRecovery for that.
 */
export function parsePlayerContinuityCapsule(value: unknown): PlayerContinuityCapsule | null {
  if (!isRecord(value)) return null;
  if (value.version !== PLAYER_CONTINUITY_CAPSULE_VERSION) return null;
  if (!hasOnlyPlayerContinuityKeys(value)) return null;
  if (typeof value.playerId !== "string" || value.playerId.length === 0) return null;
  if (typeof value.playerName !== "string" || value.playerName.length === 0) return null;
  if (!isValidCompactStrategyState(value.compactStrategy)) return null;
  if (!Array.isArray(value.notes) || !value.notes.every((note) =>
    isRecord(note)
    && hasOnlyKeys(note, NOTE_KEYS)
    && typeof note.subject === "string"
    && typeof note.note === "string"
  )) {
    return null;
  }
  if (!isRecord(value.relationships)) return null;
  if (!hasOnlyKeys(value.relationships, RELATIONSHIP_KEYS)) return null;
  if (!isStringArray(value.relationships.allies) || !isStringArray(value.relationships.threats)) {
    return null;
  }
  if (!Array.isArray(value.powerActionMemory) || !value.powerActionMemory.every(isPowerActionMemoryEntry)) {
    return null;
  }
  if (!Array.isArray(value.roundHistory) || !value.roundHistory.every(isRoundHistoryEntry)) {
    return null;
  }
  if (hasForbiddenPrivateFields(value)) return null;

  return {
    version: PLAYER_CONTINUITY_CAPSULE_VERSION,
    playerId: value.playerId,
    playerName: value.playerName,
    compactStrategy: cloneCompactStrategyState(value.compactStrategy),
    notes: value.notes.map((note) => {
      const entry = note as { subject: string; note: string };
      return { subject: entry.subject, note: entry.note };
    }),
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
