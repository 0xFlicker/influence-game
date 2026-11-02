import Ajv from "ajv";
import { and, eq, or } from "drizzle-orm";
import { cutTrialSpend, newCutTrialJournal } from "@influence/engine/house-cuts/trial";
import { schema, type DrizzleDB } from "../db/index.js";
import { userHasAnyRole } from "../db/rbac.js";
import { HouseInspectionError } from "./house-game-access.js";
import { isViewerGame } from "./game-visibility.js";
import { loadPayloads, storeFields } from "./payload-storage.js";

export interface CutRecoveryInput { audience: "public" | "mystery" | "omniscient"; expectedUpdatedAt: string; idempotencyKey: string }
const validate = new Ajv().compile<CutRecoveryInput>({ type: "object", additionalProperties: false,
  required: ["audience", "expectedUpdatedAt", "idempotencyKey"], properties: {
    audience: { enum: ["public", "mystery", "omniscient"] }, expectedUpdatedAt: { type: "string", minLength: 1, maxLength: 40 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 100 },
  } });
export function assertCutRecoveryInput(value: unknown): asserts value is CutRecoveryInput {
  if (!validate(value)) throw new HouseInspectionError("invalid_input", "Invalid Cuts recovery request");
}
async function authorize(db: DrizzleDB, userId: string) {
  if (!await userHasAnyRole(db, userId, ["admin", "sysop"])) throw new HouseInspectionError("not_accessible", "Cuts diagnostics and recovery require an operator");
}
export async function readCutDiagnostics(db: DrizzleDB, gameIdOrSlug: string, userId: string) {
  await authorize(db, userId);
  const [game] = await db.select().from(schema.games).where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug)));
  if (!game || !isViewerGame(game)) throw new HouseInspectionError("not_accessible", "Game unavailable");
  const jobs = await loadPayloads(db.select().from(schema.houseCutJobs).where(eq(schema.houseCutJobs.gameId, game.id)));
  const audiences = game.gameKind === "werewolf" ? ["mystery", "omniscient"] as const : ["public"] as const;
  return audiences.map(audience => {
    const job = jobs.find(job => job.audience === audience);
    if (!job) return { audience, status: "missing" as const, budgetUsd: 1, spentUsd: 0, action: game.status === "completed" ? "backfill" as const : null };
    const blockedReason = !job.source || !job.journal ? "Saved source or journal is missing. Operator inspection is required."
      : job.journal.attempts.some(a => !a.terminal) ? "A provider request has an unknown outcome. Operator inspection is required."
      : job.journal.budgetUsd > 1 || cutTrialSpend(job.journal) >= job.journal.budgetUsd ? "The audience budget is exhausted or invalid." : null;
    return { id: job.id, audience: job.audience, status: job.status, failure: job.failure,
    action: game.status === "completed" && job.status === "failed" && !job.publication && !blockedReason ? "recover" as const : null,
    blockedReason: job.status === "failed" ? blockedReason : null, cardCount: job.publication?.cuts.length,
    expectedUpdatedAt: job.updatedAt.toISOString(), budgetUsd: job.journal?.budgetUsd ?? 1,
    spentUsd: job.journal ? cutTrialSpend(job.journal) : 0,
    attempts: job.journal?.attempts.map(a => ({ windowId: a.windowId, ordinal: a.intent.attemptOrdinal,
      status: a.terminal?.disposition ?? "unknown", outcome: a.terminal?.outcome })) ?? [],
  }; });
}

/** Insert only a missing audience. The unique game/audience key makes retries idempotent. */
export async function backfillHouseCuts(db: DrizzleDB, gameIdOrSlug: string, input: unknown, userId: string) {
  await authorize(db, userId);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || !("audience" in input)
    || typeof input.audience !== "string" || !["public", "mystery", "omniscient"].includes(input.audience)) throw new HouseInspectionError("invalid_input", "A valid audience is required");
  const audience = input.audience as CutRecoveryInput["audience"];
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug))).for("update");
    if (!game || !isViewerGame(game) || game.status !== "completed") throw new HouseInspectionError("not_accessible", "Completed game unavailable");
    if (game.gameKind === "werewolf" ? audience === "public" : audience !== "public") throw new HouseInspectionError("invalid_input", "Audience does not match this game");
    await tx.insert(schema.houseCutJobs).values({ gameId: game.id, audience }).onConflictDoNothing();
    const [job] = await tx.select({ id: schema.houseCutJobs.id, status: schema.houseCutJobs.status }).from(schema.houseCutJobs)
      .where(and(eq(schema.houseCutJobs.gameId, game.id), eq(schema.houseCutJobs.audience, audience)));
    return job!;
  });
}
export async function recoverHouseCuts(db: DrizzleDB, gameIdOrSlug: string, input: CutRecoveryInput, userId: string) {
  assertCutRecoveryInput(input);
  await authorize(db, userId);
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug))).for("update");
    if (!game || !isViewerGame(game) || game.status !== "completed") throw new HouseInspectionError("not_accessible", "Completed game unavailable");
    const [job] = await loadPayloads(tx.select().from(schema.houseCutJobs).where(and(eq(schema.houseCutJobs.gameId, game.id), eq(schema.houseCutJobs.audience, input.audience))).for("update"));
    if (!job) throw new HouseInspectionError("invalid_input", "Cuts job not found");
    if (job.journal?.recovery?.key === input.idempotencyKey) return { id: job.id, status: job.status };
    if (job.status !== "failed" || job.publication || job.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new HouseInspectionError("conflict", "Cuts job changed; inspect it again");
    if (!job.source || !job.journal) throw new HouseInspectionError("conflict", "Cuts source or journal missing; inspect before recovery");
    if (job.journal.attempts.some(a => !a.terminal)) throw new HouseInspectionError("conflict", "Unknown paid dispatch; inspect before recovery");
    if (job.journal.budgetUsd > 1 || cutTrialSpend(job.journal) >= job.journal.budgetUsd) throw new HouseInspectionError("conflict", "Audience budget exhausted or invalid");
    const journal = newCutTrialJournal(job.source, job.journal.budgetUsd);
    journal.recovery = { key: input.idempotencyKey, previous: job.journal, failure: job.failure,
      requestedBy: userId, requestedAt: new Date().toISOString() };
    await tx.update(schema.houseCutJobs).set(await storeFields({ journal, status: "queued" as const, failure: null,
      leaseToken: null, leaseUntil: null, updatedAt: new Date() }, { journal: "json-gzip" })).where(eq(schema.houseCutJobs.id, job.id));
    return { id: job.id, status: "queued" as const };
  });
}
