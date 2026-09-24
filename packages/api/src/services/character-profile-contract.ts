import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import { isAgentGender, type AgentGender } from "../lib/agent-gender.js";
import {
  isUserSelectableAgentArchetype,
  USER_SELECTABLE_AGENT_ARCHETYPE_KEYS,
} from "./agent-archetypes.js";

export interface GeneratedCharacterProfile {
  name: string; backstory: string; personality: string; strategyStyle: string;
  personaKey: string; gender: AgentGender; performanceInstructions: string; visualDesign: string;
  introQuips: string[];
}
const limits = { ...AGENT_PROFILE_LIMITS, personaKey: 40, gender: 10, visualDesign: 8_000 };

export function characterProfileSchemaFor(allowedPersonaKeys: readonly string[]) {
  if (allowedPersonaKeys.length === 0 || allowedPersonaKeys.some((key) => !isUserSelectableAgentArchetype(key))) {
    throw new Error("Character profile schema requires valid archetype choices");
  }
  const properties = Object.fromEntries(Object.entries(limits).map(([key, maxLength]) => [key, {
    type: "string", minLength: 1, maxLength,
    ...(key === "gender" ? { enum: ["male", "female", "non-binary"] } : {}),
    ...(key === "personaKey" ? { enum: [...allowedPersonaKeys] } : {}),
  }]));
  return {
    type: "object", additionalProperties: false,
    properties: {
      ...properties,
      introQuips: {
        type: "array", minItems: 3, maxItems: 3,
        items: { type: "string", minLength: 1, maxLength: 160 },
      },
    },
    required: [...Object.keys(limits), "introQuips"],
  };
}

export const characterProfileSchema = characterProfileSchemaFor(USER_SELECTABLE_AGENT_ARCHETYPE_KEYS);
/** Exact structured character output. Never infer missing fields from prose. */
export function decodeCharacterProfile(
  content: string,
  allowedPersonaKeys: readonly string[] = USER_SELECTABLE_AGENT_ARCHETYPE_KEYS,
): GeneratedCharacterProfile {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid character profile");
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== Object.keys(limits).length + 1) throw new Error("Invalid character profile fields");
  for (const [field, max] of Object.entries(limits)) {
    const text = fields[field];
    if (typeof text !== "string" || !text.trim() || text.length > max) throw new Error(`Invalid character profile field: ${field}`);
  }
  if (
    !isAgentGender(fields.gender)
    || typeof fields.personaKey !== "string"
    || !allowedPersonaKeys.includes(fields.personaKey)
  ) throw new Error("Invalid character profile identity fields");
  if (!Array.isArray(fields.introQuips) || fields.introQuips.length !== 3
    || fields.introQuips.some((quip) => typeof quip !== "string" || !quip.trim() || quip.length > 160)) {
    throw new Error("Invalid character profile intro quips");
  }
  return fields as unknown as GeneratedCharacterProfile;
}
