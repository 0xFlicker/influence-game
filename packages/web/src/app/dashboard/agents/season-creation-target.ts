import { joinFreeQueue } from "@/lib/api";
import { readEditorStorage, writeEditorStorage } from "./agent-editor-storage";

/** Bind retries and ambiguous creation responses to the original season. This
 * is only used by season entry, never by ordinary agent creation. */
export function pinSeasonCreationTarget(creationRequestId: string, seasonId: string): string {
  const key = `influence:agent-create-season:${creationRequestId}`;
  const prior = readEditorStorage(key);
  if (!prior.ok) throw new Error("Season entry recovery is unavailable in this browser. Enable browser storage before creating the agent.");
  if (prior.value !== null && prior.value !== seasonId) {
    throw new Error("This agent creation belongs to a different season. Return to its original season to finish entry.");
  }
  if (prior.value === null && !writeEditorStorage(key, seasonId)) {
    throw new Error("Could not save the selected season. Retry before creating the agent.");
  }
  return seasonId;
}

/** Creation is already committed; keep its recovery receipt if admission fails. */
export async function enrollCreatedSeasonAgent(agent: { id: string; name: string }, expectedSeasonId?: string): Promise<void> {
  try {
    await joinFreeQueue(agent.id, expectedSeasonId);
  } catch (error) {
    throw new Error(`${agent.name} was saved, but could not join the season. ${error instanceof Error ? error.message : "Retry entry."}`);
  }
}
