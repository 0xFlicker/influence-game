import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { Phase, type PrivateDecisionTrace } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { insertGame, insertOwner } from "../__tests__/durable-run-test-utils.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import {
  rebuildPromptReuseRollupInTransaction,
  recordPromptReuseForTrace,
} from "./prompt-reuse-accounting.js";

function promptReuseTrace(
  decisionId: string,
  params: {
    comparable: boolean;
    reusableCharacters: number;
    reusableTokenEstimate: number;
    firstBreak?: string;
  },
): PrivateDecisionTrace {
  return {
    version: 2,
    decisionId,
    action: "vote",
    actor: { id: "atlas", name: "Atlas", role: "player" },
    phase: Phase.VOTE,
    round: 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    model: { name: "test-model" },
    prompt: { messages: [] },
    response: { raw: {} },
    promptReuse: {
      version: 1,
      lane: "vote",
      requestShape: "vote:v1",
      blocks: [],
      characterEstimate: 500,
      tokenEstimate: 125,
      comparable: params.comparable,
      reusableCharacters: params.reusableCharacters,
      reusableTokenEstimate: params.reusableTokenEstimate,
      ...(params.firstBreak && { firstBreak: params.firstBreak }),
    },
  };
}

describe("prompt reuse accounting", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("rebuild advances only the watermark while preserving aggregate receipt math", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const firstDecisionId = randomUUID();
    const secondDecisionId = randomUUID();

    await recordPromptReuseForTrace(db, {
      gameId,
      ownerEpoch,
      trace: promptReuseTrace(firstDecisionId, {
        comparable: true,
        reusableCharacters: 120,
        reusableTokenEstimate: 30,
        firstBreak: "user_message",
      }),
    });
    await recordPromptReuseForTrace(db, {
      gameId,
      ownerEpoch,
      trace: promptReuseTrace(secondDecisionId, {
        comparable: false,
        reusableCharacters: 40,
        reusableTokenEstimate: 10,
        firstBreak: "tool_schema",
      }),
    });

    const before = (await db.select().from(schema.gamePromptReuseRollups)
      .where(eq(schema.gamePromptReuseRollups.ownerEpoch, ownerEpoch)))[0]!;
    await db.update(schema.gamePromptReuseAppliedSources)
      .set({ eventSequence: 7 })
      .where(eq(schema.gamePromptReuseAppliedSources.decisionId, firstDecisionId));
    await db.transaction(async (tx) => {
      await rebuildPromptReuseRollupInTransaction(tx, gameId, ownerEpoch);
    });
    const after = (await db.select().from(schema.gamePromptReuseRollups)
      .where(eq(schema.gamePromptReuseRollups.ownerEpoch, ownerEpoch)))[0]!;

    expect(before).toMatchObject({
      requestCount: 2,
      comparableCount: 1,
      reusableCharacters: 160,
      reusableTokenEstimate: 40,
      firstBreakCounts: {
        user_message: 1,
        tool_schema: 1,
      },
      watermark: 0,
      coverage: "partial",
    });
    expect(after).toMatchObject({
      requestCount: before.requestCount,
      comparableCount: before.comparableCount,
      reusableCharacters: before.reusableCharacters,
      reusableTokenEstimate: before.reusableTokenEstimate,
      firstBreakCounts: before.firstBreakCounts,
      watermark: 7,
      coverage: "partial",
    });
  });
});
