import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import type { PrivateDecisionTrace } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

type PromptReuseTx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

interface PromptReuseRollupValues {
  requestCount: number;
  comparableCount: number;
  reusableCharacters: number;
  reusableTokenEstimate: number;
  firstBreakCounts: Record<string, number>;
  watermark: number;
}

function summarizePromptReuseSources(
  rows: ReadonlyArray<typeof schema.gamePromptReuseAppliedSources.$inferSelect>,
): PromptReuseRollupValues {
  const firstBreakCounts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.firstBreak) continue;
    firstBreakCounts[row.firstBreak] = (firstBreakCounts[row.firstBreak] ?? 0) + 1;
  }

  return {
    requestCount: rows.length,
    comparableCount: rows.filter((row) => row.comparable).length,
    reusableCharacters: rows.reduce((total, row) => total + row.reusableCharacters, 0),
    reusableTokenEstimate: rows.reduce((total, row) => total + row.reusableTokenEstimate, 0),
    firstBreakCounts,
    watermark: Math.max(0, ...rows.map((row) => row.eventSequence)),
  };
}

export async function rebuildPromptReuseRollupInTransaction(
  tx: PromptReuseTx,
  gameId: string,
  ownerEpoch: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(schema.gamePromptReuseAppliedSources)
    .where(and(
      eq(schema.gamePromptReuseAppliedSources.gameId, gameId),
      eq(schema.gamePromptReuseAppliedSources.ownerEpoch, ownerEpoch),
    ));
  if (rows.length === 0) return;

  const summary = summarizePromptReuseSources(rows);
  const updatedAt = new Date().toISOString();
  await tx.insert(schema.gamePromptReuseRollups)
    .values({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      ...summary,
      coverage: "partial",
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        schema.gamePromptReuseRollups.gameId,
        schema.gamePromptReuseRollups.ownerEpoch,
      ],
      set: {
        ...summary,
        coverage: "partial",
        updatedAt,
      },
    });
}

/** Applies only aggregate-safe receipt facets. The trace remains the sole detailed receipt store. */
export async function recordPromptReuseForTrace(
  db: DrizzleDB,
  input: {
    gameId: string;
    ownerEpoch: string;
    trace: PrivateDecisionTrace;
    eventSequence?: number;
  },
): Promise<void> {
  const receipt = input.trace.promptReuse;
  if (!receipt || !input.trace.decisionId) return;

  await db.transaction(async (tx) => {
    const inserted = await tx.insert(schema.gamePromptReuseAppliedSources)
      .values({
        id: randomUUID(),
        gameId: input.gameId,
        ownerEpoch: input.ownerEpoch,
        decisionId: input.trace.decisionId!,
        eventSequence: input.eventSequence ?? 0,
        comparable: receipt.comparable,
        reusableCharacters: receipt.reusableCharacters,
        reusableTokenEstimate: receipt.reusableTokenEstimate,
        firstBreak: receipt.firstBreak,
      })
      .onConflictDoNothing()
      .returning({ id: schema.gamePromptReuseAppliedSources.id });
    if (inserted.length === 0) return;

    await rebuildPromptReuseRollupInTransaction(tx, input.gameId, input.ownerEpoch);
  });
}

export async function getPromptReuseDetail(db: DrizzleDB, gameId: string) {
  const rows = await db
    .select()
    .from(schema.gamePromptReuseRollups)
    .where(eq(schema.gamePromptReuseRollups.gameId, gameId));
  return {
    version: 1,
    coverage: rows.length ? "partial" : "none",
    ownerEpochs: rows.map((row) => ({
      ownerEpoch: row.ownerEpoch,
      requestCount: row.requestCount,
      comparableCount: row.comparableCount,
      reusableCharacters: row.reusableCharacters,
      reusableTokenEstimate: row.reusableTokenEstimate,
      firstBreakCounts: row.firstBreakCounts,
      watermark: row.watermark,
      coverage: row.coverage,
    })),
  };
}
