import { asc, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { loadPayloads, readJson } from "./payload-storage.js";
import { SCREENING_LUNA_MODEL, SCREENING_MODERATION_MODEL, SCREENING_POLICY_VERSION } from "./agent-screening-policy.js";
import { screeningResponseMetadata } from "./agent-screening-provider.js";

/** Caller must authorize the exact review/route before reading its assessment. */
export async function readAgentScreening(db: DrizzleDB, revisionId: string) {
  const rows = await loadPayloads(db.select().from(schema.agentScreenings).where(eq(schema.agentScreenings.contentRevisionId, revisionId)));
  const job = rows.find(row => row.policyVersion === SCREENING_POLICY_VERSION);
  if (!job) return null;
  const attempts = await db.select().from(schema.agentScreeningAttempts).where(eq(schema.agentScreeningAttempts.screeningId, job.id))
    .orderBy(asc(schema.agentScreeningAttempts.createdAt), asc(schema.agentScreeningAttempts.ordinal));
  const moderation = attempts.find(attempt => attempt.stage === "moderation" && attempt.outcome === "accepted");
  const operations = await Promise.all(attempts.map(async attempt => {
    const envelope = attempt.response ? await readJson(attempt.response) : null;
    const evidence = envelope?.evidence as { status?: unknown; body?: unknown } | undefined;
    const metadata = typeof evidence?.status === "number" && typeof evidence.body === "string"
      ? screeningResponseMetadata({ status: evidence.status, body: evidence.body }) : { httpStatus: null, providerCode: null, refusal: null };
    return { stage: attempt.stage, ordinal: attempt.ordinal, outcome: attempt.outcome, ...metadata };
  }));
  let safetySignals: { model: string; flagged: boolean; categories: Record<string, boolean>; scores: Record<string, number> } | null = null;
  if (moderation?.response) {
    const envelope = await readJson(moderation.response);
    const evidence = envelope.evidence as { body: string };
    const response = JSON.parse(evidence.body) as { model: string; results: { flagged: boolean; categories: Record<string, boolean>; category_scores: Record<string, number> }[] };
    const result = response.results[0]!;
    safetySignals = { model: response.model, flagged: result.flagged, categories: result.categories, scores: result.category_scores };
  }
  return {
    id: job.id, mode: "shadow" as const, status: job.status, policyVersion: job.policyVersion,
    models: [SCREENING_MODERATION_MODEL, SCREENING_LUNA_MODEL], recommendation: job.recommendation,
    result: job.result, safetySignals, failureCode: job.failureCode, createdAt: job.createdAt, finishedAt: job.finishedAt,
    assessmentScope: operations.some(operation => operation.stage === "luna_collusion") ? "collusion_only" as const : "full" as const,
    safetyRefused: operations.some(operation => operation.refusal !== null),
    attempts: operations,
  };
}
