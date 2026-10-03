import { isViewerGame } from "./game-visibility.js";
import { eq, or } from "drizzle-orm";
import { schema } from "../db/index.js";
import {
  HouseInspectionError,
  houseOwnedGameIds,
  type HouseReadDB,
} from "./house-game-access.js";
export class UnsupportedHouseGameError extends HouseInspectionError {
  readonly followUps;
  constructor(gameId: string, visible: boolean) {
    super(
      "unsupported_game_kind",
      "This tool inspects Influence-specific evidence. Use read_game for Werewolf.",
    );
    this.followUps = visible
      ? [
          {
            tool: "read_game" as const,
            arguments: {
              gameIdOrSlug: gameId,
              view: "current" as const,
              audience: "mystery" as const,
            },
          },
        ]
      : [];
  }
}
/** Run only after the tool's grant/role gate. Preserve owner scope before disclosing kind. */
export async function guardInfluenceInspection(
  db: HouseReadDB,
  id: unknown,
  access: { userId: string; producer: boolean },
  privateLane = false,
) {
  if (typeof id !== "string") return;
  const [game] = await db
    .select()
    .from(schema.games)
    .where(or(eq(schema.games.id, id), eq(schema.games.slug, id)))
    .limit(1);
  if (game?.gameKind !== "werewolf") return;
  if (
    !access.producer &&
    !(await houseOwnedGameIds(db, access.userId, !privateLane)).has(game.id)
  )
    throw new HouseInspectionError("not_accessible", "Game is unavailable");
  throw new UnsupportedHouseGameError(game.id, isViewerGame(game));
}
