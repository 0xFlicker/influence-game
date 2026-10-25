import type { DecisionSchema } from "./model-invocation";

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
export function decisionSpeechPolicy(action: string) {
  if (!SPOKEN_ONLY.has(action) && !THOUGHT_AND_SPOKEN.has(action)) return null;
  return { thinking: THOUGHT_AND_SPOKEN.has(action), ballot: INFLUENCE_BALLOT_ACTIONS.has(action), maxBytes: INFLUENCE_BALLOT_ACTIONS.has(action) ? 120 : 320 };
}
export function withDecisionSpeech(tool: DecisionSchema, action: string): DecisionSchema {
  const policy = decisionSpeechPolicy(action);
  if (!policy) return tool;
  const schema = structuredClone(tool.schema);
  const properties = schema.properties as Record<string, unknown>;
  properties.message = { type: "string", description: policy.ballot
    ? "Your VERY SHORT spoken vote, at most 120 UTF-8 bytes. The chosen name alone is enough. No explanation or private reasoning. Sealed until all ballots are collected."
    : "Your short public announcement of this decision, at most 320 UTF-8 bytes. Speak to the players, without revealing private reasoning." };
  if (!policy.thinking) delete properties.thinking;
  schema.required = [...(schema.required as string[]).filter(key => key !== "message" && (policy.thinking || key !== "thinking")), "message"];
  return { ...tool, schema };
}
export function validateDecisionSpeech(action: string, value: unknown): string | null {
  const policy = decisionSpeechPolicy(action);
  if (!policy) return null;
  if (!value || typeof value !== "object") return "Decision must be an object.";
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || !record.message.trim()) return "message must be non-empty speech.";
  if (new TextEncoder().encode(record.message).length > policy.maxBytes) return `message exceeds ${policy.maxBytes} UTF-8 bytes; shorten it.`;
  if (!policy.thinking && Object.hasOwn(record, "thinking")) return "This decision requests speech only, not thinking.";
  return null;
}
