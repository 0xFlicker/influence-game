/**
 * Authentication middleware for the Influence Game API.
 *
 * Three layers:
 * 1. JWT session validation — checks Authorization: Bearer <jwt>
 * 2. Privy token verification — used during login to validate Privy access tokens
 * 3. RBAC permission / role gates — checks JWT-embedded roles & permissions
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
    userRoles: string[];
    userPermissions: string[];
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

export interface SessionTokenOptions {
  roles?: string[];
  permissions?: string[];
}

/** Create a signed JWT session token for a user. */
export async function createSessionToken(
  userId: string,
  options?: SessionTokenOptions,
): Promise<string> {
  return new SignJWT({
    sub: userId,
    roles: options?.roles ?? [],
    perms: options?.permissions ?? [],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer("influence-api")
    .sign(getJwtSecret());
}

export interface SessionPayload {
  userId: string;
  roles: string[];
  permissions: string[];
}

/** Verify and decode a session JWT. Returns user ID, roles, and permissions or null. */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "influence-api",
    });
    const userId = payload.sub as string | undefined;
    if (!userId) return null;
    return {
      userId,
      roles: (payload.roles as string[] | undefined) ?? [],
      permissions: (payload.perms as string[] | undefined) ?? [],
    };
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
  } catch (err) {
    console.error("[auth] Privy token verification failed:", err);
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
 * Sets `c.get("user")` with the authenticated user record,
 * plus `c.get("userRoles")` and `c.get("userPermissions")` from JWT.
 */
export function requireAuth(db: DrizzleDB) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.slice(7);
    const session = await verifySessionToken(token);
    if (!session) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    // Load user from DB
    const { schema } = await import("../db/index.js");
    const { eq } = await import("drizzle-orm");

    const user = (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId)))[0];

    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    c.set("user", {
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      displayName: user.displayName,
    });
    c.set("userRoles", session.roles);
    c.set("userPermissions", session.permissions);

    await next();
  });
}

// ---------------------------------------------------------------------------
// Middleware: require permission (must be chained after requireAuth)
// ---------------------------------------------------------------------------

/**
 * Hono middleware that requires the user to have at least one of the
 * specified permissions. Returns 403 if none match.
 */
export function requirePermission(...names: string[]) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const userPerms = c.get("userPermissions");
    if (!userPerms || !names.some((n) => userPerms.includes(n))) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }
    await next();
  });
}

// ---------------------------------------------------------------------------
// Middleware: require role (must be chained after requireAuth)
// ---------------------------------------------------------------------------

/**
 * Hono middleware that requires the user to have at least one of the
 * specified roles. Returns 403 if none match.
 */
export function requireRole(...names: string[]) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const userRoles = c.get("userRoles");
    if (!userRoles || !names.some((n) => userRoles.includes(n))) {
      return c.json({ error: "Insufficient role" }, 403);
    }
    await next();
  });
}

// ---------------------------------------------------------------------------
// Middleware: require admin (DEPRECATED — use requirePermission instead)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use requirePermission('create_game', ...) instead.
 * Kept temporarily for backward compatibility during migration.
 */
export function requireAdmin() {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // Check RBAC permissions first
    const userPerms = c.get("userPermissions");
    if (userPerms && userPerms.length > 0) {
      // User has RBAC roles — check for admin-level permissions
      if (userPerms.includes("view_admin") || userPerms.includes("manage_roles")) {
        await next();
        return;
      }
    }

    // Fallback to legacy ADMIN_ADDRESS check
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
      const session = await verifySessionToken(token);
      if (session) {
        const { schema } = await import("../db/index.js");
        const { eq } = await import("drizzle-orm");

        const user = (await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, session.userId)))[0];

        if (user) {
          c.set("user", {
            id: user.id,
            walletAddress: user.walletAddress,
            email: user.email,
            displayName: user.displayName,
          });
          c.set("userRoles", session.roles);
          c.set("userPermissions", session.permissions);
        }
      }
    }

    await next();
  });
}
