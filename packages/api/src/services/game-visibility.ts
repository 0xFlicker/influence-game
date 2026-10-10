import { and, eq, isNull, or, sql } from "drizzle-orm";
import { parseGameVisibility } from "@influence/engine/game-visibility";
import { schema, type DrizzleDB } from "../db/index.js";

export function storedGameVisibility(config: string) {
  const value: unknown = JSON.parse(config);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid game configuration");
  return parseGameVisibility("visibility" in value ? value.visibility : undefined);
}

/** Unsupported stored data stays inaccessible, including to ordinary operator viewing. */
export function isViewerGame(game: { id: string; config: string; hiddenAt?: string | null } | undefined): boolean {
  if (!game || game.hiddenAt) return false;
  try { storedGameVisibility(game.config); return true; }
  catch (error) { console.error(`[game-visibility] Invalid configuration for ${game.id}:`, error instanceof Error ? error.message : error); return false; }
}

/** Apply before limits/counts. Explicit null is invalid; only an absent field defaults. */
export function publicGameFilter() {
  return and(isNull(schema.games.hiddenAt), sql`jsonb_typeof(${schema.games.config}::jsonb) = 'object' AND (NOT (${schema.games.config}::jsonb ? 'visibility') OR ${schema.games.config}::jsonb->'visibility' = '"public"'::jsonb)`);
}

export async function viewerGameAvailable(db: DrizzleDB, id: string): Promise<boolean> {
  const [game] = await db.select({ id: schema.games.id, config: schema.games.config, hiddenAt: schema.games.hiddenAt }).from(schema.games)
    .where(or(eq(schema.games.id, id), eq(schema.games.slug, id)));
  return isViewerGame(game);
}
