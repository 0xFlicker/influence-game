import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq, gt, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  dismissOwnerLearningPrompt,
  OwnerLearningAnalyticsError,
  recordOwnerLearningPromptImpression,
  recordOwnerLearningRecommendationsViewed,
} from "../services/owner-learning-analytics.js";
import {
  applyOwnedOwnerLearningReview,
  OwnerLearningApplyError,
} from "../services/owner-learning-apply.js";
import {
  parseOwnerLearningGameIds,
  parseOwnerLearningStartIdempotencyKey,
} from "../services/owner-learning-contracts.js";
import {
  getOwnerLearningEligibleInputs,
  OwnerLearningEligibilityError,
} from "../services/owner-learning-eligibility.js";
import {
  getOwnedOwnerLearningReview,
  listOpenOwnedOwnerLearningReviews,
  OwnerLearningReadError,
} from "../services/owner-learning-read.js";
import {
  preflightOwnerLearningReview,
  startOwnerLearningReview,
  type OwnerLearningEvidenceProjector,
  type OwnerLearningReviewPreflight,
  type OwnerLearningStartResult,
} from "../services/owner-learning-review.js";
import {
  OwnerLearningResolutionError,
  resolveOwnedOwnerLearningReview,
} from "../services/owner-learning-resolution.js";
import { retryOwnerLearningReview } from "../services/owner-learning-worker.js";
import { parseMcpOAuthScopeSet } from "../services/mcp-scope-policy.js";

const REQUIRED_MCP_SCOPES = ["agents:read", "games:read"] as const;
const REQUIRED_MCP_SCOPES_VERSION = "owner-learning-mcp-scopes-v1";

export function createOwnerLearningRoutes(
  db: DrizzleDB,
  dependencies: {
    generationEnabled?: boolean;
    projector?: OwnerLearningEvidenceProjector;
    now?: () => Date;
  } = {},
) {
  const app = new Hono<AuthEnv>();
  const generationEnabled = dependencies.generationEnabled
    ?? (Boolean(process.env.OPENAI_API_KEY?.trim())
      && process.env.INFLUENCE_OWNER_LEARNING_WORKER_DISABLED?.toLowerCase() !== "true");
  const now = dependencies.now ?? (() => new Date());

  app.get("/api/agent-learning/eligible-inputs", requireAuth(db), async (c) => {
    const ownerUserId = c.get("user").id;
    const eligible = await getOwnerLearningEligibleInputs(db, { ownerUserId, now: now() });
    return c.json({
      ...eligible,
      mcp: {
        connectionState: await ownerMcpConnectionState(db, ownerUserId, now()),
        requiredScopesVersion: REQUIRED_MCP_SCOPES_VERSION,
      },
    });
  });

  app.post("/api/agent-learning/prompts/impression", requireAuth(db), async (c) => {
    const body = await strictJsonBody(c, ["threshold"]);
    if (!body.ok) return c.json(body.error, 400);
    if (body.value.threshold !== 1 && body.value.threshold !== 3) {
      return errorResponse(c, 400, "invalid_input", "threshold must be 1 or 3");
    }
    try {
      return c.json(await recordOwnerLearningPromptImpression(db, {
        ownerUserId: c.get("user").id,
        threshold: body.value.threshold,
        now: now(),
      }));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.post("/api/agent-learning/prompts/dismiss", requireAuth(db), async (c) => {
    try {
      return c.json(await dismissOwnerLearningPrompt(db, {
        ownerUserId: c.get("user").id,
        now: now(),
      }));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.post("/api/agent-learning/reviews/preflight", requireAuth(db), async (c) => {
    const body = await strictJsonBody(c, ["agentProfileId", "gameIds"]);
    if (!body.ok) return c.json(body.error, 400);
    try {
      const preflight = await preflightOwnerLearningReview(db, {
        ownerUserId: c.get("user").id,
        agentProfileId: requiredIdentifier(body.value.agentProfileId, "agentProfileId"),
        gameIds: requiredGameIds(body.value.gameIds),
      }, { projector: dependencies.projector });
      return c.json(publicPreflightResult(preflight, generationEnabled));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.get("/api/agent-learning/reviews/open", requireAuth(db), async (c) => {
    return c.json(await listOpenOwnedOwnerLearningReviews(db, {
      ownerUserId: c.get("user").id,
    }));
  });

  app.post("/api/agent-learning/reviews", requireAuth(db), async (c) => {
    const body = await strictJsonBody(c, ["agentProfileId", "gameIds", "idempotencyKey"]);
    if (!body.ok) return c.json(body.error, 400);
    let idempotencyKey: string;
    try {
      idempotencyKey = parseOwnerLearningStartIdempotencyKey(body.value.idempotencyKey);
    } catch (error) {
      return errorResponse(c, 400, "invalid_idempotency_key", message(error));
    }
    try {
      const result = await startOwnerLearningReview(db, {
        ownerUserId: c.get("user").id,
        agentProfileId: requiredIdentifier(body.value.agentProfileId, "agentProfileId"),
        gameIds: requiredGameIds(body.value.gameIds),
        idempotencyKey,
      }, {
        projector: dependencies.projector,
        generationEnabled,
        now: now(),
      });
      return c.json(publicStartResult(result));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.get("/api/agent-learning/reviews/:reviewId", requireAuth(db), async (c) => {
    try {
      return c.json(await getOwnedOwnerLearningReview(db, {
        ownerUserId: c.get("user").id,
        reviewId: c.req.param("reviewId"),
        ...(c.req.query("agentProfileId")
          ? { agentProfileId: c.req.query("agentProfileId") }
          : {}),
      }));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.post("/api/agent-learning/reviews/:reviewId/retry", requireAuth(db), async (c) => {
    const ownerUserId = c.get("user").id;
    try {
      const review = await getOwnedOwnerLearningReview(db, {
        ownerUserId,
        reviewId: c.req.param("reviewId"),
      });
      if (review.analysisStatus !== "failed") {
        return errorResponse(c, 409, "invalid_review_state", "Review is not failed");
      }
      if (review.logicalCallCount >= 4) {
        return errorResponse(c, 409, "logical_call_budget_exhausted", "Review call budget is exhausted");
      }
      if (!review.retryable) {
        return errorResponse(c, 409, "review_not_retryable", "Review cannot be retried");
      }
      const retried = await retryOwnerLearningReview(db, {
        ownerUserId,
        reviewId: review.id,
        now: now(),
      });
      if (!retried) return errorResponse(c, 409, "review_state_conflict", "Review state changed");
      return c.json(await getOwnedOwnerLearningReview(db, { ownerUserId, reviewId: review.id }));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.post("/api/agent-learning/reviews/:reviewId/viewed", requireAuth(db), async (c) => {
    try {
      return c.json(await recordOwnerLearningRecommendationsViewed(db, {
        ownerUserId: c.get("user").id,
        reviewId: c.req.param("reviewId"),
        now: now(),
      }));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.post("/api/agent-learning/reviews/:reviewId/apply", requireAuth(db), async (c) => {
    const body = await strictJsonBody(c, ["proposalFingerprint"]);
    if (!body.ok) return c.json(body.error, 400);
    try {
      return c.json(await applyOwnedOwnerLearningReview(db, {
        ownerUserId: c.get("user").id,
        reviewId: c.req.param("reviewId"),
        proposalFingerprint: body.value.proposalFingerprint,
        now: now(),
      }));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  app.post("/api/agent-learning/reviews/:reviewId/resolve", requireAuth(db), async (c) => {
    const body = await strictJsonBody(c, ["resolution"]);
    if (!body.ok) return c.json(body.error, 400);
    if (body.value.resolution !== "declined" && body.value.resolution !== "failed") {
      return errorResponse(c, 400, "invalid_resolution", "resolution must be declined or failed");
    }
    try {
      await resolveOwnedOwnerLearningReview(db, {
        ownerUserId: c.get("user").id,
        reviewId: c.req.param("reviewId"),
        resolution: body.value.resolution,
        now: now(),
      });
      return c.json(await getOwnedOwnerLearningReview(db, {
        ownerUserId: c.get("user").id,
        reviewId: c.req.param("reviewId"),
      }));
    } catch (error) {
      return mapOwnerLearningError(c, error);
    }
  });

  return app;
}

function publicPreflightResult(preflight: OwnerLearningReviewPreflight, generationEnabled: boolean) {
  return {
    status: preflight.evidence.analysisTrack === "awaiting_evidence"
      ? "awaiting_evidence" as const
      : generationEnabled
        ? "ready" as const
        : "generation_unavailable" as const,
    selection: {
      agentProfileId: preflight.selection.agentProfileId,
      agentProfileName: preflight.selection.agentProfileName,
      reviewedRevisionId: preflight.selection.currentRevisionId,
      gameIds: preflight.selection.games.map((game) => game.gameId),
    },
    evidence: preflight.evidence,
  };
}

function publicStartResult(result: OwnerLearningStartResult) {
  return {
    status: result.status,
    reviewId: result.reviewId,
    nextEligibleAt: result.nextEligibleAt,
    preflight: result.preflight
      ? publicPreflightResult(result.preflight, result.status !== "generation_unavailable")
      : null,
  };
}

async function ownerMcpConnectionState(
  db: DrizzleDB,
  ownerUserId: string,
  now: Date,
): Promise<"connected" | "not_connected"> {
  const tokens = await db.select({ scope: schema.mcpOauthAccessTokens.scope })
    .from(schema.mcpOauthAccessTokens).where(and(
      eq(schema.mcpOauthAccessTokens.userId, ownerUserId),
      sql`${schema.mcpOauthAccessTokens.revokedAt} IS NULL`,
      gt(schema.mcpOauthAccessTokens.expiresAt, now.toISOString()),
    ));
  return tokens.some((token) => {
    const scopes = parseMcpOAuthScopeSet(token.scope);
    return scopes != null && REQUIRED_MCP_SCOPES.every((scope) => scopes.has(scope));
  }) ? "connected" : "not_connected";
}

async function strictJsonBody(
  c: Parameters<typeof parseJsonBody>[0],
  allowedKeys: readonly string[],
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: { error: string; code: string } }
> {
  const value = await parseJsonBody(c, "owner-learning");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: { error: "Invalid JSON body", code: "invalid_input" } };
  }
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: { error: `Unsupported field: ${unsupported[0]}`, code: "invalid_input" },
    };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function requiredIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 200) {
    throw new OwnerLearningEligibilityError("profile_unavailable", `${label} is unavailable`);
  }
  return value.trim();
}

function requiredGameIds(value: unknown): string[] {
  try {
    return parseOwnerLearningGameIds(value);
  } catch (error) {
    throw new OwnerLearningRequestError(message(error));
  }
}

class OwnerLearningRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerLearningRequestError";
  }
}

function mapOwnerLearningError(c: Context<AuthEnv>, error: unknown): Response {
  if (error instanceof OwnerLearningRequestError) {
    return errorResponse(c, 400, "invalid_input", error.message);
  }
  if (error instanceof OwnerLearningEligibilityError || error instanceof OwnerLearningReadError) {
    return errorResponse(c, 404, "unavailable", "Review unavailable");
  }
  if (error instanceof OwnerLearningAnalyticsError) {
    return errorResponse(
      c,
      error.code === "review_unavailable" ? 404 : 409,
      error.code === "review_unavailable" ? "unavailable" : error.code,
      error.code === "review_unavailable"
        ? "Review unavailable"
        : error.code === "prompt_unavailable"
          ? "Prompt unavailable"
          : "Recommendations unavailable",
    );
  }
  if (error instanceof OwnerLearningApplyError) {
    return errorResponse(c, error.statusCode, error.code, "Review could not be applied", error.retryable);
  }
  if (error instanceof OwnerLearningResolutionError) {
    return errorResponse(
      c,
      error.statusCode,
      error.code === "review_not_found" ? "unavailable" : "invalid_resolution",
      error.code === "review_not_found" ? "Review unavailable" : "Review cannot be resolved",
    );
  }
  console.error("[owner-learning] Unexpected route failure", error);
  return errorResponse(c, 500, "internal_error", "Owner learning request failed");
}

function errorResponse(
  c: Context<AuthEnv>,
  status: ContentfulStatusCode,
  code: string,
  error: string,
  retryable?: boolean,
): Response {
  return c.json({ error, code, ...(retryable !== undefined ? { retryable } : {}) }, status);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
