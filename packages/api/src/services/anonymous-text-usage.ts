import { loadPayloads, storeFields } from "./payload-storage.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { GenerationAdmissionError } from "./generation-admission-error.js";
import { sha256StableJson } from "./stable-hash.js";
import { textProviderAttempts, type TextProviderAttempt } from "./text-provider-attempts.js";

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

/** One successful preview per browser, at most one global preview admitted per rolling minute. */
export async function runAnonymousText<T>(db: DrizzleDB, input: {
  visitorHash: string; requestKey: string; model: string; payload: unknown;
}, run: (attempt: TextProviderAttempt) => Promise<T>): Promise<T> {
  if (!/^[\w:-]{1,160}$/.test(input.requestKey)) {
    throw new GenerationAdmissionError("invalid_request_id", "A valid request ID is required.", 400);
  }
  const table = schema.anonymousTextOperations;
  const inputHash = sha256StableJson(input.payload);
  const admission = await db.transaction(async tx => {
    // Database authority serializes workers and survives API restarts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inference:anonymous'))`);
    const rows = await loadPayloads(tx.select().from(table).where(eq(table.visitorHash, input.visitorHash)));
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
    await tx.insert(table).values(await storeFields({ id, visitorHash: input.visitorHash, requestKey: input.requestKey, inputHash,
      model: input.model, state: "dispatched", createdAt: sql`clock_timestamp()` }, {"result":"json-gzip"}));
    return { replay: false as const, id };
  });
  if (admission.replay) return admission.value;
  const attempts = textProviderAttempts(2, async usage => {
    await db.update(table).set(usage).where(eq(table.id, admission.id));
  });
  try {
    const result = await run(attempts.attempt);
    await db.update(table).set(await storeFields({ state: "succeeded", result, completedAt: sql`clock_timestamp()` }, {"result":"json-gzip"})).where(and(eq(table.id, admission.id), eq(table.state, "dispatched")));
    return result;
  } catch (error) {
    const state = attempts.uncertain ? "uncertain" : "failed";
    await db.update(table).set(await storeFields({ state, completedAt: state === "failed" ? sql`clock_timestamp()` : null }, {"result":"json-gzip"})).where(eq(table.id, admission.id));
    throw error;
  }
}
