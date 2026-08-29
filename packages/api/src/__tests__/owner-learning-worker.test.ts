import { describe, expect, test } from "bun:test";
import { asc, eq, sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import {
  fingerprintOwnerLearningValue,
  OWNER_LEARNING_PROMPT_VERSION,
  OWNER_LEARNING_SCHEMA_VERSION,
  type OwnerLearningCheckpoint,
  type OwnerLearningReviewResult,
  type OwnerLearningSafeFailureCode,
} from "../services/owner-learning-contracts.js";
import { updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import {
  classifyOwnerLearningOutputFailure,
  claimOwnerLearningReview,
  completeOwnerLearningCall,
  createOwnerLearningTransportObserver,
  finalizeOwnerLearningReview,
  heartbeatOwnerLearningReview,
  persistOwnerLearningProviderResponse,
  reserveOwnerLearningCall,
  retryOwnerLearningReview,
  runClaimedOwnerLearningReview,
  startOwnerLearningFailureReconciliationLoop,
} from "../services/owner-learning-worker.js";
import {
  OwnerLearningAttemptPersistenceError,
  OwnerLearningProviderError,
  type OwnerLearningProvider,
} from "../services/owner-learning-provider.js";
import { OwnerLearningOutputValidationError } from "../services/owner-learning-failures.js";
import {
  lockOwnerLearningReviewForProfileMutation,
  resolveOwnedOwnerLearningReview,
  resolveOwnerLearningReviewForProfileMutation,
} from "../services/owner-learning-resolution.js";
import {
  failFixtureOwnerLearningReview,
  fakeOwnerLearningProjection,
  insertPlayedOwnerLearningAgent,
  startFixtureOwnerLearningReview,
} from "./owner-learning-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("owner learning worker durability", () => {
  test("runs failure-evidence reconciliation without constructing a provider worker", async () => {
    let reconciliations = 0;
    let releaseFirstReconciliation: (() => void) | null = null;
    const firstReconciliation = new Promise<void>((resolve) => {
      releaseFirstReconciliation = resolve;
    });
    const loop = startOwnerLearningFailureReconciliationLoop({} as never, {
      pollIntervalMs: 10_000,
      async reconcile() {
        reconciliations += 1;
        releaseFirstReconciliation?.();
      },
    });

    await firstReconciliation;
    await loop.stop();
    expect(reconciliations).toBe(1);
    expect(loop.stopped).toBe(true);
  });

  test("classifies Strategy Health semantic failures from typed validation codes", () => {
    const cases = [
      [
        "strategyHealthClassification is required for Strategy Health Check",
        "strategy_health_classification_missing",
      ],
      [
        "Strategy Health Check no-change must specifically defend the current guidance",
        "strategy_health_no_change_unsupported",
      ],
      [
        "recommendations[0].proof is required for Strategy Health Check",
        "strategy_health_proof_missing",
      ],
      [
        "recommendations[0].proof.rubricCategory is required",
        "proof_rubric_missing",
      ],
      [
        "recommendations[0].proof observed pattern requires two games",
        "cross_game_proof_missing",
      ],
    ] as const;

    for (const [message, expectedCode] of cases) {
      const code = classifyOwnerLearningOutputFailure(
        new OwnerLearningOutputValidationError(expectedCode, message),
      );
      expect(code).toBe(expectedCode);
      expect(code).not.toContain("recommendations[0]");
    }
  });

  test("classifies unexpected failures in every worker phase as phase-specific internal errors", async () => {
    const phases = [
      "selection",
      "evidence_projection",
      "materialization",
      "call_reservation",
      "provider_invocation",
      "output_validation",
      "checkpoint_persistence",
      "finalization",
    ] as const;

    for (const phase of phases) {
      const db = await setupTestDB();
      const fixture = await insertPlayedOwnerLearningAgent(db);
      const reviewId = await startFixtureOwnerLearningReview(db, fixture);
      const claim = (await claimOwnerLearningReview(db, {
        now: new Date("2026-08-04T03:01:00.000Z"),
      }))!;
      const provider: OwnerLearningProvider = {
        async invoke(request) {
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            providerRequestId: `req-${phase}`,
            completedAtMs: Date.parse("2026-08-04T03:01:01.100Z"),
          });
          return successfulProviderTurn({
            provisionalThemes: [],
            selectedMomentHandles: [],
            findings: [],
            finalResult: {
              diagnosis: "The current strategy remains coherent.",
              analysisTrack: "evidence_rich",
              strategyHealthClassification: null,
              recommendations: [],
              proposal: null,
              noChange: { rationale: "No repeated strategy defect appears." },
            },
          });
        },
      };
      const projector = async (
        _db: typeof db,
        selection: Parameters<typeof fakeOwnerLearningProjection>[0],
      ) => fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );

      expect(await runClaimedOwnerLearningReview(db, claim, {
        provider,
        projector,
        now: () => new Date("2026-08-04T03:01:02.000Z"),
        phaseFaultInjector(currentPhase) {
          if (currentPhase === phase) throw new Error(`injected ${phase} failure`);
        },
      })).toBe(false);

      const review = (await db.select().from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
      expect(review).toMatchObject({
        analysisStatus: "failed",
        safeFailureCode: "internal_error",
        executionPhase: phase,
      });
      const diagnostic = (await db.select().from(schema.agentLearningReviewFailureDiagnostics))[0]!;
      expect(diagnostic).toMatchObject({
        reviewId,
        phase,
        safeFailureCode: "internal_error",
      });
      expect((await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))).toHaveLength(1);
    }
  });

  test("does not terminalize when diagnostic persistence itself fails", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION reject_owner_learning_diagnostic_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'diagnostic persistence blocked';
      END;
      $$;
      CREATE TRIGGER reject_owner_learning_diagnostic_insert
      BEFORE INSERT ON agent_learning_review_failure_diagnostics
      FOR EACH ROW EXECUTE FUNCTION reject_owner_learning_diagnostic_insert();
    `));

    try {
      await expect(runClaimedOwnerLearningReview(db, claim, {
        provider: {
          async invoke() {
            throw new Error("provider must not be reached");
          },
        },
        now: () => new Date("2026-08-04T03:01:02.000Z"),
        phaseFaultInjector(phase) {
          if (phase === "selection") throw new Error("injected selection failure");
        },
      })).rejects.toThrow();

      expect((await db.select().from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
        analysisStatus: "running",
        executionPhase: "selection",
        safeFailureCode: null,
      });
      expect(await db.select().from(schema.agentLearningReviewFailureDiagnostics)).toHaveLength(0);
      expect(await db.select().from(schema.agentLearningReviewFailureManifests)).toHaveLength(0);
      expect(await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox)).toHaveLength(0);
      expect((await db.select().from(schema.agentLearningEvents))
        .filter((event) => event.kind === "review_failed")).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS reject_owner_learning_diagnostic_insert
          ON agent_learning_review_failure_diagnostics;
        DROP FUNCTION IF EXISTS reject_owner_learning_diagnostic_insert();
      `));
    }
  });

  test("scrubs credentials from failure events, summaries, outbox evidence, and logs", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const secret = "OWNER_REVIEW_CREDENTIAL_SENTINEL";
    const envKey = "OWNER_REVIEW_TEST_SECRET";
    const previousSecret = process.env[envKey];
    const originalConsoleError = console.error;
    const logLines: string[] = [];
    process.env[envKey] = secret;
    console.error = (...values: unknown[]) => {
      logLines.push(values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "));
    };

    try {
      expect(await runClaimedOwnerLearningReview(db, claim, {
        provider: {
          async invoke() {
            throw new Error("provider must not be reached");
          },
        },
        now: () => new Date("2026-08-04T03:01:02.000Z"),
        phaseFaultInjector(phase) {
          if (phase === "selection") {
            throw Object.assign(
              new Error(`NON_SECRET_FAILURE_CONTEXT ${secret}`),
              { code: "TEST_DATABASE_CONSTRAINT" },
            );
          }
        },
      })).toBe(false);
    } finally {
      console.error = originalConsoleError;
      if (previousSecret === undefined) delete process.env[envKey];
      else process.env[envKey] = previousSecret;
    }

    const reviewFailedEvent = (await db.select().from(schema.agentLearningEvents))
      .find((event) => event.kind === "review_failed");
    const diagnostic = (await db.select().from(schema.agentLearningReviewFailureDiagnostics))[0]!;
    const outbox = (await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0]!;
    for (const serialized of [
      JSON.stringify(reviewFailedEvent?.payload),
      JSON.stringify(diagnostic),
      outbox.body,
      logLines.join("\n"),
    ]) {
      expect(serialized).not.toContain(secret);
      expect(serialized).toContain("NON_SECRET_FAILURE_CONTEXT");
    }
    expect(diagnostic.sanitizedMessage).toContain("[REDACTED]");
    expect(diagnostic.errorCode).toBe("TEST_DATABASE_CONSTRAINT");
    expect(reviewFailedEvent?.payload).toMatchObject({
      diagnostic: {
        diagnosticId: diagnostic.id,
        fingerprint: diagnostic.fingerprint,
        message: diagnostic.sanitizedMessage,
      },
    });
  });

  test("recovers a post-response finalization failure locally without another provider request", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    let providerInvocations = 0;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerInvocations += 1;
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          providerRequestId: "req-finalization-recovery",
          completedAtMs: Date.parse("2026-08-04T03:01:01.100Z"),
        });
        return successfulProviderTurn({
          provisionalThemes: [],
          selectedMomentHandles: [],
          findings: [],
          finalResult: {
            diagnosis: "The standing guidance remains coherent.",
            analysisTrack: "evidence_rich",
            strategyHealthClassification: null,
            recommendations: [],
            proposal: null,
            noChange: { rationale: "No repeatable strategy defect appears." },
          },
        });
      },
    };
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
      phaseFaultInjector(phase) {
        if (phase === "finalization") throw new Error("injected finalization persistence failure");
      },
    })).toBe(false);

    const failed = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(failed).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "internal_error",
      executionPhase: "finalization",
      logicalCallCount: 1,
    });
    expect(failed.checkpoint?.completion).not.toBeNull();
    expect((await db.select().from(schema.agentLearningReviewCalls))).toHaveLength(1);
    expect((await db.select().from(schema.agentLearningReviewCalls))[0]?.state).toBe("succeeded");

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const secondClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, secondClaim, {
      provider: {
        async invoke() {
          throw new Error("provider must not be called during local recovery");
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:02.000Z"),
    })).toBe(true);

    expect(providerInvocations).toBe(1);
    expect((await db.select().from(schema.agentLearningReviewCalls))).toHaveLength(1);
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "no_change",
      logicalCallCount: 1,
      ownerRetryCount: 1,
    });
  });

  test("recovers a durably observed response after a hard worker stop without another provider request", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    let providerInvocations = 0;
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    await expect(runClaimedOwnerLearningReview(db, firstClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          const output = {
            provisionalThemes: [],
            selectedMomentHandles: [],
            findings: [],
            finalResult: {
              diagnosis: "The standing guidance remains coherent.",
              analysisTrack: "evidence_rich",
              strategyHealthClassification: null,
              recommendations: [],
              proposal: null,
              noChange: { rationale: "No repeated strategy defect appears." },
            },
          };
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
          });
          await request.onResponseObserved?.({
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: "sha256:raw-staged-response",
            responseEvidence: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: "resp-response-staged",
                status: "completed",
                service_tier: "flex",
                output: [{
                  type: "message",
                  content: [{ type: "output_text", text: JSON.stringify(output) }],
                }],
                usage: {
                  input_tokens: 1_000,
                  input_tokens_details: { cached_tokens: 200 },
                  output_tokens: 300,
                  output_tokens_details: { reasoning_tokens: 50 },
                },
              }),
            },
            providerResponseId: "resp-response-staged",
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            providerRequestId: "req-response-staged",
            completedAtMs: Date.parse("2026-08-04T03:01:01.100Z"),
          });
          return successfulProviderTurn(output);
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
      faultInjector(point) {
        if (point === "response_observed") throw new Error("simulated process stop after response receipt");
      },
    })).rejects.toThrow("simulated process stop after response receipt");

    const stagedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(stagedCall).toMatchObject({
      state: "dispatched",
      providerResponseId: "resp-response-staged",
      responseEvidenceBodySha256: expect.stringMatching(/^sha256:/),
      requestEvidenceSha256: expect.stringMatching(/^sha256:/),
    });
    expect(stagedCall.requestEvidenceBody).toContain("owner-learning-harness-v3");
    expect(stagedCall.responseEvidenceBody).toContain("No repeated strategy defect appears.");
    const stagedRequest = (JSON.parse(stagedCall.requestEvidenceBody!) as {
      evidence: Record<string, unknown>;
    }).evidence;
    expect(stagedRequest).toMatchObject({
      model: "gpt-5.6-luna",
      service_tier: "flex",
      store: false,
      max_output_tokens: 8_000,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(stagedRequest.input).toContain("<owner_learning_data>");

    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:03.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider: {
        async invoke() {
          throw new Error("provider must not be called for a staged response");
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(true);

    expect(providerInvocations).toBe(1);
    expect(await db.select().from(schema.agentLearningReviewCalls)).toHaveLength(1);
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "no_change",
      logicalCallCount: 1,
      ownerRetryCount: 0,
    });
  });

  test("retains accounting and uses a fresh attempt when parsed-response persistence fails", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    const output = {
      provisionalThemes: [],
      selectedMomentHandles: [],
      findings: [],
      finalResult: {
        diagnosis: "The standing guidance remains coherent.",
        analysisTrack: "evidence_rich" as const,
        strategyHealthClassification: null,
        recommendations: [],
        proposal: null,
        noChange: { rationale: "No repeated strategy defect appears." },
      },
    };
    let providerInvocations = 0;
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
          });
          await request.onResponseObserved?.({
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: `sha256:${"2".repeat(64)}`,
            responseEvidence: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: "resp-receipt-persistence",
                status: "completed",
                service_tier: "flex",
                output: [{
                  type: "message",
                  content: [{ type: "output_text", text: JSON.stringify(output) }],
                }],
                usage: { input_tokens: 1_000, output_tokens: 300, total_tokens: 1_300 },
              }),
            },
            providerResponseId: "resp-receipt-persistence",
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            providerRequestId: "req-receipt-persistence",
            completedAtMs: Date.parse("2026-08-04T03:01:01.100Z"),
          });
          return {
            ...successfulProviderTurn(output),
            providerResponseId: "resp-receipt-persistence",
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: `sha256:${"2".repeat(64)}`,
            responseEvidence: { output },
          };
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
      receiptPersistenceFaultInjector() {
        throw new Error("parsed response receipt database unavailable");
      },
    })).toBe(false);

    expect((await db.select().from(schema.agentLearningReviewCalls))[0]).toMatchObject({
      state: "failed",
      providerResponseId: "resp-receipt-persistence",
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
      costSource: "estimated",
      estimatedCostMicrousd: expect.any(Number),
    });
    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const secondClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, secondClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:02:02.000Z"),
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            completedAtMs: Date.parse("2026-08-04T03:02:02.100Z"),
          });
          return successfulProviderTurn(output);
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:02.000Z"),
    })).toBe(true);

    expect(providerInvocations).toBe(2);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(2);
    expect(calls.find((call) => call.attemptOrdinal === 1)).toMatchObject({
      state: "failed",
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
    });
    expect(calls.find((call) => call.attemptOrdinal === 2)).toMatchObject({
      state: "succeeded",
      retryOfAttemptId: calls.find((call) => call.attemptOrdinal === 1)?.id,
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
      costSource: "estimated",
    });
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "no_change",
      ownerRetryCount: 1,
    });
  });

  test("retains a staged response and retries fresh when terminal-observer persistence fails", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    const output = {
      provisionalThemes: [],
      selectedMomentHandles: [],
      findings: [],
      finalResult: {
        diagnosis: "The standing guidance remains coherent.",
        analysisTrack: "evidence_rich" as const,
        strategyHealthClassification: null,
        recommendations: [],
        proposal: null,
        noChange: { rationale: "No repeated strategy defect appears." },
      },
    };
    const rawBody = JSON.stringify({
      id: "resp-terminal-observer-recovery",
      status: "completed",
      service_tier: "flex",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      }],
      usage: { input_tokens: 900, output_tokens: 250, total_tokens: 1_150 },
    });
    let providerInvocations = 0;
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
          });
          await request.onResponseObserved?.({
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: `sha256:${"3".repeat(64)}`,
            responseEvidence: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: rawBody,
            },
            providerResponseId: "resp-terminal-observer-recovery",
          });
          const receiptFailure = new Error("terminal outcome receipt could not be committed");
          throw new OwnerLearningAttemptPersistenceError({
            requestEvidence: request.input,
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: `sha256:${"3".repeat(64)}`,
            responseEvidence: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: rawBody,
            },
            providerResponseId: "resp-terminal-observer-recovery",
          }, receiptFailure);
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
    })).toBe(false);

    expect((await db.select().from(schema.agentLearningReviewCalls))[0]).toMatchObject({
      state: "failed",
      providerResponseId: "resp-terminal-observer-recovery",
      tokenReceipt: { inputTokens: 900, totalOutputTokens: 250 },
      costSource: "estimated",
      estimatedCostMicrousd: expect.any(Number),
    });
    expect((await db.select().from(schema.agentLearningReviews))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "internal_error",
      retryable: true,
    });
    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const secondClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, secondClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:02:02.000Z"),
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            completedAtMs: Date.parse("2026-08-04T03:02:02.100Z"),
          });
          return successfulProviderTurn(output);
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:02.000Z"),
    })).toBe(true);

    expect(providerInvocations).toBe(2);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(2);
    expect(calls.find((call) => call.attemptOrdinal === 1)?.state).toBe("failed");
    expect(calls.find((call) => call.attemptOrdinal === 2)).toMatchObject({
      state: "succeeded",
      retryOfAttemptId: calls.find((call) => call.attemptOrdinal === 1)?.id,
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
      costSource: "estimated",
    });
  });

  test("stages captured response evidence transactionally when the first observation write fails", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    const output = {
      provisionalThemes: [],
      selectedMomentHandles: [],
      findings: [],
      finalResult: {
        diagnosis: "The standing guidance remains coherent.",
        analysisTrack: "evidence_rich" as const,
        strategyHealthClassification: null,
        recommendations: [],
        proposal: null,
        noChange: { rationale: "No repeated strategy defect appears." },
      },
    };
    const rawBody = JSON.stringify({
      id: "resp-observation-write-recovery",
      status: "completed",
      service_tier: "flex",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      }],
      usage: { input_tokens: 850, output_tokens: 225, total_tokens: 1_075 },
    });
    let providerInvocations = 0;
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
          });
          throw new OwnerLearningAttemptPersistenceError({
            requestEvidence: request.input,
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: `sha256:${"9".repeat(64)}`,
            responseEvidence: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: rawBody,
            },
            providerResponseId: "resp-observation-write-recovery",
          }, new Error("raw response staging transaction failed"));
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
    })).toBe(false);

    expect((await db.select().from(schema.agentLearningReviewCalls))[0]).toMatchObject({
      state: "failed",
      providerResponseId: "resp-observation-write-recovery",
      responseEvidenceBody: expect.stringContaining("No repeated strategy defect appears."),
      tokenReceipt: { inputTokens: 850, totalOutputTokens: 225 },
      costSource: "estimated",
      estimatedCostMicrousd: expect.any(Number),
    });
    expect((await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0]?.body)
      .toContain("raw response staging transaction failed");

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const retryClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, retryClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:02:02.000Z"),
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            completedAtMs: Date.parse("2026-08-04T03:02:02.100Z"),
          });
          return successfulProviderTurn(output);
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:02.000Z"),
    })).toBe(true);
    expect(providerInvocations).toBe(2);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(2);
    expect(calls.find((call) => call.attemptOrdinal === 1)?.state).toBe("failed");
    expect(calls.find((call) => call.attemptOrdinal === 2)).toMatchObject({
      state: "succeeded",
      retryOfAttemptId: calls.find((call) => call.attemptOrdinal === 1)?.id,
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
      costSource: "estimated",
    });
  });

  test("preserves the provider receipt and database cause when terminal outcome persistence fails", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const rawBody = JSON.stringify({ error: { message: "RAW_500_TERMINAL_SENTINEL" } });
    const terminalOutcome = {
      transportOrdinal: 1,
      attemptedTier: "flex" as const,
      httpStatus: 500,
      latencyMs: 417,
      providerRequestId: "req-terminal-db-failure",
      completedAtMs: Date.parse("2026-08-04T03:01:01.417Z"),
    };
    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider: {
        async invoke(request) {
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
          });
          await request.onResponseObserved?.({
            responseObservedAt: "2026-08-04T03:01:01.417Z",
            responseSha256: `sha256:${"c".repeat(64)}`,
            responseEvidence: {
              status: 500,
              headers: { "content-type": "application/json" },
              body: rawBody,
            },
            providerResponseId: null,
          });
          throw new OwnerLearningAttemptPersistenceError({
            requestEvidence: request.input,
            responseObservedAt: "2026-08-04T03:01:01.417Z",
            responseSha256: `sha256:${"c".repeat(64)}`,
            responseEvidence: {
              status: 500,
              headers: { "content-type": "application/json" },
              body: rawBody,
            },
            providerResponseId: null,
          }, new Error("TERMINAL_RECEIPT_DATABASE_CAUSE"), terminalOutcome);
        },
      },
      projector: async (_db, selection) => fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      ),
      now: () => new Date("2026-08-04T03:01:02.000Z"),
    })).toBe(false);

    expect((await db.select().from(schema.agentLearningReviews))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "provider_error",
      retryable: true,
    });
    expect((await db.select().from(schema.agentLearningReviewCalls))[0]).toMatchObject({
      state: "failed",
      safeFailureCode: "provider_error",
      finalProviderRequestId: "req-terminal-db-failure",
      transportReceipts: [{
        terminalHttpStatus: 500,
        latencyMs: 417,
        providerRequestId: "req-terminal-db-failure",
      }],
    });
    expect((await db.select().from(schema.agentLearningReviewFailureDiagnostics))[0])
      .toMatchObject({
        safeFailureCode: "provider_error",
        errorCode: "provider_http_500",
        providerRequestId: "req-terminal-db-failure",
      });
    const evidence = (await db.select()
      .from(schema.agentLearningReviewFailureEvidenceOutbox))[0]!.body;
    expect(evidence).toContain("RAW_500_TERMINAL_SENTINEL");
    expect(evidence).toContain("TERMINAL_RECEIPT_DATABASE_CAUSE");
    expect(evidence).toContain("OwnerLearningProviderPersistenceFailure");
    expect(evidence).toContain("provider_http_500");
  });

  test("keeps terminal-observer failure authoritative after an intermediate Flex 429", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const rawBody = JSON.stringify({ error: { message: "FLEX_CAPACITY_SENTINEL" } });
    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider: {
        async invoke(request) {
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
          });
          await request.onResponseObserved?.({
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: `sha256:${"a".repeat(64)}`,
            responseEvidence: {
              status: 429,
              headers: { "retry-after": "1" },
              body: rawBody,
            },
            providerResponseId: null,
          });
          throw new OwnerLearningAttemptPersistenceError({
            requestEvidence: request.input,
            responseObservedAt: "2026-08-04T03:01:01.050Z",
            responseSha256: `sha256:${"a".repeat(64)}`,
            responseEvidence: {
              status: 429,
              headers: { "retry-after": "1" },
              body: rawBody,
            },
            providerResponseId: null,
          }, new Error("terminal Flex receipt database unavailable"), {
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 429,
            latencyMs: 50,
            backoffMs: 1_000,
            completedAtMs: Date.parse("2026-08-04T03:01:01.050Z"),
          });
        },
      },
      projector: async (
        _db,
        selection,
      ) => fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      ),
      now: () => new Date("2026-08-04T03:01:02.000Z"),
    })).toBe(false);

    expect((await db.select().from(schema.agentLearningReviews))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "internal_error",
      retryable: true,
    });
    expect((await db.select().from(schema.agentLearningReviewCalls))[0]).toMatchObject({
      state: "failed",
      safeFailureCode: "internal_error",
      transportReceipts: [{ terminalHttpStatus: 429, backoffMs: 1_000 }],
    });
    const evidence = (await db.select()
      .from(schema.agentLearningReviewFailureEvidenceOutbox))[0]!.body;
    expect(evidence).toContain("terminal Flex receipt database unavailable");
    expect(evidence).toContain("FLEX_CAPACITY_SENTINEL");
  });

  test("reuses validated provider output after checkpoint persistence fails", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    let providerInvocations = 0;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerInvocations += 1;
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs: Date.parse("2026-08-04T03:01:01.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          providerRequestId: "req-checkpoint-persistence-recovery",
          completedAtMs: Date.parse("2026-08-04T03:01:01.100Z"),
        });
        return successfulProviderTurn({
          provisionalThemes: [],
          selectedMomentHandles: [],
          findings: [],
          finalResult: {
            diagnosis: "The current strategy remains coherent.",
            analysisTrack: "evidence_rich",
            strategyHealthClassification: null,
            recommendations: [],
            proposal: null,
            noChange: { rationale: "No repeated strategy defect appears." },
          },
        });
      },
    };
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;

    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
      phaseFaultInjector(phase) {
        if (phase === "checkpoint_persistence") {
          throw new Error("checkpoint database unavailable");
        }
      },
    })).toBe(false);

    const failedAttempt = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(failedAttempt).toMatchObject({
      state: "failed",
      safeFailureCode: "internal_error",
      failureDiagnosticId: expect.any(String),
      responseEvidenceBody: expect.stringContaining("No repeated strategy defect appears."),
    });
    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const secondClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, secondClaim, {
      provider: {
        async invoke() {
          throw new Error("provider must not be called during checkpoint recovery");
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:02.000Z"),
    })).toBe(true);

    expect(providerInvocations).toBe(1);
    const attempts = await db.select().from(schema.agentLearningReviewCalls)
      .orderBy(asc(schema.agentLearningReviewCalls.attemptOrdinal));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      id: failedAttempt.id,
      state: "failed",
      attemptOrdinal: 1,
      retryOfAttemptId: null,
      costSource: "estimated",
      tokenReceipt: expect.any(Object),
    });
    expect(attempts[1]).toMatchObject({
      state: "succeeded",
      attemptOrdinal: 2,
      retryOfAttemptId: failedAttempt.id,
      costSource: "unavailable",
      tokenReceipt: null,
      transportReceipts: [],
    });
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "no_change",
      logicalCallCount: 1,
      ownerRetryCount: 1,
    });
  });

  test("retains a late response and retries fresh after lease reconciliation", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    }))!;
    const output = {
      provisionalThemes: [],
      selectedMomentHandles: [],
      findings: [],
      finalResult: {
        diagnosis: "The standing guidance remains coherent.",
        analysisTrack: "evidence_rich" as const,
        strategyHealthClassification: null,
        recommendations: [],
        proposal: null,
        noChange: { rationale: "No repeated strategy defect appears." },
      },
    };
    const rawBody = JSON.stringify({
      id: "resp-late",
      status: "completed",
      service_tier: "flex",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      }],
      usage: { input_tokens: 700, output_tokens: 200, total_tokens: 900 },
    });
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    let dispatched!: () => void;
    const dispatchObserved = new Promise<void>((resolve) => { dispatched = resolve; });
    let providerInvocations = 0;
    const firstRun = runClaimedOwnerLearningReview(db, claim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:00.100Z"),
          });
          dispatched();
          await responseGate;
          await request.onResponseObserved?.({
            responseObservedAt: "2026-08-04T03:02:01.000Z",
            responseSha256: `sha256:${"4".repeat(64)}`,
            responseEvidence: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: rawBody,
            },
            providerResponseId: "resp-late",
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            completedAtMs: Date.parse("2026-08-04T03:02:01.100Z"),
          });
          return successfulProviderTurn(output);
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:01:00.200Z"),
    });
    await dispatchObserved;

    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBeNull();
    const originalCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    const originalDiagnosticId = originalCall.failureDiagnosticId;
    expect(originalCall.state).toBe("ambiguous");

    releaseResponse();
    expect(await firstRun).toBe(false);

    expect((await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, originalCall.id)))[0]).toMatchObject({
      state: "ambiguous",
      failureDiagnosticId: originalDiagnosticId,
      providerResponseId: "resp-late",
      providerResponseObservedAt: "2026-08-04T03:02:01.000Z",
      responseEvidenceBody: expect.stringContaining("No repeated strategy defect appears."),
      tokenReceipt: { inputTokens: 700, totalOutputTokens: 200 },
      costSource: "estimated",
    });
    const diagnostics = await db.select().from(schema.agentLearningReviewFailureDiagnostics);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.some((diagnostic) =>
      diagnostic.errorCode === "late_provider_response_observed"
      && diagnostic.callId === originalCall.id
    )).toBe(true);
    expect(diagnostics.some((diagnostic) =>
      diagnostic.errorCode === "late_terminal_outcome_observed"
      && diagnostic.callId === originalCall.id
    )).toBe(true);

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:03:00.000Z"),
    })).toBe(true);
    const retryClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:03:01.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, retryClaim, {
      provider: {
        async invoke(request) {
          providerInvocations += 1;
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:03:02.000Z"),
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            completedAtMs: Date.parse("2026-08-04T03:03:02.100Z"),
          });
          return successfulProviderTurn(output);
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:03:02.000Z"),
    })).toBe(true);

    expect(providerInvocations).toBe(2);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(2);
    expect(calls.find((call) => call.attemptOrdinal === 1)).toMatchObject({
      id: originalCall.id,
      state: "ambiguous",
      tokenReceipt: { inputTokens: 700, totalOutputTokens: 200 },
    });
    expect(calls.find((call) => call.attemptOrdinal === 2)).toMatchObject({
      state: "succeeded",
      retryOfAttemptId: originalCall.id,
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
      costSource: "estimated",
    });
    expect((await db.select().from(schema.agentLearningReviews))[0]).toMatchObject({
      analysisStatus: "no_change",
      logicalCallCount: 1,
      ownerRetryCount: 1,
    });
  });

  test("denies retry when a late response proves the provider failure was nonretryable", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    }))!;
    const reservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:late-nonretryable",
      requestEvidence: { input: "LATE_401_REQUEST_SENTINEL" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:00.100Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: reservation.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:00.200Z"),
    });
    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBeNull();
    const originalCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    const originalDiagnosticId = originalCall.failureDiagnosticId;

    await persistOwnerLearningProviderResponse(db, {
      reviewId,
      callId: reservation.callId,
      leaseToken: claim.leaseToken,
      observation: {
        responseObservedAt: "2026-08-04T03:02:01.000Z",
        responseSha256: `sha256:${"d".repeat(64)}`,
        responseEvidence: {
          status: 401,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: { message: "LATE_401_RESPONSE_SENTINEL" } }),
        },
        providerResponseId: null,
      },
      now: new Date("2026-08-04T03:02:01.000Z"),
    });

    expect((await db.select().from(schema.agentLearningReviews))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "worker_interrupted",
      retryable: false,
      ownerRetryCount: 0,
    });
    expect((await db.select().from(schema.agentLearningReviewCalls))[0]).toMatchObject({
      state: "ambiguous",
      failureDiagnosticId: originalDiagnosticId,
      responseEvidenceBody: expect.stringContaining("LATE_401_RESPONSE_SENTINEL"),
    });
    const diagnostics = await db.select().from(schema.agentLearningReviewFailureDiagnostics);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      safeFailureCode: "provider_error",
      errorCode: "provider_http_401",
      callId: reservation.callId,
    }));
    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:03:00.000Z"),
    })).toBe(false);
    expect((await db.select().from(schema.agentLearningReviews))[0]?.ownerRetryCount).toBe(0);
  });

  test("cancels a claimed retry when a late response proves the failure terminal", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    }))!;
    const reservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:queued-late-terminal",
      requestEvidence: { input: "QUEUED_LATE_401_REQUEST" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:00.100Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: reservation.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:00.200Z"),
    });
    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBeNull();
    const originalDiagnosticId = (await db.select().from(schema.agentLearningReviewCalls))[0]!
      .failureDiagnosticId;
    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.100Z"),
    })).toBe(true);
    const retryClaim = await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.200Z"),
    });
    expect(retryClaim?.reviewId).toBe(reviewId);

    await persistOwnerLearningProviderResponse(db, {
      reviewId,
      callId: reservation.callId,
      leaseToken: claim.leaseToken,
      observation: {
        responseObservedAt: "2026-08-04T03:02:01.000Z",
        responseSha256: `sha256:${"e".repeat(64)}`,
        responseEvidence: {
          status: 401,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: { message: "QUEUED_LATE_401_RESPONSE" } }),
        },
        providerResponseId: null,
      },
      now: new Date("2026-08-04T03:02:01.000Z"),
    });

    expect((await db.select().from(schema.agentLearningReviews))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "provider_error",
      retryable: false,
      ownerRetryCount: 1,
    });
    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:02.000Z"),
    })).toBeNull();
    await expect(reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: retryClaim!.leaseToken,
      inputPolicyHash: "sha256:cancelled-retry",
      requestEvidence: { input: "CANCELLED_RETRY_REQUEST" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:02:02.100Z"),
    })).rejects.toMatchObject({ code: "stale_or_invalid_lease" });
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.failureDiagnosticId).toBe(originalDiagnosticId);
    expect((await db.select().from(schema.agentLearningEvents))
      .filter((event) => event.kind === "review_failed")).toHaveLength(2);
  });

  test("recovers a typed output-budget failure and accounting from an observed response", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    }))!;
    const reservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:observed-output-budget",
      requestEvidence: { input: "OUTPUT_BUDGET_REQUEST" },
      stage: "drafting_recommendations",
      now: new Date("2026-08-04T03:01:00.100Z"),
    });
    const providerBody = JSON.stringify({
      id: "resp-output-budget-recovery",
      status: "incomplete",
      service_tier: "flex",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
      usage: { input_tokens: 100, output_tokens: 8_000, total_tokens: 8_100 },
    });
    await persistOwnerLearningProviderResponse(db, {
      reviewId,
      callId: reservation.callId,
      leaseToken: claim.leaseToken,
      observation: {
        responseObservedAt: "2026-08-04T03:01:00.900Z",
        responseSha256: `sha256:${"1".repeat(64)}`,
        responseEvidence: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: providerBody,
        },
        providerResponseId: "resp-output-budget-recovery",
      },
      now: new Date("2026-08-04T03:01:00.900Z"),
    });

    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:02.000Z"),
    })).toBeNull();
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "output_budget_exhausted",
      retryable: true,
    });
    expect((await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, reservation.callId)))[0]).toMatchObject({
      state: "failed",
      safeFailureCode: "output_budget_exhausted",
      providerResponseId: "resp-output-budget-recovery",
      tokenReceipt: { inputTokens: 100, totalOutputTokens: 8_000 },
      costSource: "estimated",
      estimatedCostMicrousd: expect.any(Number),
    });
    expect((await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0]?.body)
      .toContain("resp-output-budget-recovery");
  });

  test("classifies staged HTTP failures when a worker expires before terminal persistence", async () => {
    const cases = [
      {
        label: "nonretryable 401",
        status: 401,
        body: JSON.stringify({ error: { message: "RAW_401_SENTINEL" } }),
        sentinel: "RAW_401_SENTINEL",
        retryable: false,
        errorCode: "provider_http_401",
      },
      {
        label: "retryable 500",
        status: 500,
        body: JSON.stringify({ error: { message: "RAW_500_SENTINEL" } }),
        sentinel: "RAW_500_SENTINEL",
        retryable: true,
        errorCode: "provider_http_500",
      },
      {
        label: "malformed 200",
        status: 200,
        body: "RAW_MALFORMED_HTTP_SENTINEL{",
        sentinel: "RAW_MALFORMED_HTTP_SENTINEL",
        retryable: true,
        errorCode: "malformed_provider_response",
      },
    ];

    for (const [index, fixtureCase] of cases.entries()) {
      const db = await setupTestDB();
      const fixture = await insertPlayedOwnerLearningAgent(db);
      const reviewId = await startFixtureOwnerLearningReview(db, fixture);
      const claim = (await claimOwnerLearningReview(db, {
        now: new Date("2026-08-04T03:01:00.000Z"),
        leaseDurationMs: 1_000,
      }))!;
      const reservation = await reserveOwnerLearningCall(db, {
        reviewId,
        leaseToken: claim.leaseToken,
        inputPolicyHash: `sha256:crash-window-${index}`,
        requestEvidence: { input: `CRASH_WINDOW_REQUEST_${index}` },
        stage: "scanning_narratives",
        now: new Date("2026-08-04T03:01:00.100Z"),
      });
      const observer = createOwnerLearningTransportObserver(db, {
        reviewId,
        callId: reservation.callId,
        leaseToken: claim.leaseToken,
      });
      await observer.onDispatchIntent({
        transportOrdinal: 1,
        attemptedTier: "flex",
        dispatchedAtMs: Date.parse("2026-08-04T03:01:00.200Z"),
      });
      await persistOwnerLearningProviderResponse(db, {
        reviewId,
        callId: reservation.callId,
        leaseToken: claim.leaseToken,
        observation: {
          responseObservedAt: "2026-08-04T03:01:00.900Z",
          responseSha256: `sha256:${String(index + 5).repeat(64)}`,
          responseEvidence: {
            status: fixtureCase.status,
            headers: { "content-type": "application/json" },
            body: fixtureCase.body,
          },
          providerResponseId: null,
        },
        now: new Date("2026-08-04T03:01:00.900Z"),
      });

      expect(await claimOwnerLearningReview(db, {
        now: new Date("2026-08-04T03:02:00.000Z"),
      }), fixtureCase.label).toBeNull();
      expect((await db.select().from(schema.agentLearningReviews))[0], fixtureCase.label)
        .toMatchObject({
          analysisStatus: "failed",
          safeFailureCode: "provider_error",
          retryable: fixtureCase.retryable,
        });
      expect((await db.select().from(schema.agentLearningReviewCalls))[0], fixtureCase.label)
        .toMatchObject({ state: "failed", safeFailureCode: "provider_error" });
      expect((await db.select().from(schema.agentLearningReviewFailureDiagnostics))[0], fixtureCase.label)
        .toMatchObject({ errorCode: fixtureCase.errorCode });
      expect((await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0]?.body)
        .toContain(fixtureCase.sentinel);
    }
  });

  test("resumes a staged Flex 429 after its terminal receipt was persisted", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    }))!;
    const reservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:flex-429-resume",
      requestEvidence: { input: "FLEX_429_REQUEST" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:00.100Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: reservation.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:00.200Z"),
    });
    await persistOwnerLearningProviderResponse(db, {
      reviewId,
      callId: reservation.callId,
      leaseToken: claim.leaseToken,
      observation: {
        responseObservedAt: "2026-08-04T03:01:00.300Z",
        responseSha256: `sha256:${"8".repeat(64)}`,
        responseEvidence: {
          status: 429,
          headers: { "retry-after": "10" },
          body: JSON.stringify({ error: { message: "capacity" } }),
        },
        providerResponseId: null,
      },
      now: new Date("2026-08-04T03:01:00.300Z"),
    });
    await observer.onTerminalOutcome({
      transportOrdinal: 1,
      attemptedTier: "flex",
      httpStatus: 429,
      latencyMs: 100,
      backoffMs: 10_000,
      completedAtMs: Date.parse("2026-08-04T03:01:00.400Z"),
    });

    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:02.000Z"),
    }))!;
    expect(reclaimed.reviewId).toBe(reviewId);
    const resumed = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: reclaimed.leaseToken,
      inputPolicyHash: "sha256:flex-429-resume",
      requestEvidence: { input: "FLEX_429_REQUEST" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:02.100Z"),
    });
    expect(resumed).toMatchObject({
      callId: reservation.callId,
      reused: true,
      resumeTransport: {
        flex429Count: 1,
        nextTransportOrdinal: 2,
        nextTier: "flex",
        initialBackoffMs: 8_300,
      },
    });
    expect(await db.select().from(schema.agentLearningReviewFailureDiagnostics)).toHaveLength(0);
  });

  test("does not spend the owner retry on an incoherent saved checkpoint", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const incoherentCheckpoint = {
      ...validatedCheckpoint(),
      logicalCallCount: "1",
    } as unknown as OwnerLearningCheckpoint;
    await failFixtureOwnerLearningReview(db, {
      reviewId,
      failureCode: "internal_error",
      retryable: true,
      reviewUpdates: {
        logicalCallCount: 1,
        checkpoint: incoherentCheckpoint,
        checkpointHash: fingerprintOwnerLearningValue(incoherentCheckpoint),
      },
    });

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(false);
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "failed",
      ownerRetryCount: 0,
    });
  });

  test("does not spend the owner retry on an unsupported historical protocol", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await failFixtureOwnerLearningReview(db, {
      reviewId,
      failureCode: "internal_error",
      retryable: true,
      reviewUpdates: { promptVersion: "owner-learning-prompt-v1" },
    });

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(false);
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "failed",
      ownerRetryCount: 0,
      promptVersion: "owner-learning-prompt-v1",
    });
  });

  test("enforces the complete retry eligibility matrix without consuming credit", async () => {
    const cases: Array<[OwnerLearningSafeFailureCode, boolean]> = [
      ["provider_capacity_exhausted", true],
      ["provider_timeout", true],
      ["provider_error", true],
      ["invalid_structured_output", true],
      ["tier_mismatch", false],
      ["output_budget_exhausted", true],
      ["logical_call_budget_exhausted", false],
      ["evidence_unavailable", false],
      ["worker_interrupted", true],
      ["internal_error", true],
    ];

    for (const [failureCode, expectedRetry] of cases) {
      const db = await setupTestDB();
      const fixture = await insertPlayedOwnerLearningAgent(db);
      const reviewId = await startFixtureOwnerLearningReview(db, fixture);
      let call: { id: string; ordinal: number; attemptOrdinal: number } | undefined;
      if (failureCode === "invalid_structured_output") {
        call = { id: `invalid-fixture-${reviewId}`, ordinal: 1, attemptOrdinal: 1 };
        await db.insert(schema.agentLearningReviewCalls).values({
          ...call,
          reviewId,
          state: "failed",
          stage: "scanning_narratives",
          inputPolicyHash: `sha256:${reviewId}`,
          safeFailureCode: "invalid_result_contract",
        });
      }
      await failFixtureOwnerLearningReview(db, {
        reviewId,
        failureCode,
        retryable: true,
        ...(call && { call, reviewUpdates: { logicalCallCount: 1 } }),
      });
      const creditEventsBefore = (await db.select().from(schema.agentLearningEvents))
        .filter((event) => event.kind === "credit_consumed").length;

      expect(await retryOwnerLearningReview(db, {
        ownerUserId: fixture.ownerUserId,
        reviewId,
        now: new Date("2026-08-04T03:02:00.000Z"),
      })).toBe(expectedRetry);

      const review = (await db.select().from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
      expect(review.analysisStatus).toBe(expectedRetry ? "retry_queued" : "failed");
      expect(review.ownerRetryCount).toBe(expectedRetry ? 1 : 0);
      const events = await db.select().from(schema.agentLearningEvents);
      expect(events.filter((event) => event.kind === "review_retried")).toHaveLength(
        expectedRetry ? 1 : 0,
      );
      expect(events.filter((event) => event.kind === "credit_consumed")).toHaveLength(
        creditEventsBefore,
      );
    }
  });

  test("uses a fresh provider attempt after structured output was rejected", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    const validOutput = {
      provisionalThemes: [],
      selectedMomentHandles: [],
      findings: [],
      finalResult: {
        diagnosis: "The standing guidance remains coherent.",
        analysisTrack: "evidence_rich" as const,
        strategyHealthClassification: null,
        recommendations: [],
        proposal: null,
        noChange: { rationale: "No repeated strategy defect appears." },
      },
    };
    let providerInvocations = 0;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerInvocations += 1;
        const baseMs = Date.parse("2026-08-04T03:01:01.000Z") + providerInvocations * 1_000;
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs: baseMs,
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          providerRequestId: `req-structured-retry-${providerInvocations}`,
          completedAtMs: baseMs + 100,
        });
        return successfulProviderTurn(providerInvocations === 1 ? {} : validOutput);
      },
    };
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:04.000Z"),
    })).toBe(false);
    expect((await db.select().from(schema.agentLearningReviews))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "invalid_structured_output",
      retryable: true,
    });

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const retryClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    expect(await runClaimedOwnerLearningReview(db, retryClaim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:02:04.000Z"),
    })).toBe(true);

    expect(providerInvocations).toBe(2);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(2);
    expect(calls.find((call) => call.attemptOrdinal === 1)).toMatchObject({
      state: "failed",
      safeFailureCode: "invalid_turn_contract",
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
    });
    expect(calls.find((call) => call.attemptOrdinal === 2)).toMatchObject({
      state: "succeeded",
      transportReceipts: [{ providerRequestId: "req-structured-retry-2" }],
      tokenReceipt: { inputTokens: 1_000, totalOutputTokens: 300 },
      costSource: "estimated",
    });
  });

  test("retries logical turn four as attempt two without rewriting evidence or consuming credit", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const checkpoint: OwnerLearningCheckpoint = {
      version: 1,
      logicalCallCount: 3,
      diveCount: 2,
      selectedMomentIds: [],
      nextMomentCursor: 0,
      provisionalThemes: ["initiative"],
      validatedFindings: [],
      lastCompletedStage: "investigating_moments",
      promptHash: fingerprintOwnerLearningValue(OWNER_LEARNING_PROMPT_VERSION),
      schemaHash: fingerprintOwnerLearningValue(OWNER_LEARNING_SCHEMA_VERSION),
      completion: null,
    };
    for (const ordinal of [1, 2, 3]) {
      await db.insert(schema.agentLearningReviewCalls).values({
        id: `successful-attempt-${ordinal}`,
        reviewId,
        ordinal,
        attemptOrdinal: 1,
        state: "succeeded",
        stage: ordinal === 1 ? "scanning_narratives" : "investigating_moments",
        inputPolicyHash: `sha256:successful-${ordinal}`,
        providerTurnProtocol: "owner-learning-harness-v2",
        validatedCheckpoint: { ...checkpoint, logicalCallCount: ordinal },
      });
    }
    const failedAttemptId = "failed-fourth-attempt-one";
    await db.insert(schema.agentLearningReviewCalls).values({
      id: failedAttemptId,
      reviewId,
      ordinal: 4,
      attemptOrdinal: 1,
      state: "failed",
      stage: "drafting_recommendations",
      inputPolicyHash: "sha256:failed-attempt-one",
      providerTurnProtocol: "owner-learning-harness-v2",
      safeFailureCode: "invalid_result_contract",
      tokenReceipt: { inputTokens: 800, totalOutputTokens: 200 },
      costSource: "estimated",
      estimatedCostMicrousd: 300,
      completedAt: "2026-08-04T03:00:00.000Z",
    });
    const originalDiagnosticId = await failFixtureOwnerLearningReview(db, {
      reviewId,
      failureCode: "invalid_structured_output",
      retryable: true,
      call: { id: failedAttemptId, ordinal: 4, attemptOrdinal: 1 },
      responseEvidence: { output: "ORIGINAL_MALFORMED_RESPONSE" },
      reviewUpdates: {
        stage: "drafting_recommendations",
        logicalCallCount: 4,
        diveCount: 2,
        checkpoint,
        checkpointHash: fingerprintOwnerLearningValue(checkpoint),
      },
    });
    const creditEventsBefore = (await db.select().from(schema.agentLearningEvents))
      .filter((event) => event.kind === "credit_consumed").length;

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:01:00.000Z"),
    })).toBe(true);
    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:01:00.001Z"),
    })).toBe(false);
    expect((await db.select({ id: schema.agentLearningReviews.id })
      .from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.analysisStatus, "queued")))).toHaveLength(0);
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "retry_queued",
      ownerRetryCount: 1,
    });

    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:01.000Z"),
    }))!;
    let providerInvocations = 0;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerInvocations += 1;
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          providerRequestId: "req-fourth-attempt-two",
          completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
        });
        return {
          ...successfulProviderTurn({
            provisionalThemes: ["initiative"],
            selectedMomentHandles: [],
            findings: [],
            finalResult: {
              diagnosis: "The current guidance remains suitable.",
              analysisTrack: "evidence_rich",
              strategyHealthClassification: null,
              recommendations: [],
              proposal: null,
              noChange: { rationale: "The recovered analysis found no durable strategy defect." },
            },
          }),
          providerResponseId: "resp-fourth-attempt-two",
          responseObservedAt: "2026-08-04T03:01:02.100Z",
          responseSha256: "sha256:fourth-attempt-two",
          requestEvidence: { input: "RECOVERY_REQUEST" },
          responseEvidence: { output: "RECOVERY_RESPONSE" },
        };
      },
    };
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:03.000Z"),
    })).toBe(true);

    const attempts = await db.select().from(schema.agentLearningReviewCalls)
      .orderBy(schema.agentLearningReviewCalls.ordinal, schema.agentLearningReviewCalls.attemptOrdinal);
    expect(attempts).toHaveLength(5);
    expect(attempts.at(-1)).toMatchObject({
      ordinal: 4,
      attemptOrdinal: 2,
      retryOfAttemptId: failedAttemptId,
      retryOfExecutionFingerprint: "sha256:failed-attempt-one",
      providerTurnProtocol: "owner-learning-harness-v3",
      state: "succeeded",
    });
    expect(providerInvocations).toBe(1);
    expect((await db.select().from(schema.agentLearningReviewFailureDiagnostics)
      .where(eq(schema.agentLearningReviewFailureDiagnostics.id, originalDiagnosticId))))
      .toHaveLength(1);
    const finalReview = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(finalReview).toMatchObject({
      analysisStatus: "no_change",
      logicalCallCount: 4,
      ownerRetryCount: 1,
    });
    const creditEventsAfter = (await db.select().from(schema.agentLearningEvents))
      .filter((event) => event.kind === "credit_consumed").length;
    expect(creditEventsAfter).toBe(creditEventsBefore);
  });

  test("retries a failed first logical turn as call one attempt two", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const failedAttemptId = "failed-first-attempt";
    await db.insert(schema.agentLearningReviewCalls).values({
      id: failedAttemptId,
      reviewId,
      ordinal: 1,
      attemptOrdinal: 1,
      state: "failed",
      stage: "scanning_narratives",
      inputPolicyHash: "sha256:failed-first-attempt",
      safeFailureCode: "provider_error",
    });
    await failFixtureOwnerLearningReview(db, {
      reviewId,
      failureCode: "provider_error",
      retryable: true,
      call: { id: failedAttemptId, ordinal: 1, attemptOrdinal: 1 },
      reviewUpdates: {
        stage: "scanning_narratives",
        logicalCallCount: 1,
        checkpoint: null,
        checkpointHash: null,
      },
    });

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );
    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider: {
        async invoke(request) {
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:02:02.000Z"),
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            providerRequestId: "req-first-attempt-two",
            completedAtMs: Date.parse("2026-08-04T03:02:02.100Z"),
          });
          return successfulProviderTurn({
            provisionalThemes: [],
            selectedMomentHandles: [],
            findings: [],
            finalResult: {
              diagnosis: "The recovered first turn found no durable strategy defect.",
              analysisTrack: "evidence_rich",
              strategyHealthClassification: null,
              recommendations: [],
              proposal: null,
              noChange: { rationale: "The current strategy remains coherent." },
            },
          });
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:02.000Z"),
    })).toBe(true);

    const attempts = await db.select().from(schema.agentLearningReviewCalls)
      .orderBy(schema.agentLearningReviewCalls.attemptOrdinal);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({
      ordinal: 1,
      attemptOrdinal: 2,
      retryOfAttemptId: failedAttemptId,
      stage: "scanning_narratives",
      state: "succeeded",
    });
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]?.logicalCallCount).toBe(1);
  });

  test("retries an ambiguous interrupted invocation as the same logical call", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const ambiguousAttemptId = "ambiguous-first-attempt";
    await db.insert(schema.agentLearningReviewCalls).values({
      id: ambiguousAttemptId,
      reviewId,
      ordinal: 1,
      attemptOrdinal: 1,
      state: "ambiguous",
      stage: "scanning_narratives",
      inputPolicyHash: "sha256:ambiguous-first-attempt",
      safeFailureCode: "worker_interrupted",
      transportReceipts: [{
        ordinal: 1,
        attemptedTier: "flex",
        dispatchIntentAt: "2026-08-04T03:01:01.000Z",
      }],
    });
    await failFixtureOwnerLearningReview(db, {
      reviewId,
      failureCode: "worker_interrupted",
      retryable: true,
      call: { id: ambiguousAttemptId, ordinal: 1, attemptOrdinal: 1 },
      reviewUpdates: { stage: "scanning_narratives", logicalCallCount: 1 },
    });

    expect(await retryOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBe(true);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:01.000Z"),
    }))!;
    const retry = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:repaired-first-attempt",
      requestEvidence: { test: "repaired-first-attempt" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:02:02.000Z"),
    });

    expect(retry).toMatchObject({ ordinal: 1, attemptOrdinal: 2, reused: false });
    expect((await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, retry.callId)))[0]).toMatchObject({
      retryOfAttemptId: ambiguousAttemptId,
      retryOfExecutionFingerprint: "sha256:ambiguous-first-attempt",
    });
  });

  test("serializes owner retry against closing the same failed review", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await failFixtureOwnerLearningReview(db, {
      reviewId,
      failureCode: "provider_timeout",
      retryable: true,
      reviewUpdates: { logicalCallCount: 1 },
    });

    const [retry, resolve] = await Promise.allSettled([
      retryOwnerLearningReview(db, {
        ownerUserId: fixture.ownerUserId,
        reviewId,
        now: new Date("2026-08-04T03:01:00.000Z"),
      }),
      resolveOwnedOwnerLearningReview(db, {
        ownerUserId: fixture.ownerUserId,
        reviewId,
        resolution: "failed",
        now: new Date("2026-08-04T03:01:00.001Z"),
      }),
    ]);
    const finalReview = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;

    if (retry.status === "fulfilled" && retry.value) {
      expect(resolve.status).toBe("rejected");
      expect(finalReview).toMatchObject({
        analysisStatus: "retry_queued",
        resolution: null,
        ownerRetryCount: 1,
      });
    } else {
      expect(resolve.status).toBe("fulfilled");
      expect(retry).toMatchObject({ status: "fulfilled", value: false });
      expect(finalReview).toMatchObject({
        analysisStatus: "failed",
        resolution: "failed",
        ownerRetryCount: 0,
      });
    }
  });

  test("allows only one active lease globally and rejects a stale token", async () => {
    const db = await setupTestDB();
    const firstFixture = await insertPlayedOwnerLearningAgent(db);
    const secondFixture = await insertPlayedOwnerLearningAgent(db, {
      completedAt: "2026-08-04T02:00:00.000Z",
    });
    await startFixtureOwnerLearningReview(db, firstFixture);
    await startFixtureOwnerLearningReview(db, secondFixture);
    const now = new Date("2026-08-04T03:01:00.000Z");

    const firstClaim = await claimOwnerLearningReview(db, { now });
    expect(firstClaim).not.toBeNull();
    expect(await claimOwnerLearningReview(db, { now })).toBeNull();
    expect(await heartbeatOwnerLearningReview(db, {
      reviewId: firstClaim!.reviewId,
      leaseToken: firstClaim!.leaseToken,
      now: new Date("2026-08-04T03:01:05.000Z"),
    })).toBe(true);

    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:00:59.000Z",
    }).where(eq(schema.agentLearningReviews.id, firstClaim!.reviewId));
    const reclaimed = await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    });
    expect(reclaimed).not.toBeNull();
    expect(await heartbeatOwnerLearningReview(db, {
      reviewId: firstClaim!.reviewId,
      leaseToken: firstClaim!.leaseToken,
      now: new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(false);
  });

  test("fails an obsolete queued review before projecting evidence or invoking the provider", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await db.update(schema.agentLearningReviews).set({
      evidenceVersion: "owner-learning-evidence-v1",
      providerPolicyVersion: "owner-learning-luna-flex-v2",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    let projectorInvocations = 0;
    let providerInvocations = 0;

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider: {
        async invoke() {
          providerInvocations += 1;
          throw new Error("obsolete review must not reach the provider");
        },
      },
      projector: async () => {
        projectorInvocations += 1;
        throw new Error("obsolete review must not be reprojected");
      },
      now: () => new Date("2026-08-04T03:01:01.000Z"),
    })).toBe(false);
    expect(projectorInvocations).toBe(0);
    expect(providerInvocations).toBe(0);

    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "evidence_unavailable",
      retryable: false,
    });
    expect(review.leaseTokenHash).toBeNull();
  });

  test("classifies reviewed-revision drift as terminal selection evidence", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const originalRevision = (await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.id, fixture.revisionId)))[0]!;
    const currentRevisionId = "new-current-revision";
    await db.insert(schema.agentRevisions).values({
      ...originalRevision,
      id: currentRevisionId,
      ordinal: originalRevision.ordinal + 1,
      priorRevisionId: originalRevision.id,
      fingerprint: "sha256:new-current-revision",
      createdAt: "2026-08-04T03:01:00.500Z",
    });
    await db.update(schema.agentProfiles).set({
      currentRevisionId,
    }).where(eq(schema.agentProfiles.id, fixture.agentProfileId));
    let providerInvocations = 0;

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider: {
        async invoke() {
          providerInvocations += 1;
          throw new Error("revision drift must not reach the provider");
        },
      },
      now: () => new Date("2026-08-04T03:01:01.000Z"),
    })).toBe(false);
    expect(providerInvocations).toBe(0);
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "evidence_unavailable",
      retryable: false,
      executionPhase: "selection",
      ownerRetryCount: 0,
    });
    expect((await db.select().from(schema.agentLearningReviewFailureDiagnostics))[0])
      .toMatchObject({
        phase: "selection",
        safeFailureCode: "evidence_unavailable",
      });
  });

  test("reuses an undispatched reserved ordinal after lease expiry", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const firstReservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:scan",
      requestEvidence: { test: "scan" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:02.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const secondClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const secondReservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: secondClaim.leaseToken,
      inputPolicyHash: "sha256:scan",
      requestEvidence: { test: "scan" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:02:01.000Z"),
    });

    expect(secondReservation.callId).toBe(firstReservation.callId);
    expect(secondReservation.ordinal).toBe(1);
    expect((await db.select().from(schema.agentLearningReviewCalls))).toHaveLength(1);
    expect((await db.select().from(schema.agentLearningReviews))[0]!.logicalCallCount).toBe(1);
  });

  test("does not reclaim a lease that was renewed while the candidate waited for its row lock", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    });

    let locked!: () => void;
    let release!: () => void;
    const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const renewal = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM agent_learning_reviews WHERE id = ${reviewId} FOR UPDATE`);
      await tx.update(schema.agentLearningReviews).set({
        leaseExpiresAt: "2026-08-04T03:03:00.000Z",
      }).where(eq(schema.agentLearningReviews.id, reviewId));
      locked();
      await releasePromise;
    });
    await lockedPromise;

    const competingClaim = claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await renewal;

    expect(await competingClaim).toBeNull();
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]?.leaseExpiresAt)
      .toBe("2026-08-04T03:03:00.000Z");
  });

  test("fails a reclaimed call without transmission when its persisted request policy has drifted", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const firstCall = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:retired-policy",
      requestEvidence: { test: "retired-policy" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:02.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    let providerInvocations = 0;
    const provider: OwnerLearningProvider = {
      async invoke() {
        providerInvocations += 1;
        throw new Error("provider must not receive a drifted recovery request");
      },
    };

    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(false);
    expect(providerInvocations).toBe(0);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: firstCall.callId,
      ordinal: 1,
      state: "failed",
      safeFailureCode: "worker_interrupted",
    });
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "worker_interrupted",
      logicalCallCount: 1,
    });
    expect(review.leaseTokenHash).toBeNull();
  });

  test("persists the three-Flex-429 transition and one standard success inside one ordinal", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:scan",
      requestEvidence: { test: "scan" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
    });
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await observer.onDispatchIntent({
        transportOrdinal: ordinal,
        attemptedTier: "flex",
        dispatchedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.000Z`),
      });
      await observer.onTerminalOutcome({
        transportOrdinal: ordinal,
        attemptedTier: "flex",
        httpStatus: 429,
        latencyMs: 100,
        backoffMs: 1_000 * ordinal,
        completedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.100Z`),
      });
    }
    await observer.onDispatchIntent({
      transportOrdinal: 4,
      attemptedTier: "auto",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:05.000Z"),
    });
    await observer.onTerminalOutcome({
      transportOrdinal: 4,
      attemptedTier: "auto",
      httpStatus: 200,
      latencyMs: 200,
      providerRequestId: "req-auto",
      completedAtMs: Date.parse("2026-08-04T03:01:05.200Z"),
    });
    expect(await completeOwnerLearningCall(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
      effectiveTier: "default",
      tokenReceipt: {
        inputTokens: 1000,
        cachedInputTokens: 200,
        totalOutputTokens: 500,
        reasoningTokens: 100,
      },
      costReceipt: {
        costSource: "estimated",
        estimatedCostMicrousd: 1_250,
        pricingSourceId: "engine.MODEL_PRICING",
        rateCardVersion: "2026-08-04",
        pricedAt: "2026-08-04T03:01:05.200Z",
      },
      validatedCheckpoint: validatedCheckpoint(),
      now: new Date("2026-08-04T03:01:05.200Z"),
    })).toBe(true);

    const storedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(storedCall.state).toBe("succeeded");
    expect(storedCall.flex429Count).toBe(3);
    expect(storedCall.capacityPath).toBe("standard_fallback");
    expect(storedCall.transportReceipts).toHaveLength(4);
    expect(storedCall.effectiveTier).toBe("default");
    expect(storedCall.estimatedCostMicrousd).toBe(1_250);
  });

  test("persists returned accounting when the effective tier is invalid for the transport path", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:scan",
      requestEvidence: { test: "scan" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
    });
    await observer.onTerminalOutcome({
      transportOrdinal: 1,
      attemptedTier: "flex",
      httpStatus: 200,
      latencyMs: 175,
      completedAtMs: Date.parse("2026-08-04T03:01:02.175Z"),
    });

    expect(await completeOwnerLearningCall(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
      effectiveTier: "default",
      tokenReceipt: {
        inputTokens: 900,
        cachedInputTokens: 300,
        totalOutputTokens: 400,
        reasoningTokens: 100,
      },
      costReceipt: {
        costSource: "estimated",
        estimatedCostMicrousd: 725,
        pricingSourceId: "engine.MODEL_PRICING",
        rateCardVersion: "2026-08-04",
        pricedAt: "2026-08-04T03:01:02.175Z",
      },
      validatedCheckpoint: validatedCheckpoint(),
      now: new Date("2026-08-04T03:01:02.175Z"),
    })).toBe(false);

    const storedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(storedCall).toMatchObject({
      state: "failed",
      safeFailureCode: "tier_mismatch",
      effectiveTier: "default",
      latencyMs: 175,
      estimatedCostMicrousd: 725,
    });
    expect(storedCall.tokenReceipt?.totalOutputTokens).toBe(400);
  });

  test("reclaims a persisted third Flex 429 and resumes the same ordinal on standard capacity", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const firstCall = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:scan",
      requestEvidence: { test: "scan" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: firstCall.callId,
      leaseToken: firstClaim.leaseToken,
    });
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await observer.onDispatchIntent({
        transportOrdinal: ordinal,
        attemptedTier: "flex",
        dispatchedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.000Z`),
      });
      await observer.onTerminalOutcome({
        transportOrdinal: ordinal,
        attemptedTier: "flex",
        httpStatus: 429,
        latencyMs: 100,
        backoffMs: 1_000,
        completedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.100Z`),
      });
    }
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:04.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const resumed = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: reclaimed.leaseToken,
      inputPolicyHash: "sha256:scan",
      requestEvidence: { test: "scan" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:02:01.000Z"),
    });

    expect(resumed).toMatchObject({
      callId: firstCall.callId,
      ordinal: 1,
      reused: true,
      resumeTransport: {
        flex429Count: 3,
        nextTransportOrdinal: 4,
        nextTier: "auto",
      },
    });
    expect(await db.select().from(schema.agentLearningReviewCalls)).toHaveLength(1);
  });

  test("replays an interrupted fourth harness call with its original ordinal and standard fallback", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) => {
      const base = fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      const game = base.games[0]!;
      const candidateMoments = [1, 2, 3].map((ordinal) => ({
        id: `olm_recovery_${ordinal}`,
        gameId: fixture.gameId,
        anchorKind: "canonical_event" as const,
        sourceCoordinate: `event:${ordinal}:vote.cast`,
        sourceHash: game.sourceHash,
        round: ordinal,
        phase: "VOTE",
      }));
      return {
        ...base,
        games: [{ ...game, candidateMoments }],
        reviewInput: {
          ...base.reviewInput,
          games: base.reviewInput.games.map((inputGame) => ({
            ...inputGame,
            candidateMomentIds: candidateMoments.map((moment) => moment.id),
          })),
        },
      };
    };
    let firstClockMs = Date.parse("2026-08-04T03:01:01.000Z");
    let interruptedCallId: string | null = null;
    const firstProvider: OwnerLearningProvider = {
      async invoke(request) {
        const turn = request.input.turn as {
          callBudget: { ordinal: number };
          evidence?: unknown;
        };
        const ordinal = turn.callBudget.ordinal;
        if (ordinal === 4) {
          expect(turn.evidence).toBeDefined();
          for (let transportOrdinal = 1; transportOrdinal <= 3; transportOrdinal += 1) {
            const dispatchedAtMs = Date.parse(`2026-08-04T03:01:1${transportOrdinal}.000Z`);
            await request.observer.onDispatchIntent({
              transportOrdinal,
              attemptedTier: "flex",
              dispatchedAtMs,
            });
            await request.observer.onTerminalOutcome({
              transportOrdinal,
              attemptedTier: "flex",
              httpStatus: 429,
              latencyMs: 100,
              backoffMs: 1_000,
              completedAtMs: dispatchedAtMs + 100,
            });
          }
          firstClockMs = Date.parse("2026-08-04T03:02:00.000Z");
          throw new Error("worker process stopped after the third Flex 429");
        }
        const dispatchedAtMs = Date.parse(`2026-08-04T03:01:0${ordinal}.000Z`);
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs,
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          completedAtMs: dispatchedAtMs + 100,
        });
        return successfulProviderTurn(ordinal === 1
          ? {
              provisionalThemes: ["initiative"],
              selectedMomentHandles: ["g1:m1", "g1:m2", "g1:m3"],
              findings: [],
              finalResult: null,
            }
          : {
              provisionalThemes: ["initiative"],
              selectedMomentHandles: [],
              findings: [],
              finalResult: null,
            });
      },
    };

    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider: firstProvider,
      projector,
      now: () => new Date(firstClockMs += 10),
    })).toBe(false);
    const callsAfterInterruption = await db.select().from(schema.agentLearningReviewCalls);
    expect(callsAfterInterruption).toHaveLength(4);
    const interruptedCall = callsAfterInterruption.find((call) => call.ordinal === 4)!;
    interruptedCallId = interruptedCall.id;
    expect(interruptedCall).toMatchObject({ state: "dispatched", flex429Count: 3 });

    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:03:00.000Z"),
    }))!;
    let recoveredBudget: unknown = null;
    const secondProvider: OwnerLearningProvider = {
      async invoke(request) {
        const turn = request.input.turn as {
          callBudget: unknown;
          currentStrategyStyle: string;
          evidence?: unknown;
        };
        recoveredBudget = turn.callBudget;
        expect(turn.currentStrategyStyle).toBe("Build trust before committing.");
        expect(turn.evidence).toBeDefined();
        expect(request.resumeTransport).toMatchObject({
          flex429Count: 3,
          nextTransportOrdinal: 4,
          nextTier: "auto",
        });
        await request.observer.onDispatchIntent({
          transportOrdinal: 4,
          attemptedTier: "auto",
          dispatchedAtMs: Date.parse("2026-08-04T03:03:01.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 4,
          attemptedTier: "auto",
          httpStatus: 200,
          latencyMs: 100,
          completedAtMs: Date.parse("2026-08-04T03:03:01.100Z"),
        });
        return successfulProviderTurn({
          provisionalThemes: ["initiative"],
          selectedMomentHandles: [],
          findings: [],
          finalResult: {
            diagnosis: "The reviewed guidance remains appropriate.",
            analysisTrack: "evidence_rich",
            strategyHealthClassification: null,
            recommendations: [],
            proposal: null,
            noChange: { rationale: "No repeated strategic defect appears in the selected evidence." },
          },
        }, "auto");
      },
    };
    let secondClockMs = Date.parse("2026-08-04T03:03:00.000Z");

    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider: secondProvider,
      projector,
      now: () => new Date(secondClockMs += 10),
    })).toBe(true);
    expect(recoveredBudget).toEqual({
      ordinal: 4,
      remainingAfterThisCall: 0,
      finalResultRequired: true,
    });
    const recoveredCalls = await db.select().from(schema.agentLearningReviewCalls);
    expect(recoveredCalls).toHaveLength(4);
    expect(recoveredCalls.find((call) => call.ordinal === 4)).toMatchObject({
      id: interruptedCallId,
      state: "succeeded",
      effectiveTier: "auto",
      flex429Count: 3,
    });
  });

  test("recovers the validated fourth-call result across both final durability barriers", async () => {
    for (const crashPoint of ["validated_call", "checkpoint"] as const) {
      const db = await setupTestDB();
      const fixture = await insertPlayedOwnerLearningAgent(db);
      const reviewId = await startFixtureOwnerLearningReview(db, fixture);
      const firstClaim = (await claimOwnerLearningReview(db, {
        now: new Date("2026-08-04T03:01:00.000Z"),
      }))!;
      const projector = async (
        _db: typeof db,
        selection: Parameters<typeof fakeOwnerLearningProjection>[0],
      ) => {
        const base = fakeOwnerLearningProjection(
          selection,
          new Map([[fixture.gameId, fixture.gameEvidenceId]]),
        );
        const game = base.games[0]!;
        const candidateMoments = [1, 2, 3].map((ordinal) => ({
          id: `olm_final_barrier_${ordinal}`,
          gameId: fixture.gameId,
          anchorKind: "canonical_event" as const,
          sourceCoordinate: `event:${ordinal}:vote.cast`,
          sourceHash: game.sourceHash,
          round: ordinal,
          phase: "VOTE",
        }));
        return {
          ...base,
          games: [{ ...game, candidateMoments }],
          reviewInput: {
            ...base.reviewInput,
            games: base.reviewInput.games.map((inputGame) => ({
              ...inputGame,
              candidateMomentIds: candidateMoments.map((moment) => moment.id),
            })),
          },
        };
      };
      let firstProviderInvocations = 0;
      const finalResult: OwnerLearningReviewResult = {
        diagnosis: "The reviewed guidance remains appropriate.",
        analysisTrack: "evidence_rich",
        recommendations: [],
        noChange: { rationale: "No repeated strategic defect appears in the selected evidence." },
      };
      const firstProvider: OwnerLearningProvider = {
        async invoke(request) {
          firstProviderInvocations += 1;
          const turn = request.input.turn as { callBudget: { ordinal: number } };
          const ordinal = turn.callBudget.ordinal;
          const dispatchedAtMs = Date.parse(`2026-08-04T03:01:0${ordinal}.000Z`);
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs,
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            providerRequestId: `req-final-barrier-${ordinal}`,
            completedAtMs: dispatchedAtMs + 100,
          });
          return successfulProviderTurn(ordinal === 1
            ? {
                provisionalThemes: ["initiative"],
                selectedMomentHandles: ["g1:m1", "g1:m2", "g1:m3"],
                findings: [],
                finalResult: null,
              }
            : {
                provisionalThemes: ["initiative"],
                selectedMomentHandles: [],
                findings: [],
                finalResult: ordinal === 4
                  ? {
                      ...finalResult,
                      strategyHealthClassification: null,
                      proposal: null,
                    }
                  : null,
              });
        },
      };
      let validatedCalls = 0;
      let checkpoints = 0;
      let firstClockMs = Date.parse("2026-08-04T03:01:01.000Z");

      await expect(runClaimedOwnerLearningReview(db, firstClaim, {
        provider: firstProvider,
        projector,
        now: () => new Date(firstClockMs += 10),
        faultInjector(point) {
          if (point === "validated_call") validatedCalls += 1;
          if (point === "checkpoint") checkpoints += 1;
          if (
            (crashPoint === "validated_call" && validatedCalls === 4)
            || (crashPoint === "checkpoint" && checkpoints === 4)
          ) {
            throw new Error(`simulated crash after ${crashPoint}`);
          }
        },
      })).rejects.toThrow(`simulated crash after ${crashPoint}`);
      expect(firstProviderInvocations).toBe(4);

      const callsAtCrash = await db.select().from(schema.agentLearningReviewCalls)
        .where(eq(schema.agentLearningReviewCalls.reviewId, reviewId));
      const finalCallAtCrash = callsAtCrash.find((call) => call.ordinal === 4)!;
      expect(finalCallAtCrash.state).toBe("succeeded");
      expect(finalCallAtCrash.validatedCheckpoint?.completion?.result).toEqual(finalResult);
      const reviewAtCrash = (await db.select().from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
      expect(reviewAtCrash.result).toBeNull();
      expect(reviewAtCrash.checkpoint?.logicalCallCount).toBe(
        crashPoint === "validated_call" ? 3 : 4,
      );
      expect(reviewAtCrash.checkpoint?.completion != null).toBe(crashPoint === "checkpoint");

      await db.update(schema.agentLearningReviews).set({
        leaseExpiresAt: "2026-08-04T03:01:59.000Z",
      }).where(eq(schema.agentLearningReviews.id, reviewId));
      const reclaimed = (await claimOwnerLearningReview(db, {
        now: new Date("2026-08-04T03:02:00.000Z"),
      }))!;
      let recoveryProviderInvocations = 0;
      let recoveryClockMs = Date.parse("2026-08-04T03:02:01.000Z");
      expect(await runClaimedOwnerLearningReview(db, reclaimed, {
        provider: {
          async invoke() {
            recoveryProviderInvocations += 1;
            throw new Error("recovery must not issue another paid provider call");
          },
        },
        projector,
        now: () => new Date(recoveryClockMs += 10),
      })).toBe(true);
      expect(recoveryProviderInvocations).toBe(0);

      const recovered = (await db.select().from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
      expect(recovered.analysisStatus).toBe("no_change");
      expect(recovered.result).toEqual(finalResult);
      expect(finalCallAtCrash.validatedCheckpoint?.completion?.result ?? null).toEqual(recovered.result);
      expect(await db.select().from(schema.agentLearningReviewCalls)
        .where(eq(schema.agentLearningReviewCalls.reviewId, reviewId))).toHaveLength(4);
      expect(await finalizeOwnerLearningReview(db, {
        reviewId,
        leaseToken: reclaimed.leaseToken,
        expectedCheckpointHash: recovered.checkpointHash!,
        result: recovered.result!,
        proposalFingerprint: recovered.proposalFingerprint,
        now: new Date("2026-08-04T03:03:00.000Z"),
      })).toBe(true);
      const resolvedEvents = await db.select().from(schema.agentLearningEvents)
        .where(eq(schema.agentLearningEvents.reviewId, reviewId));
      expect(resolvedEvents.filter((event) => event.kind === "review_resolved")).toHaveLength(1);
    }
  });

  test("marks an unmatched dispatch intent ambiguous instead of replaying it", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:scan",
      requestEvidence: { test: "scan" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:03.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBeNull();
    expect((await db.select().from(schema.agentLearningReviewCalls))[0]!.state).toBe("ambiguous");
    const review = (await db.select().from(schema.agentLearningReviews))[0]!;
    expect(review.analysisStatus).toBe("failed");
    expect(review.safeFailureCode).toBe("worker_interrupted");
  });

  test("appends terminal transport facts after raw capture and lease replacement", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:late-terminal-receipt",
      requestEvidence: { test: "late-terminal-receipt" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:00.100Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:00.200Z"),
    });
    const rawBody = JSON.stringify({
      id: "resp-before-lease-replacement",
      status: "completed",
      service_tier: "flex",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            provisionalThemes: [],
            selectedMomentHandles: [],
            findings: [],
            finalResult: {
              diagnosis: "The current strategy remains coherent.",
              analysisTrack: "evidence_rich",
              strategyHealthClassification: null,
              recommendations: [],
              proposal: null,
              noChange: { rationale: "No repeated strategic defect appears." },
            },
          }),
        }],
      }],
      usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 },
    });
    await persistOwnerLearningProviderResponse(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
      observation: {
        responseObservedAt: "2026-08-04T03:01:00.250Z",
        responseSha256: `sha256:${"f".repeat(64)}`,
        responseEvidence: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: rawBody,
        },
        providerResponseId: "resp-before-lease-replacement",
      },
      now: new Date("2026-08-04T03:01:00.250Z"),
    });

    const replacementClaim = await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    });
    expect(replacementClaim?.reviewId).toBe(reviewId);
    expect(replacementClaim?.leaseToken).not.toBe(claim.leaseToken);
    expect(await completeOwnerLearningCall(db, {
      reviewId,
      callId: call.callId,
      leaseToken: replacementClaim!.leaseToken,
      effectiveTier: "flex",
      tokenReceipt: {
        inputTokens: 500,
        cachedInputTokens: 0,
        totalOutputTokens: 100,
        reasoningTokens: 0,
      },
      costReceipt: { costSource: "unavailable" },
      validatedCheckpoint: validatedCheckpoint(),
      now: new Date("2026-08-04T03:02:00.100Z"),
    })).toBe(true);
    await db.update(schema.agentLearningReviews).set({
      analysisStatus: "no_change",
      stage: "complete",
      resolution: "no_change",
      resolvedAt: "2026-08-04T03:02:00.150Z",
      completedAt: "2026-08-04T03:02:00.150Z",
      result: {
        diagnosis: "The current strategy remains coherent.",
        analysisTrack: "evidence_rich",
        recommendations: [],
        noChange: { rationale: "No repeated strategic defect appears." },
      },
      leaseTokenHash: null,
      leaseExpiresAt: null,
      updatedAt: "2026-08-04T03:02:00.150Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    await observer.onTerminalOutcome({
      transportOrdinal: 1,
      attemptedTier: "flex",
      httpStatus: 200,
      latencyMs: 1_250,
      providerRequestId: "req-after-reconciliation",
      completedAtMs: Date.parse("2026-08-04T03:02:00.250Z"),
    });

    const storedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(storedCall).toMatchObject({
      state: "succeeded",
      failureDiagnosticId: null,
      finalProviderRequestId: "req-after-reconciliation",
      transportReceipts: [{
        ordinal: 1,
        attemptedTier: "flex",
        terminalHttpStatus: 200,
        terminalOutcomeAt: "2026-08-04T03:02:00.250Z",
        latencyMs: 1_250,
        providerRequestId: "req-after-reconciliation",
      }],
    });
    expect((await db.select().from(schema.agentLearningReviewFailureDiagnostics))).toHaveLength(0);
  });

  test("appends a private artifact when terminal facts arrive after failure evidence was sealed", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
      leaseDurationMs: 1_000,
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:late-terminal-supplement",
      requestEvidence: { input: "LATE_TERMINAL_SUPPLEMENT_REQUEST" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:00.100Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:00.200Z"),
    });
    await persistOwnerLearningProviderResponse(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
      observation: {
        responseObservedAt: "2026-08-04T03:01:00.250Z",
        responseSha256: `sha256:${"9".repeat(64)}`,
        responseEvidence: {
          status: 401,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: { message: "LATE_TERMINAL_401_BODY" } }),
        },
        providerResponseId: null,
      },
      now: new Date("2026-08-04T03:01:00.250Z"),
    });

    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBeNull();
    const failedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    const originalDiagnosticId = failedCall.failureDiagnosticId;
    expect(originalDiagnosticId).not.toBeNull();

    await observer.onTerminalOutcome({
      transportOrdinal: 1,
      attemptedTier: "flex",
      httpStatus: 401,
      latencyMs: 1_375,
      providerRequestId: "req-late-terminal-supplement",
      completedAtMs: Date.parse("2026-08-04T03:02:00.375Z"),
    });

    const storedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(storedCall.failureDiagnosticId).toBe(originalDiagnosticId);
    expect(storedCall.transportReceipts[0]).toMatchObject({
      terminalHttpStatus: 401,
      terminalOutcomeAt: "2026-08-04T03:02:00.375Z",
      latencyMs: 1_375,
      providerRequestId: "req-late-terminal-supplement",
    });
    const diagnostics = await db.select().from(schema.agentLearningReviewFailureDiagnostics);
    expect(diagnostics).toHaveLength(2);
    const supplemental = diagnostics.find((row) => row.errorCode === "late_terminal_outcome_observed");
    expect(supplemental).toMatchObject({
      phase: "provider_invocation",
      safeFailureCode: "provider_error",
      callId: call.callId,
      providerRequestId: "req-late-terminal-supplement",
    });
    const supplementalOutbox = (await db.select()
      .from(schema.agentLearningReviewFailureEvidenceOutbox))
      .find((row) => row.diagnosticId === supplemental?.id);
    expect(supplementalOutbox?.body).toContain("req-late-terminal-supplement");
    expect(supplementalOutbox?.body).toContain("LATE_TERMINAL_401_BODY");
    expect(supplementalOutbox?.body).toContain("1375");
    expect(supplementalOutbox?.body).toContain(originalDiagnosticId!);
  });

  test("runs a claimed review to a durable no-change result with a fake provider", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        await request.observer.onDispatchIntent({
          transportOrdinal: request.resumeTransport.nextTransportOrdinal,
          attemptedTier: request.resumeTransport.nextTier,
          dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: request.resumeTransport.nextTransportOrdinal,
          attemptedTier: request.resumeTransport.nextTier,
          httpStatus: 200,
          latencyMs: 100,
          providerRequestId: "req-fake",
          completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
        });
        return {
          output: {
            provisionalThemes: [],
            selectedMomentHandles: [],
            findings: [],
            finalResult: {
              diagnosis: "The current guidance remains appropriate.",
              analysisTrack: "evidence_rich",
              strategyHealthClassification: null,
              recommendations: [],
              proposal: null,
              noChange: { rationale: "No repeated strategic defect appears in the selected evidence." },
            },
          },
          effectiveTier: "flex",
          providerResponseId: "resp-fake",
          tokenReceipt: {
            inputTokens: 1_000,
            cachedInputTokens: 200,
            totalOutputTokens: 300,
            reasoningTokens: 50,
          },
          costReceipt: {
            costSource: "estimated",
            estimatedCostMicrousd: 500,
            pricingSourceId: "engine.OPENAI_FLEX_MODEL_PRICING",
            rateCardVersion: "2026-08-04",
            pricedAt: "2026-08-04T03:01:02.100Z",
          },
        };
      },
    };
    let clockMs = Date.parse("2026-08-04T03:01:01.000Z");
    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date(clockMs += 100),
    })).toBe(true);

    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.analysisStatus).toBe("no_change");
    expect(review.resolution).toBe("no_change");
    expect(review.stage).toBe("complete");
    expect(review.checkpoint?.lastCompletedStage).toBe("complete");
    expect(review.leaseTokenHash).toBeNull();
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.state).toBe("succeeded");
  });

  test("rebinds a changed source snapshot before the first provider call", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const changedSourceHash = fingerprintOwnerLearningValue({
      gameId: fixture.gameId,
      sourceCaptureVersion: "postgame-v2:transcript-v1:cognition-v0",
    });
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => {
      const projection = fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      return {
        ...projection,
        games: projection.games.map((game) => ({
          ...game,
          sourceCaptureVersion: "postgame-v2:transcript-v1:cognition-v0",
          sourceHash: changedSourceHash,
        })),
      };
    };
    let providerInvocations = 0;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerInvocations += 1;
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
        });
        return successfulProviderTurn({
          provisionalThemes: [],
          selectedMomentHandles: [],
          findings: [],
          finalResult: {
            diagnosis: "The current guidance remains appropriate.",
            analysisTrack: "evidence_rich",
            strategyHealthClassification: null,
            recommendations: [],
            proposal: null,
            noChange: { rationale: "No repeated strategic defect appears in the selected evidence." },
          },
        });
      },
    };
    let clockMs = Date.parse("2026-08-04T03:01:01.000Z");

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date(clockMs += 100),
    })).toBe(true);
    expect(providerInvocations).toBe(1);

    const evidenceRows = await db.select().from(schema.agentLearningGameEvidence)
      .where(eq(schema.agentLearningGameEvidence.gameId, fixture.gameId));
    expect(evidenceRows).toHaveLength(2);
    const changedEvidence = evidenceRows.find((row) => row.sourceHash === changedSourceHash);
    expect(changedEvidence).toBeDefined();
    const binding = (await db.select().from(schema.agentLearningReviewGames)
      .where(eq(schema.agentLearningReviewGames.reviewId, reviewId)))[0]!;
    expect(binding.gameEvidenceId).toBe(changedEvidence!.id);
    expect(binding.gameEvidenceId).not.toBe(fixture.gameEvidenceId);
  });

  test("fails closed when the source changes after validated model work", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:first-source",
      requestEvidence: { test: "first-source" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: firstClaim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
    });
    await observer.onTerminalOutcome({
      transportOrdinal: 1,
      attemptedTier: "flex",
      httpStatus: 200,
      latencyMs: 100,
      completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
    });
    expect(await completeOwnerLearningCall(db, {
      reviewId,
      callId: call.callId,
      leaseToken: firstClaim.leaseToken,
      effectiveTier: "flex",
      tokenReceipt: {
        inputTokens: 1_000,
        cachedInputTokens: 200,
        totalOutputTokens: 300,
        reasoningTokens: 50,
      },
      costReceipt: {
        costSource: "estimated",
        estimatedCostMicrousd: 500,
        pricingSourceId: "engine.MODEL_PRICING",
        rateCardVersion: "2026-08-04",
        pricedAt: "2026-08-04T03:01:02.100Z",
      },
      validatedCheckpoint: validatedCheckpoint(),
      now: new Date("2026-08-04T03:01:02.100Z"),
    })).toBe(true);
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:03.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const changedSourceHash = fingerprintOwnerLearningValue({
      gameId: fixture.gameId,
      sourceCaptureVersion: "postgame-v2:transcript-v1:cognition-v0",
    });
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => {
      const projection = fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      return {
        ...projection,
        games: projection.games.map((game) => ({
          ...game,
          sourceCaptureVersion: "postgame-v2:transcript-v1:cognition-v0",
          sourceHash: changedSourceHash,
        })),
      };
    };
    let providerInvocations = 0;

    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider: {
        async invoke() {
          providerInvocations += 1;
          throw new Error("source drift must stop before another provider call");
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(false);
    expect(providerInvocations).toBe(0);

    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "evidence_unavailable",
      retryable: false,
      logicalCallCount: 1,
    });
    const binding = (await db.select().from(schema.agentLearningReviewGames)
      .where(eq(schema.agentLearningReviewGames.reviewId, reviewId)))[0]!;
    expect(binding.gameEvidenceId).toBe(fixture.gameEvidenceId);
  });

  test("terminalizes a reclaimed reservation when the analysis track changes", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const reserved = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:first-track",
      requestEvidence: { test: "first-track" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:02.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    let providerInvocations = 0;

    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider: {
        async invoke() {
          providerInvocations += 1;
          throw new Error("analysis-track drift must stop before provider work");
        },
      },
      projector: async (
        _db,
        selection,
      ) => fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
        "strategy_health_check",
      ),
      now: () => new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(false);
    expect(providerInvocations).toBe(0);
    const call = (await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, reserved.callId)))[0]!;
    expect(call).toMatchObject({
      state: "failed",
      safeFailureCode: "evidence_unavailable",
    });
    expect(call.completedAt).not.toBeNull();
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "evidence_unavailable",
      retryable: false,
      logicalCallCount: 1,
    });
  });

  test("terminalizes a reserved call when its source changes before recovery", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const reserved = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:first-source",
      requestEvidence: { test: "first-source" },
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:02.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const changedSourceHash = fingerprintOwnerLearningValue({
      gameId: fixture.gameId,
      sourceCaptureVersion: "postgame-v2:transcript-v1:cognition-v0",
    });
    let providerInvocations = 0;

    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider: {
        async invoke() {
          providerInvocations += 1;
          throw new Error("source drift must terminalize the reservation before dispatch");
        },
      },
      projector: async (_db, selection) => {
        const projection = fakeOwnerLearningProjection(
          selection,
          new Map([[fixture.gameId, fixture.gameEvidenceId]]),
        );
        return {
          ...projection,
          games: projection.games.map((game) => ({
            ...game,
            sourceCaptureVersion: "postgame-v2:transcript-v1:cognition-v0",
            sourceHash: changedSourceHash,
          })),
        };
      },
      now: () => new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(false);
    expect(providerInvocations).toBe(0);

    const call = (await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, reserved.callId)))[0]!;
    expect(call).toMatchObject({
      state: "failed",
      safeFailureCode: "evidence_unavailable",
    });
    expect(call.completedAt).not.toBeNull();
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "evidence_unavailable",
      retryable: false,
      logicalCallCount: 1,
    });
  });

  test("retains cost while atomically rejecting invalid structured evidence", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
        });
        return {
          output: {
            provisionalThemes: ["PRIVATE_GENERATED_OUTPUT_SENTINEL"],
            selectedMomentHandles: ["g1:m999"],
            findings: [],
            finalResult: null,
          },
          effectiveTier: "flex",
          providerResponseId: "resp-invalid",
          responseObservedAt: "2026-08-04T03:01:02.100Z",
          responseSha256: "sha256:invalid-response",
          requestEvidence: { input: "REQUEST_EVIDENCE_SENTINEL" },
          responseEvidence: { output: "PRIVATE_GENERATED_OUTPUT_SENTINEL" },
          tokenReceipt: {
            inputTokens: 1_000,
            cachedInputTokens: 200,
            totalOutputTokens: 300,
            reasoningTokens: 50,
          },
          costReceipt: {
            costSource: "estimated",
            estimatedCostMicrousd: 500,
            pricingSourceId: "engine.OPENAI_FLEX_MODEL_PRICING",
            rateCardVersion: "2026-08-04",
            pricedAt: "2026-08-04T03:01:02.100Z",
          },
        };
      },
    };
    let clockMs = Date.parse("2026-08-04T03:01:01.000Z");
    const diagnostics: unknown[] = [];

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date(clockMs += 100),
      onOutputFailure: (diagnostic) => diagnostics.push(diagnostic),
    })).toBe(false);

    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.analysisStatus).toBe("failed");
    expect(review.safeFailureCode).toBe("invalid_structured_output");
    expect(review.retryable).toBe(true);
    const call = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(call.state).toBe("failed");
    expect(call.safeFailureCode).toBe("unknown_moment_handle");
    expect(call.estimatedCostMicrousd).toBe(500);
    expect(call.tokenReceipt?.totalOutputTokens).toBe(300);
    expect(diagnostics).toEqual([{
      reviewId,
      callOrdinal: 1,
      stage: "scanning_narratives",
      code: "unknown_moment_handle",
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_GENERATED_OUTPUT_SENTINEL");
    const evidenceOutbox = (await db.select()
      .from(schema.agentLearningReviewFailureEvidenceOutbox))[0]!;
    expect(evidenceOutbox.body).toContain("PRIVATE_GENERATED_OUTPUT_SENTINEL");
  });

  test("retains empty and malformed provider responses before decoding discards them", async () => {
    const db = await setupTestDB();
    for (const failure of [
      { label: "empty", outputText: "", rawEnvelope: "RAW_EMPTY_RESPONSE_SENTINEL" },
      { label: "malformed", outputText: "not-json", rawEnvelope: "RAW_MALFORMED_RESPONSE_SENTINEL" },
      {
        label: "fenced",
        outputText: "```json\n{\"provisionalThemes\":[],\"selectedMomentHandles\":[],\"findings\":[],\"finalResult\":null}\n```",
        rawEnvelope: "RAW_FENCED_RESPONSE_SENTINEL",
      },
      {
        label: "embedded",
        outputText: "Here is the result: {\"provisionalThemes\":[],\"selectedMomentHandles\":[],\"findings\":[],\"finalResult\":null}",
        rawEnvelope: "RAW_EMBEDDED_RESPONSE_SENTINEL",
      },
      { label: "empty_object", outputText: "{}", rawEnvelope: "RAW_EMPTY_OBJECT_RESPONSE_SENTINEL" },
      {
        label: "extra_field",
        outputText: "{\"provisionalThemes\":[],\"selectedMomentHandles\":[],\"findings\":[],\"finalResult\":null,\"unexpected\":true}",
        rawEnvelope: "RAW_EXTRA_FIELD_RESPONSE_SENTINEL",
      },
    ]) {
      const fixture = await insertPlayedOwnerLearningAgent(db);
      const reviewId = await startFixtureOwnerLearningReview(db, fixture);
      const claim = (await claimOwnerLearningReview(db, {
        now: new Date("2026-08-04T03:01:00.000Z"),
      }))!;
      const projector = async (
        _db: typeof db,
        selection: Parameters<typeof fakeOwnerLearningProjection>[0],
      ) => fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      const provider: OwnerLearningProvider = {
        async invoke(request) {
          await request.observer.onDispatchIntent({
            transportOrdinal: 1,
            attemptedTier: "flex",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 1,
            attemptedTier: "flex",
            httpStatus: 200,
            latencyMs: 100,
            completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
          });
          return {
            outputText: failure.outputText,
            effectiveTier: "flex",
            providerResponseId: `resp-${failure.label}`,
            responseObservedAt: "2026-08-04T03:01:02.100Z",
            responseSha256: `sha256:${failure.label}-response`,
            requestEvidence: { input: `REQUEST_${failure.label.toUpperCase()}_SENTINEL` },
            responseEvidence: {
              rawHttpBody: failure.rawEnvelope,
              outputText: failure.outputText,
            },
            tokenReceipt: {
              inputTokens: 100,
              totalOutputTokens: failure.label === "empty" ? 0 : 2,
            },
            costReceipt: {
              costSource: "estimated",
              estimatedCostMicrousd: 25,
              pricingSourceId: "test-rate-card",
              rateCardVersion: "2026-08-04",
              pricedAt: "2026-08-04T03:01:02.100Z",
            },
          };
        },
      };
      let clockMs = Date.parse("2026-08-04T03:01:01.000Z");

      expect(await runClaimedOwnerLearningReview(db, claim, {
        provider,
        projector,
        now: () => new Date(clockMs += 100),
      })).toBe(false);

      const review = (await db.select().from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
      expect(review).toMatchObject({
        analysisStatus: "failed",
        safeFailureCode: "invalid_structured_output",
        retryable: true,
      });
      const call = (await db.select().from(schema.agentLearningReviewCalls)
        .where(eq(schema.agentLearningReviewCalls.reviewId, reviewId)))[0]!;
      expect(call).toMatchObject({
        state: "failed",
        safeFailureCode: failure.label === "empty_object" || failure.label === "extra_field"
          ? "invalid_turn_contract"
          : "invalid_result_contract",
        providerResponseId: `resp-${failure.label}`,
        estimatedCostMicrousd: 25,
      });
      expect(call.tokenReceipt?.inputTokens).toBe(100);
      const outbox = (await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox)
        .where(eq(schema.agentLearningReviewFailureEvidenceOutbox.reviewId, reviewId)))[0]!;
      expect(outbox.body).toContain(failure.rawEnvelope);
      expect(outbox.body).toContain(`resp-${failure.label}`);
      expect(outbox.body).toContain(
        failure.label === "empty_object" || failure.label === "extra_field"
          ? "invalid_turn_contract"
          : "invalid_result_contract",
      );
      if (failure.label === "empty_object" || failure.label === "extra_field") {
        expect(outbox.body).toContain('"decodedOutput":');
      }
    }
  });

  test("retains every Flex and fallback response envelope in the admin diagnostic", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (
      _db: typeof db,
      selection: Parameters<typeof fakeOwnerLearningProjection>[0],
    ) => fakeOwnerLearningProjection(
      selection,
      new Map([[fixture.gameId, fixture.gameEvidenceId]]),
    );

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider: {
        async invoke(request) {
          for (const ordinal of [1, 2, 3]) {
            await request.observer.onDispatchIntent({
              transportOrdinal: ordinal,
              attemptedTier: "flex",
              dispatchedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.000Z`),
            });
            await request.onResponseObserved?.({
              responseObservedAt: `2026-08-04T03:01:0${ordinal}.050Z`,
              responseSha256: `sha256:${String(ordinal).repeat(64)}`,
              responseEvidence: {
                status: 429,
                headers: {
                  "x-request-id": `req-flex-${ordinal}`,
                  ...(ordinal === 1 && { authorization: "Bearer SECRET_TRANSPORT_SENTINEL" }),
                },
                body: `RAW_FLEX_429_${ordinal}_SENTINEL`,
              },
              providerResponseId: null,
            });
            await request.observer.onTerminalOutcome({
              transportOrdinal: ordinal,
              attemptedTier: "flex",
              httpStatus: 429,
              latencyMs: 50,
              providerRequestId: `req-flex-${ordinal}`,
              backoffMs: 0,
              completedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.100Z`),
            });
          }
          await request.observer.onDispatchIntent({
            transportOrdinal: 4,
            attemptedTier: "auto",
            dispatchedAtMs: Date.parse("2026-08-04T03:01:04.000Z"),
          });
          await request.onResponseObserved?.({
            responseObservedAt: "2026-08-04T03:01:04.050Z",
            responseSha256: `sha256:${"4".repeat(64)}`,
            responseEvidence: {
              status: 200,
              headers: { "x-request-id": "req-fallback-4" },
              body: "RAW_FALLBACK_200_SENTINEL",
            },
            providerResponseId: "resp-fallback-4",
          });
          await request.observer.onTerminalOutcome({
            transportOrdinal: 4,
            attemptedTier: "auto",
            httpStatus: 200,
            latencyMs: 50,
            providerRequestId: "req-fallback-4",
            completedAtMs: Date.parse("2026-08-04T03:01:04.100Z"),
          });
          return {
            output: {
              provisionalThemes: [],
              selectedMomentHandles: ["unknown-moment"],
              findings: [],
              finalResult: null,
            },
            effectiveTier: "auto",
            providerResponseId: "resp-fallback-4",
            responseObservedAt: "2026-08-04T03:01:04.050Z",
            responseSha256: `sha256:${"4".repeat(64)}`,
            requestEvidence: { input: "MULTI_TRANSPORT_REQUEST_SENTINEL" },
            responseEvidence: { body: "RAW_FALLBACK_200_SENTINEL" },
            tokenReceipt: { inputTokens: 100, totalOutputTokens: 20 },
            costReceipt: {
              costSource: "estimated",
              estimatedCostMicrousd: 25,
              pricingSourceId: "test-rate-card",
              rateCardVersion: "2026-08-04",
              pricedAt: "2026-08-04T03:01:04.100Z",
            },
          };
        },
      },
      projector,
      now: () => new Date("2026-08-04T03:01:05.000Z"),
    })).toBe(false);

    const outbox = (await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0]!;
    for (const marker of [
      "RAW_FLEX_429_1_SENTINEL",
      "RAW_FLEX_429_2_SENTINEL",
      "RAW_FLEX_429_3_SENTINEL",
      "RAW_FALLBACK_200_SENTINEL",
    ]) expect(outbox.body).toContain(marker);
    expect(outbox.body).not.toContain("SECRET_TRANSPORT_SENTINEL");
    expect(outbox.body).toContain("credential_field");
  });

  test("normalizes an unknown provider tier while durably failing the review", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    const provider: OwnerLearningProvider = {
      async invoke() {
        throw new OwnerLearningProviderError(
          "provider_error",
          true,
          {
            inputTokens: 100,
            cachedInputTokens: 0,
            totalOutputTokens: 25,
            reasoningTokens: 5,
          },
          {
            costSource: "estimated",
            estimatedCostMicrousd: 150,
            pricingSourceId: "engine.MODEL_PRICING",
            rateCardVersion: "2026-08-04",
            pricedAt: "2026-08-04T03:01:02.000Z",
          },
          "unknown",
        );
      },
    };

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
    })).toBe(false);

    const call = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(call).toMatchObject({
      state: "failed",
      effectiveTier: null,
      safeFailureCode: "provider_error",
      estimatedCostMicrousd: 150,
      providerResponseId: null,
      providerResponseObservedAt: null,
      providerResponseSha256: null,
    });
    expect(call.tokenReceipt?.totalOutputTokens).toBe(25);
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.analysisStatus).toBe("failed");
  });

  test("aborts local provider work when the durable lease is lost", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let providerObservedAbort = false;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerStarted();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => {
            providerObservedAbort = true;
            reject(new DOMException("lease lost", "AbortError"));
          };
          if (request.signal?.aborted) abort();
          else request.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const run = runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:01.000Z"),
      heartbeatIntervalMs: 5,
    });
    await started;
    await db.update(schema.agentLearningReviews).set({
      leaseTokenHash: "sha256:lease-owned-by-another-worker",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    expect(await run).toBe(false);
    expect(providerObservedAbort).toBe(true);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.state).toBe("reserved");
    expect(calls[0]!.transportReceipts).toEqual([]);
  });

  test("aborts provider work after a remote supersede and releases the global lane", async () => {
    const db = await setupTestDB();
    const activeFixture = await insertPlayedOwnerLearningAgent(db);
    const queuedFixture = await insertPlayedOwnerLearningAgent(db, {
      completedAt: "2026-08-04T02:00:00.000Z",
    });
    const activeReviewId = await startFixtureOwnerLearningReview(db, activeFixture);
    const queuedReviewId = await startFixtureOwnerLearningReview(db, queuedFixture);
    await db.update(schema.agentLearningReviews).set({
      createdAt: "2026-08-04T03:00:00.000Z",
    }).where(eq(schema.agentLearningReviews.id, activeReviewId));
    await db.update(schema.agentLearningReviews).set({
      createdAt: "2026-08-04T03:00:01.000Z",
    }).where(eq(schema.agentLearningReviews.id, queuedReviewId));
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    expect(claim.reviewId).toBe(activeReviewId);
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[activeFixture.gameId, activeFixture.gameEvidenceId]]),
      );
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let providerObservedAbort = false;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerStarted();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => {
            providerObservedAbort = true;
            reject(new DOMException("remote review supersede", "AbortError"));
          };
          if (request.signal?.aborted) abort();
          else request.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const run = runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:01.000Z"),
      heartbeatIntervalMs: 60_000,
      leaseMonitorIntervalMs: 5,
    });
    await started;

    await db.transaction(async (tx) => {
      const review = await lockOwnerLearningReviewForProfileMutation(tx, {
        ownerUserId: activeFixture.ownerUserId,
        agentProfileId: activeFixture.agentProfileId,
      });
      expect(review?.id).toBe(activeReviewId);
      expect(await resolveOwnerLearningReviewForProfileMutation(tx, {
        review,
        analyticalRevisionChanged: true,
        nowIso: "2026-08-04T03:01:02.000Z",
      })).toBe("superseded");
    });

    const fenced = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, activeReviewId)))[0]!;
    expect(fenced.resolution).toBe("superseded");
    expect(fenced.leaseTokenHash).not.toBeNull();
    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:02.001Z"),
    })).toBeNull();

    expect(await run).toBe(false);
    expect(providerObservedAbort).toBe(true);
    const superseded = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, activeReviewId)))[0]!;
    expect(superseded).toMatchObject({
      resolution: "superseded",
      resolvedAt: "2026-08-04T03:01:02.000Z",
      safeFailureCode: null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
    });
    const nextClaim = await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:03.000Z"),
    });
    expect(nextClaim?.reviewId).toBe(queuedReviewId);
  });

  test("aborts local provider work immediately when the reviewed Profile supersedes it", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let providerObservedAbort = false;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerStarted();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => {
            providerObservedAbort = true;
            reject(new DOMException("review superseded", "AbortError"));
          };
          if (request.signal?.aborted) abort();
          else request.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const run = runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:01.000Z"),
      heartbeatIntervalMs: 60_000,
    });
    await started;

    await updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
      personality: "This owner-authored change supersedes the in-flight review.",
    });

    expect(await run).toBe(false);
    expect(providerObservedAbort).toBe(true);
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.resolution).toBe("superseded");
    expect(review.leaseTokenHash).toBeNull();
  });
});

function successfulProviderTurn(output: unknown, effectiveTier = "flex") {
  return {
    output,
    effectiveTier,
    providerResponseId: "resp-fake",
    tokenReceipt: {
      inputTokens: 1_000,
      cachedInputTokens: 200,
      totalOutputTokens: 300,
      reasoningTokens: 50,
    },
    costReceipt: {
      costSource: "estimated" as const,
      estimatedCostMicrousd: 500,
      pricingSourceId: "engine.OPENAI_FLEX_MODEL_PRICING",
      rateCardVersion: "2026-08-04",
      pricedAt: "2026-08-04T03:01:02.100Z",
    },
  };
}

function validatedCheckpoint(): OwnerLearningCheckpoint {
  return {
    version: 1,
    logicalCallCount: 1,
    diveCount: 0,
    selectedMomentIds: [],
    nextMomentCursor: 0,
    provisionalThemes: [],
    validatedFindings: [],
    lastCompletedStage: "scanning_narratives",
    promptHash: fingerprintOwnerLearningValue(OWNER_LEARNING_PROMPT_VERSION),
    schemaHash: fingerprintOwnerLearningValue(OWNER_LEARNING_SCHEMA_VERSION),
    completion: null,
  };
}
