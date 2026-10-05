import { werewolfSceneInventory } from "@influence/engine/werewolf/visual-scenes";
import type { VisualScenePlan } from "@influence/engine/visual-scene-plan";
import { type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents } from "./werewolf-games.js";
import { freezeWerewolfReferences } from "./werewolf-production.js";
import { planWerewolfScene } from "./werewolf-scene-plan.js";

/** Rebuild from accepted facts at the selected boundary, not the old generic render plan. */
export async function planWerewolfProduction(db: DrizzleDB, gameId: string, roomId: VisualScenePlan["roomId"], boundary: number, regenerateForms?: string) {
  const events = await readWerewolfEvents(db, gameId);
  const descriptor = werewolfSceneInventory(events).find(scene => scene.roomId === roomId && scene.boundarySequence === boundary);
  if (!descriptor) throw new Error("This image is not a recorded Werewolf scene. Refresh the production inventory.");
  // The created event is authoritative for match identities, even when no artwork was prepared.
  const created = events[0];
  if (created?.type !== "werewolf.started") throw new Error("Werewolf creation record missing");
  const participants = descriptor.participantIds.map(id => {
    const player = created.payload.players.find(player => player.id === id);
    if (!player) throw new Error("Werewolf scene player missing");
    return { id, name: player.name };
  });
  const { cast } = await freezeWerewolfReferences(db, gameId, participants);
  // Keep original frozen cast separate; only the returned candidate uses derivatives.
  return planWerewolfScene(db, gameId, descriptor, cast, regenerateForms);
}
