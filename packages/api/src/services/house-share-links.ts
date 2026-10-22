import { randomInt } from "node:crypto";
import { eq, or, sql } from "drizzle-orm";
import { parseHouseShareTarget, type HouseShareTarget } from "@influence/engine/house-share-target";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";
import { resolvePublicPlayer } from "./public-player-identity.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export class ShareRateLimitError extends Error {}

/** Row locks make admission atomic across all API instances. No daily quota. */
export async function admitShareCreation(db: DrizzleDB, visitor: string, source: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM house_share_rate_limits WHERE reset_at < now()`);
    for (const [key, limit] of [[`source:${source}`, 6000], [`visitor:${visitor}`, 120]] as const) {
      const rows = await tx.execute(sql`
        INSERT INTO house_share_rate_limits (key, count, reset_at)
        VALUES (${key}, 1, now() + interval '1 minute')
        ON CONFLICT (key) DO UPDATE SET count = house_share_rate_limits.count + 1
        WHERE house_share_rate_limits.count < ${limit}
        RETURNING key`);
      if (rows.length === 0) throw new ShareRateLimitError("Too many share requests. Try again in a minute.");
    }
  });
}

/** Recheck availability at resolution: a saved link cannot unhide a game. */
export async function validateShareTarget(db: DrizzleDB, target: HouseShareTarget): Promise<boolean> {
  if (target.kind === "profile") return !!await resolvePublicPlayer(db, target.identifier!);
  if (target.kind !== "game") return true;
  const [game] = await db.select().from(schema.games).where(or(eq(schema.games.id, target.identifier!), eq(schema.games.slug, target.identifier!)));
  if (!game || !isViewerGame(game)) return false;
  if (target.mode && game.status !== "completed") return false;
  const query = new URL(target.path, "https://thehouse.game").searchParams;
  if (game.gameKind === "werewolf" && target.sequence !== undefined) return false;
  if (game.gameKind === "influence" && target.mode === "replay" && (query.has("audience") || query.has("cursor"))) return false;
  if (target.mode === "highlights") {
    const audience = query.get("audience");
    if (audience && (game.gameKind === "influence" ? audience !== "public" : audience === "public")) return false;
  }
  return true;
}

export async function saveShareLink(db: DrizzleDB, target: HouseShareTarget) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    // Concurrent identical shares converge; rare code collisions retry, never overwrite.
    const [created] = await db.insert(schema.houseShareLinks).values({ code, path: target.path }).onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await db.select().from(schema.houseShareLinks).where(eq(schema.houseShareLinks.path, target.path));
    if (existing) return existing;
  }
  throw new Error("Unable to allocate a House share link.");
}

export async function resolveShareLink(db: DrizzleDB, code: string) {
  const [link] = await db.select().from(schema.houseShareLinks).where(eq(schema.houseShareLinks.code, code));
  if (!link || !await validateShareTarget(db, parseHouseShareTarget(link.path))) return null;
  return { code: link.code, path: link.path };
}
