/**
 * Auth routes.
 *
 * POST /api/auth/login  — exchange Privy access token for a session JWT
 * GET  /api/auth/me     — get current authenticated user
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  verifyPrivyToken,
  getPrivyUser,
  createSessionToken,
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAuthRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/auth/login — exchange Privy token for session JWT
  // -------------------------------------------------------------------------

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json().catch(() => null);
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
    } catch {
      // Non-fatal: we can still create a session without full user details
    }

    // Upsert user in our database
    // Look up by wallet first, then by Privy subject ID stored in users.id
    let user = walletAddress
      ? db
          .select()
          .from(schema.users)
          .where(eq(schema.users.walletAddress, walletAddress))
          .all()[0]
      : null;

    if (!user) {
      // Check if we have a user with this Privy ID already
      user = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, privyUserId))
        .all()[0];
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
        db.update(schema.users)
          .set(updates)
          .where(eq(schema.users.id, user.id))
          .run();
      }
    } else {
      // Create new user
      const userId = privyUserId;
      db.insert(schema.users)
        .values({
          id: userId,
          walletAddress,
          email,
          displayName: walletAddress
            ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
            : email ?? "Player",
        })
        .run();

      user = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .all()[0]!;
    }

    // Create session JWT
    const sessionToken = await createSessionToken(user.id);

    return c.json({
      token: sessionToken,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        displayName: user.displayName,
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me — get current authenticated user
  // -------------------------------------------------------------------------

  app.get("/api/auth/me", requireAuth(db), async (c) => {
    const user = c.get("user");

    const adminAddress = (
      process.env.ADMIN_ADDRESS || process.env.NEXT_PUBLIC_ADMIN_ADDRESS
    )?.toLowerCase();
    const isAdmin =
      !!adminAddress &&
      !!user.walletAddress &&
      user.walletAddress.toLowerCase() === adminAddress;

    return c.json({
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      displayName: user.displayName,
      isAdmin,
    });
  });

  return app;
}
