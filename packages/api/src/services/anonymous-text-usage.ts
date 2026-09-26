import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { APIError } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { estimateCostForKnownModel, MODEL_PRICING } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { GenerationAdmissionError } from "./generation-admission-error.js";
import { sha256StableJson } from "./stable-hash.js";

export class AnonymousPoolBusyError extends GenerationAdmissionError {
  constructor(public readonly retryAfterSeconds: number) {
    super("anonymous_pool_busy", "The free House preview is busy. Create an account or try again later.", 429);
  }
}

/** Cookie identities are opaque browser identities, not verified people. */
export async function readAnonymousAllowance(db: DrizzleDB, visitorHash: string) {
  const rows = await db.select({ state: schema.anonymousTextOperations.state })
    .from(schema.anonymousTextOperations).where(eq(schema.anonymousTextOperations.visitorHash, visitorHash));
  return { used: rows.some(row => row.state !== "failed") };
}

/** One successful preview per browser, at most one global provider dispatch per rolling minute. */
export async function runAnonymousText<T>(db: DrizzleDB, input: {
  visitorHash: string; requestKey: string; model: string; payload: unknown;
}, run: (record: (response: ChatCompletion) => Promise<void>) => Promise<T>): Promise<T> {
  if (!/^[\w:-]{1,160}$/.test(input.requestKey)) {
    throw new GenerationAdmissionError("invalid_request_id", "A valid request ID is required.", 400);
  }
  const table = schema.anonymousTextOperations;
  const inputHash = sha256StableJson(input.payload);
  const admission = await db.transaction(async tx => {
    // Database authority serializes workers and survives API restarts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inference:anonymous'))`);
    const rows = await tx.select().from(table).where(eq(table.visitorHash, input.visitorHash));
    const prior = rows.find(row => row.requestKey === input.requestKey);
    if (prior) {
      if (prior.inputHash !== inputHash) throw new GenerationAdmissionError("request_conflict", "This request ID belongs to different input.");
      if (prior.state === "succeeded") return { replay: true as const, value: prior.result as T };
      if (prior.state === "failed") throw new GenerationAdmissionError("generation_failed", "The previous preview failed. You can try again later.");
      throw new GenerationAdmissionError("anonymous_signup_required", "Your free preview is already in progress. Create an account to continue.", 403);
    }
    if (rows.some(row => row.state !== "failed")) {
      throw new GenerationAdmissionError("anonymous_signup_required", "You've used your free House message. Create a free account to keep shaping your character and generate their image.", 403);
    }
    const recent = await tx.execute<{ retry_after: number }>(sql`
      SELECT ceil(extract(epoch FROM max(created_at) + interval '1 minute' - clock_timestamp()))::int AS retry_after
      FROM anonymous_text_operations`);
    const retryAfter = recent[0]?.retry_after ?? 0;
    if (retryAfter > 0) throw new AnonymousPoolBusyError(retryAfter);
    const id = randomUUID();
    await tx.insert(table).values({ id, visitorHash: input.visitorHash, requestKey: input.requestKey, inputHash,
      model: input.model, state: "dispatched", createdAt: sql`clock_timestamp()` });
    return { replay: false as const, id };
  });
  if (admission.replay) return admission.value;
  let responseObserved = false;
  try {
    const result = await run(async response => {
      responseObserved = true;
      const usage = response.usage;
      const cost = usage ? estimateCostForKnownModel({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0, reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: usage.total_tokens, callCount: 1, emptyResponses: 0 }, response.model) : null;
      await db.update(table).set({ promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
        model: response.model, providerRequestId: response.id, estimatedCostMicrousd: cost ? Math.round(cost.totalCost * 1_000_000) : null,
        pricingSource: cost ? `engine.MODEL_PRICING:${sha256StableJson(MODEL_PRICING[response.model])}` : null }).where(eq(table.id, admission.id));
    });
    await db.update(table).set({ state: "succeeded", result, completedAt: sql`clock_timestamp()` }).where(and(eq(table.id, admission.id), eq(table.state, "dispatched")));
    return result;
  } catch (error) {
    const state = responseObserved || (error instanceof APIError && error.status !== undefined) ? "failed" : "uncertain";
    await db.update(table).set({ state, completedAt: state === "failed" ? sql`clock_timestamp()` : null }).where(eq(table.id, admission.id));
    throw error;
  }
}
