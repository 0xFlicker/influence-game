import { MAX_NEW_GAME_PLAYERS } from "@influence/engine";
import { and, countDistinct, eq, inArray, isNull, ne, sql, type SQLWrapper } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { publiclyVisibleAgentContent } from "./agent-content-eligibility.js";
import { publicAgentAwardsByIds } from "./awards.js";
import { isImportedSyntheticPlayer } from "./public-player-identity.js";

const { games, gameEvents, gamePlayers, werewolfEvents, agentProfiles, users } = schema;
type Game = Pick<typeof games.$inferSelect, "id" | "gameKind">;
type RosterDB = Pick<DrizzleDB, "select" | "execute">;
const maxLabelJsonBytes = 300;
const maxBadgeJsonBytes = 128;
const maxBadgesPerPlayer = 2;

/** Budget escaped UTF-8, the representation that the worker actually validates. */
export function boundStartAnnouncementLabel(value: string) {
  let bytes = 2; // Quotes.
  let label = "";
  for (const character of value) {
    bytes += Buffer.byteLength(JSON.stringify(character)) - 2;
    if (bytes > maxLabelJsonBytes) break;
    label += character;
  }
  return label;
}

function recordedInstant(value: SQLWrapper) {
  return sql`CASE WHEN ${value} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'
    AND pg_input_is_valid(${value}, 'timestamp with time zone') THEN ${value}::timestamptz END`;
}

async function readOpening(db: RosterDB, game: Game) {
  if (game.gameKind === "werewolf") {
    const [opening] = await db.select({
      players: sql<unknown>`${werewolfEvents.event}->'payload'->'players'`,
      startedAt: sql<string | null>`(${recordedInstant(games.startedAt)})::text`,
    }).from(werewolfEvents).innerJoin(games, eq(games.id, werewolfEvents.gameId))
      .where(and(eq(werewolfEvents.gameId, game.id), eq(werewolfEvents.sequence, 1),
        sql`${werewolfEvents.event}->>'type' = 'werewolf.started' AND ${werewolfEvents.event}->>'gameId' = ${game.id}
          AND ${werewolfEvents.event}->>'sequence' = '1'`));
    return opening;
  }
  const [opening] = await db.select({
    players: sql<unknown>`${gameEvents.envelope}->'payload'->'players'`,
    startedAt: sql<string | null>`(${recordedInstant(gameEvents.createdAt)})::text`,
  }).from(gameEvents).where(and(eq(gameEvents.gameId, game.id), eq(gameEvents.sequence, 1),
    eq(gameEvents.eventType, "game.roster_initialized"),
    sql`${gameEvents.envelope}->>'type' = 'game.roster_initialized' AND ${gameEvents.envelope}->>'gameId' = ${game.id}
      AND ${gameEvents.envelope}->>'sequence' = '1'`));
  return opening;
}

function readFrozenPlayers(players: unknown, maxPlayers: number) {
  if (!Array.isArray(players) || !players.length || players.length > maxPlayers) return null;
  const roster: { id: string; name: string; agentProfileId: string | null }[] = [];
  for (const player of players as unknown[]) {
    if (!player || typeof player !== "object" || !("id" in player) || typeof player.id !== "string" || !player.id
        || !("name" in player) || typeof player.name !== "string" || !player.name.trim()) return null;
    roster.push({ id: player.id, name: player.name, agentProfileId: "agentProfileId" in player
      && typeof player.agentProfileId === "string" ? player.agentProfileId : null });
  }
  return new Set(roster.map(player => player.id)).size === roster.length ? roster : null;
}

async function readPublicRosterProfileIds(db: RosterDB, profileIds: string[]) {
  const ids = [...new Set(profileIds)];
  if (!ids.length) return [];
  const rows = await db.select({ id: agentProfiles.id, wallet: users.walletAddress }).from(agentProfiles)
    .innerJoin(users, eq(users.id, agentProfiles.userId))
    .where(and(inArray(agentProfiles.id, ids), publiclyVisibleAgentContent()));
  return rows.filter(row => !isImportedSyntheticPlayer(row.wallet)).map(row => row.id);
}

async function readPriorPublicGames(db: RosterDB, game: Game, startedAt: string | null, profileIds: string[]) {
  if (!startedAt || !profileIds.length) return new Map<string | null, number>();
  // Match public viewer visibility without casting malformed historical configurations.
  const config = sql`(CASE WHEN ${games.config} IS JSON OBJECT THEN ${games.config}::jsonb END)`;
  const priorPublic = and(ne(games.id, game.id), eq(games.gameKind, game.gameKind), eq(games.status, "completed"),
    isNull(games.hiddenAt), sql`(NOT (${config} ? 'visibility') OR ${config}->'visibility' = '"public"'::jsonb)`,
    sql`${recordedInstant(games.endedAt)} < ${startedAt}::timestamptz`);

  if (game.gameKind === "influence") {
    const rows = await db.select({ profileId: gamePlayers.agentProfileId, count: countDistinct(games.id) })
      .from(gamePlayers).innerJoin(games, eq(games.id, gamePlayers.gameId))
      .where(and(priorPublic, inArray(gamePlayers.agentProfileId, profileIds))).groupBy(gamePlayers.agentProfileId);
    return new Map(rows.map(row => [row.profileId, row.count]));
  }

  const openingPlayers = sql`${werewolfEvents.event}->'payload'->'players'`;
  const profileId = sql<string>`seat.player->>'agentProfileId'`;
  const rows = await db.execute<{ profileId: string; count: number }>(sql`
    SELECT ${profileId} AS "profileId", count(DISTINCT ${games.id})::integer AS count
    FROM ${games} JOIN ${werewolfEvents} ON ${werewolfEvents.gameId} = ${games.id} AND ${werewolfEvents.sequence} = 1
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(${openingPlayers}) = 'array'
      THEN ${openingPlayers} ELSE '[]'::jsonb END) seat(player)
    WHERE ${priorPublic} AND ${werewolfEvents.event}->>'type' = 'werewolf.started'
      AND ${werewolfEvents.event}->>'gameId' = ${games.id} AND ${werewolfEvents.event}->>'sequence' = '1'
      AND jsonb_typeof(seat.player->'id') = 'string' AND jsonb_typeof(seat.player->'agentProfileId') = 'string'
      AND ${inArray(profileId, profileIds)}
    GROUP BY ${profileId}`);
  return new Map(rows.map(row => [row.profileId, row.count]));
}

function awardPriority(code: string) {
  switch (code) {
    case "season-0-influence-champion":
    case "season-0-werewolf-champion":
    case "season-0-agent-crown": return 0;
    case "season-0-top-eight": return 1;
    case "season-0-agent-participant": return 3;
    default: return 2;
  }
}

/** Start announcements get public frozen names and profile facts, independent of live strategy and roles. */
export async function readDiscordAnnouncementRoster(db: RosterDB, game: Game) {
  await db.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
  const opening = await readOpening(db, game);
  if (!opening) return null;
  const roster = readFrozenPlayers(opening.players, game.gameKind === "werewolf" ? 8 : MAX_NEW_GAME_PLAYERS);
  if (!roster) return null;

  const influenceSeats = game.gameKind === "influence" ? await db.select({ id: gamePlayers.id, profileId: gamePlayers.agentProfileId })
    .from(gamePlayers).where(and(eq(gamePlayers.gameId, game.id), inArray(gamePlayers.id, roster.map(seat => seat.id)))) : [];
  const profileBySeat = new Map(influenceSeats.map(seat => [seat.id, seat.profileId]));
  const cast = roster.map(seat => ({ name: seat.name,
    profileId: game.gameKind === "influence" ? profileBySeat.get(seat.id) : seat.agentProfileId,
  }));
  const publicIds = await readPublicRosterProfileIds(db, cast.flatMap(seat => seat.profileId ? [seat.profileId] : []));
  const publicProfileIds = new Set(publicIds);
  const [history, awards] = await Promise.all([
    readPriorPublicGames(db, game, opening.startedAt, publicIds),
    publicAgentAwardsByIds(db, publicIds),
  ]);

  // With at most 12 seats, these field budgets keep the entire snapshot below the worker's 8192 bytes.
  return cast.map(({ name, profileId }) => {
    const publicId = profileId && publicProfileIds.has(profileId) ? profileId : null;
    const titles = publicId ? (awards.get(publicId) ?? [])
      .filter(award => award.title.trim() && Buffer.byteLength(JSON.stringify(award.title)) <= maxBadgeJsonBytes)
      .sort((a, b) => awardPriority(a.code) - awardPriority(b.code)).map(award => award.title) : [];
    return { name: boundStartAnnouncementLabel(name),
      priorPublicGames: publicId && opening.startedAt ? history.get(publicId) ?? 0 : null,
      badges: [...new Set(titles)].slice(0, maxBadgesPerPlayer),
    };
  });
}
