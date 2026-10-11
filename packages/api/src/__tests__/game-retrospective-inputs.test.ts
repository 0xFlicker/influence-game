import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createRetrospectiveDefinition, assertRetrospectiveInputBinding, type RetrospectiveInputV1 } from "@influence/engine";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame } from "./durable-run-test-utils.js";

function input(gameId: string): RetrospectiveInputV1 {
  return { version: 1, outcome: { gameId, gameKind: "influence", eventSequence: 10, eventHash: `sha256:${"a".repeat(64)}` },
    sections: [{ phase: "game", fromEventSequence: 1, throughEventSequence: 10, summary: "The complete canonical game account." }], dialogue: [] };
}
function row(gameId: string) {
  const dossier = input(gameId), definition = createRetrospectiveDefinition(dossier, ["atlas", "echo"]);
  return { gameId, outcomeEventSequence: dossier.outcome.eventSequence, outcomeEventHash: dossier.outcome.eventHash,
    inputHash: definition.inputHash, input: dossier };
}

describe("immutable retrospective input storage", () => {
  test("preserves existing games and stores one immutable private input without creating speech rows", async () => {
    const db = await setupTestDB(), gameId = await insertGame(db, { id: "retrospective-storage", status: "in_progress" });
    const values = row(gameId);
    await db.insert(schema.gameRetrospectiveInputs).values(values);
    const [stored] = await db.select().from(schema.gameRetrospectiveInputs).where(eq(schema.gameRetrospectiveInputs.gameId, gameId));
    const definition = createRetrospectiveDefinition(values.input, ["atlas", "echo"]);
    expect(() => assertRetrospectiveInputBinding(stored?.input, definition)).not.toThrow();
    await expect(db.insert(schema.gameRetrospectiveInputs).values(values).execute()).rejects.toThrow();
    await expect(db.update(schema.gameRetrospectiveInputs).set({ inputHash: `sha256:${"b".repeat(64)}` }).where(eq(schema.gameRetrospectiveInputs.gameId, gameId)).execute()).rejects.toThrow();
    const [unchanged] = await db.select().from(schema.gameRetrospectiveInputs).where(eq(schema.gameRetrospectiveInputs.gameId, gameId));
    expect(unchanged?.inputHash).toBe(values.inputHash);
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
    expect(game?.status).toBe("in_progress");
    expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.gameId, gameId))).toHaveLength(0);
    // Normal game erasure removes its private context through the existing cascade.
    await db.delete(schema.games).where(eq(schema.games.id, gameId));
    expect(await db.select().from(schema.gameRetrospectiveInputs)).toHaveLength(0);
  });

  test("database rejects foreign/missing sources, unsupported versions, malformed hashes and oversized input", async () => {
    const db = await setupTestDB(), gameId = await insertGame(db, { id: "retrospective-invalid" });
    const values = row(gameId);
    for (const change of [
      { outcomeEventSequence: 0 }, { outcomeEventHash: "bad" }, { inputHash: "bad" }, { contractVersion: 2 },
      { input: { ...values.input, outcome: { ...values.input.outcome, gameId: "foreign" } } },
      { input: { ...values.input, outcome: { ...values.input.outcome, eventSequence: 11 } } },
      { input: { ...values.input, sections: [{ ...values.input.sections[0]!, summary: "x".repeat(262144) }] } },
    ]) await expect(db.insert(schema.gameRetrospectiveInputs).values({ ...values, ...change }).execute()).rejects.toThrow();
    // PostgreSQL CHECK accepts unknown; a JSON null game kind must fail explicitly.
    for (const outcome of [
      { gameId, eventSequence: 10, eventHash: values.outcomeEventHash },
      { ...values.input.outcome, gameKind: null },
      { ...values.input.outcome, gameKind: "foreign" },
    ]) {
      const malformedInput = JSON.stringify({ ...values.input, outcome });
      await expect(Promise.resolve(db.execute(sql`INSERT INTO game_retrospective_inputs (game_id, outcome_event_sequence, outcome_event_hash, input_hash, input)
        VALUES (${gameId}, 10, ${values.outcomeEventHash}, ${values.inputHash}, ${malformedInput}::jsonb)`))).rejects.toThrow();
    }
    expect(await db.select().from(schema.gameRetrospectiveInputs)).toHaveLength(0);
  });
});
