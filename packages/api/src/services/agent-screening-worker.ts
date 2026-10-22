import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { loadPayloads, payloadHash, readJson, storeJson } from "./payload-storage.js";
import { prepareOwnerLearningDurableValue } from "./owner-learning-failure-evidence.js";
import { sha256StableJson } from "./stable-hash.js";
import { SCREENING_POLICY_VERSION, validateScreeningRecommendation } from "./agent-screening-policy.js";
import { buildScreeningRequest, decodeScreeningResponse, ScreeningFailure, type ScreeningImage, type ScreeningProvider, type ScreeningResponse, type ScreeningStage } from "./agent-screening-provider.js";

const jobs = schema.agentScreenings, attempts = schema.agentScreeningAttempts;
type Job = typeof jobs.$inferSelect;
const liveLease = (job: Job) => and(eq(jobs.id, job.id), eq(jobs.owner, job.owner!), eq(jobs.status, "running"), sql`${jobs.leaseUntil} > now()`);

export async function claimAgentScreening(db: DrizzleDB): Promise<Job | null> {
  return db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.policyVersion, SCREENING_POLICY_VERSION), or(
      eq(jobs.status, "pending"), and(eq(jobs.status, "running"), sql`${jobs.leaseUntil} < now()`),
    ))).orderBy(asc(jobs.createdAt), asc(jobs.id)).limit(1).for("update", { skipLocked: true });
    if (!job) return null;
    const [claimed] = await tx.update(jobs).set({ status: "running", owner: randomUUID(), leaseUntil: sql`now() + interval '5 minutes'` })
      .where(eq(jobs.id, job.id)).returning();
    return claimed!;
  });
}
async function assertLease(db: DrizzleDB, job: Job, signal: AbortSignal) {
  signal.throwIfAborted();
  const [row] = await db.select({ id: jobs.id }).from(jobs).where(liveLease(job));
  if (!row) throw new ScreeningFailure("lease_lost");
}
function sanitized(value: unknown) {
  // Reuse credential-only redaction, retaining content, usage and native reasoning.
  return JSON.parse(prepareOwnerLearningDurableValue(value).body) as Record<string, unknown>;
}
function retainedResponse(envelope: Record<string, unknown>): ScreeningResponse {
  const evidence = envelope.evidence as Partial<ScreeningResponse> | undefined;
  if (!evidence || typeof evidence.status !== "number" || typeof evidence.body !== "string") throw new ScreeningFailure("transport_uncertain");
  return { status: evidence.status, body: evidence.body };
}

async function runStage(db: DrizzleDB, job: Job, stage: ScreeningStage, request: Record<string, unknown>, snapshot: Record<string, unknown>, hashes: string[], provider: ScreeningProvider, signal: AbortSignal) {
  // Accepted stages are reused after restart. Unknown dispatches never spend again automatically.
  let [attempt] = await db.select().from(attempts).where(and(eq(attempts.screeningId, job.id), eq(attempts.stage, stage)))
    .orderBy(desc(attempts.ordinal)).limit(1);
  for (;;) {
    await assertLease(db, job, signal);
    if (!attempt || attempt.outcome === "retryable") {
      const ordinal = (attempt?.ordinal ?? 0) + 1;
      if (ordinal > 3) throw new ScreeningFailure("retries_exhausted");
      if (ordinal > 1) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new ScreeningFailure("interrupted")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000 * 2 ** (ordinal - 2));
        signal.addEventListener("abort", abort, { once: true });
      });
      const requestObject = await storeJson(sanitized(request));
      await db.transaction(async tx => {
        const [owned] = await tx.select({ id: jobs.id }).from(jobs).where(liveLease(job)).for("update");
        if (!owned || signal.aborted) throw new ScreeningFailure("lease_lost");
        [attempt] = await tx.insert(attempts).values({ id: randomUUID(), screeningId: job.id, stage, ordinal, request: requestObject }).returning();
      });
      let response: ScreeningResponse;
      try {
        await assertLease(db, job, signal);
        response = await provider.invoke(stage, request, AbortSignal.any([signal, AbortSignal.timeout(90_000)]));
      } catch (error) {
        // Persist uncertainty before stopping; even a timeout may have incurred usage.
        const evidence = await storeJson(sanitized({ transportError: error instanceof Error ? error.message : "Transport failed" }));
        await db.update(attempts).set({ response: evidence, outcome: "failed" }).where(and(eq(attempts.id, attempt!.id), isNull(attempts.response)));
        throw new ScreeningFailure("transport_uncertain");
      }
      // A storage failure stops the entire job before another call. Late evidence may be
      // appended to this attempt, but only the current lease can publish the assessment.
      const responseObject = await storeJson(sanitized(response));
      await db.update(attempts).set({ response: responseObject }).where(and(eq(attempts.id, attempt!.id), isNull(attempts.response)));
      attempt = { ...attempt!, response: responseObject };
    }
    if (!attempt.response) throw new ScreeningFailure("interrupted_dispatch");
    // Decode retained refusals again on recovery so the distinct fallback stage resumes.
    let value: ReturnType<typeof decodeScreeningResponse>;
    try {
      value = decodeScreeningResponse(stage, retainedResponse(await readJson(attempt.response)), snapshot, hashes);
    } catch (error) {
      if (!(error instanceof ScreeningFailure)) throw error;
      const outcome = error.retryable ? "retryable" as const : "failed" as const;
      await db.update(attempts).set({ outcome }).where(and(eq(attempts.id, attempt.id), isNull(attempts.outcome)));
      if (!error.retryable || attempt.ordinal >= 3) throw error;
      attempt = { ...attempt, outcome };
      continue;
    }
    // Losing a worker lease is not a provider failure. Leave the saved response
    // available for its successor instead of poisoning the attempt's outcome.
    await assertLease(db, job, signal);
    await db.update(attempts).set({ outcome: "accepted" }).where(and(eq(attempts.id, attempt.id), isNull(attempts.outcome)));
    return value;
  }
}

export async function executeAgentScreening(db: DrizzleDB, job: Job, provider: ScreeningProvider, signal: AbortSignal = new AbortController().signal) {
  try {
    const [revision] = await loadPayloads(db.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, job.contentRevisionId)));
    if (!revision) throw new ScreeningFailure("evidence_unavailable");
    if (sha256StableJson(revision.snapshot) !== revision.fingerprint) throw new ScreeningFailure("snapshot_integrity");
    const rawAssets = revision.snapshot.assets;
    if (!rawAssets || typeof rawAssets !== "object" || Array.isArray(rawAssets)) throw new ScreeningFailure("invalid_assets");
    // Screen the full-body source only; the headshot is a crop, not another input.
    // Profiles without a full-body reference receive text-only screening.
    const reference = revision.snapshot.fullBodyReferenceUrl;
    if (reference != null && (typeof reference !== "string" || !reference.trim())) throw new ScreeningFailure("invalid_assets");
    const hashes: string[] = [];
    let image: ScreeningImage | null = null;
    if (typeof reference === "string") {
      const hash = (rawAssets as Record<string, unknown>)[reference];
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new ScreeningFailure("invalid_assets");
      const [asset] = await loadPayloads(db.select().from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, hash)));
      if (!asset || payloadHash(asset.bytes) !== hash) throw new ScreeningFailure("image_integrity");
      // Normalize retained pixels; never fetch mutable URLs or give providers storage credentials.
      const pixels = await sharp(asset.bytes).rotate().png().toBuffer();
      image = { hash, dataUrl: `data:image/png;base64,${pixels.toString("base64")}` };
      hashes.push(hash);
    }
    let safety: unknown = null;
    let assessed: ReturnType<typeof decodeScreeningResponse>;
    let refused = false;
    try {
      safety = await runStage(db, job, "moderation", buildScreeningRequest("moderation", revision.snapshot, image), revision.snapshot, hashes, provider, signal);
      assessed = await runStage(db, job, "luna", buildScreeningRequest("luna", revision.snapshot, image, safety), revision.snapshot, hashes, provider, signal);
    } catch (error) {
      if (!(error instanceof ScreeningFailure) || error.code !== "refusal") throw error;
      refused = true;
      // Advisory review signal survives even if the fallback fails. No human flag or hold.
      await db.update(jobs).set({ recommendation: "review" }).where(liveLease(job));
      assessed = await runStage(db, job, "luna_collusion", buildScreeningRequest("luna_collusion", revision.snapshot, null, safety), revision.snapshot, [], provider, signal);
    }
    const result = validateScreeningRecommendation(assessed, revision.snapshot, refused ? [] : hashes);
    const stored = await storeJson(result);
    await db.update(jobs).set({ status: "completed", recommendation: refused ? "review" : result.recommendation, result: stored, finishedAt: sql`now()`, owner: null, leaseUntil: null, failureCode: null }).where(liveLease(job));
  } catch (error) {
    const failureCode = error instanceof ScreeningFailure ? error.code : "evidence_or_execution_failed";
    await db.update(jobs).set({ status: "incomplete", failureCode, finishedAt: sql`now()`, owner: null, leaseUntil: null }).where(liveLease(job));
    console.warn("[agent-screening] Shadow assessment incomplete", { screeningId: job.id, failureCode });
  }
}

export function startAgentScreeningWorker(db: DrizzleDB, provider: ScreeningProvider, canClaim: () => boolean) {
  let stopped = false, running: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const tick = () => {
    if (stopped || running || !canClaim()) return;
    running = (async () => {
      const job = await claimAgentScreening(db);
      if (!job) return;
      if (stopped || !canClaim()) {
        await db.update(jobs).set({ status: "pending", owner: null, leaseUntil: null }).where(liveLease(job)); return;
      }
      const current = new AbortController(); controller = current;
      const heartbeat = setInterval(() => {
        if (!canClaim()) { current.abort(); return; }
        void db.update(jobs).set({ leaseUntil: sql`now() + interval '5 minutes'` }).where(liveLease(job)).returning({ id: jobs.id })
          .then(rows => { if (!rows.length) current.abort(); })
          .catch(() => current.abort());
      }, 15_000);
      try { await executeAgentScreening(db, job, provider, current.signal); }
      finally { clearInterval(heartbeat); controller = null; }
    })().catch(error => console.error("[agent-screening] Worker failed", error)).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 3000); timer.unref(); tick();
  return { async stop() { stopped = true; clearInterval(timer); controller?.abort(); await running; } };
}
