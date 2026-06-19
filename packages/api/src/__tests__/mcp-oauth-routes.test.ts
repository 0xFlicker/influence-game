import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAuthRoutes } from "../routes/auth.js";
import {
  createMcpOAuthRoutes,
  type McpOAuthAuditEvent,
} from "../routes/mcp-oauth.js";
import {
  MCP_OAUTH_CLIENT_ID,
  MCP_OAUTH_SCOPE,
  pkceS256,
} from "../services/mcp-oauth.js";
import { setupTestDB } from "./test-utils.js";

const MCP_ADDRESS = "0xmcp000000000000000000000000000000000011";
const NON_MCP_ADDRESS = "0xnomcp000000000000000000000000000000001";
const REDIRECT_URI = "http://127.0.0.1:34789/oauth/callback";
const INTROSPECTION_SECRET = "test-introspection-secret";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-mcp-oauth";
  process.env.ADMIN_ADDRESS = "0xadmin000000000000000000000000000000000001";
  process.env.INFLUENCE_MCP_INTROSPECTION_SECRET = INTROSPECTION_SECRET;
});

describe("MCP OAuth routes", () => {
  let db: DrizzleDB;
  let app: Hono;
  let auditEvents: McpOAuthAuditEvent[];

  beforeEach(async () => {
    db = await setupTestDB();
    await seedRBAC(db);
    auditEvents = [];
    app = new Hono();
    app.route("/", createMcpOAuthRoutes(db, (event) => auditEvents.push(event)));
    app.route("/", createAuthRoutes(db));
    process.env.INFLUENCE_MCP_INTROSPECTION_SECRET = INTROSPECTION_SECRET;
  });

  test("issues and introspects a global mcp token for users with the mcp role", async () => {
    const { userId, token: sessionToken } = await createUserSession(db, MCP_ADDRESS, "mcp");
    const codeVerifier = "local-helper-verifier";
    const state = "state-happy-path";

    const preview = await app.request("/api/oauth/mcp/authorize", {
      method: "POST",
      headers: jsonAuthHeaders(sessionToken),
      body: JSON.stringify(authorizeBody({
        codeVerifier,
        state,
        decision: "inspect",
      })),
    });

    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      clientId: MCP_OAUTH_CLIENT_ID,
      scope: MCP_OAUTH_SCOPE,
      hasMcpRole: true,
      walletAddress: MCP_ADDRESS,
    });

    const authorize = await app.request("/api/oauth/mcp/authorize", {
      method: "POST",
      headers: jsonAuthHeaders(sessionToken),
      body: JSON.stringify(authorizeBody({
        codeVerifier,
        state,
        decision: "approve",
      })),
    });

    expect(authorize.status).toBe(200);
    const redirectTo = String((await jsonObject(authorize)).redirectTo);
    const redirect = new URL(redirectTo);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get("state")).toBe(state);
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.request("/api/oauth/mcp/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: MCP_OAUTH_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code: code!,
        code_verifier: codeVerifier,
      }).toString(),
    });

    expect(token.status).toBe(200);
    const tokenJson = await jsonObject(token);
    expect(tokenJson).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp",
      audience: "game-mcp",
      purpose: "mcp_access",
    });
    expect(typeof tokenJson.access_token).toBe("string");

    const introspection = await introspect(tokenJson.access_token as string);
    expect(introspection.status).toBe(200);
    expect(await jsonObject(introspection)).toMatchObject({
      active: true,
      iss: "influence-game-mcp",
      aud: "game-mcp",
      scope: "mcp",
      token_type: "Bearer",
      purpose: "mcp_access",
    });

    const appSessionCheck = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    expect(appSessionCheck.status).toBe(401);

    expect(auditEvents).toContainEqual(expect.objectContaining({
      event: "mcp.oauth.authorize",
      userId,
      walletAddress: MCP_ADDRESS,
      clientId: MCP_OAUTH_CLIENT_ID,
      scope: "mcp",
      decision: "approve",
      result: "success",
      status: 200,
    }));
    expect(auditEvents).toContainEqual(expect.objectContaining({
      event: "mcp.oauth.token",
      userId,
      walletAddress: MCP_ADDRESS,
      clientId: MCP_OAUTH_CLIENT_ID,
      scope: "mcp",
      result: "success",
      status: 200,
    }));
    expect(auditEvents).toContainEqual(expect.objectContaining({
      event: "mcp.oauth.introspect",
      userId,
      clientId: MCP_OAUTH_CLIENT_ID,
      scope: "mcp",
      result: "success",
      active: true,
      status: 200,
    }));

    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).not.toContain(code!);
    expect(serializedAudit).not.toContain(String(tokenJson.access_token));
    expect(serializedAudit).not.toContain(codeVerifier);
    expect(serializedAudit).not.toContain(INTROSPECTION_SECRET);
    expect(serializedAudit).not.toContain("Authorization");
  });

  test("refuses authorization for users without the mcp role", async () => {
    const { token: sessionToken } = await createUserSession(db, NON_MCP_ADDRESS);

    const authorize = await app.request("/api/oauth/mcp/authorize", {
      method: "POST",
      headers: jsonAuthHeaders(sessionToken),
      body: JSON.stringify(authorizeBody({
        decision: "approve",
      })),
    });

    expect(authorize.status).toBe(403);
    const body = await jsonObject(authorize);
    expect(body.error).toBe("access_denied");
    const redirect = new URL(String(body.redirectTo));
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("test-state");
  });

  test("rejects invalid authorization inputs without issuing a code", async () => {
    const { token: sessionToken } = await createUserSession(db, MCP_ADDRESS, "mcp");

    const invalidScope = await app.request("/api/oauth/mcp/authorize", {
      method: "POST",
      headers: jsonAuthHeaders(sessionToken),
      body: JSON.stringify({
        ...authorizeBody({ decision: "approve" }),
        scope: "mcp profile",
      }),
    });
    expect(invalidScope.status).toBe(400);
    const invalidScopeBody = await jsonObject(invalidScope);
    expect(invalidScopeBody.error).toBe("invalid_scope");
    expect(new URL(String(invalidScopeBody.redirectTo)).searchParams.get("error")).toBe(
      "invalid_scope",
    );
    expect(auditEvents).toContainEqual(expect.objectContaining({
      event: "mcp.oauth.authorize",
      clientId: MCP_OAUTH_CLIENT_ID,
      scope: "mcp profile",
      result: "failure",
      status: 400,
      denialReason: "invalid_scope",
    }));

    const invalidRedirect = await app.request("/api/oauth/mcp/authorize", {
      method: "POST",
      headers: jsonAuthHeaders(sessionToken),
      body: JSON.stringify({
        ...authorizeBody({ decision: "approve" }),
        redirect_uri: "http://example.com/oauth/callback",
      }),
    });
    expect(invalidRedirect.status).toBe(400);
    expect(await jsonObject(invalidRedirect)).toMatchObject({
      error: "invalid_request",
      error_description: "redirect_uri is not allowed",
    });

    const plainChallenge = await app.request("/api/oauth/mcp/authorize", {
      method: "POST",
      headers: jsonAuthHeaders(sessionToken),
      body: JSON.stringify({
        ...authorizeBody({ decision: "approve" }),
        code_challenge_method: "plain",
      }),
    });
    expect(plainChallenge.status).toBe(400);
    expect((await jsonObject(plainChallenge)).error).toBe("invalid_request");

    const rows = await db.select().from(schema.mcpOauthAuthorizationCodes);
    expect(rows).toHaveLength(0);
  });

  test("enforces PKCE, single-use codes, and active role at token exchange", async () => {
    const { token: sessionToken } = await createUserSession(db, MCP_ADDRESS, "mcp");

    const mismatchCode = await authorizeCode(sessionToken, "right-verifier", "pkce-mismatch");
    const mismatch = await exchangeCode(mismatchCode, "wrong-verifier");
    expect(mismatch.status).toBe(400);
    expect(await jsonObject(mismatch)).toMatchObject({
      error: "invalid_grant",
      error_description: "PKCE verification failed",
    });

    const reusableCode = await authorizeCode(sessionToken, "single-use", "single-use");
    const firstExchange = await exchangeCode(reusableCode, "single-use");
    expect(firstExchange.status).toBe(200);
    const secondExchange = await exchangeCode(reusableCode, "single-use");
    expect(secondExchange.status).toBe(400);
    expect((await jsonObject(secondExchange)).error).toBe("invalid_grant");

    const revokedRoleCode = await authorizeCode(sessionToken, "role-active", "role-active");
    await revokeRole(db, MCP_ADDRESS, "mcp");
    const revokedExchange = await exchangeCode(revokedRoleCode, "role-active");
    expect(revokedExchange.status).toBe(400);
    expect(await jsonObject(revokedExchange)).toMatchObject({
      error: "invalid_grant",
      error_description: "MCP role is no longer active for this user",
    });
  });

  test("introspection requires its own secret and reflects current mcp role", async () => {
    const { token: sessionToken } = await createUserSession(db, MCP_ADDRESS, "mcp");
    const code = await authorizeCode(sessionToken, "introspection", "introspection");
    const exchanged = await exchangeCode(code, "introspection");
    const accessToken = String((await jsonObject(exchanged)).access_token);

    const missingSecret = await app.request("/api/oauth/mcp/introspect", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: accessToken }),
    });
    expect(missingSecret.status).toBe(401);

    await revokeRole(db, MCP_ADDRESS, "mcp");
    const inactive = await introspect(accessToken);
    expect(inactive.status).toBe(200);
    expect(await inactive.json()).toEqual({ active: false });
  });

  async function authorizeCode(
    sessionToken: string,
    codeVerifier: string,
    state: string,
  ): Promise<string> {
    const authorize = await app.request("/api/oauth/mcp/authorize", {
      method: "POST",
      headers: jsonAuthHeaders(sessionToken),
      body: JSON.stringify(authorizeBody({
        codeVerifier,
        state,
        decision: "approve",
      })),
    });
    expect(authorize.status).toBe(200);
    const redirectTo = String((await jsonObject(authorize)).redirectTo);
    const code = new URL(redirectTo).searchParams.get("code");
    expect(code).toBeTruthy();
    return code!;
  }

  async function exchangeCode(code: string, codeVerifier: string): Promise<Response> {
    return app.request("/api/oauth/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: MCP_OAUTH_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: codeVerifier,
      }),
    });
  }

  async function introspect(accessToken: string): Promise<Response> {
    return app.request("/api/oauth/mcp/introspect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTROSPECTION_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: accessToken }),
    });
  }
});

function authorizeBody(overrides?: {
  codeVerifier?: string;
  decision?: "approve" | "deny" | "inspect";
  state?: string;
}) {
  const codeVerifier = overrides?.codeVerifier ?? "test-verifier";
  return {
    response_type: "code",
    client_id: MCP_OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "mcp",
    state: overrides?.state ?? "test-state",
    code_challenge: pkceS256(codeVerifier),
    code_challenge_method: "S256",
    decision: overrides?.decision ?? "inspect",
  };
}

function jsonAuthHeaders(sessionToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${sessionToken}`,
    "content-type": "application/json",
  };
}

async function createUserSession(
  db: DrizzleDB,
  walletAddress: string,
  roleName?: string,
): Promise<{ userId: string; token: string }> {
  const userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    walletAddress: walletAddress.toLowerCase(),
    displayName: `Test ${walletAddress.slice(2, 8)}`,
  });

  if (roleName) {
    await assignRole(db, walletAddress, roleName);
  }

  return {
    userId,
    token: await createSessionToken(userId),
  };
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected response body to be a JSON object");
  }
  return value as Record<string, unknown>;
}

async function assignRole(
  db: DrizzleDB,
  walletAddress: string,
  roleName: string,
): Promise<void> {
  const role = (await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(sql`${schema.roles.name} = ${roleName}`))[0];
  if (!role) {
    throw new Error(`Missing role ${roleName}`);
  }

  await db.insert(schema.addressRoles).values({
    walletAddress: walletAddress.toLowerCase(),
    roleId: role.id,
    grantedBy: "test",
  });
}

async function revokeRole(
  db: DrizzleDB,
  walletAddress: string,
  roleName: string,
): Promise<void> {
  const role = (await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(sql`${schema.roles.name} = ${roleName}`))[0];
  if (!role) {
    throw new Error(`Missing role ${roleName}`);
  }

  await db
    .delete(schema.addressRoles)
    .where(andAddressRole(walletAddress, role.id));
}

function andAddressRole(walletAddress: string, roleId: string) {
  return and(
    eq(schema.addressRoles.walletAddress, walletAddress.toLowerCase()),
    eq(schema.addressRoles.roleId, roleId),
  );
}
