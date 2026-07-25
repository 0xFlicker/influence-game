import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import type { PrivateDecisionTrace } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

/** Applies only aggregate-safe receipt facets. The trace remains the sole detailed receipt store. */
export async function recordPromptReuseForTrace(db: DrizzleDB, input: { gameId: string; ownerEpoch: string; trace: PrivateDecisionTrace; eventSequence?: number }): Promise<void> {
  const receipt = input.trace.promptReuse; if (!receipt || !input.trace.decisionId) return;
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(schema.gamePromptReuseAppliedSources).values({ id: randomUUID(), gameId: input.gameId, ownerEpoch: input.ownerEpoch, decisionId: input.trace.decisionId!, eventSequence: input.eventSequence ?? 0, comparable: receipt.comparable, reusableCharacters: receipt.reusableCharacters, reusableTokenEstimate: receipt.reusableTokenEstimate, firstBreak: receipt.firstBreak }).onConflictDoNothing().returning({ id: schema.gamePromptReuseAppliedSources.id });
    if (inserted.length === 0) return;
    const rows = await tx.select().from(schema.gamePromptReuseAppliedSources).where(and(eq(schema.gamePromptReuseAppliedSources.gameId, input.gameId), eq(schema.gamePromptReuseAppliedSources.ownerEpoch, input.ownerEpoch)));
    const breaks: Record<string, number> = {}; for (const row of rows) if (row.firstBreak) breaks[row.firstBreak] = (breaks[row.firstBreak] ?? 0) + 1;
    await tx.insert(schema.gamePromptReuseRollups).values({ id: randomUUID(), gameId: input.gameId, ownerEpoch: input.ownerEpoch, requestCount: rows.length, comparableCount: rows.filter((row) => row.comparable).length, reusableCharacters: rows.reduce((n, row) => n + row.reusableCharacters, 0), reusableTokenEstimate: rows.reduce((n, row) => n + row.reusableTokenEstimate, 0), firstBreakCounts: breaks, watermark: Math.max(0, ...rows.map((row) => row.eventSequence)), coverage: "partial", updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: [schema.gamePromptReuseRollups.gameId, schema.gamePromptReuseRollups.ownerEpoch], set: { requestCount: rows.length, comparableCount: rows.filter((row) => row.comparable).length, reusableCharacters: rows.reduce((n, row) => n + row.reusableCharacters, 0), reusableTokenEstimate: rows.reduce((n, row) => n + row.reusableTokenEstimate, 0), firstBreakCounts: breaks, watermark: Math.max(0, ...rows.map((row) => row.eventSequence)), updatedAt: new Date().toISOString() } });
  });
}

export async function getPromptReuseDetail(db: DrizzleDB, gameId: string) {
  const rows = await db.select().from(schema.gamePromptReuseRollups).where(eq(schema.gamePromptReuseRollups.gameId, gameId));
  return { version: 1, coverage: rows.length ? "partial" : "none", ownerEpochs: rows.map((row) => ({ ownerEpoch: row.ownerEpoch, requestCount: row.requestCount, comparableCount: row.comparableCount, reusableCharacters: row.reusableCharacters, reusableTokenEstimate: row.reusableTokenEstimate, firstBreakCounts: row.firstBreakCounts, watermark: row.watermark, coverage: row.coverage })) };
}
