/**
 * Auth routes.
 *
 * POST /api/auth/login  — exchange Privy access token for a session JWT
 * GET  /api/auth/me     — get current authenticated user
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import {
  verifyPrivyToken,
  getPrivyUser,
  createSessionToken,
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAuthRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/auth/login — exchange Privy token for session JWT
  // -------------------------------------------------------------------------

  app.post("/api/auth/login", async (c) => {
    const body = await parseJsonBody(c, "POST /api/auth/login");
    if (!body?.token) {
      return c.json({ error: "token is required" }, 400);
    }

    // Verify Privy access token
    const privyUserId = await verifyPrivyToken(body.token);
    if (!privyUserId) {
      return c.json({ error: "Invalid Privy token" }, 401);
    }

    // Get full Privy user to extract wallet/email
    let walletAddress: string | null = null;
    let email: string | null = null;

    try {
      const privyUser = await getPrivyUser(privyUserId);

      // Extract wallet address from linked accounts
      const walletAccount = privyUser.linkedAccounts?.find(
        (a: { type: string }) => a.type === "wallet",
      );
      if (walletAccount && "address" in walletAccount) {
        walletAddress = (walletAccount.address as string).toLowerCase();
      }

      // Extract email from linked accounts
      const emailAccount = privyUser.linkedAccounts?.find(
        (a: { type: string }) => a.type === "email",
      );
      if (emailAccount && "address" in emailAccount) {
        email = emailAccount.address as string;
      }
    } catch (err) {
      // Non-fatal: we can still create a session without full user details
      console.warn("[auth] Failed to fetch Privy user details:", err instanceof Error ? err.message : err);
    }

    // Upsert user in our database
    // Look up by wallet first, then by Privy subject ID stored in users.id
    let user = walletAddress
      ? (await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.walletAddress, walletAddress)))[0]
      : null;

    if (!user) {
      // Check if we have a user with this Privy ID already
      user = (await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, privyUserId)))[0];
    }

    if (user) {
      // Update existing user with latest info
      const updates: Record<string, string> = {};
      if (walletAddress && !user.walletAddress) {
        updates.walletAddress = walletAddress;
      }
      if (email && !user.email) {
        updates.email = email;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(schema.users)
          .set(updates)
          .where(eq(schema.users.id, user.id));
      }
    } else {
      // Create new user
      const userId = privyUserId;
      await db.insert(schema.users)
        .values({
          id: userId,
          walletAddress,
          email,
          displayName: walletAddress
            ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
            : email ?? "Player",
        });

      user = (await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId)))[0]!;
    }

    // Resolve RBAC roles and permissions for wallet address
    const resolved = user.walletAddress
      ? await getPermissionsForAddress(db, user.walletAddress)
      : { roles: [], permissions: [] };

    // Create session JWT with embedded roles and permissions
    const sessionToken = await createSessionToken(user.id, {
      roles: resolved.roles,
      permissions: resolved.permissions,
    });

    return c.json({
      token: sessionToken,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        displayName: user.displayName,
        roles: resolved.roles,
        permissions: resolved.permissions,
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me — get current authenticated user
  // -------------------------------------------------------------------------

  app.get("/api/auth/me", requireAuth(db), async (c) => {
    const user = c.get("user");
    const roles = c.get("userRoles") ?? [];
    const permissions = c.get("userPermissions") ?? [];

    const isAdmin =
      roles.includes("sysop") ||
      roles.includes("admin") ||
      permissions.includes("view_admin");

    return c.json({
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      displayName: user.displayName,
      isAdmin,
      roles,
      permissions,
    });
  });

  return app;
}
