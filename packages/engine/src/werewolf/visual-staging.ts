import type { WerewolfPublicEntry } from "./observation";
import type { WerewolfState, WerewolfEvent } from "./types";
import { werewolfHuntScene, type WerewolfScenePurpose } from "./visual-scenes";

/** Private staging stays server-side; an audience-filtered entry is required. */
export function werewolfVisualStaging(state: WerewolfState, event: WerewolfEvent, entry: WerewolfPublicEntry) {
  if (entry.day === 0) return { boundary: event.sequence - 1, roomId: null, purpose: null, participantIds: [] } as const;
  if (entry.kind === "night") {
    // Mystery's entry deliberately has no attackTargetId, even though the event does.
    const hunt = "attackTargetId" in entry ? werewolfHuntScene(state, event) : null;
    // Saves use character art, but may still reuse published wolf forms.
    if (!hunt && entry.attackTargetId) return {
      boundary: event.sequence - 1, roomId: null, purpose: "hunt" as const,
      participantIds: [...state.aliveIds.filter(id => state.roles[id] === "werewolf"), entry.attackTargetId],
    };
    return { boundary: event.sequence - 1, roomId: hunt?.roomId ?? null, purpose: hunt?.purpose ?? null, participantIds: hunt?.participantIds ?? [] };
  }
  const pack = entry.kind === "pack_vote" || entry.kind === "speech" && entry.audience === "pack";
  return { boundary: event.sequence - 1, roomId: pack ? "mingle-1" as const : "lobby" as const,
    purpose: (pack ? "pack" : "village") as WerewolfScenePurpose,
    participantIds: state.aliveIds.filter(id => !pack || state.roles[id] === "werewolf") };
}
