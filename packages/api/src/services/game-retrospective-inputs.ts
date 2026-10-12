import { eq, sql } from "drizzle-orm";
import { assertRetrospectiveInputBinding, RETROSPECTIVE_MAX_INPUT_BYTES,
  RetrospectiveExecutionError,
  type RetrospectiveDefinitionV1, type RetrospectiveInputV1 } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

type Transaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

/** Called inside the owning event commit, after its owner/head fence. */
export async function insertRetrospectiveInput(tx: Transaction, input: RetrospectiveInputV1, definition: RetrospectiveDefinitionV1): Promise<void> {
  assertRetrospectiveInputBinding(input, definition);
  const game = (await tx.select({ kind: schema.games.gameKind }).from(schema.games)
    .where(eq(schema.games.id, input.outcome.gameId)).limit(1))[0];
  if (!game || game.kind !== input.outcome.gameKind) throw new Error("Retrospective input belongs to a different game kind");
  const size = await tx.execute(sql`SELECT octet_length(${JSON.stringify(input)}::jsonb::text) AS bytes`);
  const bytes = Number(size[0]?.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > RETROSPECTIVE_MAX_INPUT_BYTES) throw new RetrospectiveExecutionError("initialize", "context_capacity_exceeded", new Error("Retrospective input exceeds PostgreSQL storage byte limit"));
  await tx.insert(schema.gameRetrospectiveInputs).values({
    gameId: input.outcome.gameId, contractVersion: 1,
    outcomeEventSequence: input.outcome.eventSequence, outcomeEventHash: input.outcome.eventHash,
    inputHash: definition.inputHash, input: structuredClone(input),
  });
}
