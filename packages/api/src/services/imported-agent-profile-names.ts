import { HOUSE_AGENT_NAMES } from "@influence/engine";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

const MAX_AGENT_PROFILE_NAME_LENGTH = 80;

export interface ImportedAgentProfileNameNamespace {
  existingProfileIds: Set<string>;
  occupiedNames: Set<string>;
}

export async function lockAndLoadImportedAgentProfileNameNamespace(
  tx: DrizzleTransaction,
): Promise<ImportedAgentProfileNameNamespace> {
  await tx.execute(sql`LOCK TABLE agent_profiles IN SHARE ROW EXCLUSIVE MODE`);
  const profiles = await tx
    .select({ id: schema.agentProfiles.id, name: schema.agentProfiles.name })
    .from(schema.agentProfiles);
  return {
    existingProfileIds: new Set(profiles.map((profile) => profile.id)),
    occupiedNames: new Set([
      ...HOUSE_AGENT_NAMES.map(normalizeAgentProfileName),
      ...profiles.map((profile) => normalizeAgentProfileName(profile.name)),
    ]),
  };
}

export function allocateImportedAgentProfileName(
  requestedName: unknown,
  occupiedNames: Set<string>,
): string {
  const baseName = typeof requestedName === "string" && requestedName.trim()
    ? requestedName.trim().slice(0, MAX_AGENT_PROFILE_NAME_LENGTH).trimEnd()
    : "Imported Agent";
  const normalizedBaseName = normalizeAgentProfileName(baseName);
  if (!occupiedNames.has(normalizedBaseName)) {
    occupiedNames.add(normalizedBaseName);
    return baseName;
  }

  for (let ordinal = 2; ordinal <= 3_999; ordinal += 1) {
    const suffix = toRomanNumeral(ordinal);
    const availableBaseLength = MAX_AGENT_PROFILE_NAME_LENGTH - suffix.length - 1;
    const candidateBase = baseName.slice(0, availableBaseLength).trimEnd();
    const candidate = `${candidateBase} ${suffix}`;
    const normalizedCandidate = normalizeAgentProfileName(candidate);
    if (!occupiedNames.has(normalizedCandidate)) {
      occupiedNames.add(normalizedCandidate);
      return candidate;
    }
  }

  throw new Error(`Could not allocate a unique imported agent name for ${baseName}`);
}

function normalizeAgentProfileName(name: string): string {
  return name.trim().toLowerCase();
}

function toRomanNumeral(value: number): string {
  const symbols: ReadonlyArray<readonly [number, string]> = [
    [1_000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [amount, symbol] of symbols) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}
