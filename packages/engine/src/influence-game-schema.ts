import {resolveInfluenceDecisionContractVersion} from "./influence-decision-speech";

/** Frozen execution/presentation contract. Missing on historical games means v1. */
export type InfluenceGameSchemaVersion = 1 | 2;
export const CURRENT_INFLUENCE_GAME_SCHEMA_VERSION: InfluenceGameSchemaVersion = 2;

export function resolveInfluenceGameSchemaVersion(value: unknown): InfluenceGameSchemaVersion {
  if (value === undefined || value === 1) return 1;
  if (value === 2) return 2;
  throw new Error(`Unsupported Influence game schema version: ${String(value)}`);
}

/** Persisted new-root games must retain the decision contract frozen at creation. */
export function resolveInfluenceGameDecisionVersion(root: unknown, decision: unknown) {
  const version = resolveInfluenceDecisionContractVersion(decision);
  if (resolveInfluenceGameSchemaVersion(root) === 2 && version !== 3) {
    throw new Error("Influence game schema v2 requires decision contract v3");
  }
  return version;
}
