import { loadPayloads } from "../services/payload-storage.js";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DEFAULT_CONFIG, GameRunner, ProviderUnavailableError, RetrospectiveExecutionError, RetrospectiveContextCapacityError, durableProviderLogicalCallId, fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective, replayCanonicalEvents } from "@influence/engine";
import { advanceWerewolf, replayWerewolf, runWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { ApiTestMockAgent } from "../services/game-lifecycle.js";
import { createDurableGameRunnerStore } from "../services/durable-game-runner-store.js";
import { adoptDurableGameRunOwner } from "../services/game-ownership.js";
import { adoptInProgressDurableGamesOnStartup } from "../services/startup-durable-games.js";
import { findStartupRecoverableGameIds } from "../services/game-recovery.js";
import { pauseRetrospectiveExecution, readRetrospectiveFrontier, resumeGameRetrospective } from "../services/game-retrospective-recovery.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore } from "../services/werewolf-games.js";
import { readHouseGameResults } from "../services/house-game-results.js";
import { abortAllWerewolf, activeWerewolfCount, startWerewolfRuntime } from "../services/werewolf-runtime.js";
import { grantTestAuthority } from "./rbac-fixtures.js";

async function authorizedDB() {
  const db = await setupTestDB();
  await db.insert(schema.users).values({ id: "rt08-recovery-admin" });
  await grantTestAuthority(db, "rt08-recovery-admin", ["resume_game_retrospective"], "admin");
  return db;
}

test("an existing initialization suspension resumes a large account into a complete retrospective", async () => {
  const db = await authorizedDB(), gameId = await insertGame(db, { status: "in_progress" });
  await db.update(schema.games).set({ transcriptCaptureVersion: 1, formalSpeechCaptureVersion: 1 }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  const ownerEpoch = await insertOwner(db, gameId, { expiresAt: "2099-01-01T00:00:00.000Z" });
  const largeText = "A remembered conversation. 界\n".repeat(12_000);
  let reproduceOldFailure = true;
  const agents = () => ["Atlas", "Echo", "Nova"].map((name, i) => {
    const agent = new ApiTestMockAgent(`large-${i}`, name);
    const introduction = agent.getIntroduction.bind(agent), setup = agent.prepareRetrospectiveSetup.bind(agent);
    agent.getIntroduction = async () => ({ ...await introduction(), message: largeText });
    agent.prepareRetrospectiveSetup = async (...args) => {
      // Reproduce the already-persisted production failure, not a size policy.
      if (reproduceOldFailure) throw new RetrospectiveExecutionError("initialize", "invalid_context", new Error("historical size guard"));
      return setup(...args);
    };
    return agent;
  });
  const config = { ...DEFAULT_CONFIG, maxDiaryFollowUps: 0, diaryRoomAfterPhases: [], formatManifest: ["save_or_eliminate" as const], mingleSessionsPerRound: 1 };
  const store = createDurableGameRunnerStore(db, { gameId, ownerEpoch });
  let failure: RetrospectiveExecutionError | null = null;
  try { await new GameRunner(agents(), config, undefined, { gameId, durableTurnStore: store }).run(); }
  catch (error) { if (!(error instanceof RetrospectiveExecutionError)) throw error; failure = error; }
  expect(failure).toMatchObject({ stage: "initialize", code: "invalid_context" });
  const before = (await store.load(gameId))!, outcome = replayCanonicalEvents(before.canonicalEvents).retrospectiveOutcomeSource;
  expect(await pauseRetrospectiveExecution(db, gameId, ownerEpoch, failure!)).toBeTrue();
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  const suspended = JSON.parse(game!.config).retrospectiveFailure;
  expect(await resumeGameRetrospective(db, { gameId, expectedHead: suspended.head, expectedFailureId: suspended.id,
    idempotencyKey: "resume-large-input" }, "rt08-recovery-admin")).toMatchObject({ alreadyResumed: false });
  reproduceOldFailure = false;
  const replacement = await adoptDurableGameRunOwner(db, gameId);
  if (!replacement.ok) throw Error(replacement.error);
  const resumed = createDurableGameRunnerStore(db, { gameId, ownerEpoch: replacement.claim.ownerEpoch });
  await new GameRunner(agents(), config, undefined, { gameId, durableTurnStore: resumed }).run();
  const after = (await resumed.load(gameId))!, state = replayCanonicalEvents(after.canonicalEvents);
  expect(state.retrospectiveOutcomeSource).toEqual(outcome);
  expect(state.retrospective!.statements).toHaveLength(3);
  expect(after.execution.status).toBe("terminal");
  const saved = (await resumed.readRetrospectiveSource(gameId)).input!;
  expect(Buffer.byteLength(JSON.stringify(saved))).toBeGreaterThan(256 * 1024);
  expect(saved.dialogue.some(entry => entry.text === largeText)).toBeTrue();
}, 30_000);

test.each(["malformed_output", "budget_exhausted", "circuit_open"] as const)("Influence %s suspends the exact slot until explicit fenced recovery", async code => {
  const db = await authorizedDB(), gameId = await insertGame(db, { status: "in_progress" });
  await db.update(schema.games).set({ transcriptCaptureVersion: 1, formalSpeechCaptureVersion: 1 }).where(eq(schema.games.id, gameId));
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  const ownerEpoch = await insertOwner(db, gameId, { expiresAt: "2099-01-01T00:00:00.000Z" });
  let calls = 0, shouldFail = true;
  const agents = () => ["Atlas", "Echo", "Nova"].map((name, i) => {
    const agent = new ApiTestMockAgent(`rt08-${i}`, name), emit = agent.getRetrospectiveStatement.bind(agent);
    agent.getRetrospectiveStatement = async (...args) => {
      calls++;
      if (args[1].request.ordinal === 1 && shouldFail) throw new ProviderUnavailableError("Required statement unavailable", code);
      return emit(...args);
    };
    return agent;
  });
  const config = { ...DEFAULT_CONFIG, maxDiaryFollowUps: 0, diaryRoomAfterPhases: [], formatManifest: ["save_or_eliminate" as const], mingleSessionsPerRound: 1 };
  const store = createDurableGameRunnerStore(db, { gameId, ownerEpoch });
  let failure: RetrospectiveExecutionError | null = null;
  try { await new GameRunner(agents(), config, undefined, { gameId, durableTurnStore: store }).run(); }
  catch (error) { if (!(error instanceof RetrospectiveExecutionError)) throw error; failure = error; }
  expect(failure).toMatchObject({ code, stage: "statement" });
  const before = (await store.load(gameId))!, prefix = replayCanonicalEvents(before.canonicalEvents).retrospective!;
  expect(prefix.statements).toHaveLength(1); expect(calls).toBe(2);
  expect(await pauseRetrospectiveExecution(db, gameId, ownerEpoch, failure!)).toBeTrue();
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)), suspended = JSON.parse(game!.config).retrospectiveFailure;
  expect(suspended).toMatchObject({ code, actorId: prefix.definition.speakerIds[1], ordinal: 1, head: { sequence: before.execution.heads.eventSequence } });
  expect(suspended.providerLogicalCallId).toBe(durableProviderLogicalCallId({ gameId, turnId: `${gameId}:turn:${before.execution.heads.turnSequence + 1}`, subcallSlot: 1 }));
  expect((await db.select().from(schema.gameExecutionStates))[0]!.status).toBe("repair_required");
  expect(await findStartupRecoverableGameIds(db)).toEqual([]);
  expect((await adoptInProgressDurableGamesOnStartup(db, { isAlreadyRunning: () => false, start() { throw new Error("Must not automatically dispatch exhausted speech"); } })).adopted).toEqual([]);
  expect(calls).toBe(2);
  expect(await readHouseGameResults(db, gameId)).toMatchObject({ ok: true, game: { status: "suspended" }, retrospective: { statementCount: 1 } });
  const input = { gameId, expectedHead: suspended.head, expectedFailureId: suspended.id, idempotencyKey: "resume-rt08" };
  await expect(resumeGameRetrospective(db, { ...input, expectedFailureId: "different" }, "rt08-recovery-admin")).rejects.toMatchObject({ code: "conflict" });
  await expect(resumeGameRetrospective(db, { ...input, expectedHead: { ...input.expectedHead, sequence: 0 } }, "rt08-recovery-admin")).rejects.toMatchObject({ code: "conflict" });
  expect(await pauseRetrospectiveExecution(db, gameId, ownerEpoch, failure!)).toBeFalse();
  expect(await resumeGameRetrospective(db, input, "rt08-recovery-admin")).toMatchObject({ alreadyResumed: false });
  expect(await resumeGameRetrospective(db, input, "rt08-recovery-admin")).toMatchObject({ alreadyResumed: true });
  await expect(resumeGameRetrospective(db, { ...input, expectedFailureId: null }, "rt08-recovery-admin")).rejects.toMatchObject({ code: "conflict" });
  shouldFail = false;
  const replacement = await adoptDurableGameRunOwner(db, gameId);
  if (!replacement.ok) throw Error(replacement.error);
  await expect(store.load(gameId)).rejects.toThrow("owner");
  const resumed = createDurableGameRunnerStore(db, { gameId, ownerEpoch: replacement.claim.ownerEpoch });
  await new GameRunner(agents(), config, undefined, { gameId, durableTurnStore: resumed }).run();
  const final = replayCanonicalEvents((await resumed.load(gameId))!.canonicalEvents);
  expect(final.retrospective!.statements).toHaveLength(3);
  expect(final.retrospective!.statements[0]).toEqual(prefix.statements[0]);
  expect(final.retrospectiveOutcomeSource).toEqual(replayCanonicalEvents(before.canonicalEvents).retrospectiveOutcomeSource);
  expect(calls).toBe(4);
}, 30_000);

test("Werewolf failure preserves its prepared request, frozen input and accepted prefix through explicit recovery", async () => {
  const db = await authorizedDB();
  await db.insert(schema.users).values({ id: "rt08-wolf-owner" });
  const game = await createWerewolfGame(db, "rt08-wolf-owner", { preset: "one_wolf", agentProfileIds: [], maxDays: 1 });
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw Error(claim.error);
  const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
  let shouldFail = true, calls = 0;
  const agent: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, async getRetrospectiveStatement(input) {
    calls++;
    if (input.context.request.ordinal === 1 && shouldFail) throw new ProviderUnavailableError("Required speech exhausted", "malformed_output");
    return fixtureWerewolfRetrospective(input);
  }, async decide({ request }) {
    if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" } : { kind: "speech", text: null, cue: null };
  } };
  let error: RetrospectiveExecutionError | null = null;
  try { await runWerewolf(store, agent); } catch (cause) { if (!(cause instanceof RetrospectiveExecutionError)) throw cause; error = cause; }
  expect(error).toMatchObject({ stage: "statement", code: "malformed_output" });
  const events = await store.read(), state = replayWerewolf(events), frozen = (await loadPayloads(db.select().from(schema.gameRetrospectiveInputs)))[0]!;
  const [row] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
  const frontier = await readRetrospectiveFrontier(db, row!);
  expect(await pauseRetrospectiveExecution(db, game.id, claim.claim.ownerEpoch, error!)).toBeTrue();
  expect((await claimWerewolfGame(db, game.id)).ok).toBeFalse();
  expect(await findStartupRecoverableGameIds(db)).toEqual([]); expect(calls).toBe(2);
  const failure = JSON.parse((await db.select().from(schema.games).where(eq(schema.games.id, game.id)))[0]!.config).retrospectiveFailure;
  await resumeGameRetrospective(db, { gameId: game.id, expectedHead: frontier.head, expectedFailureId: failure.id, idempotencyKey: "wolf-resume" }, "rt08-recovery-admin");
  const next = await claimWerewolfGame(db, game.id);
  if (!next.ok) throw Error(next.error);
  await expect(advanceWerewolf(store, agent)).rejects.toThrow("stale");
  shouldFail = false;
  const final = await runWerewolf(createWerewolfStore(db, game.id, next.claim.ownerEpoch), agent);
  expect(final.outcome).toEqual(state.outcome);
  expect(final.retrospective!.statements[0]).toEqual(state.retrospective!.statements[0]);
  expect(final.retrospective!.statements).toHaveLength(final.players.length);
  expect((await loadPayloads(db.select().from(schema.gameRetrospectiveInputs)))[0]).toEqual(frozen);
  expect(calls).toBe(final.players.length + 1);
}, 30_000);

test("a dispatched retrospective remains in active ownership until drain aborts it; no failure or speech is fabricated", async () => {
  const db = await authorizedDB();
  await db.insert(schema.users).values({ id: "rt08-drain-owner" });
  const game = await createWerewolfGame(db, "rt08-drain-owner", { preset: "one_wolf", agentProfileIds: [], maxDays: 1 });
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw Error(claim.error);
  const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
  let dispatched!: () => void;
  const ready = new Promise<void>(resolve => { dispatched = resolve; });
  const agent: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity,
    async getRetrospectiveStatement({ signal }) {
      dispatched();
      return new Promise((_, reject) => { signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }); });
    }, async decide({ request }) {
      if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
      return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" } : { kind: "speech", text: null, cue: null };
    } };
  let state = replayWerewolf(await store.read());
  while (!state.outcome) state = await advanceWerewolf(store, agent);
  await startWerewolfRuntime(db, game.id, claim.claim.ownerEpoch, agent);
  await ready;
  expect(activeWerewolfCount()).toBe(1);
  const frontier = await store.read();
  await abortAllWerewolf();
  expect(activeWerewolfCount()).toBe(0);
  expect(await store.read()).toEqual(frontier);
  const [catalog] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
  expect(catalog!.status).toBe("in_progress");
  expect(JSON.parse(catalog!.config).retrospectiveFailure).toBeUndefined();
  expect((await db.select().from(schema.gameRunOwners))[0]!.status).toBe("expired");
  const next = await claimWerewolfGame(db, game.id);
  if (!next.ok) throw Error(next.error);
  const final = await runWerewolf(createWerewolfStore(db, game.id, next.claim.ownerEpoch), { ...agent, getRetrospectiveStatement: fixtureWerewolfRetrospective });
  expect(final.outcome).toEqual(state.outcome);
  expect(final.retrospective!.statements).toHaveLength(final.players.length);
}, 30_000);

test("the existing Werewolf runtime checkpoints failed initialization and releases the active run", async () => {
  const db = await authorizedDB();
  await db.insert(schema.users).values({ id: "rt08-init-owner" });
  const game = await createWerewolfGame(db, "rt08-init-owner", { preset: "one_wolf", agentProfileIds: [], maxDays: 1 });
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw Error(claim.error);
  const agent: WerewolfAgent = { async prepareRetrospectiveCapacity() { throw new RetrospectiveContextCapacityError(); },
    async getRetrospectiveStatement() { throw Error("No speech can be dispatched without admitted initialization"); }, async decide({ request }) {
      if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
      return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" } : { kind: "speech", text: null, cue: null };
    } };
  await startWerewolfRuntime(db, game.id, claim.claim.ownerEpoch, agent);
  const deadline = Date.now() + 5000;
  while (activeWerewolfCount() && Date.now() < deadline) await Bun.sleep(10);
  expect(activeWerewolfCount()).toBe(0);
  const [catalog] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
  expect(catalog!.status).toBe("suspended");
  expect(JSON.parse(catalog!.config).retrospectiveFailure).toMatchObject({ stage: "initialize", code: "capacity_unavailable", actorId: null, ordinal: null });
  expect((await readHouseGameResults(db, game.id)).ok).toBeTrue();
  expect((await db.select().from(schema.gameRunOwners))[0]!.status).toBe("revoked");
  expect(await findStartupRecoverableGameIds(db)).toEqual([]);
}, 30_000);
