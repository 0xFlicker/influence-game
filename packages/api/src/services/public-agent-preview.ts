import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  getUserSelectableAgentArchetype,
  type AgentArchetypeKey,
} from "./agent-archetypes.js";
import {
  isImportedSyntheticPlayer,
  publicPlayerLinkIdentity,
  type PublicPlayerIdentityRef,
} from "./public-player-identity.js";

const PUBLIC_RECENT_RESULT_LIMIT = 5;
type PublicAgentPreviewDB = Pick<DrizzleDB, "select">;

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

/**
 * Public agent data used by watch/replay surfaces. Owner is optional so
 * historical and anonymous agents remain renderable without a fake link.
 */
export interface PublicReplayAgentPreview extends PublicAgentPreview {
  owner?: PublicPlayerIdentityRef | null;
}

export interface PublicPlayerCompetitionFacts {
  agents: PublicAgentPreview[];
  recentResults: PublicCompetitionResult[];
}

interface PublicAgentProfileRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  personaKey: string | null;
  ownerId?: string;
  ownerPublicId?: string;
  ownerHandle?: string | null;
  ownerDisplayName?: string | null;
  ownerWalletAddress?: string | null;
  ownerEmail?: string | null;
}

interface PublicAgentCompetitionAggregate {
  gamesPlayed: number;
  wins: number;
}

export async function getPublicAgentPreviewsByProfileIds(
  db: PublicAgentPreviewDB,
  agentProfileIds: readonly string[],
): Promise<Map<string, PublicAgentPreview>> {
  const uniqueProfileIds = [...new Set(agentProfileIds)];
  if (uniqueProfileIds.length === 0) return new Map();

  const rows = await db.select({
    id: schema.agentProfiles.id,
    name: schema.agentProfiles.name,
    avatarUrl: schema.agentProfiles.avatarUrl,
    personaKey: schema.agentProfiles.personaKey,
    ownerWalletAddress: schema.users.walletAddress,
  }).from(schema.agentProfiles)
    .innerJoin(schema.users, eq(schema.agentProfiles.userId, schema.users.id))
    .where(inArray(schema.agentProfiles.id, uniqueProfileIds));
  const publicProfiles = rows.filter(
    (profile) => !isImportedSyntheticPlayer(profile.ownerWalletAddress),
  );
  const aggregateByAgent = await getPublicAgentCompetitionAggregates(
    db,
    publicProfiles.map((profile) => profile.id),
  );

  return new Map(publicProfiles.map((profile) => [
    profile.id,
    buildPublicAgentPreview(profile, aggregateByAgent.get(profile.id)),
  ]));
}

export async function getPublicReplayAgentPreviewsByProfileIds(
  db: PublicAgentPreviewDB,
  agentProfileIds: readonly string[],
): Promise<Map<string, PublicReplayAgentPreview>> {
  const uniqueProfileIds = [...new Set(agentProfileIds)];
  if (uniqueProfileIds.length === 0) return new Map();

  const rows = await db.select({
    id: schema.agentProfiles.id,
    name: schema.agentProfiles.name,
    avatarUrl: schema.agentProfiles.avatarUrl,
    personaKey: schema.agentProfiles.personaKey,
    ownerId: schema.users.id,
    ownerPublicId: schema.users.publicId,
    ownerHandle: schema.users.handle,
    ownerDisplayName: schema.users.displayName,
    ownerWalletAddress: schema.users.walletAddress,
    ownerEmail: schema.users.email,
  }).from(schema.agentProfiles)
    .innerJoin(schema.users, eq(schema.agentProfiles.userId, schema.users.id))
    .where(inArray(schema.agentProfiles.id, uniqueProfileIds));
  const publicProfiles = rows.filter(
    (profile) => !isImportedSyntheticPlayer(profile.ownerWalletAddress),
  );
  const aggregateByAgent = await getPublicAgentCompetitionAggregates(
    db,
    publicProfiles.map((profile) => profile.id),
  );

  return new Map(publicProfiles.map((profile) => [
    profile.id,
    {
      ...buildPublicAgentPreview(profile, aggregateByAgent.get(profile.id)),
      owner: publicReplayAgentOwner(profile),
    },
  ]));
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

  const profileIds = profiles.map((profile) => profile.id);
  const publicReceiptFilter = and(
    eq(schema.competitionReceipts.ownerId, internalUserId),
    inArray(schema.competitionReceipts.agentProfileId, profileIds),
    eq(schema.competitionReceipts.eligibilityStatus, "eligible"),
    eq(schema.games.status, "completed"),
    eq(schema.games.trackType, "free"),
    isNull(schema.games.hiddenAt),
  );

  const [aggregateByAgent, recentResults] = await Promise.all([
    getPublicAgentCompetitionAggregates(db, profileIds, internalUserId),
    db.select({
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
      .limit(PUBLIC_RECENT_RESULT_LIMIT),
  ]);

  return {
    agents: profiles.map((profile) => (
      buildPublicAgentPreview(profile, aggregateByAgent.get(profile.id))
    )),
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

async function getPublicAgentCompetitionAggregates(
  db: PublicAgentPreviewDB,
  agentProfileIds: readonly string[],
  ownerId?: string,
): Promise<Map<string, PublicAgentCompetitionAggregate>> {
  if (agentProfileIds.length === 0) return new Map();
  const filters = [
    inArray(schema.competitionReceipts.agentProfileId, [...agentProfileIds]),
    eq(schema.competitionReceipts.eligibilityStatus, "eligible"),
    eq(schema.games.status, "completed"),
    eq(schema.games.trackType, "free"),
    isNull(schema.games.hiddenAt),
  ];
  if (ownerId) {
    filters.push(eq(schema.competitionReceipts.ownerId, ownerId));
  }
  const aggregates = await db.select({
    agentProfileId: schema.competitionReceipts.agentProfileId,
    gamesPlayed: sql<number>`count(*)::int`,
    wins: sql<number>`count(*) filter (
      where ${schema.competitionReceipts.placement} = 1
    )::int`,
  }).from(schema.competitionReceipts)
    .innerJoin(
      schema.agentProfiles,
      and(
        eq(schema.competitionReceipts.agentProfileId, schema.agentProfiles.id),
        eq(schema.competitionReceipts.ownerId, schema.agentProfiles.userId),
      ),
    )
    .innerJoin(schema.games, eq(schema.competitionReceipts.gameId, schema.games.id))
    .where(and(...filters))
    .groupBy(schema.competitionReceipts.agentProfileId);

  return new Map(
    aggregates.map((aggregate) => [aggregate.agentProfileId, aggregate]),
  );
}

function buildPublicAgentPreview(
  profile: PublicAgentProfileRow,
  aggregate: PublicAgentCompetitionAggregate | undefined,
): PublicAgentPreview {
  const gamesPlayed = aggregate?.gamesPlayed ?? 0;
  const wins = aggregate?.wins ?? 0;
  return {
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    role: publicRole(profile.personaKey),
    competition: {
      gamesPlayed,
      wins,
      winRate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    },
  };
}

function publicReplayAgentOwner(
  profile: PublicAgentProfileRow,
): PublicPlayerIdentityRef | null {
  if (!profile.ownerId || !profile.ownerPublicId) return null;
  return publicPlayerLinkIdentity({
    id: profile.ownerId,
    publicId: profile.ownerPublicId,
    handle: profile.ownerHandle ?? null,
    displayName: profile.ownerDisplayName ?? null,
    walletAddress: profile.ownerWalletAddress ?? null,
    email: profile.ownerEmail ?? null,
  });
}

function publicRole(personaKey: string | null): PublicAgentPreview["role"] {
  if (!personaKey) return null;
  const archetype = getUserSelectableAgentArchetype(personaKey);
  if (!archetype) return null;
  return {
    key: archetype.key,
    label: archetype.label,
  };
}
