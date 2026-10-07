import { and, eq, isNull, or } from "drizzle-orm";
import { projectWerewolfDecisions, type WerewolfDecisions } from "@influence/engine/werewolf/decisions";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";
import { readWerewolfEvents, WerewolfGameError } from "./werewolf-games.js";
import { readWerewolfThinking } from "./werewolf-thinking.js";

export async function readWerewolfDecisions(db: DrizzleDB, id: string, audience: string, cursor: number, actorId: string): Promise<WerewolfDecisions> {
  if (audience !== "mystery" && audience !== "omniscient") throw new WerewolfGameError("Choose mystery or omniscient", 400);
  if (!Number.isSafeInteger(cursor) || cursor < 1 || !actorId.trim()) throw new WerewolfGameError("Choose a player and replay position", 400);
  const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game || !isViewerGame(game)) throw new WerewolfGameError("Game not found", 404);
  const events = await readWerewolfEvents(db, game.id);
  if (!events.find(event => event.type === "werewolf.started")?.payload.players.some(player => player.id === actorId)) throw new WerewolfGameError("Player not found", 404);
  const result = projectWerewolfDecisions(events, audience, cursor, actorId);
  // Never read private evidence for Mystery, including at the ending.
  if (audience === "omniscient" && result.entries.length) {
    const thinking = await readWerewolfThinking(db, game.id, audience, result.cursor);
    for (const entry of result.entries) {
      const recorded = thinking.entries.find(item => item.actorId === actorId && item.cursor === entry.cursor && item.action === entry.action);
      if (recorded) entry.thinking = recorded.thinking;
    }
  }
  return result;
}
