import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { gameModelPolicy } from "@influence/engine";
import { schema } from "../db/index.js";
import { createMcpRoutes } from "../routes/mcp.js";
import {
  hashOpaqueSecret, MCP_OAUTH_AUDIENCE, MCP_OAUTH_CLIENT_ID, MCP_OAUTH_PURPOSE,
  resolveMcpOAuthClientScopeEnvelope,
} from "../services/mcp-oauth.js";
import { canonicalMcpOAuthScopeCheck, MCP_OAUTH_SCOPE_VALUES, parseAndValidateMcpOAuthScopes } from "../services/mcp-scope-policy.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../services/legal-acceptance.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { setupTestDB } from "./test-utils.js";

test("media scope migration preserves canonical grants and validates the complete scope set", async () => {
  const db = await setupTestDB();
  const candidates = Array.from({ length: 1 << MCP_OAUTH_SCOPE_VALUES.length }, (_, mask) =>
    MCP_OAUTH_SCOPE_VALUES.filter((_, index) => mask & (1 << index)).join(" "));
  const canonical = (scope: string) => {
    const result = parseAndValidateMcpOAuthScopes(scope);
    return result.ok && result.scope === scope;
  };
  const migration = await readFile(new URL("../../drizzle/0144_producer_render_scope.sql", import.meta.url), "utf8");
  const previous = await readFile(new URL("../../drizzle/0139_producer_routing_scope.sql", import.meta.url), "utf8");
  const constraints = [...migration.matchAll(/CHECK \(scope IN \((.*?)\)\)/g)];
  expect(constraints).toHaveLength(4);
  for (const constraint of constraints) {
    const values = [...constraint[1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!);
    expect(values).toEqual(candidates.filter(scope => canonical(scope) && !scope.includes("producer:media")));
    for (const [, oldScope] of previous.matchAll(/'([^']+)'/g)) expect(values).toContain(oldScope!);
  }
  expect(parseAndValidateMcpOAuthScopes("producer:routing").ok).toBe(false);
  expect(parseAndValidateMcpOAuthScopes("producer producer:routing").ok).toBe(true);
  expect(parseAndValidateMcpOAuthScopes("producer:render").ok).toBe(false);
  expect(parseAndValidateMcpOAuthScopes("producer producer:render").ok).toBe(true);
  candidates.push("producer producer", "producer:media producer", "producer\n", " producer", "producer ", "producer\tproducer:media");
  const check = canonicalMcpOAuthScopeCheck("scope");
  const current = await readFile(new URL("../../drizzle/0174_producer_media_scope.sql", import.meta.url), "utf8");
  expect(current.split(`CHECK (${check})`)).toHaveLength(5);
  const checked = await db.execute<{scope: string; valid: boolean}>(sql`
    SELECT scope, ${sql.raw(check)} AS valid
    FROM jsonb_array_elements_text(${JSON.stringify(candidates)}::jsonb) AS scopes(scope)
  `);
  expect(checked).toHaveLength(candidates.length);
  for (const row of checked) expect(row.valid, row.scope).toBe(canonical(row.scope));
});

test("HTTP MCP routing edits require explicit consent, current sysop authority, and a waiting game", async () => {
  const db = await setupTestDB();
  const prior = { JWT_SECRET: process.env.JWT_SECRET, MCP_OAUTH_RESOURCE_URI: process.env.MCP_OAUTH_RESOURCE_URI };
  process.env.JWT_SECRET = "routing-mcp-test-only";
  process.env.MCP_OAUTH_RESOURCE_URI = "http://127.0.0.1:3000/mcp";
  try {
    const userId = "routing-mcp-operator", walletAddress = "0xroutingmcp", gameId = "routing-mcp-waiting";
    await db.insert(schema.users).values({ id: userId, walletAddress });
    await grantTestAuthority(db, userId, [], "producer");
    await grantTestAuthority(db, userId, [], "sysop");
    await db.insert(schema.legalAcceptances).values({ userId, termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION, deploymentSha: "0123456789abcdef0123456789abcdef01234567", source: "existing_account" });
    await db.insert(schema.games).values({ id: gameId, slug: gameId, config: "{}", status: "waiting" });
    const token = async (scope: string) => {
      const raw = randomUUID();
      await db.insert(schema.mcpOauthAccessTokens).values({ id: randomUUID(), tokenHash: hashOpaqueSecret(raw), userId,
        walletAddress, clientId: MCP_OAUTH_CLIENT_ID, resourceUri: "http://127.0.0.1:3000/mcp", scope,
        audience: MCP_OAUTH_AUDIENCE, purpose: MCP_OAUTH_PURPOSE, expiresAt: "2099-01-01T00:00:00.000Z" });
      return raw;
    };
    const readToken = await token("producer"), editToken = await token("producer producer:edit");
    const routingToken = await token("producer producer:routing");
    expect(await resolveMcpOAuthClientScopeEnvelope(db, MCP_OAUTH_CLIENT_ID)).toContain("producer:routing");
    const app = createMcpRoutes(db, { auditLogger: () => undefined, ownerLearningConnectionRecorder: async () => undefined });
    const call = async (bearer: string, name: string, args: Record<string, unknown>) => {
      const response = await app.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
      expect(response.status).toBe(200);
      return await response.json() as { result?: { isError?: boolean; structuredContent?: { policy: unknown; frozen: boolean } }; error?: { code: number; message: string } };
    };
    const storedConfig = async () => (await db.select({ config: schema.games.config }).from(schema.games).where(eq(schema.games.id, gameId)))[0]!.config;
    const policy = gameModelPolicy({});
    const args = { gameIdOrSlug: gameId, policy };
    expect((await call(readToken, "read_game_model_routing", { gameIdOrSlug: gameId })).result?.structuredContent?.frozen).toBe(false);
    for (const oldGrant of [readToken, editToken]) {
      expect((await call(oldGrant, "set_game_model_routing", args)).result?.isError).toBe(true);
      expect(await storedConfig()).toBe("{}");
    }
    const saved = await call(routingToken, "set_game_model_routing", args);
    expect(saved.error).toBeUndefined();
    expect(saved.result?.isError).not.toBe(true);
    expect(saved.result?.structuredContent?.policy).toEqual(policy);
    const acceptedConfig = await storedConfig();
    expect(JSON.parse(acceptedConfig).modelRouting).toEqual(policy);
    await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, gameId));
    expect((await call(routingToken, "set_game_model_routing", args)).error?.message).toBe("Model settings are frozen once the game starts");
    expect(await storedConfig()).toBe(acceptedConfig);
    await db.update(schema.games).set({ status: "waiting" }).where(eq(schema.games.id, gameId));
    const [sysop] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    await db.delete(schema.userRoles).where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.roleId, sysop!.id)));
    expect((await call(routingToken, "set_game_model_routing", args)).error?.message).toBe("Game model settings require admin or sysop access");
    expect(await storedConfig()).toBe(acceptedConfig);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}, 30_000);
