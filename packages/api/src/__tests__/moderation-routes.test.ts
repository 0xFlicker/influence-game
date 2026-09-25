import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "./test-utils.js";
import { createSessionToken } from "../middleware/auth.js";
import { createModerationRoutes } from "../routes/moderation.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { executeModerationRead, executeModerationWrite } from "../services/moderation-commands.js";
import { parseAndValidateMcpOAuthScopes } from "../services/mcp-scope-policy.js";

const originalJwtSecret = process.env.JWT_SECRET;
afterAll(() => { if (originalJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalJwtSecret; });

describe("protected moderation adapters", () => {
  let db: DrizzleDB;
  let moderator: string, owner: string, token: string, ownerToken: string, reviewId: string;
  beforeEach(async () => {
    process.env.JWT_SECRET = "moderation-route-tests";
    db = await setupTestDB(); await seedRBAC(db);
    moderator = randomUUID(); owner = randomUUID();
    await db.insert(schema.users).values([{ id: moderator, walletAddress: "0xmoderator" }, { id: owner, walletAddress: "0xowner" }]);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "moderator"));
    await db.insert(schema.addressRoles).values({ walletAddress: "0xmoderator", roleId: role!.id, grantedBy: "test" });
    token = await createSessionToken(moderator); ownerToken = await createSessionToken(owner);
    const created = await createOwnedAgentProfile(db, { userId: owner }, { name: "Route Character", personality: "Original" });
    reviewId = created.receipt.moderationRecordId!;
  });
  test("HTTP enforces fresh roles, private responses, runtime validation, and actor-only receipts", async () => {
    const app = createModerationRoutes(db);
    const request = (path: string, body?: object, auth = token) => app.request(`/api/moderation/${path}`, { headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
    const denied = await request("queue", undefined, ownerToken);
    expect(denied.status).toBe(403); expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect((await request(`reviews/${reviewId}/triage`, { actionId: randomUUID(), action: "flag", reason: {}, version: 0, token: "x" })).status).toBe(400);
    const actionId = randomUUID();
    const claimed = await request("claim", { actionId, reviewId });
    expect(claimed.status).toBe(200);
    expect((await request(`receipts/${actionId}`)).status).toBe(200);
    expect((await request("recovery")).status).toBe(403);
    await db.delete(schema.addressRoles).where(eq(schema.addressRoles.walletAddress, "0xmoderator"));
    expect((await request(`receipts/${actionId}`)).status).toBe(403);
    expect((await request(`reviews/${reviewId}`)).status).toBe(403);
  });
  test("MCP command adapter requires exact operation fields and never grants roles from scope", async () => {
    expect(parseAndValidateMcpOAuthScopes("moderation:write").ok).toBe(false);
    expect(parseAndValidateMcpOAuthScopes("moderation:read moderation:write").ok).toBe(true);
    await expect(executeModerationRead(db, owner, { operation: "queue" })).rejects.toMatchObject({ status: 403 });
    await expect(executeModerationWrite(db, moderator, { operation: "claim", actionId: randomUUID(), reviewId, reason: "ignored field" })).rejects.toMatchObject({ status: 400 });
    const actionId = randomUUID();
    const first = await executeModerationWrite(db, moderator, { operation: "claim", actionId, reviewId });
    expect(await executeModerationWrite(db, moderator, { operation: "claim", actionId, reviewId })).toEqual(first);
  });
});
