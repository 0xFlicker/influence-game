import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createOwnerLearningRoutes } from "../routes/owner-learning.js";
import type { OwnerLearningEvidenceProjector } from "../services/owner-learning-review.js";
import { setupTestDB } from "./test-utils.js";
import {
  fakeOwnerLearningProjection,
  insertPlayedOwnerLearningAgent,
  startFixtureOwnerLearningReview,
} from "./owner-learning-test-utils.js";

beforeAll(() => {
  process.env.JWT_SECRET = "owner-learning-route-test-secret";
});

describe("owner learning REST routes", () => {
  test("requires authentication and makes foreign reviews indistinguishable from missing reviews", async () => {
    const db = await setupTestDB();
    const owner = await insertPlayedOwnerLearningAgent(db);
    const stranger = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, owner);
    const ownerToken = await createSessionToken(owner.ownerUserId);
    const strangerToken = await createSessionToken(stranger.ownerUserId);
    const app = new Hono().route("/", createOwnerLearningRoutes(db));

    expect((await app.request(`/api/agent-learning/reviews/${reviewId}`)).status).toBe(401);
    const foreign = await app.request(`/api/agent-learning/reviews/${reviewId}`, authGet(strangerToken));
    const missing = await app.request("/api/agent-learning/reviews/missing-review", authGet(ownerToken));
    const mismatchedProfile = await app.request(
      `/api/agent-learning/reviews/${reviewId}?agentProfileId=${stranger.agentProfileId}`,
      authGet(ownerToken),
    );

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(mismatchedProfile.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(await mismatchedProfile.json()).toEqual({
      error: "Review unavailable",
      code: "unavailable",
    });
  });

  test("returns deterministic preflight while generation is unavailable and spends nothing", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const token = await createSessionToken(fixture.ownerUserId);
    const projector = projectorFor(fixture);
    const app = new Hono().route("/", createOwnerLearningRoutes(db, {
      generationEnabled: false,
      projector,
      now: () => new Date("2026-08-04T03:00:00.000Z"),
    }));

    const preflight = await app.request("/api/agent-learning/reviews/preflight", jsonPost(token, {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
    }));
    expect(preflight.status).toBe(200);
    const preflightBody = await preflight.json();
    expect(preflightBody).toMatchObject({
      status: "generation_unavailable",
      selection: { agentProfileId: fixture.agentProfileId, gameIds: [fixture.gameId] },
    });
    const preflightSerialized = JSON.stringify(preflightBody);
    expect(preflightSerialized).not.toContain("reviewInput");
    expect(preflightSerialized).not.toContain("narrativeGroups");
    expect(preflightSerialized).not.toContain("gameEvidenceId");

    const start = await app.request("/api/agent-learning/reviews", jsonPost(token, {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "disabled-start",
    }));
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({
      status: "generation_unavailable",
      reviewId: null,
      preflight: { status: "generation_unavailable" },
    });

    const invalid = await app.request("/api/agent-learning/reviews", jsonPost(token, {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "   ",
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "invalid_idempotency_key" });
    expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(0);
    expect(await db.select().from(schema.agentLearningReviewEntitlements)).toHaveLength(0);
  });

  test("starts and resumes the singleton, exposes only the owner DTO, and rejects expanded apply input", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const token = await createSessionToken(fixture.ownerUserId);
    const app = new Hono().route("/", createOwnerLearningRoutes(db, {
      generationEnabled: true,
      projector: projectorFor(fixture),
      now: () => new Date("2026-08-04T03:00:00.000Z"),
    }));
    const startBody = {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "web-start",
    };

    const started = await app.request("/api/agent-learning/reviews", jsonPost(token, startBody));
    const startedBody = await started.json() as { reviewId: string; status: string };
    expect(startedBody.status).toBe("started");
    const resumed = await app.request("/api/agent-learning/reviews", jsonPost(token, startBody));
    expect(await resumed.json()).toMatchObject({
      status: "existing_review",
      reviewId: startedBody.reviewId,
    });

    await db.update(schema.agentLearningReviews).set({
      leaseTokenHash: "secret-lease",
      checkpointHash: "secret-checkpoint",
    }).where(eq(schema.agentLearningReviews.id, startedBody.reviewId));
    const open = await app.request("/api/agent-learning/reviews/open", authGet(token));
    expect((await open.json()) as unknown[]).toHaveLength(1);
    const read = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}?agentProfileId=${fixture.agentProfileId}`,
      authGet(token),
    );
    const serialized = JSON.stringify(await read.json());
    for (const forbidden of [
      "ownerUserId",
      "leaseTokenHash",
      "checkpointHash",
      "selectedModel",
      "providerRequestId",
      "actualCostMicrousd",
      "estimatedCostMicrousd",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const firstMcpOffer = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}/mcp-offer-viewed`,
      authPost(token),
    );
    const secondMcpOffer = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}/mcp-offer-viewed`,
      authPost(token),
    );
    expect(await firstMcpOffer.json()).toEqual({ recorded: true });
    expect(await secondMcpOffer.json()).toEqual({ recorded: false });

    await db.update(schema.agentLearningReviews).set({
      analysisStatus: "ready",
      stage: "complete",
      result: {
        diagnosis: "The agent committed before testing the room.",
        analysisTrack: "evidence_rich",
        recommendations: [{
          id: "recommendation-1",
          title: "Test support before committing",
          disposition: "change",
          confidence: "medium",
          rationale: "The selected game supports a more conditional opening.",
          evidenceRefs: [{
            kind: "game_summary",
            gameId: fixture.gameId,
            coordinate: "summary:reviewed-player",
            sourceHash: `sha256:${fixture.gameId}`,
            sourceVersion: "owner-learning-evidence-v1",
          }],
        }],
        proposal: {
          field: "strategyStyle",
          before: "Build trust before committing.",
          after: "Test support before committing.",
        },
      },
      proposalFingerprint: "sha256:proposal",
    }).where(eq(schema.agentLearningReviews.id, startedBody.reviewId));

    const firstViewed = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}/viewed`,
      authPost(token),
    );
    const secondViewed = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}/viewed`,
      authPost(token),
    );
    expect(await firstViewed.json()).toEqual({ recorded: true });
    expect(await secondViewed.json()).toEqual({ recorded: false });
    const firstManualEditor = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}/manual-editor-opened`,
      authPost(token),
    );
    const secondManualEditor = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}/manual-editor-opened`,
      authPost(token),
    );
    expect(await firstManualEditor.json()).toEqual({ recorded: true });
    expect(await secondManualEditor.json()).toEqual({ recorded: false });

    const strategyBefore = (await db.select({ strategyStyle: schema.agentProfiles.strategyStyle })
      .from(schema.agentProfiles).where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!.strategyStyle;
    const invalidApply = await app.request(
      `/api/agent-learning/reviews/${startedBody.reviewId}/apply`,
      jsonPost(token, {
        proposalFingerprint: "fingerprint",
        recommendationIds: ["client-chosen"],
        strategyStyle: "client-written strategy",
      }),
    );
    expect(invalidApply.status).toBe(400);
    expect(await invalidApply.json()).toMatchObject({ code: "invalid_input" });
    expect((await db.select({ strategyStyle: schema.agentProfiles.strategyStyle })
      .from(schema.agentProfiles).where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!.strategyStyle)
      .toBe(strategyBefore);
    expect(await db.select().from(schema.agentLearningReviewApplications)).toHaveLength(0);
    expect((await db.select({ kind: schema.agentLearningEvents.kind })
      .from(schema.agentLearningEvents)).map((event) => event.kind)).toContain("manual_editor_opened");
  });

  test("deduplicates prompt analytics by the qualifying completion watermark", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const token = await createSessionToken(fixture.ownerUserId);
    const app = new Hono().route("/", createOwnerLearningRoutes(db, {
      now: () => new Date("2026-08-04T03:00:00.000Z"),
    }));

    expect(await (await app.request(
      "/api/agent-learning/eligible-inputs",
      authGet(token),
    )).json()).toMatchObject({ mcp: { connectionState: "not_connected" } });
    await db.insert(schema.mcpOauthAccessTokens).values({
      id: "owner-learning-mcp-token",
      tokenHash: "sha256:owner-learning-route-test",
      userId: fixture.ownerUserId,
      clientId: "owner-learning-test-client",
      resourceUri: "https://mcp.example.test",
      scope: "agents:read agents:write games:read",
      audience: "game-mcp",
      purpose: "mcp_access",
      expiresAt: "2026-08-05T00:00:00.000Z",
    });
    expect(await (await app.request(
      "/api/agent-learning/eligible-inputs",
      authGet(token),
    )).json()).toMatchObject({ mcp: { connectionState: "connected" } });

    const firstImpression = await app.request(
      "/api/agent-learning/prompts/impression",
      jsonPost(token, { threshold: 1 }),
    );
    const secondImpression = await app.request(
      "/api/agent-learning/prompts/impression",
      jsonPost(token, { threshold: 1 }),
    );
    expect(await firstImpression.json()).toEqual({ recorded: true });
    expect(await secondImpression.json()).toEqual({ recorded: false });

    const firstDismissal = await app.request("/api/agent-learning/prompts/dismiss", authPost(token));
    const secondDismissal = await app.request("/api/agent-learning/prompts/dismiss", authPost(token));
    expect(await firstDismissal.json()).toEqual({ recorded: true });
    expect(await secondDismissal.json()).toEqual({ recorded: false });
    const events = await db.select().from(schema.agentLearningEvents);
    expect(events.map((event) => event.kind).sort()).toEqual([
      "prompt_dismissed",
      "prompt_impression",
    ]);
  });

  test("retries eligible failed work and never accepts cancel as an owner resolution", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const token = await createSessionToken(fixture.ownerUserId);
    const app = new Hono().route("/", createOwnerLearningRoutes(db, {
      now: () => new Date("2026-08-04T04:00:00.000Z"),
    }));
    await db.update(schema.agentLearningReviews).set({
      analysisStatus: "failed",
      stage: "complete",
      safeFailureCode: "provider_timeout",
      retryable: true,
      logicalCallCount: 1,
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    const retried = await app.request(
      `/api/agent-learning/reviews/${reviewId}/retry`,
      authPost(token),
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      id: reviewId,
      analysisStatus: "queued",
      retryable: false,
      logicalCallCount: 1,
    });

    const cancel = await app.request(
      `/api/agent-learning/reviews/${reviewId}/resolve`,
      jsonPost(token, { resolution: "cancelled" }),
    );
    expect(cancel.status).toBe(400);
    expect(await cancel.json()).toMatchObject({ code: "invalid_resolution" });
    expect((await db.select({ resolution: schema.agentLearningReviews.resolution })
      .from(schema.agentLearningReviews).where(eq(schema.agentLearningReviews.id, reviewId)))[0]!.resolution)
      .toBeNull();
  });
});

function projectorFor(
  fixture: Awaited<ReturnType<typeof insertPlayedOwnerLearningAgent>>,
): OwnerLearningEvidenceProjector {
  return async (_db, selection) => fakeOwnerLearningProjection(
    selection,
    new Map([[fixture.gameId, fixture.gameEvidenceId]]),
  );
}

function authGet(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function authPost(token: string): RequestInit {
  return { method: "POST", headers: { Authorization: `Bearer ${token}` } };
}

function jsonPost(token: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
