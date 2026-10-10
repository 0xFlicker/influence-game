import { and, desc, eq, or } from "drizzle-orm";
import { gameHref } from "@influence/engine/game-links";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame, storedGameVisibility } from "./game-visibility.js";
import { resolveSubjectGameAccessClaims } from "./match-access-context.js";

export type HouseReadDB = Pick<DrizzleDB, "select">;
export type HouseGame = typeof schema.games.$inferSelect;
export type HouseCollection = "public" | "mine" | "producer";
export class HouseInspectionError extends Error {
  constructor(
    public readonly code:
      | "not_accessible"
      | "invalid_input"
      | "invalid_cursor"
      | "unsupported_game_kind"
      | "not_started"
      | "not_completed"
      | "unavailable"
      | "entry_too_large",
    message: string,
  ) {
    super(message);
  }
}
export async function resolveHouseSpectatorGame(
  db: HouseReadDB,
  idOrSlug: string,
): Promise<HouseGame> {
  const [game] = await db
    .select()
    .from(schema.games)
    .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
    .limit(1);
  if (!game || !isViewerGame(game))
    throw new HouseInspectionError("not_accessible", "Game is unavailable");
  return game;
}
export function houseGameIdentity(game: HouseGame) {
  return {
    id: game.id,
    slug: game.slug,
    gameKind: game.gameKind,
    status: game.status,
    createdAt: game.createdAt,
    href: gameHref(game.slug),
  };
}
/** Both admission seats and the frozen started roster establish Werewolf ownership. */
export async function houseOwnedGameIds(
  db: HouseReadDB,
  userId: string,
  includeCreated = true,
): Promise<Set<string>> {
  const claims = await resolveSubjectGameAccessClaims(db, userId);
  const gameIds = includeCreated ? claims.gameIds : claims.joinedGameIds;
  const profiles = await db
    .select({ id: schema.agentProfiles.id })
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.userId, userId));
  const owned = new Set(profiles.map((p) => p.id));
  const seats = await db.select().from(schema.werewolfLobbySeats);
  for (const seat of seats)
    if (owned.has(seat.agentProfileId)) gameIds.add(seat.gameId);
  const starts = await db
    .select()
    .from(schema.werewolfEvents)
    .where(eq(schema.werewolfEvents.sequence, 1));
  for (const row of starts)
    if (
      row.event?.type === "werewolf.started" &&
      Array.isArray(row.event.payload?.players) &&
      row.event.payload.players.some(
        (p) =>
          p &&
          typeof p.agentProfileId === "string" &&
          owned.has(p.agentProfileId),
      )
    )
      gameIds.add(row.gameId);
  return gameIds;
}
/** Filter eligibility before a shared, deterministic limit. No event reads for public discovery. */
export async function listHouseGames(
  db: HouseReadDB,
  input: {
    collection?: HouseCollection;
    gameKind?: HouseGame["gameKind"];
    limit?: number;
  },
  access: { userId: string; producer: boolean },
) {
  const collection = input.collection ?? "public";
  if (
    !Number.isSafeInteger(input.limit ?? 20) ||
    (input.limit ?? 20) < 1 ||
    (input.limit ?? 20) > 100
  )
    throw new HouseInspectionError(
      "invalid_input",
      "Limit must be between 1 and 100",
    );
  if (collection === "producer" && !access.producer)
    throw new HouseInspectionError(
      "not_accessible",
      "Producer collection requires producer access",
    );
  const owned =
    collection === "mine" ? await houseOwnedGameIds(db, access.userId) : null;
  const rows = await db
    .select()
    .from(schema.games)
    .where(
      and(
        input.gameKind ? eq(schema.games.gameKind, input.gameKind) : undefined,
      ),
    )
    .orderBy(desc(schema.games.createdAt), desc(schema.games.id));
  const games = rows
    .filter((game) => {
      if (collection === "producer") return true;
      if (!isViewerGame(game)) return false;
      return collection === "mine"
        ? owned!.has(game.id)
        : storedGameVisibility(game.config) === "public";
    })
    .slice(0, input.limit ?? 20)
    .map(houseGameIdentity);
  return { schemaVersion: 2 as const, collection, games };
}
