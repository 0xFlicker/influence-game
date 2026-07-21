/**
 * Protocol-neutral owner-unified match access projection (U3).
 *
 * Resolves one immutable per-invocation subject/game ownership snapshot:
 * subject identity, owned-seat set + fingerprint, and roster name/id resolution.
 * Transcript and cognition lanes consume this ownership-only context; neither
 * this module nor its callers should import MCP server/catalog code.
 *
 * Created-only access remains distinct from participating ownership: creating a
 * game without an owned seat may still authorize canonical board reads, but
 * private transcript/cognition lanes stay denied.
 */

import { createHash } from "node:crypto";
import { asc, eq, or, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

/** Narrow DB surface used by ownership resolution (supports transactions). */
export type MatchAccessDB = Pick<DrizzleDB, "select">;

export interface MatchAccessRosterPlayer {
  id: string;
  name: string;
  userId: string | null;
  agentProfileId: string | null;
}

export interface MatchAccessOwnedSeat {
  playerId: string;
  name: string;
  agentProfileId: string | null;
}

/**
 * Immutable ownership snapshot for one subject + one game.
 * Do not mutate sets/arrays after construction.
 */
export interface MatchAccessContext {
  readonly subjectUserId: string;
  readonly gameId: string;
  readonly gameSlug: string;
  readonly gameStatus: string;
  readonly transcriptCaptureVersion: number;
  /** Subject created the game (canonical access without private lanes). */
  readonly isCreator: boolean;
  /** Subject owns at least one participating seat (direct or via agent profile). */
  readonly hasParticipatingOwnership: boolean;
  /**
   * Canonical games:read access: creator OR participating owner.
   * Unknown / inaccessible games never produce a context for subjects.
   */
  readonly hasCanonicalAccess: boolean;
  readonly ownedPlayerIds: ReadonlySet<string>;
  readonly ownedAgentProfileIds: ReadonlySet<string>;
  readonly ownedSeats: readonly MatchAccessOwnedSeat[];
  /**
   * Stable domain-separated fingerprint of the sorted owned player ID set.
   * Used later by cursor binding (U4) and ownership-stale checks.
   */
  readonly ownershipFingerprint: string;
  readonly roster: readonly MatchAccessRosterPlayer[];
  /**
   * Resolve a stored name-or-ID token to a player UUID when unambiguous.
   * Returns null for unknown or ambiguous tokens (duplicate names, etc.).
   */
  resolvePlayerId(nameOrId: string): string | null;
  /** Display name for a known player UUID, or null if not on roster. */
  resolvePlayerName(playerId: string): string | null;
}

/**
 * Cross-game subject claims used by list/filter surfaces and Games MCP adapters.
 * Participating ownership is joinedGameIds / playerIds; creators alone are not
 * participating owners for private lanes.
 */
export interface SubjectGameAccessClaims {
  userId: string;
  gameIds: Set<string>;
  createdGameIds: Set<string>;
  joinedGameIds: Set<string>;
  playerIds: Set<string>;
  agentProfileIds: Set<string>;
}

/** @deprecated Prefer SubjectGameAccessClaims; retained for Games MCP adapter naming. */
export type GamesMcpClaims = SubjectGameAccessClaims;

export type MatchAccessResolveResult =
  | { status: "resolved"; context: MatchAccessContext }
  | {
      /**
       * Subject cannot access this game for MCP games:read — unknown id/slug
       * and inaccessible games are intentionally indistinguishable.
       */
      status: "not_accessible";
    };

export interface ResolveMatchAccessInput {
  subjectUserId: string;
  gameIdOrSlug: string;
}

const OWNERSHIP_FINGERPRINT_DOMAIN = "influence.match.ownership.v1";

/**
 * Resolve every game the subject created or participates in (direct seat or
 * owned agent profile). Protocol-neutral replacement for resolveGamesMcpClaims.
 */
export async function resolveSubjectGameAccessClaims(
  db: MatchAccessDB,
  userId: string,
): Promise<SubjectGameAccessClaims> {
  const createdRows = await db
    .select({ gameId: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.createdById, userId));

  const playerRows = await db
    .select({
      gameId: schema.gamePlayers.gameId,
      playerId: schema.gamePlayers.id,
      agentProfileId: schema.gamePlayers.agentProfileId,
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

/**
 * Resolve one immutable MatchAccessContext for a subject + game within the
 * caller's current database snapshot. Prefer calling this and private-row
 * selection inside the same transaction when concurrent seat transfer is a concern.
 */
export async function resolveMatchAccessContext(
  db: MatchAccessDB,
  input: ResolveMatchAccessInput,
): Promise<MatchAccessResolveResult> {
  const game = await loadGameIdentity(db, input.gameIdOrSlug);
  if (!game) {
    return { status: "not_accessible" };
  }

  const rosterRows = await db
    .select({
      id: schema.gamePlayers.id,
      persona: schema.gamePlayers.persona,
      userId: schema.gamePlayers.userId,
      agentProfileId: schema.gamePlayers.agentProfileId,
      agentProfileOwnerId: schema.agentProfiles.userId,
    })
    .from(schema.gamePlayers)
    .leftJoin(
      schema.agentProfiles,
      eq(schema.gamePlayers.agentProfileId, schema.agentProfiles.id),
    )
    .where(eq(schema.gamePlayers.gameId, game.id))
    .orderBy(asc(schema.gamePlayers.joinedAt), asc(schema.gamePlayers.id));

  const roster: MatchAccessRosterPlayer[] = rosterRows.map((row) => ({
    id: row.id,
    name: personaDisplayName(row.persona, row.id),
    userId: row.userId,
    agentProfileId: row.agentProfileId,
  }));

  const ownedSeats: MatchAccessOwnedSeat[] = [];
  for (const row of rosterRows) {
    const ownsDirect = row.userId === input.subjectUserId;
    const ownsViaProfile = row.agentProfileOwnerId === input.subjectUserId;
    if (!ownsDirect && !ownsViaProfile) continue;
    ownedSeats.push({
      playerId: row.id,
      name: personaDisplayName(row.persona, row.id),
      agentProfileId: row.agentProfileId,
    });
  }

  ownedSeats.sort((left, right) => left.playerId.localeCompare(right.playerId));

  const isCreator = game.createdById === input.subjectUserId;
  const hasParticipatingOwnership = ownedSeats.length > 0;
  const hasCanonicalAccess = isCreator || hasParticipatingOwnership;

  if (!hasCanonicalAccess) {
    return { status: "not_accessible" };
  }

  const ownedPlayerIds = new Set(ownedSeats.map((seat) => seat.playerId));
  const ownedAgentProfileIds = new Set(
    ownedSeats
      .map((seat) => seat.agentProfileId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const context = buildMatchAccessContext({
    subjectUserId: input.subjectUserId,
    gameId: game.id,
    gameSlug: game.slug,
    gameStatus: game.status,
    transcriptCaptureVersion: game.transcriptCaptureVersion,
    isCreator,
    hasParticipatingOwnership,
    hasCanonicalAccess,
    ownedPlayerIds,
    ownedAgentProfileIds,
    ownedSeats,
    roster,
  });

  return { status: "resolved", context };
}

/**
 * Run ownership resolution and a callback against one database transaction so
 * concurrent seat transfers cannot mix pre/post ownership within one read.
 */
export async function withMatchAccessSnapshot<T>(
  db: DrizzleDB,
  input: ResolveMatchAccessInput,
  fn: (args: {
    tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
    resolution: MatchAccessResolveResult;
  }) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Stabilize game + roster rows for the duration of the snapshot.
    await tx.execute(sql`
      SELECT id FROM games
      WHERE id = ${input.gameIdOrSlug} OR slug = ${input.gameIdOrSlug}
      ORDER BY id
      FOR SHARE
    `);
    const resolution = await resolveMatchAccessContext(tx, input);
    if (resolution.status === "resolved") {
      await tx.execute(sql`
        SELECT id FROM game_players
        WHERE game_id = ${resolution.context.gameId}
        ORDER BY id
        FOR SHARE
      `);
      // Re-resolve after locks so the callback sees the locked snapshot.
      const locked = await resolveMatchAccessContext(tx, {
        subjectUserId: input.subjectUserId,
        gameIdOrSlug: resolution.context.gameId,
      });
      return fn({ tx, resolution: locked });
    }
    return fn({ tx, resolution });
  });
}

export function ownershipFingerprintForPlayerIds(
  ownedPlayerIds: Iterable<string>,
): string {
  const sorted = [...new Set(ownedPlayerIds)].sort();
  const material = `${OWNERSHIP_FINGERPRINT_DOMAIN}:${sorted.join(",")}`;
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

export function buildMatchAccessContext(input: {
  subjectUserId: string;
  gameId: string;
  gameSlug: string;
  gameStatus: string;
  transcriptCaptureVersion: number;
  isCreator: boolean;
  hasParticipatingOwnership: boolean;
  hasCanonicalAccess: boolean;
  ownedPlayerIds: ReadonlySet<string>;
  ownedAgentProfileIds: ReadonlySet<string>;
  ownedSeats: readonly MatchAccessOwnedSeat[];
  roster: readonly MatchAccessRosterPlayer[];
}): MatchAccessContext {
  const idToName = new Map<string, string>();
  const nameToIds = new Map<string, string[]>();

  for (const player of input.roster) {
    idToName.set(player.id, player.name);
    const key = normalizeName(player.name);
    const existing = nameToIds.get(key);
    if (existing) existing.push(player.id);
    else nameToIds.set(key, [player.id]);
  }

  const resolvePlayerId = (nameOrId: string): string | null => {
    if (!nameOrId) return null;
    if (idToName.has(nameOrId)) return nameOrId;
    const matches = nameToIds.get(normalizeName(nameOrId));
    if (!matches || matches.length !== 1) return null;
    return matches[0] ?? null;
  };

  const resolvePlayerName = (playerId: string): string | null =>
    idToName.get(playerId) ?? null;

  return {
    subjectUserId: input.subjectUserId,
    gameId: input.gameId,
    gameSlug: input.gameSlug,
    gameStatus: input.gameStatus,
    transcriptCaptureVersion: input.transcriptCaptureVersion,
    isCreator: input.isCreator,
    hasParticipatingOwnership: input.hasParticipatingOwnership,
    hasCanonicalAccess: input.hasCanonicalAccess,
    ownedPlayerIds: input.ownedPlayerIds,
    ownedAgentProfileIds: input.ownedAgentProfileIds,
    ownedSeats: input.ownedSeats,
    ownershipFingerprint: ownershipFingerprintForPlayerIds(input.ownedPlayerIds),
    roster: input.roster,
    resolvePlayerId,
    resolvePlayerName,
  };
}

/**
 * Whether private match lanes (authorized transcript, owned cognition) may open
 * for this context. Creator-only access is not enough.
 */
export function hasPrivateMatchLaneAccess(context: MatchAccessContext): boolean {
  return context.hasParticipatingOwnership && context.ownedPlayerIds.size > 0;
}

async function loadGameIdentity(
  db: MatchAccessDB,
  gameIdOrSlug: string,
): Promise<{
  id: string;
  slug: string;
  status: string;
  createdById: string | null;
  transcriptCaptureVersion: number;
} | null> {
  const row = (await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      createdById: schema.games.createdById,
      transcriptCaptureVersion: schema.games.transcriptCaptureVersion,
    })
    .from(schema.games)
    .where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug)))
    .limit(1))[0];
  return row ?? null;
}

function personaDisplayName(persona: string, fallbackId: string): string {
  try {
    const parsed = JSON.parse(persona) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      return parsed.name.trim();
    }
  } catch {
    // Invalid persona falls back to player id for resolution stability.
  }
  return fallbackId;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}
