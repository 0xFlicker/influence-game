import { asc, eq, inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { decodeContentSnapshot } from "./agent-content-submissions.js";
import { hasEligibleAgentContent } from "./agent-content-eligibility.js";

/** Resolve approved character revisions in one batch for both admission and public casting. */
export async function readPublishedWerewolfCharacters(db: Pick<DrizzleDB, "select">, profiles: Array<typeof schema.agentProfiles.$inferSelect>) {
  const ids = [...new Set(profiles.flatMap(profile => profile.contentRevisionId ? [profile.contentRevisionId] : []))];
  const revisions = ids.length ? await db.select().from(schema.agentContentRevisions).where(inArray(schema.agentContentRevisions.id, ids)) : [];
  const byId = new Map(revisions.map(revision => [revision.id, revision]));
  return profiles.map(profile => {
    if (!hasEligibleAgentContent(profile)) throw new Error("This agent is archived or awaiting review. Remove them from the cast before starting.");
    const revision = profile.contentRevisionId ? byId.get(profile.contentRevisionId) : undefined;
    if (profile.contentRevisionId && !revision) throw new Error("Missing approved character revision");
    return revision ? decodeContentSnapshot(revision.snapshot, profile) : profile;
  });
}

type Profile = typeof schema.agentProfiles.$inferSelect;
export interface WerewolfCastingPlayer {
  id: string;
  agentProfileId: string | null;
  ownerPublicId: string | null;
  name: string;
  avatarUrl: string | null;
  personaKey: Profile["personaKey"] | null;
  available: boolean;
}

/** Saved seats expose approved public identity only, shared by lobby and producer reads. */
export async function readWerewolfCastingPlayers(db: Pick<DrizzleDB, "select">, gameIds: string[]) {
  const byGame = new Map<string, WerewolfCastingPlayer[]>();
  if (!gameIds.length) return byGame;
  const rows = await db.select({ seat: schema.werewolfLobbySeats, profile: schema.agentProfiles, ownerPublicId: schema.users.publicId })
    .from(schema.werewolfLobbySeats)
    .leftJoin(schema.agentProfiles, eq(schema.agentProfiles.id, schema.werewolfLobbySeats.agentProfileId))
    .leftJoin(schema.users, eq(schema.users.id, schema.agentProfiles.userId))
    .where(inArray(schema.werewolfLobbySeats.gameId, gameIds))
    .orderBy(asc(schema.werewolfLobbySeats.joinedAt), asc(schema.werewolfLobbySeats.id));
  const profiles = [...new Map(rows.filter((row): row is typeof row & { profile: Profile } => row.profile !== null && hasEligibleAgentContent(row.profile)).map(row => [row.profile.id, row.profile])).values()];
  const characters = await readPublishedWerewolfCharacters(db, profiles);
  const byId = new Map(characters.map((character, i) => [profiles[i]!.id, character]));
  for (const row of rows) {
    const identity = { id: row.seat.id, agentProfileId: row.seat.agentProfileId, ownerPublicId: row.ownerPublicId };
    const character = row.seat.houseCharacter ?? (row.profile ? byId.get(row.profile.id) : undefined);
    const cast = byGame.get(row.seat.gameId) ?? [];
    cast.push(character
      ? { ...identity, name: character.name, avatarUrl: character.avatarUrl, personaKey: character.personaKey ?? null, available: true }
      : { ...identity, name: "Unavailable agent", avatarUrl: null, personaKey: null, available: false });
    byGame.set(row.seat.gameId, cast);
  }
  return byGame;
}
