import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { parseHouseShareTarget, SHARE_CODE_PATTERN, type HouseShareTarget } from "@influence/engine/house-share-target";
import { uuid } from "@influence/engine/operational-errors";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";
import { readPublicAgentIdentity } from "./public-agent-profile.js";
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

/** Recheck visibility at resolution for games and profiles. */
export async function validateShareTarget(db: DrizzleDB, target: HouseShareTarget): Promise<boolean> {
  if (target.kind === "profile") return !!await resolvePublicPlayer(db, target.identifier!);
  if (target.kind === "agent") return !!await readPublicAgentIdentity(db, target.identifier!);
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

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export async function saveShareLink(db: DrizzleDB, target: HouseShareTarget, ownerId?: string) {
  if (!ownerId) return insertShareLink(db, target);
  return db.transaction(async tx => {
    const [owner] = await tx.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.id, ownerId), isNull(schema.users.deletedAt))).for("share");
    if (owner) await tx.insert(schema.houseShareAccounts).values({ userId: owner.id }).onConflictDoNothing();
    return insertShareLink(tx, target, owner?.id);
  });
}

async function insertShareLink(db: DrizzleDB | Tx, target: HouseShareTarget, ownerId?: string) {
  const scope = ownerId ? eq(schema.houseShareLinks.ownerId, ownerId) : isNull(schema.houseShareLinks.analyticsId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    // Concurrent identical shares converge; rare code collisions retry, never overwrite.
    const [created] = await db.insert(schema.houseShareLinks)
      .values({ code, path: target.path, ownerId, analyticsId: ownerId ? randomUUID() : null })
      .onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await db.select().from(schema.houseShareLinks).where(and(scope, eq(schema.houseShareLinks.path, target.path)));
    if (existing) return existing;
  }
  throw new Error("Unable to allocate a House share link.");
}

export async function resolveShareLink(db: DrizzleDB, code: string, issueOpenTicket = false) {
  const [link] = await db.select().from(schema.houseShareLinks).where(eq(schema.houseShareLinks.code, code));
  if (!link || !await validateShareTarget(db, parseHouseShareTarget(link.path))) return null;
  return {
    code: link.code,
    path: link.path,
    ...(issueOpenTicket && link.ownerId ? { openTicket: createOpenTicket(code) } : {}),
  };
}

const OPEN_TICKET_TTL_MS = 15 * 60_000;

function signOpenTicket(value: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be set");
  return createHmac("sha256", secret).update(`house-share-open:${value}`).digest("base64url");
}

function createOpenTicket(code: string) {
  const payload = `${code}.${randomUUID()}.${Date.now()}`;
  return `${payload}.${signOpenTicket(payload)}`;
}

export async function recordShareOpen(db: DrizzleDB, ticket: unknown, visitorId?: string) {
  if (typeof ticket !== "string" || ticket.length > 110) return null;
  const fields = ticket.split(".");
  const [code, id, time, signature] = fields;
  if (fields.length !== 4 || !code || !SHARE_CODE_PATTERN.test(code) || !id || !uuid(id) ||
      !time || !signature || !/^[\w-]{43}$/.test(signature)) return null;
  const age = Date.now() - Number(time);
  if (!Number.isFinite(age) || age < 0 || age > OPEN_TICKET_TTL_MS) return null;
  const expected = signOpenTicket(`${code}.${id}.${time}`);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  const [link] = await db.select({
    path: schema.houseShareLinks.path,
    ownerId: schema.houseShareLinks.ownerId,
    shareLinkId: schema.houseShareLinks.analyticsId,
    sharingAccountId: schema.houseShareAccounts.analyticsId,
  }).from(schema.houseShareLinks)
    .innerJoin(schema.users, eq(schema.users.id, schema.houseShareLinks.ownerId))
    .innerJoin(schema.houseShareAccounts, eq(schema.houseShareAccounts.userId, schema.houseShareLinks.ownerId))
    .where(and(eq(schema.houseShareLinks.code, code), isNull(schema.users.deletedAt)));
  if (!link?.shareLinkId || link.ownerId === visitorId ||
      !await validateShareTarget(db, parseHouseShareTarget(link.path))) return null;

  const created = await db.insert(schema.houseShareOpens).values({ id, linkCode: code }).onConflictDoNothing()
    .returning({ openedAt: schema.houseShareOpens.openedAt });
  return { openId: id, share_link_id: link.shareLinkId, sharing_account_id: link.sharingAccountId,
    openedAt: created[0]?.openedAt.toISOString() ?? null };
}
