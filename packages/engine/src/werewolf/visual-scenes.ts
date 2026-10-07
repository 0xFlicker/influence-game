import type { VisualRoomId } from "../visual-mode";
import type { WerewolfEvent, WerewolfRequest, WerewolfState } from "./types";
import { applyWerewolfEvent } from "./rules";

export type WerewolfScenePurpose = "village" | "pack" | "hunt";
export interface WerewolfSceneDescriptor {
  purpose: WerewolfScenePurpose;
  roomId: VisualRoomId;
  boundarySequence: number;
  day: number;
  participantIds: string[];
  wolfIds: string[];
  targetId: string | null;
}

/** All production callers use the same canonical cast and purpose, including repairs. */
export function werewolfConversationScene(state: WerewolfState, action: WerewolfRequest["action"]): WerewolfSceneDescriptor | null {
  const pack = state.aliveIds.filter(id => state.roles[id] === "werewolf");
  if (action === "pack_talk" && pack.length > 1) return { purpose: "pack", roomId: "mingle-1", boundarySequence: state.sequence,
    day: state.day, participantIds: pack, wolfIds: pack, targetId: null };
  if (action === "open_thread" || action === "discuss") return { purpose: "village", roomId: "lobby", boundarySequence: state.sequence,
    day: state.day, participantIds: [...state.aliveIds], wolfIds: [], targetId: null };
  return null;
}

/** Stage successful attacks before the victim dies; Doctor saves need no hunt render. */
export function werewolfHuntScene(before: WerewolfState, event: WerewolfEvent): WerewolfSceneDescriptor | null {
  if (event.type !== "werewolf.night_resolved" || !event.payload.attackTargetId || event.payload.attackTargetId === event.payload.protectedId) return null;
  const wolfIds = before.aliveIds.filter(id => before.roles[id] === "werewolf");
  const targetId = event.payload.attackTargetId;
  if (!wolfIds.length || !before.aliveIds.includes(targetId) || wolfIds.includes(targetId)) throw new Error("Invalid canonical hunt cast");
  return { purpose: "hunt", roomId: "mingle-2", boundarySequence: event.sequence - 1, day: before.day,
    participantIds: [...wolfIds, targetId], wolfIds, targetId };
}

export function werewolfSceneSignature(scene: WerewolfSceneDescriptor) {
  return JSON.stringify([scene.purpose, scene.participantIds, scene.wolfIds, scene.targetId]);
}

/** No introductions, no invented lone-wolf meeting, no target-less hunt. */
export function werewolfSceneInventory(events: readonly WerewolfEvent[]): WerewolfSceneDescriptor[] {
  let state: WerewolfState | null = null;
  const previous = new Map<WerewolfScenePurpose, string>();
  const scenes: WerewolfSceneDescriptor[] = [];
  for (const event of events) {
    if (state) {
      const descriptor = event.type === "werewolf.action_accepted"
        ? werewolfConversationScene(state, event.payload.action) : werewolfHuntScene(state, event);
      if (descriptor) {
        const signature = werewolfSceneSignature(descriptor);
        // Hunts are tied to their resolved night.
        if (descriptor.purpose === "hunt" || previous.get(descriptor.purpose) !== signature) scenes.push(descriptor);
        previous.set(descriptor.purpose, signature);
      }
    }
    state = applyWerewolfEvent(state, event);
  }
  return scenes;
}
