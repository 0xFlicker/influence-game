import type { WerewolfAudience } from "./observation";
import type { WerewolfEvent } from "./types";
import { walkWerewolfHistory } from "./watch";

export interface WerewolfDecisionEntry {
  cursor: number;
  day: number;
  actorId: string;
  action: "vote" | "attack" | "protect" | "investigate";
  targetId: string | null;
  unavailable: boolean;
  context: string;
  result: string;
  thinking?: string;
}

export interface WerewolfDecisions {
  cursor: number;
  entries: WerewolfDecisionEntry[];
}

/** Resolution-only, audience-local history. No prose parsing, pending choices or future outcomes. */
export function projectWerewolfDecisions(
  events: readonly WerewolfEvent[],
  audience: WerewolfAudience,
  through: number,
  actorId: string,
): WerewolfDecisions {
  const entries: WerewolfDecisionEntry[] = [];
  let cursor = 0;
  for (const frame of walkWerewolfHistory(events, audience)) {
    if (frame.cursor > through) break;
    cursor = frame.cursor;
    const { entry, before, state } = frame;
    if (!entry) continue;
    const name = (id: string) => state.players.find(player => player.id === id)?.name ?? "Player";
    if (entry.kind === "vote") {
      const ballot = entry.result.ballots.find(ballot => ballot.voterId === actorId);
      if (ballot) entries.push({
        cursor, day: entry.day, actorId, action: "vote", targetId: ballot.targetId, unavailable: ballot.unavailable,
        context: `Day ${entry.day} · Vote after thread ${entry.result.thread}`,
        result: entry.result.eliminatedId ? `${name(entry.result.eliminatedId)} was eliminated.`
          : entry.result.dayEnded ? "No one was eliminated." : "No majority. Discussion continues.",
      });
    }
    if (audience !== "omniscient") continue;
    if (entry.kind === "pack_vote") {
      const ballot = entry.result.ballots.find(ballot => ballot.voterId === actorId);
      if (ballot) entries.push({
        cursor, day: entry.day, actorId, action: "attack", targetId: ballot.targetId,
        unavailable: before?.actions.some(action => action.actorId === actorId && action.action === "attack" && action.fallback !== null) ?? false,
        context: `Night ${entry.day} · Pack ballot ${entry.result.attempt}`,
        result: entry.result.targetId ? `The pack agreed on ${name(entry.result.targetId)}.`
          : entry.result.endReason === "attempt_limit" ? "The pack could not agree. No target tonight." : "The pack has not agreed yet.",
      });
    }
    if (entry.kind === "night" && before) {
      for (const action of before.actions) {
        if (action.actorId !== actorId || action.decision.kind !== "target") continue;
        const targetId = action.decision.targetId;
        if (action.action === "protect") {
          const saved = targetId !== null && targetId === entry.attackTargetId && targetId === entry.protectedId && entry.killedId === null;
          entries.push({
            cursor, day: entry.day, actorId, action: "protect", targetId,
            unavailable: action.fallback !== null, context: `Night ${entry.day} · Doctor`,
            result: saved ? `Protection saved ${name(targetId)} from the pack.`
              : !targetId ? "No protection selected."
              : !entry.attackTargetId ? "The pack made no attack." : "This player was not the pack's target.",
          });
        }
        if (action.action === "investigate") entries.push({
          cursor, day: entry.day, actorId, action: "investigate", targetId,
          unavailable: action.fallback !== null, context: `Night ${entry.day} · Seer`,
          result: entry.investigation ? entry.investigation.isWolf ? "Found a werewolf." : "Not a werewolf." : "No investigation result.",
        });
      }
    }
  }
  return { cursor, entries };
}
