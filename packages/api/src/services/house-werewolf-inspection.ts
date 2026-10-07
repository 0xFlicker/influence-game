import {
  projectWerewolfSnapshot,
  type WerewolfAudience,
} from "@influence/engine/werewolf";
import { walkWerewolfHistory } from "@influence/engine/werewolf/watch";
import { readWerewolfEvents } from "./werewolf-games.js";
import type { HouseReadDB, HouseGame } from "./house-game-access.js";
import { HouseInspectionError } from "./house-game-access.js";

/** Retain only projected audience frames; private reducer state never leaves this adapter. */
export async function loadHouseWerewolfHistory(
  db: HouseReadDB,
  game: HouseGame,
  audience: WerewolfAudience,
) {
  try {
    const events = await readWerewolfEvents(db, game.id);
    const frames = [];
    for (const frame of walkWerewolfHistory(events, audience)) {
      if (frame.entry)
        frames.push({
          cursor: frame.cursor,
          entry: frame.entry,
          snapshot: inspectionSnapshot(frame.state, audience, frame.cursor),
        });
    }
    if (
      (game.startedAt && !frames.length) ||
      (game.status === "completed" && frames.at(-1)?.entry.kind !== "result")
    )
      throw new HouseInspectionError(
        "unavailable",
        "Game history is incomplete",
      );
    return frames;
  } catch (error) {
    if (error instanceof HouseInspectionError) throw error;
    throw new HouseInspectionError(
      "unavailable",
      "Game history failed validation",
    );
  }
}
function inspectionSnapshot(
  ...args: Parameters<typeof projectWerewolfSnapshot>
) {
  const snapshot = projectWerewolfSnapshot(...args);
  return {
    ...snapshot,
    players: snapshot.players.map(({ id, name, personaKey, alive, role }) => ({
      id,
      name,
      personaKey,
      alive,
      ...(role ? { role } : {}),
    })),
  };
}
