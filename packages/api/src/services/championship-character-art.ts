import { eq, inArray } from "drizzle-orm";
import type { WerewolfPlayer } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson } from "./payload-storage.js";

/** Resolve accepted seats through their immutable attempt, never through live profiles. */
export async function championshipCharacterArt(db: Pick<DrizzleDB, "select">, gameId: string, players: readonly WerewolfPlayer[]) {
  const [attempt] = await db.select().from(schema.championshipMatchAttempts).where(eq(schema.championshipMatchAttempts.gameId, gameId));
  const [match] = await db.select().from(schema.championshipMatches).where(attempt ? eq(schema.championshipMatches.id, attempt.matchId) : eq(schema.championshipMatches.gameId, gameId));
  if (!match) return null;
  const entries = await db.select().from(schema.championshipEntries).where(eq(schema.championshipEntries.eventId, match.eventId));
  const artwork = entries.length ? await db.select().from(schema.championshipArtwork).where(inArray(schema.championshipArtwork.id, entries.map(entry => entry.id))) : [];
  return Promise.all(players.map(async player => {
    const entry = entries.find(entry => player.id === `${attempt?.seatPrefix ?? match.id}:${entry.id}` && player.agentProfileId === entry.agentId);
    if (!entry) throw new Error("Championship character does not match its accepted seat");
    const build = await readJson(entry.build);
    if (build.version !== 1 || build.competitionRevisionId !== entry.id || build.agentId !== entry.agentId || build.ownerId !== entry.ownerId) throw new Error("Championship character build identity mismatch");
    const art = artwork.find(row => row.id === build.artwork?.revisionId && row.eventId === match.eventId && row.agentId === entry.agentId && row.ownerId === entry.ownerId);
    if (!art?.body || !art.avatar || art.body.sha256 !== build.artwork?.bodyHash || art.avatar.sha256 !== build.artwork.avatarHash) throw new Error("Championship character artwork integrity mismatch");
    return { playerId: player.id, character: build.character, body: art.body, portrait: art.avatar };
  }));
}
