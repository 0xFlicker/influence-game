import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import { isAgentGender, type AgentGender } from "../lib/agent-gender.js";
import { isUserSelectableAgentArchetype } from "./agent-archetypes.js";

export interface GeneratedCharacterProfile {
  name: string; backstory: string; personality: string; strategyStyle: string;
  personaKey: string; gender: AgentGender; performanceInstructions: string; visualDesign: string;
}
const limits = { ...AGENT_PROFILE_LIMITS, personaKey: 40, gender: 10, visualDesign: 8_000 };
export const characterProfileSchema = {
  type: "object", additionalProperties: false,
  properties: Object.fromEntries(Object.entries(limits).map(([key, maxLength]) => [key, {
    type: "string", minLength: 1, maxLength,
    ...(key === "gender" ? { enum: ["male", "female", "non-binary"] } : {}),
  }])),
  required: Object.keys(limits),
};
/** Exact structured character output. Never infer missing fields from prose. */
export function decodeCharacterProfile(content: string): GeneratedCharacterProfile {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid character profile");
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== Object.keys(limits).length) throw new Error("Invalid character profile fields");
  for (const [field, max] of Object.entries(limits)) {
    const text = fields[field];
    if (typeof text !== "string" || !text.trim() || text.length > max) throw new Error(`Invalid character profile field: ${field}`);
  }
  if (!isAgentGender(fields.gender) || !isUserSelectableAgentArchetype(fields.personaKey)) throw new Error("Invalid character profile identity fields");
  return fields as unknown as GeneratedCharacterProfile;
}
