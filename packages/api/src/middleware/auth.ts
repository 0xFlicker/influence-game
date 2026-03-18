/**
 * Authentication middleware for the Influence Game API.
 *
 * Three layers:
 * 1. JWT session validation — checks Authorization: Bearer <jwt>
 * 2. Privy token verification — used during login to validate Privy access tokens
 * 3. Admin gate — checks wallet address against admin allowlist
 */

import { createMiddleware } from "hono/factory";
import { PrivyClient } from "@privy-io/server-auth";
import { SignJWT, jwtVerify } from "jose";
import type { DrizzleDB } from "../db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  walletAddress: string | null;
  email: string | null;
  displayName: string | null;
}

// Hono variable typing
export type AuthEnv = {
  Variables: {
    user: AuthUser;
    db: DrizzleDB;
  };
};

// ---------------------------------------------------------------------------
// Privy client (singleton)
// ---------------------------------------------------------------------------

let _privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (!_privyClient) {
    const appId = process.env.PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET must be set");
    }
    _privyClient = new PrivyClient(appId, appSecret);
  }
  return _privyClient;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be set");
  }
  return new TextEncoder().encode(secret);
}

/** Create a signed JWT session token for a user. */
export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer("influence-api")
    .sign(getJwtSecret());
}

/** Verify and decode a session JWT. Returns the user ID or null. */
export async function verifySessionToken(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "influence-api",
    });
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Privy verification
// ---------------------------------------------------------------------------

/** Verify a Privy access token. Returns the Privy user ID or null. */
export async function verifyPrivyToken(
  token: string,
): Promise<string | null> {
  try {
    const privy = getPrivyClient();
    const claims = await privy.verifyAuthToken(token);
    return claims.userId;
  } catch {
    return null;
  }
}

/** Get the Privy user record by Privy user ID. */
export async function getPrivyUser(privyUserId: string) {
  const privy = getPrivyClient();
  return privy.getUser(privyUserId);
}

// ---------------------------------------------------------------------------
// Middleware: require authenticated session
// ---------------------------------------------------------------------------

/**
 * Hono middleware that requires a valid JWT session token.
 * Sets `c.get("user")` with the authenticated user record.
 */
export function requireAuth(db: DrizzleDB) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await verifySessionToken(token);
    if (!userId) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    // Load user from DB
    const { schema } = await import("../db/index.js");
    const { eq } = await import("drizzle-orm");

    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .all()[0];

    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    c.set("user", {
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      displayName: user.displayName,
    });

    await next();
  });
}

// ---------------------------------------------------------------------------
// Middleware: require admin (must be chained after requireAuth)
// ---------------------------------------------------------------------------

/**
 * Hono middleware that requires the authenticated user to be an admin.
 * Must be used after `requireAuth` so that `c.get("user")` is available.
 *
 * Admin is determined by wallet address matching ADMIN_ADDRESS env var.
 */
export function requireAdmin() {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const adminAddress = process.env.ADMIN_ADDRESS?.toLowerCase();
    if (!adminAddress) {
      return c.json({ error: "Admin access not configured" }, 503);
    }

    if (!user.walletAddress || user.walletAddress.toLowerCase() !== adminAddress) {
      return c.json({ error: "Admin access required" }, 403);
    }

    await next();
  });
}

// ---------------------------------------------------------------------------
// Middleware: optional auth (attaches user if token present, doesn't block)
// ---------------------------------------------------------------------------

/**
 * Hono middleware that optionally authenticates the user.
 * If a valid Bearer token is present, sets `c.get("user")`.
 * If not, continues without setting user.
 */
export function optionalAuth(db: DrizzleDB) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const userId = await verifySessionToken(token);
      if (userId) {
        const { schema } = await import("../db/index.js");
        const { eq } = await import("drizzle-orm");

        const user = db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .all()[0];

        if (user) {
          c.set("user", {
            id: user.id,
            walletAddress: user.walletAddress,
            email: user.email,
            displayName: user.displayName,
          });
        }
      }
    }

    await next();
  });
}
