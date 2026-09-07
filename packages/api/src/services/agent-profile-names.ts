import { HOUSE_AGENT_NAMES } from "@influence/engine";

export function normalizeAgentProfileName(name: string): string {
  return name.trim().toLowerCase();
}

export const RESERVED_AGENT_PROFILE_NAMES: readonly string[] = [
  ...HOUSE_AGENT_NAMES.map(normalizeAgentProfileName),
  "null",
  "undefined",
];

export function isReservedAgentProfileName(name: string): boolean {
  return RESERVED_AGENT_PROFILE_NAMES.includes(normalizeAgentProfileName(name));
}
