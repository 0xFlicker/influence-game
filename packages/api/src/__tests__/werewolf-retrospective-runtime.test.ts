import { loadPayloads } from "../services/payload-storage.js";
import { expect, test } from "bun:test";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { createProviderAdapter, modelCatalogEntryById, fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective, RetrospectiveExecutionError, type LlmProviderRuntime } from "@influence/engine";
import { advanceWerewolf, replayWerewolf, runWerewolf, WerewolfModelAgent, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { pinWerewolfRulesVersion, setupTestDB } from "./test-utils.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore, releaseWerewolfOwner } from "../services/werewolf-games.js";
import { createApiProviderExecutionHooks } from "../services/provider-call-journal.js";
import { getAdminGameCostDetail } from "../services/admin-game-cost-detail.js";
import { pauseRetrospectiveExecution, resumeGameRetrospective } from "../services/game-retrospective-recovery.js";
import { grantTestAuthority } from "./rbac-fixtures.js";

const scripted: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, getRetrospectiveStatement: fixtureWerewolfRetrospective,
  async decide({ request }) {
    if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" } : { kind: "speech", text: "Compare the votes.", cue: null };
  } };

test.each(["first", "final"] as const)("%s retrospective response survives owner change before event commit", async slot => {
  const db = await setupTestDB();
  await db.insert(schema.users).values({ id: "rt05-owner" });
  const game = await createWerewolfGame(db, "rt05-owner", { preset: "one_wolf", agentProfileIds: [], maxDays: 1, providerManifest: [{ catalogId: "openai:gpt-5-nano" }] });
  await pinWerewolfRulesVersion(db, game.id, 8);
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
  let state = replayWerewolf(await store.read());
  while (!state.outcome) state = await advanceWerewolf(store, scripted);
  const outcome = structuredClone(state.outcome);
  expect((await db.select().from(schema.games))[0]!.status).toBe("in_progress");
  expect((await db.select().from(schema.gameRunOwners))[0]!.status).toBe("active");
  expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(0);
  await expect(advanceWerewolf({ ...store, async append(event, input) {
    if (event.type === "werewolf.retrospective_started") return store.append({ ...event, payload: { ...event.payload, inputHash: "sha256:invalid" } }, input);
    return store.append(event, input);
  } }, scripted)).rejects.toThrow();
  expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(0);
  state = await advanceWerewolf(store, scripted);
  if (slot === "final") while (state.retrospective!.statements.length < state.players.length - 1) state = await advanceWerewolf(store, scripted);
  const ordinal = state.retrospective!.statements.length;
  const frozen = (await loadPayloads(db.select().from(schema.gameRetrospectiveInputs)))[0]!.input;
  let generations = 0;
  const client = new OpenAI({ apiKey: "fixture", baseURL: "https://api.openai.com/v1", maxRetries: 0, fetch: async (url, init) => {
    generations++;
    const body = JSON.parse(String(init?.body));
    const context = JSON.parse(body.input);
    expect(context.game).toEqual(frozen);
    expect(context.request.ordinal).toBe(ordinal);
    expect(context.priorStatements.map((prior: { speech: string }) => prior.speech)).toEqual(state.retrospective!.statements.map(prior => prior.speech));
    return Response.json({ id: "rt05-response", object: "response", status: "completed", model: body.model,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ speech: "  I now understand the whole game. 😀\n " }) }] }],
      usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });
  } });
  const entry = modelCatalogEntryById("openai:gpt-5-nano")!;
  const runtime: LlmProviderRuntime = { adapter: createProviderAdapter(entry.providerProfileId, client), catalogId: entry.id,
    providerProfileId: entry.providerProfileId, modelId: entry.modelId, modelCapabilities: entry.capabilities,
    reasoningPolicy: "high",  position: 0, role: "primary" };
  const makeAgent = (ownerEpoch: string): WerewolfAgent => {
    const model = new WerewolfModelAgent({ runtimes: [runtime], hooks: createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch }), ownerEpoch });
    return { ...scripted, async prepareRetrospectiveCapacity() { throw new Error("Frozen setup cannot rebuild capacity again"); }, getRetrospectiveStatement: input => model.getRetrospectiveStatement(input) };
  };
  await expect(advanceWerewolf({ ...store, async append(event, input) {
    if (event.type === "werewolf.retrospective_statement_recorded") throw new Error("Interrupted after accepted provider response");
    return store.append(event, input);
  } }, makeAgent(claim.claim.ownerEpoch))).rejects.toThrow("Interrupted after accepted");
  expect(generations).toBe(1);
  expect(replayWerewolf(await store.read()).sequence).toBe(state.sequence);
  const planned = (await db.select().from(schema.werewolfTurns).where(eq(schema.werewolfTurns.sequence, state.sequence + 1)))[0]!;
  expect(planned.request).toMatchObject({ actorId: state.retrospective!.definition.speakerIds[ordinal], ordinal });
  await releaseWerewolfOwner(db, game.id, claim.claim.ownerEpoch);
  const replacement = await claimWerewolfGame(db, game.id);
  if (!replacement.ok) throw new Error(replacement.error);
  await expect(advanceWerewolf(store, scripted)).rejects.toThrow("stale");
  const nextStore = createWerewolfStore(db, game.id, replacement.claim.ownerEpoch);
  const resumed = await advanceWerewolf(nextStore, makeAgent(replacement.claim.ownerEpoch));
  expect(resumed.retrospective!.statements[ordinal]!.speech).toBe("  I now understand the whole game. 😀\n ");
  expect(generations).toBe(1);
  const call = (await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]!;
  expect(resumed.retrospective!.statements[ordinal]!.providerLogicalCallId).toBe(call.id);
  expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(1);
  const cost = await getAdminGameCostDetail(db, game.id);
  if (!cost.ok) throw new Error(cost.error);
  expect(cost.detail.breakdowns.action).toMatchObject({ "retrospective-statement": { callCount: 1, totalTokens: 140 } });
  expect((await db.select().from(schema.games))[0]!.status).toBe("in_progress");
  const final = await runWerewolf(nextStore, scripted);
  expect(final.outcome).toEqual(outcome); expect(final.retrospective!.statements).toHaveLength(final.players.length);
  expect((await db.select().from(schema.games))[0]!.status).toBe("completed");
  expect((await db.select().from(schema.gameRunOwners)).filter(owner => owner.status === "closed")).toHaveLength(1);
  expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(1);
}, 30_000);

test("input insertion rolls back when the same start transaction cannot append its canonical event", async () => {
  const db = await setupTestDB();
  await db.insert(schema.users).values({ id: "rt05-atomic-owner" });
  const game = await createWerewolfGame(db, "rt05-atomic-owner", { preset: "one_wolf", agentProfileIds: [], maxDays: 1 });
  await pinWerewolfRulesVersion(db, game.id, 8);
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
  let state = replayWerewolf(await store.read());
  while (!state.outcome) state = await advanceWerewolf(store, scripted);
  type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
  const faultingDb = new Proxy(db, { get(target, property) {
    if (property !== "transaction") return Reflect.get(target, property, target);
    return (callback: (tx: Tx) => Promise<unknown>) => target.transaction(async tx => callback(new Proxy(tx, { get(transaction, key) {
      const member = Reflect.get(transaction, key, transaction);
      if (key !== "insert") return typeof member === "function" ? member.bind(transaction) : member;
      const insert = member as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        if (args[0] === schema.werewolfEvents) throw new Error("Injected event insertion failure after frozen input");
        return insert.apply(transaction, args);
      };
    } }))) ;
  } });
  await expect(advanceWerewolf(createWerewolfStore(faultingDb, game.id, claim.claim.ownerEpoch), scripted)).rejects.toThrow("after frozen input");
  expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(0);
  expect(replayWerewolf(await store.read())).toEqual(state);
  const restarted = await advanceWerewolf(store, scripted);
  expect(restarted.retrospective!.statements).toHaveLength(0);
  expect(await loadPayloads(db.select().from(schema.gameRetrospectiveInputs))).toHaveLength(1);
}, 30_000);

test("a crash after exhausted native retries cannot spend again before explicit recovery", async () => {
  const db = await setupTestDB();
  await db.insert(schema.users).values({ id: "rt08-journal-owner" });
  await grantTestAuthority(db, "rt08-journal-owner", ["resume_game_retrospective"], "admin");
  const game = await createWerewolfGame(db, "rt08-journal-owner", { preset: "one_wolf", agentProfileIds: [], maxDays: 1,
    providerManifest: [{ catalogId: "openai:gpt-5-nano" }] });
  await pinWerewolfRulesVersion(db, game.id, 8);
  const first = await claimWerewolfGame(db, game.id);
  if (!first.ok) throw Error(first.error);
  const store = createWerewolfStore(db, game.id, first.claim.ownerEpoch);
  let state = replayWerewolf(await store.read());
  while (!state.retrospective) state = await advanceWerewolf(store, scripted);
  let generations = 0, valid = false;
  const client = new OpenAI({ apiKey: "fixture", baseURL: "https://api.openai.com/v1", maxRetries: 0, fetch: async (url, init) => {
    generations++;
    const body = JSON.parse(String(init?.body));
    return Response.json({ id: `rt08-native-${generations}`, object: "response", created_at: 0, status: "completed", model: body.model,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(valid ? { speech: "I finally see what changed the outcome." } : {}) }] }],
      usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });
  } });
  const entry = modelCatalogEntryById("openai:gpt-5-nano")!;
  const runtime: LlmProviderRuntime = { adapter: createProviderAdapter(entry.providerProfileId, client), catalogId: entry.id,
    providerProfileId: entry.providerProfileId, modelId: entry.modelId, modelCapabilities: entry.capabilities,
    reasoningPolicy: "high",  position: 0, role: "primary" };
  const model = (ownerEpoch: string) => new WerewolfModelAgent({ runtimes: [runtime], hooks: createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch }), ownerEpoch });
  await expect(advanceWerewolf(store, model(first.claim.ownerEpoch))).rejects.toMatchObject({ code: "malformed_output" });
  expect(generations).toBe(3);
  // Simulate loss after journal terminalization and before the runtime catch.
  await releaseWerewolfOwner(db, game.id, first.claim.ownerEpoch);
  const next = await claimWerewolfGame(db, game.id);
  if (!next.ok) throw Error(next.error);
  const resumed = createWerewolfStore(db, game.id, next.claim.ownerEpoch);
  let failure: RetrospectiveExecutionError | null = null;
  try { await advanceWerewolf(resumed, model(next.claim.ownerEpoch)); }
  catch (error) { if (!(error instanceof RetrospectiveExecutionError)) throw error; failure = error; }
  expect(failure).toMatchObject({ code: "journal_exhausted" });
  expect(generations).toBe(3);
  expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(3);
  expect(await pauseRetrospectiveExecution(db, game.id, next.claim.ownerEpoch, failure!)).toBeTrue();
  const suspension = JSON.parse((await db.select().from(schema.games).where(eq(schema.games.id, game.id)))[0]!.config).retrospectiveFailure;
  await resumeGameRetrospective(db, { gameId: game.id, expectedHead: suspension.head, expectedFailureId: suspension.id, idempotencyKey: "native-recovery" }, "rt08-journal-owner");
  const finalOwner = await claimWerewolfGame(db, game.id);
  if (!finalOwner.ok) throw Error(finalOwner.error);
  valid = true;
  const final = await advanceWerewolf(createWerewolfStore(db, game.id, finalOwner.claim.ownerEpoch), model(finalOwner.claim.ownerEpoch));
  expect(generations).toBe(4);
  expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(4);
  expect(final.retrospective!.statements[0]!.speech).toBe("I finally see what changed the outcome.");
  expect(final.outcome).toEqual(state.outcome);
}, 30_000);
