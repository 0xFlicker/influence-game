import { eq, or } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export interface GamesMcpClaims {
  userId: string;
  gameIds: Set<string>;
  createdGameIds: Set<string>;
  joinedGameIds: Set<string>;
  playerIds: Set<string>;
  agentProfileIds: Set<string>;
}

export async function resolveGamesMcpClaims(
  db: DrizzleDB,
  userId: string,
): Promise<GamesMcpClaims> {
  const createdRows = await db
    .select({ gameId: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.createdById, userId));

  const playerRows = await db
    .select({
      gameId: schema.gamePlayers.gameId,
      playerId: schema.gamePlayers.id,
      directUserId: schema.gamePlayers.userId,
      agentProfileId: schema.gamePlayers.agentProfileId,
      agentProfileOwnerId: schema.agentProfiles.userId,
    })
    .from(schema.gamePlayers)
    .leftJoin(
      schema.agentProfiles,
      eq(schema.gamePlayers.agentProfileId, schema.agentProfiles.id),
    )
    .where(or(
      eq(schema.gamePlayers.userId, userId),
      eq(schema.agentProfiles.userId, userId),
    ));

  const createdGameIds = new Set(createdRows.map((row) => row.gameId));
  const joinedGameIds = new Set<string>();
  const playerIds = new Set<string>();
  const agentProfileIds = new Set<string>();

  for (const row of playerRows) {
    joinedGameIds.add(row.gameId);
    playerIds.add(row.playerId);
    if (row.agentProfileId) agentProfileIds.add(row.agentProfileId);
  }

  return {
    userId,
    gameIds: new Set([...createdGameIds, ...joinedGameIds]),
    createdGameIds,
    joinedGameIds,
    playerIds,
    agentProfileIds,
  };
}
