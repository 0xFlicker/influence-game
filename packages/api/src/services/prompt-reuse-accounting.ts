import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
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
  let comparableCount = 0;
  let reusableCharacters = 0;
  let reusableTokenEstimate = 0;
  let watermark = 0;
  for (const row of rows) {
    if (row.comparable) comparableCount += 1;
    reusableCharacters += row.reusableCharacters;
    reusableTokenEstimate += row.reusableTokenEstimate;
    watermark = Math.max(watermark, row.eventSequence);
    if (row.firstBreak) {
      firstBreakCounts[row.firstBreak] = (firstBreakCounts[row.firstBreak] ?? 0) + 1;
    }
  }

  return {
    requestCount: rows.length,
    comparableCount,
    reusableCharacters,
    reusableTokenEstimate,
    firstBreakCounts,
    watermark,
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

    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext('prompt_reuse_rollup'),
        hashtext(${input.ownerEpoch})
      )
    `);
    const existing = (await tx.select()
      .from(schema.gamePromptReuseRollups)
      .where(and(
        eq(schema.gamePromptReuseRollups.gameId, input.gameId),
        eq(schema.gamePromptReuseRollups.ownerEpoch, input.ownerEpoch),
      ))
      .limit(1))[0];
    // A missing rollup may predate this receipt, so one rebuild establishes the
    // durable base. Later receipts update that base in constant time.
    if (!existing) {
      await rebuildPromptReuseRollupInTransaction(tx, input.gameId, input.ownerEpoch);
      return;
    }

    const firstBreakCounts = { ...existing.firstBreakCounts };
    if (receipt.firstBreak) {
      firstBreakCounts[receipt.firstBreak] = (firstBreakCounts[receipt.firstBreak] ?? 0) + 1;
    }
    await tx.update(schema.gamePromptReuseRollups)
      .set({
        requestCount: existing.requestCount + 1,
        comparableCount: existing.comparableCount + (receipt.comparable ? 1 : 0),
        reusableCharacters: existing.reusableCharacters + receipt.reusableCharacters,
        reusableTokenEstimate: existing.reusableTokenEstimate + receipt.reusableTokenEstimate,
        firstBreakCounts,
        watermark: Math.max(existing.watermark, input.eventSequence ?? 0),
        coverage: "partial",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.gamePromptReuseRollups.id, existing.id));
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
