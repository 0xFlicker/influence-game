import type { JsonObject } from "@influence/prompt-lab-protocol";
import type { PromptThreadSelectionReason } from "@influence/engine/prompt-thread-report";

export type PromptThreadMappedSelectionReason = Exclude<
  PromptThreadSelectionReason,
  "ranked_out"
>;

export function promptThreadSourceIdBySequence(
  privateData: JsonObject,
): Map<string, string> {
  const starting = record(privateData.startingState, "starting state");
  if (!Array.isArray(starting.historyCatalog)) {
    throw new Error("Case has no history catalog for evidence mapping");
  }
  const mapping = new Map<string, string>();
  for (const value of starting.historyCatalog) {
    const item = record(value, "history catalog item");
    if (item.sequence === null || item.sequence === undefined) continue;
    if (typeof item.sourceId !== "string") {
      throw new Error("History catalog item has no stable source ID");
    }
    mapping.set(String(item.sequence), item.sourceId);
  }
  return mapping;
}

export function promptThreadSelectionReason(
  value: string,
): PromptThreadMappedSelectionReason {
  if (value === "selected_history") return "selected";
  if (value === "history_disabled") return "policy_disabled";
  if (value === "seed_miss") return "zero_overlap";
  if (value === "budget_excluded") return "budget_exhausted";
  throw new Error(`Unsupported selection reason ${value}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}
