import { inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export interface GameSeasonIdentity {
  id: string;
  slug: string;
  name: string;
}

export async function getGameSeasonIdentityMap(
  db: DrizzleDB,
  seasonIds: Array<string | null>,
): Promise<Map<string, GameSeasonIdentity>> {
  const ids = [...new Set(seasonIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({ id: schema.seasons.id, slug: schema.seasons.slug, name: schema.seasons.name })
    .from(schema.seasons)
    .where(inArray(schema.seasons.id, ids));

  return new Map(rows.map((season) => [season.id, season]));
}
