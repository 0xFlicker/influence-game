import { applyWerewolfEvent } from "./rules";
import { projectWerewolfView } from "./observation";
import type { WerewolfAction, WerewolfEvent, WerewolfState } from "./types";

export interface WerewolfThinkingEntry {
  cursor: number;
  actorId: string;
  day: number;
  action: WerewolfAction;
  thinking: string;
}
export interface WerewolfThinking { cursor: number; entries: WerewolfThinkingEntry[] }

/** Server-only eligibility. Sealed choices wait for resolution; silent turns join
 * the next visible moment. Never use raw event sequences as spectator cursors. */
export function werewolfThinkingActions(events: readonly WerewolfEvent[], cursor: number) {
  type Action = Extract<WerewolfEvent, { type: "werewolf.action_accepted" }>;
  const released: Array<{ event: Action; cursor: number; day: number }> = [];
  const pending: Array<{ event: Action; day: number }> = [];
  let state: WerewolfState | null = null;
  let previousCursor = 0;
  for (const event of events) {
    state = applyWerewolfEvent(state, event);
    const position = projectWerewolfView(state, "omniscient").cursor;
    if (position > cursor) break;
    if (event.type === "werewolf.action_accepted" && event.payload.fallback === null) pending.push({ event, day: state.day });
    for (let i = 0; i < pending.length;) {
      const item = pending[i]!;
      const action = item.event.payload.action;
      const ready = item.event.payload.decision.kind !== "target" ? position > previousCursor
        : action === "vote" ? event.type === "werewolf.day_vote_resolved"
        : action === "attack" && state.phase === "pack" ? event.type === "werewolf.pack_vote_resolved"
        : event.type === "werewolf.night_resolved";
      if (ready) { released.push({ ...item, cursor: position }); pending.splice(i, 1); }
      else i++;
    }
    previousCursor = position;
  }
  return released;
}
