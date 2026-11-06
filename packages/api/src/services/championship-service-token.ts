import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { ChampionshipError } from "./championships.js";
export const CHAMPIONSHIP_TOKEN_TYPE = "championship_service";
const audience = "influence-championship";
const operations = { controller: ["manifest", "dispatch", "complete"], launcher: ["launch"] } as const;
export type ChampionshipOperation = "manifest" | "dispatch" | "complete" | "launch";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Operator-only provisioning. Controller and launcher use separately revocable principals. */
export async function createChampionshipServiceToken(db: DrizzleDB, userId: string, expiresAt: Date,
  scope: { eventId: string; role: keyof typeof operations }) {
  const [service] = await db.select().from(schema.servicePrincipals).where(eq(schema.servicePrincipals.userId, userId));
  if (!service?.enabled || service.purpose !== "championship") throw new Error("Enabled championship service principal required");
  if (!scope || !uuid.test(scope.eventId) || !Object.hasOwn(operations, scope.role)) throw new Error("Exact championship event and service role required");
  const [event] = await db.select({ id: schema.championshipEvents.id }).from(schema.championshipEvents).where(eq(schema.championshipEvents.id, scope.eventId));
  if (!event) throw new Error("Championship event not found");
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("Choose a future service credential expiry after the event");
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required for service credential provisioning");
  return new SignJWT({ token_type: CHAMPIONSHIP_TOKEN_TYPE, eventId: event.id, operations: operations[scope.role] })
    .setProtectedHeader({ alg: "HS256" }).setAudience(audience).setIssuer("influence-api").setSubject(userId)
    .setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(new TextEncoder().encode(secret));
}
/** Deliberately separate from human/session auth: custom scope is verified, never discarded. */
export async function authorizeChampionshipService(db: DrizzleDB, authorization: string | undefined, operation: ChampionshipOperation) {
  if (!authorization?.startsWith("Bearer ") || !process.env.JWT_SECRET) throw new ChampionshipError("Authentication required", 401);
  let claims;
  try { claims = (await jwtVerify(authorization.slice(7), new TextEncoder().encode(process.env.JWT_SECRET), { issuer: "influence-api", audience, algorithms: ["HS256"], requiredClaims: ["exp", "sub"] })).payload; }
  catch { throw new ChampionshipError("Authentication required", 401); }
  if (claims.token_type !== CHAMPIONSHIP_TOKEN_TYPE || typeof claims.sub !== "string" || !claims.sub
    || typeof claims.eventId !== "string" || !uuid.test(claims.eventId) || !Array.isArray(claims.operations)
    || !claims.operations.every(value => typeof value === "string" && ["manifest", "dispatch", "complete", "launch"].includes(value))
    || !claims.operations.includes(operation)) throw new ChampionshipError("Championship operation not authorized", 403);
  const [service] = await db.select().from(schema.servicePrincipals).where(and(eq(schema.servicePrincipals.userId, claims.sub), eq(schema.servicePrincipals.purpose, "championship")));
  if (!service?.enabled) throw new ChampionshipError("Championship service disabled", 403);
  return { eventId: claims.eventId, userId: claims.sub };
}
export function assertChampionshipEventScope(expected: string, actual: string) {
  if (expected !== actual) throw new ChampionshipError("Championship event not authorized", 403);
}
/** Current binding only; retry/correction keeps historical attempts but never authorizes them. */
export async function assertChampionshipGameScope(db: DrizzleDB, eventId: string, gameId: string) {
  if (!uuid.test(gameId)) throw new ChampionshipError("Championship game not authorized", 403);
  const [match] = await db.select({ id: schema.championshipMatches.id, status: schema.championshipMatches.status }).from(schema.championshipMatches)
    .where(and(eq(schema.championshipMatches.eventId, eventId), eq(schema.championshipMatches.gameId, gameId)));
  if (!match || match.status === "void") throw new ChampionshipError("Championship game not authorized", 403);
  // Gameplay adoption independently locks the game and rechecks in_progress/owner epoch.
  // Retry cancels/fences the old game before moving this binding; a race cannot revive it.
}

/** Prepare a split pair after operator provisioning; never create live principals implicitly. */
export async function createChampionshipServiceTokenPair(db: DrizzleDB, input: { controllerUserId: string; launcherUserId: string; eventId: string; expiresAt: Date }) {
  if (input.controllerUserId === input.launcherUserId) throw new Error("Separate controller and launcher principals required");
  return {
    controller: await createChampionshipServiceToken(db, input.controllerUserId, input.expiresAt, { eventId: input.eventId, role: "controller" }),
    launcher: await createChampionshipServiceToken(db, input.launcherUserId, input.expiresAt, { eventId: input.eventId, role: "launcher" }),
  };
}
