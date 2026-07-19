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
import { extractBearerToken, validateGameMcpBearerToken } from "../game-mcp/auth.js";
import { projectAuthenticatedPublicIdentity } from "../services/authenticated-public-identity.js";
import { createPrivyAuthenticationVerifier } from "../services/authentication-providers.js";
import { resolveAccountAuthentication } from "../services/account-authentication.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface AuthRouteDependencies {
  verifyPrivyToken?: typeof verifyPrivyToken;
  getPrivyUser?: typeof getPrivyUser;
  isInviteRequired?: typeof isInviteRequired;
  redeemInviteCode?: typeof redeemInviteCode;
  compatibilityBridgeEnabled?: boolean;
}

export function createAuthRoutes(
  db: DrizzleDB,
  dependencies: AuthRouteDependencies = {},
) {
  const app = new Hono<AuthEnv>();
  const verifyPrivyAccessToken = dependencies.verifyPrivyToken ?? verifyPrivyToken;
  const loadPrivyUser = dependencies.getPrivyUser ?? getPrivyUser;
  const inviteIsRequired = dependencies.isInviteRequired ?? isInviteRequired;
  const redeemCode = dependencies.redeemInviteCode ?? redeemInviteCode;
  const compatibilityBridgeEnabled = dependencies.compatibilityBridgeEnabled
    ?? readPrivyCompatibilityBridgeEnabled();
  const privyVerifier = createPrivyAuthenticationVerifier({
    verifyAccessToken: verifyPrivyAccessToken,
    loadUser: loadPrivyUser,
  });

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
        ...projectAuthenticatedPublicIdentity(user),
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

    const verification = await privyVerifier.verify(body.token);
    if (verification.status === "invalid") {
      return c.json({ error: "Invalid Privy token" }, 401);
    }

    const provider = verification.status === "verified"
      ? verification.evidence.provider
      : verification.provider;
    const subject = verification.status === "verified"
      ? verification.evidence.subject
      : verification.subject;
    const authentication = await resolveAccountAuthentication(db, {
      provider,
      subject,
      evidence: verification.status === "verified" ? verification.evidence : null,
      compatibilityBridgeEnabled,
      checkInviteRequired: (tx) => inviteIsRequired(tx),
      redeemInvite: typeof body.inviteCode === "string"
        ? (tx, userId) => redeemCode(tx, body.inviteCode as string, userId)
        : undefined,
    });

    if (authentication.status === "profile_unavailable") {
      return c.json({
        error: "Authentication provider profile is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    }
    if (authentication.status === "link_required") {
      return c.json({
        error: "This sign-in method must be linked to the existing account",
        code: "ACCOUNT_LINK_REQUIRED",
      }, 409);
    }
    if (authentication.status === "invite_required") {
      return c.json({
        error: "Invite code required",
        code: "INVITE_REQUIRED",
      }, 403);
    }
    if (authentication.status === "invalid_invite") {
      return c.json({
        error: "Invalid or already used invite code",
        code: "INVALID_INVITE_CODE",
      }, 403);
    }
    if (authentication.status === "support_blocked") {
      return c.json({
        error: "This account needs support before it can sign in",
        code: "ACCOUNT_SUPPORT_REQUIRED",
      }, 409);
    }
    const user = authentication.user;

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
        ...projectAuthenticatedPublicIdentity(user),
        roles: resolved.roles,
        permissions: resolved.permissions,
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/check-invite — check if invite codes are required
  // -------------------------------------------------------------------------

  app.get("/api/auth/invite-required", async (c) => {
    const required = await inviteIsRequired(db);
    return c.json({ required });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me — get current authenticated user
  // -------------------------------------------------------------------------

  app.get("/api/auth/me", requireAuth(db), async (c) => {
    const authUser = c.get("user");
    const user = (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, authUser.id)))[0];
    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }
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
      ...projectAuthenticatedPublicIdentity(user),
      isAdmin,
      roles,
      permissions,
    });
  });

  return app;
}

/**
 * The bridge is intentionally on by default during inventory rollout. After a
 * zero final delta, set PRIVY_COMPATIBILITY_BRIDGE_ENABLED=false so an
 * unbound legacy row cannot authenticate through subject/wallet inference.
 */
export function readPrivyCompatibilityBridgeEnabled(
  value = process.env.PRIVY_COMPATIBILITY_BRIDGE_ENABLED,
): boolean {
  if (value === undefined || value.trim() === "") return true;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    'PRIVY_COMPATIBILITY_BRIDGE_ENABLED must be "true" or "false"',
  );
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
