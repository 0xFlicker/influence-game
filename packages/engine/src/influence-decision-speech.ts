import type { DecisionSchema } from "./model-invocation";
import { speechDraftingGuidance } from "./speech-budget";

/** New games freeze v3; unversioned accepted history spans both earlier contracts. */
export type InfluenceDecisionContractVersion = 1 | 2 | 3;
export const CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION: InfluenceDecisionContractVersion = 3;

export function resolveInfluenceDecisionContractVersion(value: unknown): InfluenceDecisionContractVersion {
  if (value === undefined) return 1;
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error(`Unsupported Influence decision contract version: ${String(value)}`);
}

/** Public delivery is separate from the structured fields that decide the game. */
export const INFLUENCE_BALLOT_ACTIONS = new Set([
  "vote", "empower-revote", "council-vote", "elimination-vote", "endgame-elimination-vote", "reckoning-vote",
  "tribunal-vote", "tribunal-jury-tiebreaker-vote", "jury-vote",
  "format-save-or-eliminate-ballot", "format-vote-bomb-ballot",
  "format-majority-elimination-ballot", "format-even-votes-ballot",
  "format-restricted-history-ballot", "format-two-names-ballot", "format-safety-bounce-vote",
]);
const SPOKEN_ONLY = new Set([...INFLUENCE_BALLOT_ACTIONS, "format-pick", "format-tiebreak", "format-two-names-tiebreak"]);
const THOUGHT_AND_SPOKEN = new Set([
  "format-two-names-initial-names", "format-two-names-override", "format-two-names-replacement", "bounce-pointer",
]);
export function decisionSpeechPolicy(action: string, version: InfluenceDecisionContractVersion = CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION) {
  if (!SPOKEN_ONLY.has(action) && !THOUGHT_AND_SPOKEN.has(action)) return null;
  return { thinking: THOUGHT_AND_SPOKEN.has(action) || (version >= 3 && (action === "format-tiebreak" || action === "format-two-names-tiebreak")), ballot: INFLUENCE_BALLOT_ACTIONS.has(action), maxBytes: INFLUENCE_BALLOT_ACTIONS.has(action) && version < 3 ? 120 : 320 };
}
export function withDecisionSpeech(tool: DecisionSchema, action: string, version: InfluenceDecisionContractVersion = CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION): DecisionSchema {
  const policy = decisionSpeechPolicy(action, version);
  if (!policy) return tool;
  const schema = structuredClone(tool.schema);
  const properties = schema.properties as Record<string, unknown>;
  properties.message = { type: "string", description: policy.ballot
    ? version >= 3
      ? `You are speaking privately to the House. State your vote and briefly explain why, in one sentence or less. Your explanation is sealed from other contestants. At most ${policy.maxBytes} UTF-8 bytes.`
      : "Your VERY SHORT spoken vote, at most 120 UTF-8 bytes. The chosen name alone is enough. No explanation or private reasoning. Sealed until all ballots are collected."
    : `Your short public announcement of this decision, at most 320 UTF-8 bytes. Speak to the players, without revealing private reasoning. ${speechDraftingGuidance(policy.maxBytes)}` };
  if (!policy.thinking) delete properties.thinking;
  else properties.thinking ??= { type: "string", description: "Your private reasoning for this decision." };
  schema.required = [...(schema.required as string[]).filter(key => key !== "message" && (policy.thinking || key !== "thinking")), "message"];
  if (policy.thinking && !(schema.required as string[]).includes("thinking")) (schema.required as string[]).push("thinking");
  return { ...tool, schema };
}
export function validateDecisionSpeech(action: string, value: unknown, version: InfluenceDecisionContractVersion = CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION): string | null {
  const policy = decisionSpeechPolicy(action, version);
  if (!policy) return null;
  if (!value || typeof value !== "object") return "Decision must be an object.";
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || !record.message.trim()) return "message must be non-empty speech.";
  if (new TextEncoder().encode(record.message).length > policy.maxBytes) return `message exceeds ${policy.maxBytes} UTF-8 bytes; shorten it.`;
  if (!policy.thinking && Object.hasOwn(record, "thinking")) return "This decision requests speech only, not thinking.";
  return null;
}

/** Public Two Names decisions whose saved delivery precedes the canonical reveal. */
export const TWO_NAMES_PUBLIC_DECISION_ACTIONS = ["format-two-names-initial-names", "format-two-names-override", "format-two-names-replacement"] as const;
export function twoNamesDecisionSpeechAction(kind: string): string | null {
  switch (kind) {
    case "two_names_initial_names": case "format.two_names_setup": return TWO_NAMES_PUBLIC_DECISION_ACTIONS[0];
    case "two_names_override_declined": case "two_names_override_removed":
    case "format.two_names_override_declined": case "format.two_names_override_used": return TWO_NAMES_PUBLIC_DECISION_ACTIONS[1];
    case "two_names_replacement": case "format.two_names_replacement_named": return TWO_NAMES_PUBLIC_DECISION_ACTIONS[2];
    default: return null;
  }
}
