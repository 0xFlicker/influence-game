import { applyWerewolfEvent } from "./rules";
import { projectWerewolfView, type WerewolfAudience, type WerewolfView } from "./observation";
import type { WerewolfEvent, WerewolfState } from "./types";
import type { AcceptedVisualScene } from "../visual-mode";

export interface WerewolfPresentation {
  slug: string;
  status: string;
  latestCursor: number;
  publicationCutoff: string;
  view: WerewolfView;
  scene: AcceptedVisualScene | null;
}
/** Server-only staging coordinates. Public playback exposes audience-local cursors only. */
export function projectWerewolfPresentation(events: readonly WerewolfEvent[], audience: WerewolfAudience, cursor?: number) {
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) throw new Error("Invalid replay position");
  let state: WerewolfState | null = null;
  let selected: { view: WerewolfView; boundary: number; roomId: "lobby" | "mingle-1" | null; participantIds: string[] } | null = null;
  let latestCursor = 0;
  for (const event of events) {
    const before: WerewolfState | null = state;
    state = applyWerewolfEvent(state, event);
    const view = projectWerewolfView(state, audience);
    if (view.cursor === latestCursor) continue;
    // Current rules append at most one visible entry per accepted event. Never
    // silently skip a new entry if that contract changes in a future ruleset.
    if (view.cursor !== latestCursor + 1) throw new Error("Replay event requires explicit multi-entry staging");
    latestCursor = view.cursor;
    if (selected && cursor !== undefined && latestCursor > cursor) continue;
    const entry = view.entries.at(-1)!;
    const roomId = entry.day === 0 ? null : entry.kind === "pack_vote" || entry.kind === "speech" && entry.audience === "pack" ? "mingle-1" : "lobby";
    const staging = before ?? state;
    selected = { view, roomId, boundary: event.sequence - 1,
      participantIds: roomId === null ? [] : staging.aliveIds.filter(id => roomId === "lobby" || staging.roles[id] === "werewolf") };
  }
  if (!selected) throw new Error("Werewolf replay is empty");
  return { ...selected, latestCursor };
}
