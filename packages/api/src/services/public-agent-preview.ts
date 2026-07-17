import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  getUserSelectableAgentArchetype,
  isUserSelectableAgentArchetype,
  type AgentArchetypeKey,
} from "./agent-archetypes.js";

const PUBLIC_RECENT_RESULT_LIMIT = 5;

export interface PublicCompetitionResult {
  gameSlug: string;
  agentName: string;
  placement: number;
  lobbySize: number;
  totalPoints: number;
  earnedAt: string;
}

export interface PublicAgentPreview {
  name: string;
  avatarUrl: string | null;
  role: null | {
    key: AgentArchetypeKey;
    label: string;
  };
  competition: {
    gamesPlayed: number;
    wins: number;
    winRate: number;
  };
}

export interface PublicPlayerCompetitionFacts {
  agents: PublicAgentPreview[];
  recentResults: PublicCompetitionResult[];
}

export async function getPublicPlayerCompetitionFacts(
  db: DrizzleDB,
  internalUserId: string,
): Promise<PublicPlayerCompetitionFacts> {
  const profiles = await db.select({
    id: schema.agentProfiles.id,
    name: schema.agentProfiles.name,
    avatarUrl: schema.agentProfiles.avatarUrl,
    personaKey: schema.agentProfiles.personaKey,
  }).from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.userId, internalUserId))
    .orderBy(
      asc(sql`lower(btrim(${schema.agentProfiles.name}))`),
      asc(schema.agentProfiles.name),
      asc(schema.agentProfiles.id),
    );

  if (profiles.length === 0) {
    return { agents: [], recentResults: [] };
  }

  const publicReceiptFilter = and(
    eq(schema.competitionReceipts.ownerId, internalUserId),
    inArray(schema.competitionReceipts.agentProfileId, profiles.map((profile) => profile.id)),
    eq(schema.competitionReceipts.eligibilityStatus, "eligible"),
    eq(schema.games.status, "completed"),
    eq(schema.games.trackType, "free"),
    isNull(schema.games.hiddenAt),
  );
  const aggregates = await db.select({
    agentProfileId: schema.competitionReceipts.agentProfileId,
    gamesPlayed: sql<number>`count(*)::int`,
    wins: sql<number>`count(*) filter (
      where ${schema.competitionReceipts.placement} = 1
    )::int`,
  }).from(schema.competitionReceipts)
    .innerJoin(schema.games, eq(schema.competitionReceipts.gameId, schema.games.id))
    .where(publicReceiptFilter)
    .groupBy(schema.competitionReceipts.agentProfileId);
  const aggregateByAgent = new Map(
    aggregates.map((aggregate) => [aggregate.agentProfileId, aggregate]),
  );

  const recentResults = await db.select({
    gameSlug: schema.games.slug,
    agentName: schema.competitionReceipts.agentNameSnapshot,
    placement: schema.competitionReceipts.placement,
    lobbySize: schema.competitionReceipts.lobbySize,
    totalPoints: schema.competitionReceipts.totalPoints,
    earnedAt: schema.competitionReceipts.earnedAt,
  }).from(schema.competitionReceipts)
    .innerJoin(schema.games, eq(schema.competitionReceipts.gameId, schema.games.id))
    .where(publicReceiptFilter)
    .orderBy(
      desc(schema.competitionReceipts.earnedAt),
      desc(schema.competitionReceipts.id),
    )
    .limit(PUBLIC_RECENT_RESULT_LIMIT);

  return {
    agents: profiles.map((profile) => {
      const aggregate = aggregateByAgent.get(profile.id);
      const gamesPlayed = aggregate?.gamesPlayed ?? 0;
      const wins = aggregate?.wins ?? 0;
      const role = publicRole(profile.personaKey);
      return {
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        role,
        competition: {
          gamesPlayed,
          wins,
          winRate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
        },
      };
    }),
    recentResults: recentResults.map((receipt) => ({
        gameSlug: receipt.gameSlug,
        agentName: receipt.agentName,
        placement: receipt.placement!,
        lobbySize: receipt.lobbySize,
        totalPoints: receipt.totalPoints,
        earnedAt: receipt.earnedAt,
      })),
  };
}

function publicRole(personaKey: string | null): PublicAgentPreview["role"] {
  if (!isUserSelectableAgentArchetype(personaKey)) return null;
  return {
    key: personaKey,
    label: getUserSelectableAgentArchetype(personaKey)!.label,
  };
}
