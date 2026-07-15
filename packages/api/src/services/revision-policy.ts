import { sha256StableJson } from "./stable-hash.js";
import {
  INITIAL_COMPETITION_SIGMA,
  type CompetitionRating,
} from "./season-policy.js";

export const REVISION_POLICY_VERSION = "agent-revision-v2";

export type RevisionMagnitude = "none" | "initial" | "small" | "material" | "execution";

export interface EffectiveAgentRuntimeSnapshot {
  name: string;
  personality: string;
  backstory: string | null;
  strategyInstructions: string | null;
  personaKey: string | null;
  model: string;
  providerProfileId: string;
  catalogId: string;
  reasoningPolicy: string | null;
  toolChoiceMode: string | null;
  temperature: number;
}

export interface RevisionDistanceEvidence {
  changedBehaviorFields: string[];
  changedExecutionFields: string[];
  textDistances: Record<string, number>;
  maximumTextDistance: number;
  smallThreshold: number;
  materialThreshold: number;
}

export interface RevisionClassification {
  magnitude: RevisionMagnitude;
  previousFingerprint: string | null;
  nextFingerprint: string;
  evidence: RevisionDistanceEvidence;
  policyVersion: typeof REVISION_POLICY_VERSION;
}

export interface RevisionRecalibration {
  magnitude: RevisionMagnitude;
  before: CompetitionRating;
  after: CompetitionRating;
  varianceAddition: number;
  sigmaCap: number;
  policyVersion: typeof REVISION_POLICY_VERSION;
}

const SMALL_TEXT_DISTANCE = 0.15;
const MATERIAL_TEXT_DISTANCE = 0.35;
const BEHAVIOR_TEXT_FIELDS = ["personality", "backstory", "strategyInstructions"] as const;
const EXECUTION_FIELDS = [
  "model",
  "providerProfileId",
  "catalogId",
  "reasoningPolicy",
  "toolChoiceMode",
  "temperature",
] as const;

export function canonicalizeEffectiveRuntimeSnapshot(
  snapshot: EffectiveAgentRuntimeSnapshot,
): EffectiveAgentRuntimeSnapshot {
  return {
    name: canonicalText(snapshot.name),
    personality: canonicalText(snapshot.personality),
    backstory: canonicalNullableText(snapshot.backstory),
    strategyInstructions: canonicalNullableText(snapshot.strategyInstructions),
    personaKey: canonicalNullableText(snapshot.personaKey),
    model: snapshot.model.trim(),
    providerProfileId: snapshot.providerProfileId.trim(),
    catalogId: snapshot.catalogId.trim(),
    reasoningPolicy: canonicalNullableText(snapshot.reasoningPolicy),
    toolChoiceMode: canonicalNullableText(snapshot.toolChoiceMode),
    temperature: snapshot.temperature,
  };
}

export function fingerprintEffectiveRuntimeSnapshot(
  snapshot: EffectiveAgentRuntimeSnapshot,
): string {
  validateSnapshot(snapshot);
  const canonical = canonicalizeEffectiveRuntimeSnapshot(snapshot);
  return sha256StableJson({
    personality: canonical.personality,
    backstory: canonical.backstory,
    strategyInstructions: canonical.strategyInstructions,
    personaKey: canonical.personaKey,
    model: canonical.model,
    providerProfileId: canonical.providerProfileId,
    catalogId: canonical.catalogId,
    reasoningPolicy: canonical.reasoningPolicy,
    toolChoiceMode: canonical.toolChoiceMode,
    temperature: canonical.temperature,
  });
}

export function classifyRevision(
  previous: EffectiveAgentRuntimeSnapshot | null,
  next: EffectiveAgentRuntimeSnapshot,
): RevisionClassification {
  validateSnapshot(next);
  const nextFingerprint = fingerprintEffectiveRuntimeSnapshot(next);
  if (!previous) {
    return classification("initial", null, nextFingerprint, [], [], {});
  }
  validateSnapshot(previous);
  const previousFingerprint = fingerprintEffectiveRuntimeSnapshot(previous);
  if (previousFingerprint === nextFingerprint) {
    return classification("none", previousFingerprint, nextFingerprint, [], [], {});
  }

  const canonicalPrevious = canonicalizeEffectiveRuntimeSnapshot(previous);
  const canonicalNext = canonicalizeEffectiveRuntimeSnapshot(next);
  const changedExecutionFields = EXECUTION_FIELDS.filter(
    (field) => canonicalPrevious[field] !== canonicalNext[field],
  );
  const changedBehaviorFields: string[] = [];
  const textDistances: Record<string, number> = {};

  for (const field of BEHAVIOR_TEXT_FIELDS) {
    const before = canonicalPrevious[field] ?? "";
    const after = canonicalNext[field] ?? "";
    if (before === after) continue;
    changedBehaviorFields.push(field);
    textDistances[field] = combinedTextDistance(before, after);
  }
  if (canonicalPrevious.personaKey !== canonicalNext.personaKey) {
    changedBehaviorFields.push("personaKey");
  }

  if (changedExecutionFields.length > 0) {
    return classification(
      "execution",
      previousFingerprint,
      nextFingerprint,
      changedBehaviorFields,
      changedExecutionFields,
      textDistances,
    );
  }

  const maximumDistance = maxTextDistance(textDistances);
  const personaChanged = canonicalPrevious.personaKey !== canonicalNext.personaKey;
  const magnitude: RevisionMagnitude = !personaChanged
    && changedBehaviorFields.length === 1
    && maximumDistance < SMALL_TEXT_DISTANCE
    ? "small"
    : "material";
  return classification(
    magnitude,
    previousFingerprint,
    nextFingerprint,
    changedBehaviorFields,
    changedExecutionFields,
    textDistances,
  );
}

export function recalibrateRatingForRevision(
  current: CompetitionRating,
  magnitude: RevisionMagnitude,
): RevisionRecalibration {
  if (!Number.isFinite(current.mu) || !Number.isFinite(current.sigma) || current.sigma <= 0) {
    throw new Error("Current competition rating is invalid");
  }
  const factor = magnitude === "small"
    ? 0.1
    : magnitude === "material"
      ? 0.35
      : magnitude === "execution"
        ? 0.6
        : 0;
  const varianceAddition = (factor * INITIAL_COMPETITION_SIGMA) ** 2;
  const widenedSigma = Math.min(
    INITIAL_COMPETITION_SIGMA,
    Math.sqrt(current.sigma ** 2 + varianceAddition),
  );
  return {
    magnitude,
    before: { ...current },
    after: { mu: current.mu, sigma: widenedSigma },
    varianceAddition,
    sigmaCap: INITIAL_COMPETITION_SIGMA,
    policyVersion: REVISION_POLICY_VERSION,
  };
}

export function combinedTextDistance(left: string, right: string): number {
  const canonicalLeft = canonicalText(left);
  const canonicalRight = canonicalText(right);
  if (canonicalLeft === canonicalRight) return 0;
  const maximumLength = Math.max(canonicalLeft.length, canonicalRight.length);
  const editDistance = maximumLength === 0
    ? 0
    : levenshteinDistance(canonicalLeft, canonicalRight) / maximumLength;
  const tokenDistance = tokenSetDistance(canonicalLeft, canonicalRight);
  return (editDistance + tokenDistance) / 2;
}

function classification(
  magnitude: RevisionMagnitude,
  previousFingerprint: string | null,
  nextFingerprint: string,
  changedBehaviorFields: string[],
  changedExecutionFields: string[],
  textDistances: Record<string, number>,
): RevisionClassification {
  return {
    magnitude,
    previousFingerprint,
    nextFingerprint,
    evidence: {
      changedBehaviorFields,
      changedExecutionFields,
      textDistances,
      maximumTextDistance: maxTextDistance(textDistances),
      smallThreshold: SMALL_TEXT_DISTANCE,
      materialThreshold: MATERIAL_TEXT_DISTANCE,
    },
    policyVersion: REVISION_POLICY_VERSION,
  };
}

function validateSnapshot(snapshot: EffectiveAgentRuntimeSnapshot): void {
  if (!snapshot.name.trim() || !snapshot.personality.trim()) {
    throw new Error("Effective runtime snapshot requires name and personality");
  }
  if (!snapshot.model.trim() || !snapshot.providerProfileId.trim() || !snapshot.catalogId.trim()) {
    throw new Error("Effective runtime snapshot requires resolved execution identity");
  }
  if (!Number.isFinite(snapshot.temperature)) {
    throw new Error("Effective runtime snapshot temperature must be finite");
  }
}

function canonicalText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function canonicalNullableText(value: string | null): string | null {
  if (value === null) return null;
  const canonical = canonicalText(value);
  return canonical || null;
}

function maxTextDistance(distances: Record<string, number>): number {
  const values = Object.values(distances);
  return values.length === 0 ? 0 : Math.max(...values);
}

function tokenSetDistance(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 && rightTokens.size === 0) return 0;
  const union = new Set([...leftTokens, ...rightTokens]);
  let intersectionSize = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersectionSize += 1;
  }
  return 1 - intersectionSize / union.size;
}

function levenshteinDistance(left: string, right: string): number {
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}
