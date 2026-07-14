import type { AvatarCompletionRead } from "./avatar-generation.js";

export const AGENT_MUTATION_RECEIPT_SCHEMA_VERSION = 1 as const;
export const MAX_AGENT_MUTATION_WAITING_SEAT_REFERENCES = 10;

export interface AgentMutationProfileRevisionReceipt {
  revisionId: string;
  ordinal: number;
  outcome: "created" | "preserved";
  active: true;
}

export interface AgentMutationWaitingSeatReference {
  gameId: string;
  slug: string;
  disposition: "reconciled" | "already_current" | "crossed_freeze";
  effectiveRevisionId: string | null;
}

export interface AgentMutationReceipt {
  schemaVersion: typeof AGENT_MUTATION_RECEIPT_SCHEMA_VERSION;
  operation: "created" | "updated";
  agent: {
    agentProfileId: string;
    identityDisposition: "created" | "preserved";
  };
  profileRevision: AgentMutationProfileRevisionReceipt;
  dailyFree: "not_enrolled" | "preserved_follows_profile";
  waitingSeats: {
    total: number;
    reconciled: number;
    alreadyCurrent: number;
    crossedFreeze: number;
    games: AgentMutationWaitingSeatReference[];
    truncatedCount: number;
  };
  frozenSeats: {
    unchanged: number;
  };
  avatarCompletion?: AvatarCompletionRead;
  warnings: string[];
}

export function boundAgentMutationWaitingSeatReferences(
  references: readonly AgentMutationWaitingSeatReference[],
): Pick<AgentMutationReceipt["waitingSeats"], "games" | "truncatedCount"> {
  const games = references.slice(0, MAX_AGENT_MUTATION_WAITING_SEAT_REFERENCES);
  return {
    games,
    truncatedCount: references.length - games.length,
  };
}
