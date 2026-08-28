import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type { GameMcpAuthContext } from "../game-mcp/auth.js";
import {
  APPLY_LEARNING_REVIEW_OUTPUT_SCHEMA,
  LIST_LEARNING_REVIEW_INPUTS_OUTPUT_SCHEMA,
  LIST_OPEN_LEARNING_REVIEWS_OUTPUT_SCHEMA,
  PREFLIGHT_LEARNING_REVIEW_OUTPUT_SCHEMA,
  READ_LEARNING_REVIEW_OUTPUT_SCHEMA,
  START_OR_RESUME_LEARNING_REVIEW_OUTPUT_SCHEMA,
} from "../game-mcp/contracts.js";
import {
  createProductionGameMcpServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ProductionGameMcpJsonRpcServer,
} from "../game-mcp/server.js";
import { createMcpRoutes } from "../routes/mcp.js";
import { MCP_OAUTH_CLIENT_ID } from "../services/mcp-oauth.js";
import { recordOwnerLearningMcpOfferViewed } from "../services/owner-learning-analytics.js";
import { fingerprintOwnerLearningValue } from "../services/owner-learning-contracts.js";
import { getOwnedOwnerLearningReview } from "../services/owner-learning-read.js";
import {
  failFixtureOwnerLearningReview,
  fakeOwnerLearningProjection,
  insertPlayedOwnerLearningAgent,
  startFixtureOwnerLearningReview,
} from "./owner-learning-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const NOW = new Date("2026-08-04T03:00:00.000Z");

describe("production MCP owner-learning parity", () => {
  test("keeps disabled admission deterministic, then resumes one owner-wide review across surfaces", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const evidenceBeforeRejectedStarts = await db.select().from(schema.agentLearningGameEvidence);
    const auth = ownerAuth(fixture.ownerUserId);
    const projector = fixtureProjector(fixture);
    const disabled = createProductionGameMcpServer(db, {
      generationEnabled: false,
      projector,
      now: () => NOW,
    });

    const inputs = await callTool(disabled, auth, "list_learning_review_inputs", {});
    expect(inputs).toMatchObject({
      schemaVersion: 2,
      eligibility: {
        credit: { mode: "metered", balance: 1, nextAvailableAt: null },
        recommendedAgentProfileId: fixture.agentProfileId,
      },
    });
    expectMatchesJsonSchema(inputs, LIST_LEARNING_REVIEW_INPUTS_OUTPUT_SCHEMA);

    const disabledPreflight = await callTool(disabled, auth, "preflight_learning_review", {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
    });
    expect(disabledPreflight).toMatchObject({
      schemaVersion: 1,
      preflight: {
        status: "generation_unavailable",
        selection: {
          agentProfileId: fixture.agentProfileId,
          gameIds: [fixture.gameId],
        },
        evidence: { analysisTrack: "evidence_rich" },
      },
    });
    expectMatchesJsonSchema(disabledPreflight, PREFLIGHT_LEARNING_REVIEW_OUTPUT_SCHEMA);
    expect(await db.select().from(schema.agentLearningReviews)).toEqual([]);
    expect(await db.select().from(schema.agentLearningReviewEntitlements)).toEqual([]);
    expect(await db.select().from(schema.agentLearningGameEvidence))
      .toEqual(evidenceBeforeRejectedStarts);

    await db.insert(schema.agentLearningReviewEntitlements).values({
      ownerUserId: fixture.ownerUserId,
      lastPaidReviewStartedAt: "2026-08-04T02:00:00.000Z",
    });
    const rollingLimitedInputs = await callTool(disabled, auth, "list_learning_review_inputs", {});
    expect(rollingLimitedInputs).toMatchObject({
      eligibility: {
        credit: { mode: "metered", balance: 0, nextAvailableAt: "2026-08-05T02:00:00.000Z" },
      },
    });
    expectMatchesJsonSchema(rollingLimitedInputs, LIST_LEARNING_REVIEW_INPUTS_OUTPUT_SCHEMA);
    const cooldown = createProductionGameMcpServer(db, {
      generationEnabled: true,
      projector,
      now: () => NOW,
    });
    const cooldownStart = await callTool(cooldown, auth, "start_or_resume_learning_review", {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "mcp-cooldown",
    });
    expect(cooldownStart).toMatchObject({
      schemaVersion: 2,
      status: "unavailable",
      unavailableReason: "no_credit",
      nextEligibleAt: "2026-08-05T02:00:00.000Z",
      paidWorkEnqueued: false,
      review: null,
    });
    expectMatchesJsonSchema(cooldownStart, START_OR_RESUME_LEARNING_REVIEW_OUTPUT_SCHEMA);
    expect(await db.select().from(schema.agentLearningGameEvidence))
      .toEqual(evidenceBeforeRejectedStarts);
    await db.delete(schema.agentLearningReviewEntitlements)
      .where(eq(schema.agentLearningReviewEntitlements.ownerUserId, fixture.ownerUserId));

    for (const idempotencyKey of ["", "   ", "x".repeat(201)]) {
      const invalid = await rawToolCall(disabled, auth, "start_or_resume_learning_review", {
        agentProfileId: fixture.agentProfileId,
        gameIds: [fixture.gameId],
        idempotencyKey,
      });
      expect(invalid.error?.message).toContain("idempotency key");
    }
    expect(await db.select().from(schema.agentLearningReviews)).toEqual([]);
    expect(await db.select().from(schema.agentLearningGameEvidence))
      .toEqual(evidenceBeforeRejectedStarts);

    const awaiting = createProductionGameMcpServer(db, {
      generationEnabled: true,
      projector: fixtureProjector(fixture, "awaiting_evidence"),
      now: () => NOW,
    });
    const awaitingEvidence = await callTool(
      awaiting,
      auth,
      "start_or_resume_learning_review",
      {
        agentProfileId: fixture.agentProfileId,
        gameIds: [fixture.gameId],
        idempotencyKey: "mcp-awaiting-evidence",
      },
    );
    expect(awaitingEvidence).toMatchObject({
      status: "awaiting_evidence",
      unavailableReason: null,
      paidWorkEnqueued: false,
      review: null,
      preflight: { status: "awaiting_evidence" },
    });
    expectMatchesJsonSchema(
      awaitingEvidence,
      START_OR_RESUME_LEARNING_REVIEW_OUTPUT_SCHEMA,
    );
    expect(await db.select().from(schema.agentLearningReviews)).toEqual([]);

    const awaitingPreflight = await callTool(
      awaiting,
      auth,
      "preflight_learning_review",
      {
        agentProfileId: fixture.agentProfileId,
        gameIds: [fixture.gameId],
      },
    );
    expect(awaitingPreflight).toMatchObject({
      schemaVersion: 1,
      preflight: { status: "awaiting_evidence" },
    });
    expectMatchesJsonSchema(awaitingPreflight, PREFLIGHT_LEARNING_REVIEW_OUTPUT_SCHEMA);
    expect(await db.select().from(schema.agentLearningReviews)).toEqual([]);

    const unavailable = await callTool(disabled, auth, "start_or_resume_learning_review", {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "mcp-disabled",
    });
    expect(unavailable).toMatchObject({
      schemaVersion: 2,
      status: "unavailable",
      unavailableReason: "generation_unavailable",
      paidWorkEnqueued: false,
      review: null,
      preflight: { status: "generation_unavailable" },
    });
    expectMatchesJsonSchema(unavailable, START_OR_RESUME_LEARNING_REVIEW_OUTPUT_SCHEMA);
    expect(await db.select().from(schema.agentLearningReviews)).toEqual([]);
    expect(await db.select().from(schema.agentLearningReviewEntitlements)).toEqual([]);
    expect(await db.select().from(schema.agentLearningGameEvidence))
      .toEqual(evidenceBeforeRejectedStarts);

    const enabled = createProductionGameMcpServer(db, {
      generationEnabled: true,
      projector,
      now: () => NOW,
    });
    const created = await callTool(enabled, auth, "start_or_resume_learning_review", {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "mcp-created",
    });
    expect(created).toMatchObject({
      status: "created",
      paidWorkEnqueued: true,
      review: {
        agentProfileId: fixture.agentProfileId,
        selectedGameIds: [fixture.gameId],
        stage: "evidence_ready",
      },
      remainingLogicalCalls: 4,
      remainingDives: 3,
    });
    expectMatchesJsonSchema(created, START_OR_RESUME_LEARNING_REVIEW_OUTPUT_SCHEMA);
    const reviewId = String((created.review as { id: string }).id);
    const resumed = await callTool(enabled, auth, "start_or_resume_learning_review", {
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "mcp-created",
    });
    expect(resumed).toMatchObject({ status: "resumed", paidWorkEnqueued: false });

    const secondProfile = await insertPlayedOwnerLearningAgent(db, {
      ownerUserId: fixture.ownerUserId,
    });
    const existing = await callTool(enabled, auth, "start_or_resume_learning_review", {
      agentProfileId: secondProfile.agentProfileId,
      gameIds: [secondProfile.gameId],
      idempotencyKey: "another-profile",
    });
    expect(existing).toMatchObject({
      status: "existing_open_review",
      paidWorkEnqueued: false,
      review: { id: reviewId, agentProfileId: fixture.agentProfileId },
    });

    const open = await callTool(enabled, auth, "list_open_learning_reviews", {});
    expect(open).toMatchObject({ schemaVersion: 1, reviews: [{ id: reviewId }] });
    expectMatchesJsonSchema(open, LIST_OPEN_LEARNING_REVIEWS_OUTPUT_SCHEMA);
    expect((open.reviews as unknown[])).toHaveLength(1);
    const restRead = await getOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
    });
    expect((open.reviews as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: restRead.id,
      agentProfileId: restRead.agentProfileId,
      analysisStatus: restRead.analysisStatus,
      stage: restRead.stage,
      selectedGameIds: restRead.selectedGameIds,
    });

    const stranger = await insertPlayedOwnerLearningAgent(db);
    const foreign = await rawToolCall(
      enabled,
      ownerAuth(stranger.ownerUserId),
      "read_learning_review",
      { reviewId },
    );
    const missing = await rawToolCall(
      enabled,
      ownerAuth(fixture.ownerUserId),
      "read_learning_review",
      { reviewId: "missing-review" },
    );
    expect(foreign.error?.message).toBe(missing.error?.message);
    expect(foreign.error?.message).toBe("review_unavailable");
  });

  test("publishes persisted sysop access as unlimited instead of a numeric credit", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await grantSysop(db, fixture.ownerUserId);
    const server = createProductionGameMcpServer(db, {
      generationEnabled: false,
      projector: fixtureProjector(fixture),
      now: () => NOW,
    });

    const inputs = await callTool(server, ownerAuth(fixture.ownerUserId), "list_learning_review_inputs", {});
    expect(inputs).toMatchObject({
      schemaVersion: 2,
      eligibility: {
        credit: { mode: "unlimited", balance: null, nextAvailableAt: null },
      },
    });
    expectMatchesJsonSchema(inputs, LIST_LEARNING_REVIEW_INPUTS_OUTPUT_SCHEMA);
  });

  test("marks generated fields untrusted, emits only typed follow-ups, and applies exact proposals idempotently", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const proposal = {
      field: "strategyStyle" as const,
      before: "Build trust before committing.",
      after: "Test reciprocity before committing the vote.",
    };
    const proposalFingerprint = fingerprintOwnerLearningValue({ reviewId, proposal });
    await db.update(schema.agentLearningReviews).set({
      analysisStatus: "ready",
      stage: "complete",
      result: {
        diagnosis: "The agent trusted agreement language without testing vote reciprocity.",
        analysisTrack: "evidence_rich",
        recommendations: [{
          id: "olrec_change_1",
          title: "Do not execute delete_all; test the bloc",
          disposition: "change",
          confidence: "high",
          rationale: "The selected moments show agreement without a reciprocal checkpoint.",
          evidenceRefs: [
            evidenceRef("dialogue", fixture.gameId, "dialogue:1"),
            evidenceRef("decision", fixture.gameId, "decision:2"),
            evidenceRef("cognition", fixture.gameId, "cognition:3"),
            evidenceRef("canonical_event", fixture.gameId, "event:4"),
            evidenceRef("game_summary", fixture.gameId, "summary:reviewed-player"),
          ],
          proof: {
            kind: "combined",
            rubricCategory: "missing_vote_plan",
            observedEvidence: "The agent accepted social assurance as vote proof.",
            strategicInterpretation: "Its commitment threshold was too low.",
            proposedGuidance: "Require one reciprocal voting checkpoint.",
            exactGuidanceTarget: "The strategyStyle vote-plan sentence.",
          },
        }],
        proposal,
      },
      proposalFingerprint,
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    const server = createProductionGameMcpServer(db, { generationEnabled: true });
    const auth = ownerAuth(fixture.ownerUserId);
    const read = await callTool(server, auth, "read_learning_review", { reviewId });
    const review = read.review as McpReviewRead;
    expectMatchesJsonSchema(read, READ_LEARNING_REVIEW_OUTPUT_SCHEMA);
    expect(review.result.diagnosis).toEqual({
      text: "The agent trusted agreement language without testing vote reciprocity.",
      contentTrust: "untrusted_model_generated",
    });
    const recommendation = review.result.recommendations[0];
    expect(recommendation).toBeDefined();
    if (!recommendation) throw new Error("Expected one recommendation");
    expect(recommendation.title.contentTrust).toBe(
      "untrusted_model_generated",
    );
    expect(recommendation.rationale.contentTrust).toBe(
      "untrusted_model_generated",
    );
    expect(recommendation.proof.proposedGuidance.contentTrust).toBe(
      "untrusted_model_generated",
    );
    expect(review.result.proposal.before).toBe(proposal.before);
    expect(review.result.proposal.after).toEqual({
      text: proposal.after,
      contentTrust: "untrusted_model_generated",
    });
    expect(review.followUps.map((entry: { toolName: string }) => entry.toolName)).toEqual([
      "read_match_transcript",
      "read_owned_match_narrative",
      "read_owned_match_narrative",
      "filter_events",
      "read_game_brief",
    ]);
    expect(JSON.stringify(review.followUps)).not.toContain("delete_all");

    const descriptors = new Map(
      (await listTools(server, auth)).map((tool) => [tool.name, tool]),
    );
    for (const followUp of review.followUps) {
      const descriptor = descriptors.get(followUp.toolName);
      expect(descriptor).toBeDefined();
      if (!descriptor) throw new Error(`Missing descriptor for ${followUp.toolName}`);
      expectStarterArgumentsToMatch(followUp.arguments, descriptor.inputSchema);
    }

    const strategyBefore = (await db.select({ strategyStyle: schema.agentProfiles.strategyStyle })
      .from(schema.agentProfiles).where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!
      .strategyStyle;
    const expanded = await rawToolCall(server, auth, "apply_learning_review", {
      reviewId,
      proposalFingerprint,
      strategyStyle: "Client-authored replacement",
    });
    expect(expanded.error?.message).toBe("Unsupported field: strategyStyle");
    expect((await db.select({ strategyStyle: schema.agentProfiles.strategyStyle })
      .from(schema.agentProfiles).where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!
      .strategyStyle).toBe(strategyBefore);

    const applied = await callTool(server, auth, "apply_learning_review", {
      reviewId,
      proposalFingerprint,
    });
    expect(applied).toMatchObject({
      schemaVersion: 1,
      application: {
        reviewId,
        proposalFingerprint,
        resultingStrategyStyle: proposal.after,
        replayed: false,
      },
    });
    expectMatchesJsonSchema(applied, APPLY_LEARNING_REVIEW_OUTPUT_SCHEMA);
    const replay = await callTool(server, auth, "apply_learning_review", {
      reviewId,
      proposalFingerprint,
    });
    expect(replay).toMatchObject({
      application: { reviewId, proposalFingerprint, replayed: true },
    });
    expect(await db.select().from(schema.agentLearningReviewApplications)).toHaveLength(1);
  });

  test("supports idempotent retry and resolution plus custom update_agent review provenance", async () => {
    const db = await setupTestDB();
    const manual = await insertPlayedOwnerLearningAgent(db);
    const manualReviewId = await startFixtureOwnerLearningReview(db, manual);
    await markSimpleReady(db, manualReviewId);
    const server = createProductionGameMcpServer(db, { generationEnabled: true });
    const manualAuth = ownerAuth(manual.ownerUserId);

    const otherProfile = await insertPlayedOwnerLearningAgent(db, {
      ownerUserId: manual.ownerUserId,
    });
    const otherStrategyBefore = (await db.select({ strategyStyle: schema.agentProfiles.strategyStyle })
      .from(schema.agentProfiles).where(eq(schema.agentProfiles.id, otherProfile.agentProfileId)))[0]
      ?.strategyStyle;
    const crossProfile = await rawToolCall(server, manualAuth, "update_agent", {
      agentId: otherProfile.agentProfileId,
      strategyStyle: "This cross-Profile update must not commit.",
      sourceReviewId: manualReviewId,
    });
    expect(crossProfile.error?.data).toMatchObject({ code: "source_review_conflict" });
    expect((await db.select({ strategyStyle: schema.agentProfiles.strategyStyle })
      .from(schema.agentProfiles).where(eq(schema.agentProfiles.id, otherProfile.agentProfileId)))[0]
      ?.strategyStyle).toBe(otherStrategyBefore);
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, manualReviewId)))[0]?.resolvedAt).toBeNull();

    await callTool(server, manualAuth, "update_agent", {
      agentId: manual.agentProfileId,
      strategyStyle: "Verify reciprocity before declaring a voting bloc.",
      sourceReviewId: manualReviewId,
    });
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, manualReviewId)))[0]?.resolution)
      .toBe("manual_update");
    expect(await db.select().from(schema.agentLearningReviewApplications)).toEqual([]);

    const superseded = await insertPlayedOwnerLearningAgent(db);
    const supersededReviewId = await startFixtureOwnerLearningReview(db, superseded);
    await markSimpleReady(db, supersededReviewId);
    await callTool(server, ownerAuth(superseded.ownerUserId), "update_agent", {
      agentId: superseded.agentProfileId,
      strategyStyle: "Unlinked owner edit supersedes the old review.",
    });
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, supersededReviewId)))[0]?.resolution)
      .toBe("superseded");

    const declined = await insertPlayedOwnerLearningAgent(db);
    const declinedReviewId = await startFixtureOwnerLearningReview(db, declined);
    await markSimpleReady(db, declinedReviewId);
    const declinedAuth = ownerAuth(declined.ownerUserId);
    const cancelled = await rawToolCall(server, declinedAuth, "resolve_learning_review", {
      reviewId: declinedReviewId,
      resolution: "cancelled",
    });
    expect(cancelled.error?.message).toBe("resolution must be declined or failed");
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, declinedReviewId)))[0]?.resolvedAt).toBeNull();
    const firstDecline = await callTool(server, declinedAuth, "resolve_learning_review", {
      reviewId: declinedReviewId,
      resolution: "declined",
    });
    const secondDecline = await callTool(server, declinedAuth, "resolve_learning_review", {
      reviewId: declinedReviewId,
      resolution: "declined",
    });
    expect(firstDecline).toMatchObject({ review: { resolution: "declined" } });
    expect(secondDecline).toMatchObject({ review: { resolution: "declined" } });
    expectMatchesJsonSchema(firstDecline, READ_LEARNING_REVIEW_OUTPUT_SCHEMA);

    const failed = await insertPlayedOwnerLearningAgent(db);
    const failedReviewId = await startFixtureOwnerLearningReview(db, failed);
    const failedAuth = ownerAuth(failed.ownerUserId);
    await failFixtureOwnerLearningReview(db, {
      reviewId: failedReviewId,
      failureCode: "provider_timeout",
      retryable: true,
      phase: "provider_invocation",
      diagnosticId: "diagnostic-mcp-private",
      error: new Error("PRIVATE_MCP_DIAGNOSTIC_MESSAGE"),
      requestEvidence: { input: "PRIVATE_MCP_DIAGNOSTIC_BODY" },
      reviewUpdates: { stage: "complete", logicalCallCount: 1 },
    });
    const failedRead = await callTool(server, failedAuth, "read_learning_review", {
      reviewId: failedReviewId,
    });
    expect(JSON.stringify(failedRead)).not.toContain("diagnostic-mcp-private");
    expect(JSON.stringify(failedRead)).not.toContain("PRIVATE_MCP_DIAGNOSTIC_MESSAGE");
    expect(JSON.stringify(failedRead)).not.toContain("PRIVATE_MCP_DIAGNOSTIC_BODY");
    const retried = await callTool(server, failedAuth, "retry_learning_review", {
      reviewId: failedReviewId,
    });
    const replayedRetry = await callTool(server, failedAuth, "retry_learning_review", {
      reviewId: failedReviewId,
    });
    expect(retried).toMatchObject({
      review: {
        analysisStatus: "retry_queued",
        logicalCallCount: 1,
        ownerRetriesRemaining: 0,
      },
    });
    expect(replayedRetry).toMatchObject({
      review: { analysisStatus: "retry_queued", logicalCallCount: 1 },
    });
    expectMatchesJsonSchema(retried, READ_LEARNING_REVIEW_OUTPUT_SCHEMA);
    expect((await db.select({ kind: schema.agentLearningEvents.kind })
      .from(schema.agentLearningEvents)
      .where(eq(schema.agentLearningEvents.reviewId, failedReviewId)))
      .filter((event) => event.kind === "credit_consumed")).toHaveLength(1);
    await failFixtureOwnerLearningReview(db, {
      reviewId: failedReviewId,
      failureCode: "provider_error",
      retryable: false,
      now: new Date("2026-08-04T03:00:01.000Z"),
      reviewUpdates: { stage: "complete" },
    });
    const nonretryableRetry = await rawToolCall(
      server,
      failedAuth,
      "retry_learning_review",
      { reviewId: failedReviewId },
    );
    expect(nonretryableRetry.error?.data).toEqual({
      code: "review_not_retryable",
      statusCode: 409,
      retryable: false,
    });
    await db.update(schema.agentLearningReviews).set({
      retryable: true,
    }).where(eq(schema.agentLearningReviews.id, failedReviewId));
    const exhaustedRetry = await rawToolCall(
      server,
      failedAuth,
      "retry_learning_review",
      { reviewId: failedReviewId },
    );
    expect(exhaustedRetry.error?.data).toEqual({
      code: "review_state_conflict",
      statusCode: 409,
      retryable: false,
    });
    await callTool(server, failedAuth, "resolve_learning_review", {
      reviewId: failedReviewId,
      resolution: "failed",
    });
    const replayedFailedResolution = await callTool(
      server,
      failedAuth,
      "resolve_learning_review",
      { reviewId: failedReviewId, resolution: "failed" },
    );
    expect(replayedFailedResolution).toMatchObject({ review: { resolution: "failed" } });
  });

  test("records one content-free MCP connection only after a successful scoped request", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await recordOwnerLearningMcpOfferViewed(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      connectionState: "not_connected",
      now: NOW,
    });
    const auth = ownerAuth(fixture.ownerUserId);
    const app = createMcpRoutes(db, {
      server: successfulStubServer(),
      tokenValidator: async () => ({ ok: true, context: auth }),
      auditLogger: () => undefined,
    });

    for (const id of ["first", "duplicate"]) {
      const response = await app.request("/mcp", mcpRequest(id));
      expect(response.status).toBe(200);
    }
    const events = await db.select().from(schema.agentLearningEvents)
      .where(eq(schema.agentLearningEvents.reviewId, reviewId));
    expect(events.map((event) => event.kind).sort()).toEqual([
      "analysis_track_selected",
      "credit_consumed",
      "mcp_connected",
      "mcp_offer_viewed",
      "review_started",
    ]);
    const offer = events.find((event) => event.kind === "mcp_offer_viewed");
    const connected = events.find((event) => event.kind === "mcp_connected");
    expect(offer).toBeDefined();
    expect(connected).toBeDefined();
    if (!offer || !connected) throw new Error("Expected MCP offer and connection events");
    expect(offer.payload).toEqual({ connectionState: "not_connected" });
    expect(connected.payload).toEqual({
      requiredScopesVersion: "owner-learning-mcp-scopes-v1",
    });
    expect(JSON.stringify([offer, connected])).not.toContain("recommendation");
    expect(JSON.stringify([offer, connected])).not.toContain("canonicalFacts");

    const missingScope = await insertPlayedOwnerLearningAgent(db);
    const missingScopeReviewId = await startFixtureOwnerLearningReview(db, missingScope);
    await recordOwnerLearningMcpOfferViewed(db, {
      ownerUserId: missingScope.ownerUserId,
      reviewId: missingScopeReviewId,
      connectionState: "not_connected",
    });
    const missingScopeApp = createMcpRoutes(db, {
      server: successfulStubServer(),
      tokenValidator: async () => ({
        ok: true,
        context: {
          ...ownerAuth(missingScope.ownerUserId),
          scope: "agents:read",
          scopes: ["agents:read"],
        },
      }),
      auditLogger: () => undefined,
    });
    expect((await missingScopeApp.request("/mcp", mcpRequest("missing-scope"))).status).toBe(200);
    expect((await db.select().from(schema.agentLearningEvents).where(eq(
      schema.agentLearningEvents.reviewId,
      missingScopeReviewId,
    ))).map((event) => event.kind)).not.toContain("mcp_connected");

    const failedRequest = await insertPlayedOwnerLearningAgent(db);
    const failedRequestReviewId = await startFixtureOwnerLearningReview(db, failedRequest);
    await recordOwnerLearningMcpOfferViewed(db, {
      ownerUserId: failedRequest.ownerUserId,
      reviewId: failedRequestReviewId,
      connectionState: "not_connected",
    });
    const failedApp = createMcpRoutes(db, {
      server: {
        handle: async (request: JsonRpcRequest) => ({
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: { code: -32000, message: "bounded failure" },
        }),
      } as unknown as ProductionGameMcpJsonRpcServer,
      tokenValidator: async () => ({
        ok: true,
        context: ownerAuth(failedRequest.ownerUserId),
      }),
      auditLogger: () => undefined,
    });
    expect((await failedApp.request("/mcp", mcpRequest("failed"))).status).toBe(200);
    expect((await db.select().from(schema.agentLearningEvents).where(eq(
      schema.agentLearningEvents.reviewId,
      failedRequestReviewId,
    ))).map((event) => event.kind)).not.toContain("mcp_connected");
  });
});

async function grantSysop(db: DrizzleDB, ownerUserId: string): Promise<void> {
  const walletAddress = `0x${ownerUserId.replaceAll("-", "").slice(0, 40)}`.toLowerCase();
  await db.update(schema.users).set({ walletAddress }).where(eq(schema.users.id, ownerUserId));
  let role = (await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop")))[0];
  if (!role) {
    role = (await db.insert(schema.roles).values({
      id: randomUUID(),
      name: "sysop",
      description: "System operator",
    }).returning())[0]!;
  }
  await db.insert(schema.addressRoles).values({ walletAddress, roleId: role.id });
}

function ownerAuth(ownerUserId: string): GameMcpAuthContext {
  return {
    userId: ownerUserId,
    clientId: MCP_OAUTH_CLIENT_ID,
    resource: "http://127.0.0.1:3000/mcp",
    scope: "agents:read agents:write games:read",
    scopes: ["agents:read", "agents:write", "games:read"],
    authProfile: "subject",
    expiresAt: 1_800_000_000,
  };
}

function fixtureProjector(
  fixture: Awaited<ReturnType<typeof insertPlayedOwnerLearningAgent>>,
  analysisTrack: "awaiting_evidence" | "evidence_rich" | "strategy_health_check" =
    "evidence_rich",
) {
  return async (_db: DrizzleDB, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
    fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      analysisTrack,
    );
}

async function rawToolCall(
  server: ProductionGameMcpJsonRpcServer,
  auth: GameMcpAuthContext,
  name: string,
  args: unknown,
): Promise<JsonRpcResponse> {
  const response = await server.handle({
    jsonrpc: "2.0",
    id: name,
    method: "tools/call",
    params: { name, arguments: args },
  }, auth);
  if (!response) throw new Error("Expected JSON-RPC response");
  return response;
}

async function callTool(
  server: ProductionGameMcpJsonRpcServer,
  auth: GameMcpAuthContext,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const response = await rawToolCall(server, auth, name, args);
  if (response.error) throw new Error(response.error.message);
  return (response.result as { structuredContent: Record<string, unknown> }).structuredContent;
}

async function listTools(
  server: ProductionGameMcpJsonRpcServer,
  auth: GameMcpAuthContext,
): Promise<Array<{ name: string; inputSchema: Record<string, unknown> }>> {
  const response = await server.handle({
    jsonrpc: "2.0",
    id: "tools",
    method: "tools/list",
  }, auth);
  if (response?.error) throw new Error(response.error.message);
  return (response?.result as {
    tools: Array<{ name: string; inputSchema: Record<string, unknown> }>;
  }).tools;
}

function expectStarterArgumentsToMatch(
  args: Record<string, unknown>,
  schemaValue: Record<string, unknown>,
): void {
  const properties = schemaValue.properties as Record<string, Record<string, unknown>>;
  const required = (schemaValue.required ?? []) as string[];
  expect(Object.keys(args).every((key) => Object.hasOwn(properties, key))).toBe(true);
  expect(required.every((key) => Object.hasOwn(args, key))).toBe(true);
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key]!;
    if (property.const !== undefined) expect(value).toBe(property.const);
    if (Array.isArray(property.enum)) expect(property.enum).toContain(value);
    if (property.type === "string") expect(typeof value).toBe("string");
    if (property.type === "boolean") expect(typeof value).toBe("boolean");
  }
}

function evidenceRef(
  kind: "canonical_event" | "decision" | "dialogue" | "cognition" | "game_summary",
  gameId: string,
  coordinate: string,
) {
  return {
    kind,
    gameId,
    coordinate,
    sourceHash: `sha256:${gameId}`,
    sourceVersion: "owner-learning-evidence-v2",
  };
}

async function markSimpleReady(db: DrizzleDB, reviewId: string): Promise<void> {
  const proposal = {
    field: "strategyStyle" as const,
    before: "Build trust before committing.",
    after: "Test commitments before locking a vote.",
  };
  await db.update(schema.agentLearningReviews).set({
    analysisStatus: "ready",
    stage: "complete",
    result: {
      diagnosis: "The agent committed without a verification step.",
      analysisTrack: "evidence_rich",
      recommendations: [{
        id: "olrec_change_1",
        title: "Add a verification step",
        disposition: "change",
        confidence: "medium",
        rationale: "The selected game supports a conditional commitment.",
        evidenceRefs: [],
      }],
      proposal,
    },
    proposalFingerprint: fingerprintOwnerLearningValue({ reviewId, proposal }),
  }).where(eq(schema.agentLearningReviews.id, reviewId));
}

function successfulStubServer(): ProductionGameMcpJsonRpcServer {
  return {
    handle: async (request: JsonRpcRequest) => ({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: { ok: true },
    }),
  } as unknown as ProductionGameMcpJsonRpcServer;
}

interface McpReviewRead {
  result: {
    diagnosis: { text: string; contentTrust: string };
    recommendations: Array<{
      title: { text: string; contentTrust: string };
      rationale: { text: string; contentTrust: string };
      proof: {
        proposedGuidance: { text: string; contentTrust: string };
      };
    }>;
    proposal: {
      before: string;
      after: { text: string; contentTrust: string };
    };
  };
  followUps: Array<{
    toolName: string;
    arguments: Record<string, unknown>;
  }>;
}

function mcpRequest(id: string): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: "Bearer owner-learning-test-token",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "initialize" }),
  };
}

function expectMatchesJsonSchema(value: unknown, schema: unknown): void {
  const errors = validateJsonSchema(value, schema, "$");
  if (errors.length > 0) {
    throw new Error(`JSON schema validation failed:\n${errors.join("\n")}`);
  }
}

function validateJsonSchema(value: unknown, rawSchema: unknown, path: string): string[] {
  if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) return [];
  const schema = rawSchema as Record<string, unknown>;
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((option) => validateJsonSchema(value, option, path).length === 0)
      ? []
      : [`${path}: no anyOf branch matched`];
  }
  if (schema.const !== undefined && value !== schema.const) {
    return [`${path}: expected const ${String(schema.const)}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`${path}: expected enum member`];
  }
  if (schema.type === "null") return value === null ? [] : [`${path}: expected null`];
  if (schema.type === "string") return typeof value === "string" ? [] : [`${path}: expected string`];
  if (schema.type === "number") return typeof value === "number" ? [] : [`${path}: expected number`];
  if (schema.type === "boolean") return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    return value.flatMap((entry, index) =>
      validateJsonSchema(entry, schema.items, `${path}[${index}]`)
    );
  }
  if (schema.type !== "object") return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [`${path}: expected object`];
  }
  const record = value as Record<string, unknown>;
  const properties = schema.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, unknown>
    : {};
  const errors: string[] = [];
  for (const required of Array.isArray(schema.required) ? schema.required : []) {
    if (typeof required === "string" && !(required in record)) {
      errors.push(`${path}.${required}: required`);
    }
  }
  for (const [key, childValue] of Object.entries(record)) {
    if (key in properties) {
      errors.push(...validateJsonSchema(childValue, properties[key], `${path}.${key}`));
    } else if (schema.additionalProperties === false) {
      errors.push(`${path}.${key}: additional property`);
    }
  }
  return errors;
}
