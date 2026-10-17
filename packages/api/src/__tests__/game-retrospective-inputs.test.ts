import { loadPayloads, storeFields } from "../services/payload-storage.js";
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createRetrospectiveDefinition, assertRetrospectiveInputBinding, freezeInfluenceRetrospective,
  GameState, Phase, type RetrospectiveInputV1 } from "@influence/engine";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame } from "./durable-run-test-utils.js";
import { insertRetrospectiveInput } from "../services/game-retrospective-inputs.js";

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
  test("size migration preserves existing input bytes while permitting larger new inputs", async () => {
    const db = await setupTestDB();
    const migration = await Bun.file(new URL("../../drizzle/0118_retrospective_input_size.sql", import.meta.url)).text();
    await db.transaction(async tx => {
      // pg_temp shadows the public table only on this transaction's connection.
      await tx.execute(sql`CREATE TEMP TABLE game_retrospective_inputs (
        input jsonb NOT NULL,
        CONSTRAINT game_retrospective_inputs_size_check CHECK (octet_length(input::text) <= 262144)
      ) ON COMMIT DROP`);
      const existing = input("existing-frozen-input");
      await tx.execute(sql`INSERT INTO pg_temp.game_retrospective_inputs VALUES (${JSON.stringify(existing)}::jsonb)`);
      const before = await tx.execute(sql`SELECT input::text AS body FROM pg_temp.game_retrospective_inputs`);
      await tx.execute(sql.raw(migration));
      expect(await tx.execute(sql`SELECT input::text AS body FROM pg_temp.game_retrospective_inputs`)).toEqual(before);
      const large = { ...existing, sections: [{ ...existing.sections[0]!, summary: "界".repeat(120_000) }] };
      await tx.execute(sql`INSERT INTO pg_temp.game_retrospective_inputs VALUES (${JSON.stringify(large)}::jsonb)`);
      const rows = await tx.execute(sql`SELECT input FROM pg_temp.game_retrospective_inputs`);
      expect(rows).toHaveLength(2);
      expect(rows.map(row => row.input)).toContainEqual(large);
    });
  });

  test("compiled context round-trips through private object storage with exact source references and no cognition", async () => {
    const db = await setupTestDB(), gameId = await insertGame(db, { id: "retrospective-compiled-input" });
    const seats = ["atlas", "echo"].map(id => ({ id, name: id, personality: "Original character", backstory: "Original story", influenceStrategy: `${id}-PRIVATE_STRATEGY` }));
    const game = new GameState(seats, { gameId });
    game.startRound(); game.recordPhaseEntered(Phase.INTRODUCTION);
    const anchor = game.getCanonicalEvents().at(-1)!.sequence;
    game.eliminatePlayer("echo");
    const frozen = freezeInfluenceRetrospective({ events: game.getCanonicalEvents(), seats,
      transcript: [{ round: 1, phase: Phase.INTRODUCTION, timestamp: 1, from: "Echo", speakerPlayerId: "echo", entrySequence: 1,
        scope: "public", text: "  My exact words. 😀  ", thinking: "PRIVATE_THINKING", reasoningContext: "PRIVATE_REASONING" }],
      transcriptThroughSequence: 1, dialogueAnchors: [{ entrySequence: 1, eventSequence: anchor }],
      capacities: { effectiveModelIds: ["fixture"], models: [{ modelId: "fixture", maxContextBytes: 100_000 }] } });
    await db.insert(schema.gameRetrospectiveInputs).values(await storeFields({ gameId, outcomeEventSequence: frozen.input.outcome.eventSequence,
      outcomeEventHash: frozen.input.outcome.eventHash, inputHash: frozen.definition.inputHash, input: frozen.input }, {"input":"json-gzip"}));
    const [stored] = await loadPayloads(db.select().from(schema.gameRetrospectiveInputs).where(eq(schema.gameRetrospectiveInputs.gameId, gameId)));
    expect(stored?.input).toEqual(frozen.input);
    expect(() => assertRetrospectiveInputBinding(stored?.input, frozen.definition)).not.toThrow();
    expect(stored?.input.dialogue[0]?.source).toEqual({ kind: "transcript_entry", sequence: 1 });
    expect(stored?.input.dialogue[0]?.text).toBe("  My exact words. 😀  ");
    expect(JSON.stringify(stored?.input)).not.toContain("PRIVATE_");
  });

  test("preserves existing games and stores one immutable private input without creating speech rows", async () => {
    const db = await setupTestDB(), gameId = await insertGame(db, { id: "retrospective-storage", status: "in_progress" });
    const values = row(gameId);
    await db.insert(schema.gameRetrospectiveInputs).values(await storeFields(values, {"input":"json-gzip"}));
    const [stored] = await loadPayloads(db.select().from(schema.gameRetrospectiveInputs).where(eq(schema.gameRetrospectiveInputs.gameId, gameId)));
    const definition = createRetrospectiveDefinition(values.input, ["atlas", "echo"]);
    expect(() => assertRetrospectiveInputBinding(stored?.input, definition)).not.toThrow();
    await expect(db.insert(schema.gameRetrospectiveInputs).values(await storeFields(values, {"input":"json-gzip"})).execute()).rejects.toThrow();
    await expect(db.update(schema.gameRetrospectiveInputs).set({ inputHash: `sha256:${"b".repeat(64)}` }).where(eq(schema.gameRetrospectiveInputs.gameId, gameId)).execute()).rejects.toThrow();
    const [unchanged] = await loadPayloads(db.select().from(schema.gameRetrospectiveInputs).where(eq(schema.gameRetrospectiveInputs.gameId, gameId)));
    expect(unchanged?.inputHash).toBe(values.inputHash);
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
    expect(game?.status).toBe("in_progress");
    expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.gameId, gameId))).toHaveLength(0);
    // Normal game erasure removes its private context through the existing cascade.
    await db.delete(schema.games).where(eq(schema.games.id, gameId));
    expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(0);
  });

  test("large Unicode input survives the production writer, compression and hash verification intact", async () => {
    const db = await setupTestDB(), gameId = await insertGame(db, { id: "retrospective-large-input" });
    const dossier = input(gameId);
    dossier.sections[0]!.summary = '界"\\\n'.repeat(120_000);
    const definition = createRetrospectiveDefinition(dossier, ["atlas", "echo"]);
    expect(Buffer.byteLength(JSON.stringify(dossier))).toBeGreaterThan(256 * 1024);
    await db.transaction(tx => insertRetrospectiveInput(tx, dossier, definition));
    const [stored] = await loadPayloads(db.select().from(schema.gameRetrospectiveInputs).where(eq(schema.gameRetrospectiveInputs.gameId, gameId)));
    expect(stored?.input).toEqual(dossier);
    expect(() => assertRetrospectiveInputBinding(stored?.input, definition)).not.toThrow();
    await expect(db.update(schema.gameRetrospectiveInputs).set(await storeFields({ input: input(gameId) }, {"input":"json-gzip"})).where(eq(schema.gameRetrospectiveInputs.gameId, gameId)).execute()).rejects.toThrow();
  });

  test("metadata constraints and the writer reject invalid source bindings", async () => {
    const db = await setupTestDB(), gameId = await insertGame(db, { id: "retrospective-invalid" });
    const values = row(gameId);
    for (const change of [
      { outcomeEventSequence: 0 }, { outcomeEventHash: "bad" }, { inputHash: "bad" }, { contractVersion: 2 },
    ]) await expect(db.insert(schema.gameRetrospectiveInputs).values(await storeFields({ ...values, ...change }, { input: "json-gzip" })).execute()).rejects.toThrow();
    const definition = createRetrospectiveDefinition(values.input, ["atlas", "echo"]);
    for (const outcome of [
      { ...values.input.outcome, gameId: "foreign" },
      { ...values.input.outcome, eventSequence: 11 },
    ]) await expect(db.transaction(tx => insertRetrospectiveInput(tx, { ...values.input, outcome }, definition))).rejects.toThrow();
    // A reference column rejects embedded bodies, even through raw SQL.
    await expect(Promise.resolve(db.execute(sql`INSERT INTO game_retrospective_inputs (game_id, outcome_event_sequence, outcome_event_hash, input_hash, input_object)
      VALUES (${gameId}, 10, ${values.outcomeEventHash}, ${values.inputHash}, ${JSON.stringify(values.input)}::jsonb)`))).rejects.toThrow();
    expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(0);
  });
});
