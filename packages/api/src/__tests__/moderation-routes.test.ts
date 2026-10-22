import { testUserIdForWallet } from "./rbac-fixtures.js";
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
import { storeJson } from "../services/payload-storage.js";
import type { readScreeningOverview, readModerationReview, listModerationQueue } from "../services/moderation-intake.js";

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
    await db.insert(schema.userRoles).values({ userId: testUserIdForWallet("0xmoderator"), roleId: role!.id, grantedBy: "test" });
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
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, testUserIdForWallet("0xmoderator")));
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
  test("screening overview aggregates current-policy revisions with fresh role boundaries and MCP parity", async () => {
    for (const [index, status] of (["running", "completed", "incomplete", "incomplete"] as const).entries()) {
      const created = await createOwnedAgentProfile(db, { userId: owner }, { name: `Screening ${index}`, personality: "Original" });
      await db.update(schema.agentScreenings).set({ status, recommendation: status === "completed" ? "review" : null,
        failureCode: status === "incomplete" ? "provider_timeout" : null }).where(eq(schema.agentScreenings.contentRevisionId, created.profile.contentRevisionId!));
      if (status === "completed") await db.update(schema.agentModerationReviews).set({ status: "resolved" }).where(eq(schema.agentModerationReviews.id, created.receipt.moderationRecordId!));
    }
    const [original] = await db.select().from(schema.agentScreenings);
    await db.insert(schema.agentScreenings).values({ id: randomUUID(), contentRevisionId: original!.contentRevisionId, policyVersion: "obsolete-policy", status: "incomplete", failureCode: "old_failure" });
    const app = createModerationRoutes(db);
    const request = (auth = token, query = "") => app.request(`/api/moderation/screening-overview${query}`, { headers: { Authorization: `Bearer ${auth}` } });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const overview = await response.json() as Awaited<ReturnType<typeof readScreeningOverview>>;
    expect(overview).toMatchObject({ scope: "ordinary", total: 5, statuses: { pending: 1, running: 1, completed: 1, incomplete: 2 },
      recommendations: { no_concern: 0, review: 1, inconclusive: 0 }, failures: [{ code: "provider_timeout", count: 2 }] });
    expect(await executeModerationRead(db, moderator, { operation: "screening_overview" })).toMatchObject({ groups: overview.groups });
    expect((await request(ownerToken)).status).toBe(403);
    expect((await request(token, "?route=escalated")).status).toBe(400);
    await expect(executeModerationRead(db, moderator, { operation: "screening_overview", filter: "all" })).rejects.toMatchObject({ status: 400 });
    await db.update(schema.agentModerationReviews).set({ route: "escalated" });
    expect(await (await request()).json()).toMatchObject({ total: 0, failures: [], statuses: { pending: 0, running: 0, completed: 0, incomplete: 0 } });
    const [admin] = await db.select().from(schema.roles).where(eq(schema.roles.name, "admin"));
    await db.insert(schema.userRoles).values({ userId: testUserIdForWallet("0xmoderator"), roleId: admin!.id, grantedBy: "test" });
    expect(await (await request()).json()).toMatchObject({ scope: "all_queues", total: 5 });
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, testUserIdForWallet("0xmoderator")));
    expect((await request()).status).toBe(403);
  });
  test("shadow findings use the same private HTTP/MCP boundaries and remain separate from human flags", async () => {
    const result = { recommendation: "review" as const, summary: "Private assessment", findings: [] };
    await db.update(schema.agentScreenings).set({ status: "completed", recommendation: "review", result: await storeJson(result) });
    const app = createModerationRoutes(db);
    const response = await app.request(`/api/moderation/reviews/${reviewId}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json() as Awaited<ReturnType<typeof readModerationReview>>;
    expect(body.screening!.result!.summary).toBe("Private assessment");
    expect(body.screening!.mode).toBe("shadow"); expect(body.isLatestSubmission).toBe(true);
    expect(body.review.flagged).toBe(false); expect(body.review.held).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const queue = await app.request("/api/moderation/queue?filter=ai_review", { headers: { Authorization: `Bearer ${token}` } });
    expect((await queue.json() as Awaited<ReturnType<typeof listModerationQueue>>).items.map(item => item.id)).toEqual([reviewId]);
    await db.update(schema.agentModerationReviews).set({ status: "resolved" }).where(eq(schema.agentModerationReviews.id, reviewId));
    const resolved = await app.request("/api/moderation/queue?filter=ai_review", { headers: { Authorization: `Bearer ${token}` } });
    const discovered = await resolved.json() as Awaited<ReturnType<typeof listModerationQueue>>;
    expect(discovered.items.map(item => item.id)).toEqual([reviewId]);
    expect(discovered.items[0]!.reviewStatus).toBe("resolved");
    const mcp = await executeModerationRead(db, moderator, { operation: "review", reviewId });
    expect(JSON.stringify(mcp)).toContain("Private assessment");
    expect(JSON.stringify(mcp)).not.toContain("request_object");
    await expect(executeModerationRead(db, owner, { operation: "review", reviewId })).rejects.toMatchObject({ status: 403 });
    await db.update(schema.agentModerationReviews).set({ route: "escalated" }).where(eq(schema.agentModerationReviews.id, reviewId));
    await expect(executeModerationRead(db, moderator, { operation: "review", reviewId })).rejects.toMatchObject({ status: 404 });
  });
});
