import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { HouseParticipation, ParticipationFilter } from "@influence/engine/house-participation";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame, publicGameFilter } from "./game-visibility.js";
import { readHouseGameResultsInTransaction } from "./house-game-results.js";
import { readEpisodePresentations } from "./episode-presentation.js";

type Game = typeof schema.games.$inferSelect;
type Candidate = { game: Game; playerId: string; agentProfileId: string | null; agentName: string; totalPlayers: number };

export class HistoryPageUnavailable extends Error {
  constructor() { super("Game history is temporarily unavailable"); }
}

/** Visibility and ownership precede limits. No scoring or completion side effects. */
interface ParticipationOptions {
  publicOnly?: boolean;
  agentProfileId?: string;
  gameKind?: ParticipationFilter;
  limit?: number;
}

export async function readHouseParticipation(db: DrizzleDB, ownerId: string, options: ParticipationOptions = {}): Promise<HouseParticipation[]> {
  return db.transaction(tx => readParticipationSnapshot(tx, ownerId, options), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

type HistoryCursor = { gameKind: ParticipationFilter; hasInstant: boolean; epoch: string; gameId: string; playerId: string };

export function parseHistoryCursor(raw: string): HistoryCursor | null {
  if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 6 || value[0] !== 3 || !["all", "influence", "werewolf"].includes(value[1]) || typeof value[2] !== "boolean" || typeof value[3] !== "string" || !/^-?\d{1,20}(?:\.\d{1,6})?$/.test(value[3]) || value.slice(4).some(v => typeof v !== "string" || !v || v.length > 512)) return null;
    return { gameKind: value[1], hasInstant: value[2], epoch: value[3], gameId: value[4], playerId: value[5] };
  } catch { return null; }
}

/** Bounds canonical result reconstruction to one owner-scoped page, including all owned seats. */
export async function readHouseParticipationPage(db: DrizzleDB, ownerId: string, limit: number, cursor: HistoryCursor | null, gameKind: ParticipationFilter = "all") {
  return db.transaction(async tx => {
    // Naive historical timestamps are interpreted as UTC, consistently across DB sessions.
    await tx.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
    const boundary = cursor ? sql`WHERE (has_instant, instant, game_id COLLATE "C", player_id COLLATE "C") < (${cursor.hasInstant}, ${cursor.epoch}::numeric, ${cursor.gameId} COLLATE "C", ${cursor.playerId} COLLATE "C")` : sql``;
    const keys = await tx.execute<{ has_instant: boolean; epoch: string; game_id: string; player_id: string }>(sql`
      WITH visible_games AS (
        SELECT id, game_kind, ended_at, config,
          CASE WHEN config IS JSON OBJECT THEN config::jsonb ELSE NULL END AS cfg
        FROM games WHERE status = 'completed' AND ended_at IS NOT NULL AND hidden_at IS NULL
      ), valid_games AS NOT MATERIALIZED (
        SELECT * FROM visible_games WHERE cfg IS NOT NULL AND (NOT (cfg ? 'visibility') OR cfg->'visibility' IN ('"public"'::jsonb, '"unlisted"'::jsonb))
      ), owned AS (
        SELECT g.ended_at AS completed_at, g.id AS game_id, p.id AS player_id
        FROM valid_games g JOIN game_players p ON p.game_id = g.id
        WHERE g.game_kind = 'influence' AND p.user_id = ${ownerId} AND ${gameKind !== "werewolf"}
        UNION ALL
        SELECT g.ended_at, g.id, p.value->>'id'
        FROM valid_games g JOIN werewolf_events e ON e.game_id = g.id AND e.sequence = 1
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.event->'payload'->'players') = 'array' THEN e.event->'payload'->'players' ELSE '[]'::jsonb END) p(value)
        JOIN agent_profiles a ON a.id = p.value->>'agentProfileId' AND a.user_id = ${ownerId}
        WHERE g.game_kind = 'werewolf' AND ${gameKind !== "influence"} AND e.event->>'type' = 'werewolf.started' AND e.event->>'gameId' = g.id AND e.event->>'sequence' = '1' AND p.value->>'id' IS NOT NULL
      ), parsed AS (
        SELECT *, CASE WHEN completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'
          AND pg_input_is_valid(completed_at, 'timestamp with time zone') THEN completed_at::timestamptz ELSE NULL END AS ts FROM owned
      ), ranked AS (
        SELECT game_id, player_id, (ts IS NOT NULL AND isfinite(ts)) AS has_instant,
          CASE WHEN ts IS NOT NULL AND isfinite(ts) THEN extract(epoch FROM ts) ELSE 0::numeric END AS instant
        FROM parsed
      )
      SELECT has_instant, instant::text AS epoch, game_id, player_id FROM ranked ${boundary}
      ORDER BY has_instant DESC, instant DESC, game_id COLLATE "C" DESC, player_id COLLATE "C" DESC
      LIMIT ${limit + 1}
    `);
    const page = keys.slice(0, limit);
    const items = page.length ? await readParticipationSnapshot(tx, ownerId, { gameKind }, page.map(k => ({ gameId: k.game_id, playerId: k.player_id }))) : [];
    const last = page.at(-1);
    const nextCursor = keys.length > limit && last ? Buffer.from(JSON.stringify([3, gameKind, last.has_instant, last.epoch, last.game_id, last.player_id])).toString("base64url") : null;
    return { items, nextCursor };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function readParticipationSnapshot(db: Pick<DrizzleDB, "select" | "selectDistinctOn">, ownerId: string, options: ParticipationOptions, selectedKeys?: { gameId: string; playerId: string }[]): Promise<HouseParticipation[]> {
  const filter = options.gameKind ?? "all";
  const visible = options.publicOnly ? publicGameFilter() : isNull(schema.games.hiddenAt);
  const completed = and(eq(schema.games.status, "completed"), isNotNull(schema.games.endedAt), visible);
  const candidates: Candidate[] = [];
  if (filter !== "werewolf") {
    const query = db.select({ game: schema.games, player: schema.gamePlayers,
      totalPlayers: sql<number>`(SELECT count(*)::int FROM game_players seats WHERE seats.game_id = ${schema.games.id})`,
    }).from(schema.gamePlayers).innerJoin(schema.games, eq(schema.games.id, schema.gamePlayers.gameId))
      .where(and(completed, eq(schema.games.gameKind, "influence"), eq(schema.gamePlayers.userId, ownerId), selectedKeys ? inArray(schema.games.id, selectedKeys.map(k => k.gameId)) : undefined, options.agentProfileId ? eq(schema.gamePlayers.agentProfileId, options.agentProfileId) : undefined))
      .orderBy(desc(schema.games.endedAt), desc(schema.games.id), desc(schema.gamePlayers.id));
    const rows = await (options.limit === undefined ? query : query.limit(options.limit));
    for (const { game, player, totalPlayers } of rows) {
      if (!isViewerGame(game)) continue;
      const persona: unknown = JSON.parse(player.persona);
      const name = persona && typeof persona === "object" && "name" in persona && typeof persona.name === "string" ? persona.name : "Unknown agent";
      candidates.push({ game, playerId: player.id, agentProfileId: player.agentProfileId, agentName: name, totalPlayers });
    }
  }
  if (filter !== "influence") {
    // Query only openings with an owned profile; direct-created games need no lobby seats.
    const query = db.select({ game: schema.games, event: schema.werewolfEvents.event })
      .from(schema.games).innerJoin(schema.werewolfEvents, and(eq(schema.games.id, schema.werewolfEvents.gameId), eq(schema.werewolfEvents.sequence, 1)))
      .where(and(completed, eq(schema.games.gameKind, "werewolf"), selectedKeys ? inArray(schema.games.id, selectedKeys.map(k => k.gameId)) : undefined, sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${schema.werewolfEvents.event}->'payload'->'players') = 'array' THEN ${schema.werewolfEvents.event}->'payload'->'players' ELSE '[]'::jsonb END) p
        JOIN agent_profiles a ON a.id = p->>'agentProfileId' WHERE a.user_id = ${ownerId}
        AND (${options.agentProfileId ?? null}::text IS NULL OR a.id = ${options.agentProfileId ?? null})
      )`)).orderBy(desc(schema.games.endedAt), desc(schema.games.id));
    const rows = await (options.limit === undefined ? query : query.limit(options.limit));
    if (rows.length) {
      if (selectedKeys) {
        for (const { event } of rows) {
          if (event.type !== "werewolf.started" || !Array.isArray(event.payload?.players) || event.payload.players.length > 1000) throw new HistoryPageUnavailable();
          const ids = new Set<string>();
          for (const player of event.payload.players) {
            if (!player || typeof player !== "object" || typeof player.id !== "string" || !player.id || player.id.length > 512 || ids.has(player.id)
              || (player.agentProfileId != null && (typeof player.agentProfileId !== "string" || !player.agentProfileId || player.agentProfileId.length > 512))) throw new HistoryPageUnavailable();
            ids.add(player.id);
          }
        }
      }
      // Hydrate only profiles mentioned by the selected openings; an owner may
      // have arbitrarily many saved profiles unrelated to this page.
      const profileIds = selectedKeys ? [...new Set(rows.flatMap(({ event }) => event.type === "werewolf.started"
        ? event.payload.players.flatMap(player => player.agentProfileId ? [player.agentProfileId] : []) : []))] : null;
      const owned = new Set((await db.select({ id: schema.agentProfiles.id }).from(schema.agentProfiles)
        .where(and(eq(schema.agentProfiles.userId, ownerId), profileIds ? inArray(schema.agentProfiles.id, profileIds) : undefined, options.agentProfileId ? eq(schema.agentProfiles.id, options.agentProfileId) : undefined))).map(p => p.id));
      for (const { game, event } of rows) {
        if (!isViewerGame(game) || event.type !== "werewolf.started" || event.gameId !== game.id || event.sequence !== 1) continue;
        for (const player of event.payload.players) if (player.agentProfileId && owned.has(player.agentProfileId)) {
          candidates.push({ game, playerId: player.id, agentProfileId: player.agentProfileId, agentName: player.name, totalPlayers: event.payload.players.length });
        }
      }
    }
  }
  candidates.sort((a,b) => b.game.endedAt!.localeCompare(a.game.endedAt!) || b.game.id.localeCompare(a.game.id) || b.playerId.localeCompare(a.playerId));
  let selected: Candidate[];
  if (selectedKeys) {
    selected = [];
    const seen = new Set<string>();
    for (const key of selectedKeys) {
      const identity = JSON.stringify([key.gameId, key.playerId]);
      if (seen.has(identity)) throw new HistoryPageUnavailable();
      seen.add(identity);
      const matches = candidates.filter(row => row.game.id === key.gameId && row.playerId === key.playerId);
      if (matches.length !== 1) throw new HistoryPageUnavailable();
      selected.push(matches[0]!);
    }
  } else selected = options.limit ? candidates.slice(0, options.limit) : candidates;
  const games = [...new Map(selected.map(row => [row.game.id, row.game])).values()];
  if (!games.length) return [];
  const [episodes, receipts] = await Promise.all([
    readEpisodePresentations(db, games, { includeEpisodeNumbers: false }),
    db.select().from(schema.competitionReceipts).where(and(inArray(schema.competitionReceipts.gameId, games.map(g => g.id)),
      eq(schema.competitionReceipts.ownerId, ownerId), eq(schema.competitionReceipts.eligibilityStatus, "eligible"))),
  ]);
  // One canonical read per selected game, not per owned seat. The caller bounds public history before result projection.
  const outcomes = new Map<string, Awaited<ReturnType<typeof readHouseGameResultsInTransaction>>>();
  for (const game of games) outcomes.set(game.id, await readHouseGameResultsInTransaction(db, game.id, episodes.get(game.id)));
  const points = new Map(receipts.map(r => [`${r.gameId}:${r.agentProfileId}`, r.totalPoints]));
  return selected.map(({ game, playerId, agentProfileId, agentName, totalPlayers }): HouseParticipation => {
    const identity = { gameId: game.id, gameSlug: game.slug, gameTitle: episodes.get(game.id)?.title ?? game.slug,
      playerId, agentProfileId, agentName, totalPlayers, completedAt: game.endedAt! };
    const read = outcomes.get(game.id)!;
    if (game.gameKind === "werewolf") {
      const result = read.ok && read.gameKind === "werewolf" ? read.results : null;
      const player = result?.players.find(p => p.id === playerId);
      return { ...identity, gameKind: "werewolf", result: result && player ? {
        outcome: result.outcome.faction === null ? "draw" : player.won ? "win" : "loss",
        faction: player.faction, alive: player.alive, eliminationDay: player.elimination?.day ?? null, days: result.day,
      } : null };
    }
    const result = read.ok && read.gameKind === "influence" ? read.results : null;
    const player = result?.players.find(p => p.id === playerId);
    return { ...identity, gameKind: "influence", result: result ? {
      outcome: result.summary.winner ? result.summary.winner.id === playerId ? "win" : "loss" : "unknown",
      placement: player?.placement ?? null,
      eliminated: player && player.status !== "unknown" ? player.status === "eliminated" : null,
      rounds: result.summary.roundsPlayed, totalPoints: points.get(`${game.id}:${agentProfileId}`) ?? null,
    } : null };
  });
}
