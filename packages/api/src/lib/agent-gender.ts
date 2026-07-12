export const AGENT_GENDER_VALUES = ["male", "female", "non-binary"] as const;

export type AgentGender = typeof AGENT_GENDER_VALUES[number];

export const AGENT_GENDER_LABELS: Record<AgentGender, string> = {
  male: "Male",
  female: "Female",
  "non-binary": "Non-binary",
};

export function isAgentGender(value: unknown): value is AgentGender {
  return typeof value === "string"
    && AGENT_GENDER_VALUES.includes(value as AgentGender);
}
