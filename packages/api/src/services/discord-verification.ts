import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPermissionsForUser } from "../db/rbac.js";
import { getPostgresConstraintName } from "../lib/postgres-errors.js";
import { DiscordVerificationError, type DiscordOAuthConfig, type DiscordIdentityExchange } from "./discord-oauth.js";

const connections = schema.discordConnections;
const attempts = schema.discordVerificationAttempts;
export const hashDiscordSecret = (value: string) => createHash("sha256").update(value).digest("hex");
type Transaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

function invalidAttempt(): never {
  throw new DiscordVerificationError("invalid_attempt", 400, "This verification has expired or belongs to another sign-in. Start again.");
}
function conflict(): never {
  throw new DiscordVerificationError("connection_conflict", 409, "One of these accounts is already connected. Disconnect the existing link first.");
}

export function discordCommunityRoles(roles: string[]): string[] {
  const highest = roles.includes("sysop") ? 3 : roles.includes("admin") ? 2 : roles.includes("moderator") ? 1 : 0;
  return ["user", "moderator", "admin", "sysop"].slice(0, highest + 1);
}

async function lockAccount(tx: Transaction, userId: string) {
  const [user] = await tx.select({ id: schema.users.id, deletedAt: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, userId)).for("update");
  if (!user || user.deletedAt) invalidAttempt();
}

export async function startDiscordVerification(db: DrizzleDB, userId: string, nonce: string, config: DiscordOAuthConfig) {
  const state = randomBytes(32).toString("base64url");
  await db.transaction(async tx => {
    await lockAccount(tx, userId);
    await tx.delete(attempts).where(and(eq(attempts.userId, userId), lt(attempts.expiresAt, sql`now()`)));
    const active = await tx.select({ hash: attempts.stateHash }).from(attempts).where(eq(attempts.userId, userId));
    if (active.length >= 10) throw new DiscordVerificationError("too_many_attempts", 429, "Too many verification attempts. Try again in ten minutes.");
    const [existing] = await tx.select().from(connections).where(eq(connections.userId, userId));
    if (existing) conflict();
    await tx.insert(attempts).values({ stateHash: hashDiscordSecret(state), nonceHash: hashDiscordSecret(nonce), userId,
      applicationId: config.applicationId, redirectUri: config.redirectUri, guildId: config.guildId, status: "pending",
      expiresAt: sql`now() + interval '10 minutes'` });
  });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({ client_id: config.applicationId, redirect_uri: config.redirectUri,
    response_type: "code", scope: "identify", state, prompt: "consent", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(nonce).digest("base64url") }).toString();
  return { authorizationUrl: url.toString(), state };
}

function boundAttempt(userId: string, state: string, nonce: string) {
  return and(eq(attempts.stateHash, hashDiscordSecret(state)), eq(attempts.userId, userId),
    eq(attempts.nonceHash, hashDiscordSecret(nonce)), gt(attempts.expiresAt, sql`now()`));
}

export async function exchangeDiscordVerification(db: DrizzleDB, userId: string, input: { state: string; nonce: string; code: string }, config: DiscordOAuthConfig, exchange: DiscordIdentityExchange) {
  const binding = boundAttempt(userId, input.state, input.nonce);
  // Claim before provider I/O: a duplicate request cannot exchange the same code twice.
  const [attempt] = await db.update(attempts).set({ status: "exchanging" }).where(and(binding, eq(attempts.status, "pending"),
    eq(attempts.applicationId, config.applicationId), eq(attempts.redirectUri, config.redirectUri), eq(attempts.guildId, config.guildId))).returning();
  if (!attempt) {
    const [verified] = await db.select().from(attempts).where(and(binding, eq(attempts.status, "verified")));
    if (verified?.discordId && verified.username) return { id: verified.discordId, username: verified.username };
    invalidAttempt();
  }
  const identity = await exchange(input.code, config, input.nonce);
  const [verified] = await db.update(attempts).set({ status: "verified", discordId: identity.id, username: identity.username })
    .where(and(boundAttempt(userId, input.state, input.nonce), eq(attempts.status, "exchanging"))).returning();
  if (!verified) invalidAttempt();
  return identity;
}

export async function confirmDiscordVerification(db: DrizzleDB, userId: string, state: string, nonce: string, config: DiscordOAuthConfig) {
  try {
    await db.transaction(async tx => {
      await lockAccount(tx, userId);
      const [attempt] = await tx.select().from(attempts).where(boundAttempt(userId, state, nonce)).for("update");
      if (!attempt?.discordId || !attempt.username || !["verified", "confirmed"].includes(attempt.status)) invalidAttempt();
      if (attempt.applicationId !== config.applicationId || attempt.guildId !== config.guildId || attempt.redirectUri !== config.redirectUri) invalidAttempt();
      const [existing] = await tx.select().from(connections).where(eq(connections.userId, userId));
      if (existing) {
        if (existing.discordId !== attempt.discordId || existing.disconnecting || existing.guildId !== attempt.guildId) conflict();
      } else {
        // A confirmed attempt must never resurrect a connection after disconnect.
        if (attempt.status === "confirmed") invalidAttempt();
        await tx.insert(connections).values({ userId, discordId: attempt.discordId, username: attempt.username, guildId: attempt.guildId });
        await tx.insert(schema.discordConnectionAudit).values({ userId, discordId: attempt.discordId, action: "connected" });
      }
      await tx.update(attempts).set({ status: "confirmed" }).where(eq(attempts.stateHash, attempt.stateHash));
    });
  } catch (error) {
    if (["discord_connections_user_id_unique", "discord_connections_discord_id_unique", "discord_connections_user_id_key", "discord_connections_discord_id_key"].includes(getPostgresConstraintName(error) ?? "")) conflict();
    throw error;
  }
  return readDiscordConnection(db, userId);
}

export async function readDiscordConnection(db: DrizzleDB, userId: string) {
  const [row] = await db.select().from(connections).where(eq(connections.userId, userId));
  if (!row) return { connection: null };
  const { roles } = await getPermissionsForUser(db, userId);
  return { connection: { username: row.username, discordId: row.discordId, disconnecting: row.disconnecting,
    roles: row.disconnecting ? [] : discordCommunityRoles(roles),
    syncStatus: row.deliveredRevision === row.revision ? "synced" : row.lastError ? "retrying" : "pending",
    lastError: row.lastError, syncedAt: row.syncedAt?.toISOString() ?? null } };
}

export async function changeDiscordConnection(db: DrizzleDB, userId: string, action: "refresh" | "disconnect") {
  await db.transaction(async tx => {
    await lockAccount(tx, userId);
    const [row] = await tx.select().from(connections).where(eq(connections.userId, userId)).for("update");
    if (!row || (row.disconnecting && action === "disconnect")) return;
    if (row.disconnecting) throw new DiscordVerificationError("disconnect_pending", 409, "Server access removal is still pending.");
    await tx.update(connections).set({ disconnecting: action === "disconnect", revision: row.revision + 1,
      nextAttemptAt: sql`now()`, attempts: 0, lastError: null }).where(eq(connections.id, row.id));
    if (action === "disconnect") await tx.delete(attempts).where(eq(attempts.userId, userId));
    await tx.insert(schema.discordConnectionAudit).values({ userId, discordId: row.discordId, action });
  });
  return readDiscordConnection(db, userId);
}

/** Resolve fresh authority for the trusted Discord controller; never a login token. */
export async function resolveDiscordAuthority(db: DrizzleDB | Transaction, discordId: string, guildId: string) {
  const [connection] = await db.select().from(connections).where(and(eq(connections.discordId, discordId), eq(connections.guildId, guildId), eq(connections.disconnecting, false)));
  if (!connection) return { connected: false as const };
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, connection.userId));
  const [service] = await db.select().from(schema.servicePrincipals).where(eq(schema.servicePrincipals.userId, connection.userId));
  if (!user || user.deletedAt || service || user.walletAddress === "0x0000000000000000000000000000000000000000") return { connected: false as const };
  const authority = await getPermissionsForUser(db, connection.userId);
  return { connected: true as const, publicId: user.publicId, roles: authority.roles, permissions: authority.permissions,
    communityRoles: discordCommunityRoles(authority.roles) };
}

export async function claimDiscordRoleWork(db: DrizzleDB, guildId: string) {
  // Bounded retention work also runs when there are no pending role deliveries.
  await db.execute(sql`DELETE FROM discord_verification_attempts WHERE state_hash IN
    (SELECT state_hash FROM discord_verification_attempts WHERE expires_at < now() LIMIT 1000)`);
  await db.execute(sql`DELETE FROM discord_connection_audit WHERE id IN
    (SELECT id FROM discord_connection_audit WHERE created_at < now() - interval '90 days' LIMIT 1000)`);
  // Leases survive application restarts; one row owns both the link and delivery cursor.
  const rows = await db.execute<{ id: string; lease: string }>(sql`
    UPDATE discord_connections SET lease = gen_random_uuid(), lease_until = now() + interval '2 minutes'
    WHERE id = (SELECT id FROM discord_connections WHERE guild_id = ${guildId}
      AND delivered_revision < revision AND next_attempt_at <= now()
      AND (lease_until IS NULL OR lease_until < now())
      ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, lease`);
  const claimed = rows[0];
  return claimed ? readDiscordRoleWork(db, claimed.id, claimed.lease) : null;
}

export async function readDiscordRoleWork(db: DrizzleDB, id: string, lease: string) {
  const [row] = await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.lease, lease), gt(connections.leaseUntil, sql`now()`)));
  if (!row) return null;
  const authority = await resolveDiscordAuthority(db, row.discordId, row.guildId);
  return { id: row.id, lease, revision: row.revision, discordId: row.discordId, guildId: row.guildId,
    roles: authority.connected ? authority.communityRoles : [], disconnecting: row.disconnecting };
}

export const discordDeliveryErrors = ["member_missing", "member_pending", "permissions", "rate_limited", "discord_unavailable", "configuration", "superseded"] as const;
export type DiscordDeliveryError = typeof discordDeliveryErrors[number];

export async function completeDiscordRoleWork(db: DrizzleDB, input: { id: string; lease: string; revision: number; roles: string[]; error?: DiscordDeliveryError; retryAfter?: number }) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(connections).where(and(eq(connections.id, input.id), eq(connections.lease, input.lease), gt(connections.leaseUntil, sql`now()`))).for("update");
    if (!row) return false;
    const authority = await resolveDiscordAuthority(tx, row.discordId, row.guildId);
    const desired = authority.connected ? authority.communityRoles : [];
    const superseded = row.revision !== input.revision || desired.join(",") !== input.roles.join(",");
    if (superseded) {
      await tx.update(connections).set({ lease: null, leaseUntil: null, nextAttemptAt: sql`now()` }).where(eq(connections.id, row.id));
      return false;
    }
    if (input.error) {
      const delay = Math.max(input.retryAfter ?? 0, Math.min(3600, 15 * 2 ** Math.min(row.attempts, 8)));
      await tx.update(connections).set({ lease: null, leaseUntil: null, attempts: row.attempts + 1, lastError: input.error,
        nextAttemptAt: sql`now() + ${delay} * interval '1 second'` }).where(eq(connections.id, row.id));
    } else if (row.disconnecting) {
      const [owner] = await tx.select({ deletedAt: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, row.userId));
      if (!owner?.deletedAt) await tx.insert(schema.discordConnectionAudit).values({ userId: row.userId, discordId: row.discordId, action: "removed" });
      await tx.delete(connections).where(eq(connections.id, row.id));
    } else {
      await tx.update(connections).set({ lease: null, leaseUntil: null, deliveredRevision: row.revision,
        attempts: 0, lastError: null, syncedAt: sql`now()` }).where(eq(connections.id, row.id));
    }
    return true;
  });
}
