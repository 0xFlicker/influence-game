import { loadPayloads } from "../services/payload-storage.js";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DEFAULT_CONFIG, GameRunner, Phase, replayCanonicalEvents, assertRetrospectiveInputBinding } from "@influence/engine";
import { ApiTestMockAgent } from "../services/game-lifecycle.js";
import { schema } from "../db/index.js";
import { createDurableGameRunnerStore } from "../services/durable-game-runner-store.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";

describe("Influence retrospective durable runtime", () => {
  test("rolls back input and initialization together, then resumes and seals one complete epilogue", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db, { status: "in_progress" });
    await db.update(schema.games).set({ transcriptCaptureVersion: 1, formalSpeechCaptureVersion: 1 }).where(eq(schema.games.id, gameId));
    await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
    const ownerEpoch = await insertOwner(db, gameId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    const makeAgents = () => ["Atlas", "Echo", "Nova"].map((name, i) => new ApiTestMockAgent(`seat-${i}`, name));
    const config = { ...DEFAULT_CONFIG, maxDiaryFollowUps: 0, diaryRoomAfterPhases: [], formatManifest: ["save_or_eliminate" as const], mingleSessionsPerRound: 1 };
    const store = createDurableGameRunnerStore(db, { gameId, ownerEpoch });
    const runner = new GameRunner(makeAgents(), config, undefined, { gameId, durableTurnStore: {
      ...store,
      async commitTurn(draft, input) {
        if (input) {
          const invalid = structuredClone(draft);
          invalid.nextExecution.lastPresentationPhase = Phase.LOBBY;
          return store.commitTurn(invalid, input);
        }
        return store.commitTurn(draft);
      },
    } });
    await expect(runner.run()).rejects.toThrow("phase choreography");
    expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(0);
    const before = await store.load(gameId);
    expect(before!.execution.cursor).toEqual({ version: 1, kind: "retrospective", stage: "initialize" });
    const outcome = replayCanonicalEvents(before!.canonicalEvents).retrospectiveOutcomeSource!;
    expect(outcome).not.toBeNull();
    const source = await store.readRetrospectiveSource(gameId);
    expect(source.input).toBeNull();
    expect(source.transcriptThroughSequence).toBe(before!.execution.heads.dialogueSequence);
    expect(source.dialogueAnchors).toHaveLength(source.transcriptThroughSequence);
    expect(source.dialogueAnchors.every(anchor => anchor.eventSequence <= outcome.eventSequence)).toBeTrue();

    const agents = makeAgents();
    const restartedStore = createDurableGameRunnerStore(db, { gameId, ownerEpoch });
    const result = await new GameRunner(agents, config, undefined, { gameId, durableTurnStore: restartedStore }).run();
    const snapshot = await restartedStore.load(gameId);
    const state = replayCanonicalEvents(snapshot!.canonicalEvents);
    expect(state.retrospectiveOutcomeSource).toEqual(outcome);
    expect(result.winner).toBe(state.retrospective!.definition.speakerIds.at(-1));
    expect(snapshot!.execution.status).toBe("terminal");
    expect(state.retrospective!.statements).toHaveLength(3);
    expect(state.retrospective!.completedAtEventSequence).not.toBeNull();
    const saved = await restartedStore.readRetrospectiveSource(gameId);
    expect(() => assertRetrospectiveInputBinding(saved.input, state.retrospective!.definition)).not.toThrow();
    expect(saved.transcriptThroughSequence).toBe(source.transcriptThroughSequence);
    expect(saved.dialogueAnchors).toEqual(source.dialogueAnchors);
    expect((await loadPayloads(db.select().from(schema.gameRetrospectiveInputs)))).toHaveLength(1);
    // Engine completion does not perform API settlement, seal the transcript or close its owner.
    expect((await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0]?.status).toBe("in_progress");
    expect((await db.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId, gameId)))[0]?.status).toBe("active");
    expect((await db.select().from(schema.gamePublications)).filter(row => row.kind === "completion")).toHaveLength(1);
    expect(snapshot!.transcriptEntries.filter(entry => entry.phase === Phase.RETROSPECTIVE && entry.scope === "public")).toHaveLength(3);
  }, 30_000);
});
