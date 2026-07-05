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
import { isInviteRequired, redeemInviteCode } from "../lib/invite-codes.js";
import { getSafeDefaultDisplayName, isEmailLike } from "../lib/display-name.js";
import { extractBearerToken, validateGameMcpBearerToken } from "../game-mcp/auth.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAuthRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/auth/local-cli-session — exchange local producer MCP OAuth token
  // for a normal app session JWT. This is intentionally loopback-only so local
  // scripts can reuse the existing browser OAuth grant without making MCP
  // bearer tokens authenticate normal app routes directly.
  // -------------------------------------------------------------------------

  app.post("/api/auth/local-cli-session", async (c) => {
    if (!isLoopbackHost(c.req.header("host"), c.req.url)) {
      return c.json({ error: "Local CLI session exchange is loopback-only" }, 403);
    }

    const body = await parseJsonBody(c, "POST /api/auth/local-cli-session");
    const tokenFromBody = typeof body?.mcpToken === "string" ? body.mcpToken.trim() : "";
    const token = tokenFromBody || extractBearerToken(c.req.header("Authorization"));
    if (!token) {
      return c.json({ error: "mcpToken is required" }, 400);
    }

    const validation = await validateGameMcpBearerToken(db, token);
    if (!validation.ok) {
      return c.json({ error: "Invalid MCP token", reason: validation.reason }, validation.status);
    }
    if (validation.context.authProfile !== "producer") {
      return c.json({ error: "Producer MCP scope is required" }, 403);
    }

    const user = (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, validation.context.userId)))[0];
    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    const resolved = user.walletAddress
      ? await getPermissionsForAddress(db, user.walletAddress)
      : { roles: [], permissions: [] };
    const sessionToken = await createSessionToken(user.id, resolved);

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
      if (
        !user.displayName ||
        isEmailLike(user.displayName) ||
        (user.email &&
          user.displayName.trim().toLowerCase() === user.email.trim().toLowerCase())
      ) {
        updates.displayName = getSafeDefaultDisplayName({
          walletAddress: walletAddress ?? user.walletAddress,
        });
      }
      if (Object.keys(updates).length > 0) {
        await db.update(schema.users)
          .set(updates)
          .where(eq(schema.users.id, user.id));
      }
    } else {
      // New user signup — check invite code requirement
      const inviteRequired = await isInviteRequired(db);

      if (inviteRequired && !body.inviteCode) {
        return c.json({
          error: "Invite code required",
          code: "INVITE_REQUIRED",
        }, 403);
      }

      // Create new user
      const userId = privyUserId;
      await db.insert(schema.users)
        .values({
          id: userId,
          walletAddress,
          email,
          displayName: getSafeDefaultDisplayName({ walletAddress }),
        });

      // Redeem invite code if provided
      if (inviteRequired && body.inviteCode) {
        const redeemed = await redeemInviteCode(db, body.inviteCode as string, userId);
        if (!redeemed) {
          // Roll back user creation
          await db.delete(schema.users).where(eq(schema.users.id, userId));
          return c.json({
            error: "Invalid or already used invite code",
            code: "INVALID_INVITE_CODE",
          }, 403);
        }
      }

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
  // GET /api/auth/check-invite — check if invite codes are required
  // -------------------------------------------------------------------------

  app.get("/api/auth/invite-required", async (c) => {
    const required = await isInviteRequired(db);
    return c.json({ required });
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

function isLoopbackHost(hostHeader: string | undefined, requestUrl?: string): boolean {
  const host = hostFromHeader(hostHeader) ?? hostFromUrl(requestUrl);
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

function hostFromHeader(hostHeader: string | undefined): string | undefined {
  const host = hostHeader?.trim().toLowerCase();
  if (!host) return undefined;
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]");
    return closingBracket === -1 ? host : host.slice(0, closingBracket + 1);
  }
  return host.split(":")[0];
}

function hostFromUrl(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined;
  try {
    return new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
