import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { createProviderAdapter, modelCatalogEntryById, DEFAULT_MODEL_CATALOG_ID, type LlmProviderRuntime } from "@influence/engine";
import { advanceWerewolf, defaultWerewolfStrategy, nextWerewolfStep, observeWerewolf, replayWerewolf, runWerewolf, werewolfActionPlans, werewolfEvent, WerewolfModelAgent, type WerewolfAgent, type WerewolfView } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore, readWerewolfEvents, readWerewolfView, releaseWerewolfOwner } from "../services/werewolf-games.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { createGameRoutes } from "../routes/games.js";
import { createApiProviderExecutionHooks } from "../services/provider-call-journal.js";
import { adoptInProgressDurableGamesOnStartup } from "../services/startup-durable-games.js";

let db: DrizzleDB;
const ownerId = "werewolf-owner";
const manifest = [{ catalogId: DEFAULT_MODEL_CATALOG_ID }];
const scripted: WerewolfAgent = { async decide({ request }) {
  return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "PRIVATE_THINKING" }
    : { kind: "speech", text: request.action === "pack_talk" ? "SECRET_PACK" : "I suspect the quiet ones.", thinking: "PRIVATE_THINKING" };
} };
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.users).values({ id: ownerId });
});
async function create(agentProfileIds: string[] = []) {
  const game = await createWerewolfGame(db, ownerId, { preset: "two_wolves", agentProfileIds, providerManifest: manifest, maxDays: 2 });
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  return { ...game, ...claim.claim, store: createWerewolfStore(db, game.id, claim.claim.ownerEpoch) };
}

describe("Werewolf House integration", () => {
  test("earlier experimental rules fail clearly without rewriting their log", async () => {
    const game = await create();
    const initial = (await game.store.read())[0]!;
    if (initial.type !== "werewolf.started") throw new Error("setup");
    Object.assign(initial.payload.config, { rulesVersion: 1 });
    await db.update(schema.werewolfEvents).set({ event: initial }).where(eq(schema.werewolfEvents.gameId, game.id));
    const response = await createWerewolfRoutes(db).request(`/api/werewolf/${game.slug}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This game uses an unsupported Werewolf rules version. Start a new game to use shared discussion beats." });
    expect(await game.store.read()).toEqual([initial]);
  });
  test("one character keeps separate strategies and freezes only Werewolf into its game", async () => {
    const context = { userId: ownerId, publicBaseUrl: "http://localhost" };
    const first = await createOwnedAgentProfile(db, context, { name: "Arden Vale", personality: "Observant", gender: "non-binary", personaKey: "observer", backstory: "An old librarian", strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: "WEREWOLF_ONLY" });
    const edited = await updateOwnedAgentProfile(db, context, first.profile.id, { werewolfStrategyStyle: "WEREWOLF_EDIT", expectedContentRevisionId: first.profile.contentRevisionId, submissionId: randomUUID() });
    expect(edited.profile.strategyStyle).toBe("INFLUENCE_ONLY");
    expect(edited.profile.currentRevisionId).toBe(first.profile.currentRevisionId);
    expect(edited.profile.contentRevisionId).not.toBe(first.profile.contentRevisionId);
    const game = await create([first.profile.id]);
    const before = await game.store.read();
    const state = replayWerewolf(before);
    const character = state.players.find((p) => p.agentProfileId === first.profile.id)!;
    expect(character).toMatchObject({ name: "Arden Vale", personality: "Observant", backstory: "An old librarian", strategy: "WEREWOLF_EDIT", contentRevisionId: edited.profile.contentRevisionId });
    expect(JSON.stringify(before)).not.toContain("INFLUENCE_ONLY");
    await updateOwnedAgentProfile(db, context, first.profile.id, { werewolfStrategyStyle: "FUTURE_GAME", expectedContentRevisionId: edited.profile.contentRevisionId, submissionId: randomUUID() });
    expect(await game.store.read()).toEqual(before);
    const observation = observeWerewolf(state, character.id);
    expect(observation.self.strategy).toBe("WEREWOLF_EDIT");
    expect(JSON.stringify(await readWerewolfView(db, game.id, "omniscient"))).not.toContain("WEREWOLF_EDIT");
  });

  test("absent Werewolf notes freeze archetype defaults; another owner's or archived character cannot join", async () => {
    await db.insert(schema.users).values({ id: "other-owner" });
    await db.insert(schema.agentProfiles).values([{ id: "mine", userId: ownerId, name: "My character", personality: "Calm", personaKey: "observer", strategyStyle: "INFLUENCE_ONLY" }, { id: "theirs", userId: "other-owner", name: "Other", personality: "Calm" }]);
    const game = await create(["mine"]);
    const initial = await game.store.read();
    const players = replayWerewolf(initial).players;
    expect(players.find((p) => p.agentProfileId === "mine")?.strategy).toBe(defaultWerewolfStrategy("observer"));
    for (const player of players) expect(player.strategy).toBe(defaultWerewolfStrategy(player.personaKey));
    expect(new Set(players.map(player => player.strategy)).size).toBeGreaterThan(1);
    expect(JSON.stringify(initial)).not.toContain("INFLUENCE_ONLY");
    await db.update(schema.agentProfiles).set({ personaKey: "aggressive", werewolfStrategyStyle: "Future notes" }).where(eq(schema.agentProfiles.id, "mine"));
    expect(await game.store.read()).toEqual(initial);
    await expect(create(["theirs"])).rejects.toThrow("unavailable");
    await db.update(schema.agentProfiles).set({ archivedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, "mine"));
    await expect(create(["mine"])).rejects.toThrow("archived");
  });

  test("two workers cannot own or commit the same frontier; stale work cannot append", async () => {
    const game = await create();
    expect((await claimWerewolfGame(db, game.id)).ok).toBe(false);
    const initial = replayWerewolf(await game.store.read());
    const step = nextWerewolfStep(initial);
    if (step.kind !== "action") throw new Error("expected introduction");
    await game.store.prepare!(initial, step.request);
    const decision = await scripted.decide({ gameId: game.id, actionSlot: initial.sequence + 1, request: step.request, observation: observeWerewolf(initial, step.request.actorId) });
    const event = werewolfEvent(initial, { type: "werewolf.action_accepted", payload: { ...step.request, decision, fallback: null } });
    const writes = await Promise.allSettled([game.store.append(event), game.store.append(event)]);
    expect(writes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await releaseWerewolfOwner(db, game.id, game.ownerEpoch);
    const replacement = await claimWerewolfGame(db, game.id);
    expect(replacement.ok).toBe(true);
    await expect(advanceWerewolf(game.store, scripted)).rejects.toThrow("stale");
    expect((await game.store.read()).length).toBe(2);
  });

  test("shared startup adopts the Werewolf log and commits faction completion without Influence settlement", async () => {
    const game = await create();
    await advanceWerewolf(game.store, scripted);
    await releaseWerewolfOwner(db, game.id, game.ownerEpoch);
    const startup = await adoptInProgressDurableGamesOnStartup(db, { start: async ({ gameId, ownerEpoch, executionState }) => {
      expect(executionState).toBeNull();
      await runWerewolf(createWerewolfStore(db, gameId, ownerEpoch), scripted);
    } });
    expect(startup.adopted).toEqual([game.id]);
    const state = replayWerewolf(await readWerewolfEvents(db, game.id));
    expect(state.outcome).not.toBeNull();
    expect((await db.select().from(schema.games).where(eq(schema.games.id, game.id)))[0]?.status).toBe("completed");
    expect(await db.select().from(schema.gameResults)).toEqual([]);
    expect(await db.select().from(schema.gameCompletionSettlements)).toEqual([]);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, ownerId)))[0]?.gamesPlayed).toBe(0);
  });

  test("provider dispatch requires a frozen matching action and observation", async () => {
    const game = await create();
    const state = replayWerewolf(await game.store.read());
    const step = nextWerewolfStep(state);
    if (step.kind !== "action") throw new Error("expected action");
    const coordinate = { gameId: game.id, ownerEpoch: game.ownerEpoch, actor: { id: step.request.actorId, name: state.players[0]!.name, role: "player" as const }, action: "werewolf.introduce", round: 0, semantic: { version: 1 as const, kind: "werewolf_action" as const, eventSequence: 2 } };
    const hooks = createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch: game.ownerEpoch });
    await expect(hooks.onAllocateAttemptOrdinal!(coordinate)).rejects.toThrow("frozen plan");
    await game.store.prepare!(state, step.request);
    expect(await hooks.onAllocateAttemptOrdinal!(coordinate)).toBe(1);
    await expect(hooks.onAllocateAttemptOrdinal!({ ...coordinate, action: "werewolf.attack" })).rejects.toThrow("frozen plan");
    await expect(hooks.onAllocateAttemptOrdinal!({ ...coordinate, round: 1 })).rejects.toThrow("frozen plan");
    await expect(hooks.onAllocateAttemptOrdinal!({ ...coordinate, actor: { ...coordinate.actor, name: "Wrong actor" } })).rejects.toThrow("frozen plan");
    await db.update(schema.werewolfTurns).set({ observationHash: "tampered" }).where(eq(schema.werewolfTurns.gameId, game.id));
    await expect(hooks.onAllocateAttemptOrdinal!(coordinate)).rejects.toThrow("frozen plan");
  });

  test("one corrupt log suspends only that game while startup recovers another", async () => {
    const damaged = await create();
    const healthy = await create();
    await releaseWerewolfOwner(db, damaged.id, damaged.ownerEpoch);
    await releaseWerewolfOwner(db, healthy.id, healthy.ownerEpoch);
    await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, damaged.id));
    const started: string[] = [];
    const startup = await adoptInProgressDurableGamesOnStartup(db, { start: async ({ gameId }) => { started.push(gameId); } });
    expect(startup.adopted).toEqual([healthy.id]);
    expect(started).toEqual([healthy.id]);
    expect((await db.select().from(schema.games).where(eq(schema.games.id, damaged.id)))[0]?.status).toBe("suspended");
    expect((await db.select().from(schema.games).where(eq(schema.games.id, healthy.id)))[0]?.status).toBe("in_progress");
  });

  test("Mystery replay is prefix-safe, Omniscient is explicit, and Influence endpoints reject Werewolf", async () => {
    const game = await create();
    await runWerewolf(game.store, scripted);
    const app = createWerewolfRoutes(db);
    const initial = await app.request(`/api/werewolf/${game.slug}?cursor=1`);
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toContain("no-store");
    const mystery = await initial.json() as { view: WerewolfView; latestCursor: number };
    expect(mystery.view.players.every((p: { role?: string; alive: boolean }) => p.role === undefined && p.alive)).toBe(true);
    expect(mystery.view.outcome).toBeNull();
    expect(JSON.stringify(mystery)).not.toContain("SECRET_PACK");
    const all = await (await app.request(`/api/werewolf/${game.slug}?audience=omniscient`)).json() as { view: WerewolfView };
    expect(all.view.players.every((p: { role?: string }) => p.role)).toBe(true);
    expect(JSON.stringify(all)).toContain("SECRET_PACK");
    expect(JSON.stringify(all)).not.toContain("PRIVATE_THINKING");
    for (let cursor = 1; cursor < mystery.latestCursor; cursor++) {
      const view = await readWerewolfView(db, game.id, "mystery", cursor);
      expect(view.players.every((p) => p.role === undefined)).toBe(true);
      expect(view.outcome).toBeNull();
    }
    expect((await app.request(`/api/werewolf/${game.slug}?audience=bad`)).status).toBe(400);
    expect((await app.request(`/api/werewolf/${game.slug}?cursor=-1`)).status).toBe(400);
    const influence = createGameRoutes(db);
    expect((await influence.request(`/api/games/${game.id}/transcript`)).status).toBe(409);
    expect(await (await influence.request("/api/games")).json()).toEqual([]);
  });

  test("malformed output retries inside the provider boundary; accepted decisions survive an owner change before commit", async () => {
    const game = await createWerewolfGame(db, ownerId, { preset: "one_wolf", agentProfileIds: [], providerManifest: [{ catalogId: "katana:glm-5-2" }] });
    const claim = await claimWerewolfGame(db, game.id);
    if (!claim.ok) throw new Error(claim.error);
    let dispatches = 0;
    const client = new OpenAI({ apiKey: "test-only", baseURL: "http://fixture.invalid/v1", maxRetries: 0,
      fetch: async () => {
        dispatches++;
        return new Response(JSON.stringify({ id: `fixture-${dispatches}`, object: "chat.completion", created: 0, model: "glm-5-2",
          choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
            tool_calls: [{ id: "decision", type: "function", function: { name: "werewolf_introduce", arguments: dispatches === 1 ? "{}" : JSON.stringify({ text: "A persisted introduction.", thinking: "Private reasoning." }) } }] } }],
          usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 } }), { headers: { "content-type": "application/json" } });
      } });
    const model = modelCatalogEntryById("katana:glm-5-2")!;
    const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id, providerProfileId: "katana", modelId: model.modelId,
      modelCapabilities: model.capabilities, reasoningPolicy: "medium", toolChoiceMode: "required", position: 0, role: "primary" };
    const agent = (ownerEpoch: string) => new WerewolfModelAgent({ runtimes: [runtime], ownerEpoch, hooks: createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch }) });
    const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
    const state = replayWerewolf(await store.read());
    const step = nextWerewolfStep(state);
    if (step.kind !== "action") throw new Error("expected introduction");
    await store.prepare!(state, step.request);
    const accepted = await agent(claim.claim.ownerEpoch).decide({ gameId: game.id, actionSlot: 2, request: step.request, observation: observeWerewolf(state, step.request.actorId) });
    expect(dispatches).toBe(2);
    expect(await store.read()).toHaveLength(1);
    await releaseWerewolfOwner(db, game.id, claim.claim.ownerEpoch);
    const replacement = await claimWerewolfGame(db, game.id);
    if (!replacement.ok) throw new Error(replacement.error);
    const resumed = await advanceWerewolf(createWerewolfStore(db, game.id, replacement.claim.ownerEpoch), agent(replacement.claim.ownerEpoch));
    expect(resumed.actions[0]?.decision).toEqual(accepted);
    expect(dispatches).toBe(2);
    const attempts = await db.select().from(schema.providerCallAttempts);
    expect(attempts.filter((a) => a.outcomeKind === "usable")).toHaveLength(1);
    expect(attempts.filter((a) => a.outcomeKind === "malformed_output")).toHaveLength(1);
  });

  test("parallel beat plans survive a partial commit and owner change without redispatch or partial public reveal", async () => {
    const game = await createWerewolfGame(db, ownerId, { preset: "one_wolf", agentProfileIds: [], providerManifest: [{ catalogId: "katana:glm-5-2" }] });
    const claim = await claimWerewolfGame(db, game.id);
    if (!claim.ok) throw new Error(claim.error);
    const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
    let start = replayWerewolf(await store.read());
    for (let i = 0; i < 40 && start.phase !== "day"; i++) start = await advanceWerewolf(store, scripted);
    expect(start.phase).toBe("day");
    const plans = werewolfActionPlans(start);
    const before = await readWerewolfView(db, game.id, "mystery");
    const beforeOmniscient = await readWerewolfView(db, game.id, "omniscient");
    let dispatches = 0;
    const client = new OpenAI({ apiKey: "test-only", baseURL: "http://fixture.invalid/v1", maxRetries: 0,
      fetch: async () => {
        dispatches++;
        return Response.json({ id: `discussion-${dispatches}`, object: "chat.completion", created: 0, model: "glm-5-2",
          choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
            tool_calls: [{ id: "decision", type: "function", function: { name: "werewolf_discuss", arguments: JSON.stringify({ text: `Independent claim ${dispatches}`, thinking: "PRIVATE_THINKING" }) } }] } }],
          usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 } });
      } });
    const model = modelCatalogEntryById("katana:glm-5-2")!;
    const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id, providerProfileId: "katana", modelId: model.modelId,
      modelCapabilities: model.capabilities, reasoningPolicy: "medium", toolChoiceMode: "required", position: 0, role: "primary" };
    const agent = (ownerEpoch: string) => new WerewolfModelAgent({ runtimes: [runtime], ownerEpoch, hooks: createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch }) });
    let commits = 0;
    await expect(advanceWerewolf({ ...store, append: async (event) => {
      if (++commits === 2) throw new Error("Interrupted between private commitments");
      await store.append(event);
    } }, agent(claim.claim.ownerEpoch))).rejects.toThrow("Interrupted between");
    expect(dispatches).toBe(plans.length);
    const partial = replayWerewolf(await store.read());
    expect(partial.actions).toHaveLength(1);
    expect(await readWerewolfView(db, game.id, "mystery")).toEqual(before);
    expect(await readWerewolfView(db, game.id, "omniscient")).toEqual(beforeOmniscient);
    for (const id of start.aliveIds) expect(observeWerewolf(partial, id)).toEqual(observeWerewolf(start, id));
    const savedPlans = await db.select().from(schema.werewolfTurns).where(eq(schema.werewolfTurns.gameId, game.id));
    expect(savedPlans.filter((plan) => plan.request.action === "discuss").map((plan) => plan.sequence).toSorted()).toEqual(plans.map((plan) => plan.sequence).toSorted());

    await releaseWerewolfOwner(db, game.id, claim.claim.ownerEpoch);
    const replacement = await claimWerewolfGame(db, game.id);
    if (!replacement.ok) throw new Error(replacement.error);
    await expect(advanceWerewolf(store, scripted)).rejects.toThrow("stale");
    const resumedStore = createWerewolfStore(db, game.id, replacement.claim.ownerEpoch);
    const sealed = await advanceWerewolf(resumedStore, agent(replacement.claim.ownerEpoch));
    expect(sealed.actions).toHaveLength(plans.length);
    expect(dispatches).toBe(plans.length);
    expect(await readWerewolfView(db, game.id, "mystery")).toEqual(before);
    await advanceWerewolf(resumedStore, scripted);
    const after = await readWerewolfView(db, game.id, "mystery");
    expect(after.cursor).toBe(before.cursor + 1);
    const reveal = after.entries.at(-1);
    expect(reveal?.kind === "discussion" && reveal.result.contributions.length).toBe(plans.length);
    expect(JSON.stringify(after)).not.toContain("PRIVATE_THINKING");
    expect(await readWerewolfView(db, game.id, "mystery", before.cursor)).toEqual(before);
    expect(await readWerewolfView(db, game.id, "mystery", after.cursor)).toEqual(after);
    const attempts = await db.select().from(schema.providerCallAttempts);
    expect(attempts.filter((attempt) => attempt.outcomeKind === "usable")).toHaveLength(plans.length);
  });
});
