import { MAX_AGENT_DISPLAY_NAME_LENGTH } from "./agent-profile-management.js";

const GENERATED_AGENT_SURNAMES = [
  "Hartwell", "Langford", "Marlowe", "Sorrell", "Voss", "Ashford", "Bellamy", "Caldwell",
  "Dunmore", "Ellery", "Fairchild", "Grantham", "Hollis", "Iverson", "Kestrel", "Lockwood",
  "Mercer", "North", "Orsini", "Prescott", "Quill", "Rutherford", "Sinclair", "Tallis",
] as const;
export function allocateGeneratedAgentName(
  generatedName: string,
  occupiedNames: Set<string>,
): { name: string; changed: boolean } {
  const requestedName = generatedName.trim().replace(/\s+/g, " ").slice(0, MAX_AGENT_DISPLAY_NAME_LENGTH).trimEnd() || "Agent";
  const normalizedOccupiedNames = new Set(
    [...occupiedNames].map(normalizeAgentProfileName),
  );
  if (hasLastName(requestedName) && !normalizedOccupiedNames.has(normalizeAgentProfileName(requestedName))) {
    return { name: requestedName, changed: false };
  }

  const firstNames = requestedName.split(" ").slice(0, -1).join(" ")
    || requestedName.split(" ")[0]
    || "Agent";
  for (const surname of GENERATED_AGENT_SURNAMES) {
    const candidate = generatedNameCandidate(firstNames, surname);
    if (!normalizedOccupiedNames.has(normalizeAgentProfileName(candidate))) {
      return { name: candidate, changed: true };
    }
  }

  for (let ordinal = 2; ordinal < 10_000; ordinal += 1) {
    const candidate = generatedNameCandidate(firstNames, `${GENERATED_AGENT_SURNAMES[0]} ${ordinal}`);
    if (!normalizedOccupiedNames.has(normalizeAgentProfileName(candidate))) {
      return { name: candidate, changed: true };
    }
  }

  throw new Error("Could not allocate a unique generated agent name");
}

export function updateGeneratedProfileNameReferences<T extends {
  name: string;
  backstory: string | null;
  personality: string;
  strategyStyle: string | null;
}>(profile: T, name: string): T {
  if (profile.name === name) return profile;
  const nameReference = new RegExp(escapeRegExp(profile.name), "gi");
  const replaceName = (value: string | null) => value?.replace(nameReference, name) ?? null;
  return {
    ...profile,
    name,
    backstory: replaceName(profile.backstory),
    personality: replaceName(profile.personality) ?? profile.personality,
    strategyStyle: replaceName(profile.strategyStyle),
  };
}

function hasLastName(name: string): boolean {
  return name.trim().split(/\s+/).length >= 2;
}

function generatedNameCandidate(firstNames: string, surname: string): string {
  const maxFirstNameLength = MAX_AGENT_DISPLAY_NAME_LENGTH - surname.length - 1;
  return `${firstNames.slice(0, maxFirstNameLength).trimEnd() || "Agent"} ${surname}`;
}

function normalizeAgentProfileName(name: string): string {
  return name.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
