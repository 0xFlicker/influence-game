import type { SavedAgent } from "./api";

export type AgentEntryIntent =
  | { flow: "join_game"; gameId: string }
  | { flow: "daily_free"; seasonId?: string; season?: string }
  | { flow: "update" };

export function hasFullBodyAgentArt(agent: Pick<SavedAgent, "fullBodyReferenceUrl">): boolean {
  return Boolean(agent.fullBodyReferenceUrl?.trim());
}

function entryQuery(intent: AgentEntryIntent): URLSearchParams {
  const query = new URLSearchParams({ flow: intent.flow });
  if (intent.flow === "join_game") query.set("gameId", intent.gameId);
  else if (intent.flow === "daily_free") {
    if (intent.seasonId) query.set("seasonId", intent.seasonId);
    if (intent.season) query.set("season", intent.season);
  }
  return query;
}

export function agentPreparationHref(agentId: string, intent: AgentEntryIntent): string {
  const query = entryQuery(intent);
  query.set("agentId", agentId);
  return `/agents/prepare?${query}`;
}

export function agentEditForEntryHref(agentId: string, intent: AgentEntryIntent): string {
  return `/dashboard/agents/${encodeURIComponent(agentId)}/edit?${entryQuery(intent)}`;
}

export function agentEntryIntentKey(agentId: string, intent: AgentEntryIntent): string {
  const target = intent.flow === "join_game" ? intent.gameId : intent.flow === "daily_free" ? intent.seasonId ?? "daily" : "update";
  return `house:complete-and-join:${agentId}:${intent.flow}:${target}`;
}
