import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
/** Operator provisioning helper; never an unauthenticated issuance endpoint. */
export async function createChampionshipServiceToken(db: DrizzleDB, userId: string, expiresAt: Date) {
  const [service] = await db.select().from(schema.servicePrincipals).where(eq(schema.servicePrincipals.userId, userId));
  if (!service?.enabled || service.purpose !== "championship") throw new Error("Enabled championship service principal required");
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("Choose a future service credential expiry after the event");
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required for service credential provisioning");
  return new SignJWT({ perms: ["dispatch_championship"], roles: [] }).setProtectedHeader({ alg: "HS256" })
    .setIssuer("influence-api").setSubject(userId).setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(secret));
}
