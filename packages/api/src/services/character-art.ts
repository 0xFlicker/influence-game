import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type { CharacterHeadPosition } from "@influence/engine/character-portrait";

/** Presentation joins the current character. Unowned participants are their own
 * durable character; their persona owns the artwork rather than a profile. */
export async function readCharacterArtwork(db: Pick<DrizzleDB, "select">, gameId: string) {
  const rows = await db.select({ player: schema.gamePlayers, profile: schema.agentProfiles })
    .from(schema.gamePlayers).leftJoin(schema.agentProfiles, eq(schema.agentProfiles.id, schema.gamePlayers.agentProfileId))
    .where(eq(schema.gamePlayers.gameId, gameId));
  return rows.map(({ player, profile }) => {
    const art = player.agentProfileId ? profile : JSON.parse(player.persona) as {
      fullBodyReferenceUrl?: string | null; headPosition?: CharacterHeadPosition | null };
    if (!art) throw new Error(`Missing character ${player.agentProfileId}`);
    return { id: player.werewolfPlayerId ?? player.id, fullBodyReferenceUrl: art.fullBodyReferenceUrl ?? null, headPosition: art.headPosition ?? null };
  });
}
