import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { createProviderAdapter, modelCatalogEntryById, DEFAULT_MODEL_CATALOG_ID, type LlmProviderRuntime } from "@influence/engine";
import { advanceWerewolf, defaultWerewolfStrategy, nextWerewolfStep, observeWerewolf, replayWerewolf, runWerewolf, werewolfActionPlans, werewolfEvent, WerewolfModelAgent, type WerewolfAgent, type WerewolfView, type WerewolfVoteProgress } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore, readWerewolfLiveView, readWerewolfEvents, readWerewolfView, releaseWerewolfOwner } from "../services/werewolf-games.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { createGameRoutes } from "../routes/games.js";
import { createApiProviderExecutionHooks } from "../services/provider-call-journal.js";
import { adoptInProgressDurableGamesOnStartup } from "../services/startup-durable-games.js";

let db: DrizzleDB;
const ownerId = "werewolf-owner";
const manifest = [{ catalogId: DEFAULT_MODEL_CATALOG_ID }];
const scripted: WerewolfAgent = { async decide({ request }) {
  if (request.action === "open_thread") return { kind: "opening", text: "Who changed their mind?", cue: null, recipientIds: request.legalRecipientIds.slice(0, 3) };
  return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "PRIVATE_THINKING" }
    : { kind: "speech", cue: null, text: request.action === "pack_talk" ? "SECRET_PACK" : "Who changed their mind?" };
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
    Object.assign(initial.payload.config, { rulesVersion: 2 });
    await db.update(schema.werewolfEvents).set({ event: initial }).where(eq(schema.werewolfEvents.gameId, game.id));
    const response = await createWerewolfRoutes(db).request(`/api/werewolf/${game.slug}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This game uses an unsupported Werewolf rules version. Start a new game to use ordered recipient threads (rules v7)." });
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
  }, 30_000);

  test.each(["malformed", "spoken_uuid", "discussion_reply", "opening_recipients", "day_abstention"] as const)("%s output retries and survives an owner change before commit", async invalidKind => {
    const action = invalidKind === "day_abstention" ? "vote" : invalidKind === "discussion_reply" ? "discuss" : invalidKind === "opening_recipients" ? "open_thread" : "introduce";
    const game = await createWerewolfGame(db, ownerId, { preset: "one_wolf", agentProfileIds: [], providerManifest: [{ catalogId: "katana:glm-5-2" }] });
    const claim = await claimWerewolfGame(db, game.id);
    if (!claim.ok) throw new Error(claim.error);
    let dispatches = 0;
    const client = new OpenAI({ apiKey: "test-only", baseURL: "http://fixture.invalid/v1", maxRetries: 0,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (action === "discuss") {
          const context = JSON.parse(body.messages.at(-2).content);
          const input = JSON.parse(body.messages.at(-1).content);
          expect(context.request.action).toBe("discuss");
          expect(context.observation.board.entries.at(-1).contribution.text).toBe("Who changed their mind?");
          expect(context.contributionGuidance).toContain("To pass, return null text");
          expect(input.turnReminder.stage).toBe("reply");
          expect(input.turnReminder.openingStatement).toBe("Who changed their mind?");
          expect(input.conversationTurn.stage).toBe("reply");
          expect(input.conversationTurn.messageToAnswer.text).toBe("Who changed their mind?");
          expect(Object.keys(input).at(-1)).toBe("conversationTurn");
        }
        if (action === "vote") {
          const input = JSON.parse(body.messages.at(-1).content);
          expect(input.voteCheckpoint.afterThread).toBe(1);
          expect(input.voteCheckpoint.livingPlayers).toBe(5);
          expect(input.voteCheckpoint.requiredVotes).toBe(3);
          expect(input.observation.board.entries.some((entry: { kind: string }) => entry.kind === "vote")).toBe(false);
        }
        const openingRequest = action === "open_thread" ? JSON.parse(body.messages.at(-2).content).request : null;
        if (openingRequest) {
          expect(JSON.parse(body.messages.at(-1).content).conversationTurn.stage).toBe("opening");
          expect(openingRequest.legalRecipientIds).toHaveLength(4);
        }
        dispatches++;
        return new Response(JSON.stringify({ id: `fixture-${dispatches}`, object: "chat.completion", created: 0, model: "glm-5-2",
          choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
            tool_calls: [{ id: "decision", type: "function", function: { name: `werewolf_${action}`, arguments: dispatches === 1 ? openingRequest ? JSON.stringify({ text: "Invalid invitation", cue: null, recipientIds: [openingRequest.actorId] }) : invalidKind !== "spoken_uuid" ? "{}" : JSON.stringify({ cue: null, text: "I trust Mira (7c731c26-a298-4987-b015-07ab4bae27ce)." }) : JSON.stringify(action === "vote" ? { targetId: null, thinking: "Hear more" } : openingRequest ? { cue: null, text: "A persisted contribution.", recipientIds: openingRequest.legalRecipientIds.slice(0, 3).reverse() } : { cue: null, text: "A persisted contribution." }) } }] } }],
          usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 } }), { headers: { "content-type": "application/json" } });
      } });
    const model = modelCatalogEntryById("katana:glm-5-2")!;
    const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id, providerProfileId: "katana", modelId: model.modelId,
      modelCapabilities: model.capabilities, reasoningPolicy: "medium", toolChoiceMode: "required", position: 0, role: "primary" };
    const agent = (ownerEpoch: string) => new WerewolfModelAgent({ runtimes: [runtime], ownerEpoch, hooks: createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch }) });
    const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
    let state = replayWerewolf(await store.read());
    if (action === "open_thread") while (state.phase !== "day") state = await advanceWerewolf(store, scripted);
    if (action === "discuss") {
      while (state.phase !== "day") state = await advanceWerewolf(store, scripted);
      state = await advanceWerewolf(store, scripted); // Opening is committed before this reply.
    }
    if (action === "vote") while (state.phase !== "vote") state = await advanceWerewolf(store, scripted);
    const before = await readWerewolfView(db, game.id, "mystery");
    const step = nextWerewolfStep(state);
    if (step.kind !== "action") throw new Error("expected introduction");
    await store.prepare!(state, step.request);
    const accepted = await agent(claim.claim.ownerEpoch).decide({ gameId: game.id, actionSlot: state.sequence + 1, request: step.request, observation: observeWerewolf(state, step.request.actorId) });
    expect(dispatches).toBe(2);
    expect(await store.read()).toHaveLength(state.sequence);
    expect(await readWerewolfView(db, game.id, "mystery")).toEqual(before);
    await releaseWerewolfOwner(db, game.id, claim.claim.ownerEpoch);
    const replacement = await claimWerewolfGame(db, game.id);
    if (!replacement.ok) throw new Error(replacement.error);
    // This fixture exercises one accepted provider value; the batch test below covers all ballots.
    const replayAgent = agent(replacement.claim.ownerEpoch);
    const resumed = await advanceWerewolf(createWerewolfStore(db, game.id, replacement.claim.ownerEpoch), { decide: input =>
      input.request.actorId === step.request.actorId ? replayAgent.decide(input) : scripted.decide(input) });
    const committed = (await store.read())[state.sequence];
    expect(committed?.type === "werewolf.action_accepted" && committed.payload.decision).toEqual(accepted);
    const after = await readWerewolfView(db, game.id, "mystery");
    expect(after.cursor).toBe(before.cursor + (action === "vote" ? 0 : 1));
    if (action === "vote") expect(after).toEqual(before);
    expect(await readWerewolfView(db, game.id, "mystery", before.cursor)).toEqual(before);
    if (action === "discuss") {
      expect(after.entries.at(-1)).toMatchObject({ kind: "discussion", contribution: { stage: "reply", text: "A persisted contribution." } });
      const next = nextWerewolfStep(resumed);
      if (next.kind !== "action") throw new Error("Missing next reply");
      expect(observeWerewolf(resumed, next.request.actorId).turnReminder?.latestStatement?.text).toBe("A persisted contribution.");
    }
    if (action === "open_thread") {
      expect(accepted.kind).toBe("opening");
      if (accepted.kind !== "opening") throw new Error("opening");
      expect(resumed.discussion?.recipientIds).toEqual(accepted.recipientIds);
      expect(resumed.discussion?.respondentIds.slice(0, 3)).toEqual(accepted.recipientIds);
      expect(nextWerewolfStep(resumed)).toMatchObject({ kind: "action", request: { actorId: accepted.recipientIds[0], action: "discuss" } });
    }
    expect(dispatches).toBe(2);
    const attempts = await db.select().from(schema.providerCallAttempts);
    expect(attempts.filter((a) => a.outcomeKind === "usable")).toHaveLength(1);
    expect(attempts.filter((a) => a.outcomeKind === "malformed_output")).toHaveLength(1);
  });

  test.each(["attack", "vote", "final_vote"] as const)("parallel %s ballots survive a partial commit and owner change without redispatch or partial reveal", async scenario => {
    const action = scenario === "attack" ? "attack" : "vote";
    const finalVote = scenario === "final_vote";
    const game = await createWerewolfGame(db, ownerId, { preset: "two_wolves", agentProfileIds: [], providerManifest: [{ catalogId: "katana:glm-5-2" }] });
    const claim = await claimWerewolfGame(db, game.id);
    if (!claim.ok) throw new Error(claim.error);
    const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
    let start = replayWerewolf(await store.read());
    const reachBallot: WerewolfAgent = { decide: async input => {
      if (finalVote && input.request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
      if (finalVote && input.request.action === "vote") return { kind: "target", targetId: null, thinking: "Hear more" };
      return scripted.decide(input);
    } };
    for (let i = 0; i < 150; i++) {
      const step = nextWerewolfStep(start);
      if (step.kind === "action" && step.request.action === action && (!finalVote || start.discussion?.ended)) break;
      start = await advanceWerewolf(store, reachBallot);
    }
    const plans = werewolfActionPlans(start);
    const thread = start.discussion?.threadIndex ?? 0;
    expect(plans.every(plan => plan.request.action === action)).toBe(true);
    expect(plans.length).toBeGreaterThan(1);
    const audience = "omniscient";
    const beforeMystery = await readWerewolfView(db, game.id, "mystery");
    const beforeOmniscient = await readWerewolfView(db, game.id, "omniscient");
    const before = beforeOmniscient;
    let dispatches = 0;
    let decisionsReady = 0;
    const lastVoter = Promise.withResolvers<void>();
    const peersReady = Promise.withResolvers<void>();
    if (action === "vote") expect((await readWerewolfLiveView(db, game.id, audience, true)).voteProgress).toMatchObject({ ready: 0, total: plans.length, thread });
    const client = new OpenAI({ apiKey: "test-only", baseURL: "http://fixture.invalid/v1", maxRetries: 0,
      fetch: async (_url, init) => {
        dispatches++;
        const input = JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content);
        if (action === "vote" && input.request.actorId === plans.at(-1)!.request.actorId) await lastVoter.promise;
        return Response.json({ id: `discussion-${dispatches}`, object: "chat.completion", created: 0, model: "glm-5-2",
          choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
            tool_calls: [{ id: "decision", type: "function", function: { name: `werewolf_${action}`, arguments: JSON.stringify({ targetId: action === "vote" ? finalVote ? start.aliveIds[(start.aliveIds.indexOf(input.request.actorId) + 1) % start.aliveIds.length] : null : plans[0]!.request.legalTargetIds[0], thinking: "PRIVATE_THINKING" }) } }] } }],
          usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 } });
      } });
    const model = modelCatalogEntryById("katana:glm-5-2")!;
    const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id, providerProfileId: "katana", modelId: model.modelId,
      modelCapabilities: model.capabilities, reasoningPolicy: "medium", toolChoiceMode: "required", position: 0, role: "primary" };
    const agent = (ownerEpoch: string) => new WerewolfModelAgent({ runtimes: [runtime], ownerEpoch, hooks: createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch }) });
    let commits = 0;
    const tracked = agent(claim.claim.ownerEpoch);
    const advancing = advanceWerewolf({ ...store, append: async (event) => {
      if (++commits === 2) throw new Error("Interrupted between private commitments");
      await store.append(event);
    } }, { decide: async input => {
      const decision = await tracked.decide(input);
      if (++decisionsReady === plans.length - 1) peersReady.resolve();
      return decision;
    } }).then(() => null, error => error);
    if (action === "vote") {
      await peersReady.promise;
      expect(dispatches).toBe(plans.length);
      const app = createWerewolfRoutes(db);
      for (const mode of ["mystery", "omniscient"] as const) {
        const live = await (await app.request(`/api/werewolf/${game.slug}?audience=${mode}`)).json() as { view: WerewolfView; voteProgress: WerewolfVoteProgress | null };
        expect(live.voteProgress).toEqual({ kind: "day_vote", voteMode: finalVote ? "plurality" : "majority", day: start.day, thread, total: plans.length, ready: plans.length - 1, requiredVotes: finalVote ? null : Math.floor(plans.length / 2) + 1 });
        expect(live.view).toEqual(mode === "mystery" ? beforeMystery : beforeOmniscient);
        const historic = await (await app.request(`/api/werewolf/${game.slug}?audience=${mode}&cursor=${live.view.cursor}`)).json() as { voteProgress: WerewolfVoteProgress | null };
        expect(historic.voteProgress).toBeNull();
      }
      for (const id of start.aliveIds) expect(observeWerewolf(replayWerewolf(await store.read()), id)).toEqual(observeWerewolf(start, id));
      expect((await readWerewolfLiveView(db, game.id, audience, false)).voteProgress).toBeNull();
      lastVoter.resolve();
    }
    const failure = await advancing;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("Interrupted between");
    expect(dispatches).toBe(plans.length);
    const partial = replayWerewolf(await store.read());
    expect(partial.actions).toHaveLength(start.actions.length + 1);
    if (action === "vote") expect((await readWerewolfLiveView(db, game.id, audience, true)).voteProgress?.ready).toBe(plans.length);
    expect(await readWerewolfView(db, game.id, "mystery")).toEqual(beforeMystery);
    expect(await readWerewolfView(db, game.id, "omniscient")).toEqual(beforeOmniscient);
    for (const id of start.aliveIds) expect(observeWerewolf(partial, id)).toEqual(observeWerewolf(start, id));
    const savedPlans = await db.select().from(schema.werewolfTurns).where(eq(schema.werewolfTurns.gameId, game.id));
    expect(savedPlans.filter((plan) => plan.request.action === action && plan.sequence > start.sequence).map((plan) => plan.sequence).toSorted()).toEqual(plans.map((plan) => plan.sequence).toSorted());

    await releaseWerewolfOwner(db, game.id, claim.claim.ownerEpoch);
    const replacement = await claimWerewolfGame(db, game.id);
    if (!replacement.ok) throw new Error(replacement.error);
    await expect(advanceWerewolf(store, scripted)).rejects.toThrow("stale");
    const resumedStore = createWerewolfStore(db, game.id, replacement.claim.ownerEpoch);
    const sealed = await advanceWerewolf(resumedStore, agent(replacement.claim.ownerEpoch));
    expect(sealed.actions).toHaveLength(start.actions.length + plans.length);
    expect(dispatches).toBe(plans.length);
    expect(await readWerewolfView(db, game.id, "mystery")).toEqual(beforeMystery);
    await advanceWerewolf(resumedStore, scripted);
    const after = await readWerewolfView(db, game.id, audience);
    expect(after.cursor).toBe(before.cursor + 1);
    const reveal = after.entries.at(-1);
    expect(reveal?.kind === (action === "vote" ? "vote" : "pack_vote") && (reveal.kind === "vote" || reveal.kind === "pack_vote") ? reveal.result.ballots.length : 0).toBe(plans.length);
    if (action === "attack") expect(await readWerewolfView(db, game.id, "mystery")).toEqual(beforeMystery);
    expect((await readWerewolfLiveView(db, game.id, audience, true)).voteProgress).toBeNull();
    expect(JSON.stringify(after)).not.toContain("PRIVATE_THINKING");
    expect(await readWerewolfView(db, game.id, audience, before.cursor)).toEqual(before);
    expect(await readWerewolfView(db, game.id, audience, after.cursor)).toEqual(after);
    const attempts = await db.select().from(schema.providerCallAttempts);
    expect(attempts.filter((attempt) => attempt.outcomeKind === "usable")).toHaveLength(plans.length);
    if (finalVote) {
      expect(reveal).toMatchObject({ kind: "vote", result: { voteMode: "plurality", requiredVotes: null, eliminatedId: null, dayEnded: true } });
      expect(nextWerewolfStep(replayWerewolf(await store.read()))).toMatchObject({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: "pack" } } });
    }
    if (action === "vote" && !finalVote) {
      let next = await advanceWerewolf(resumedStore, scripted);
      while (next.phase !== "vote") next = await advanceWerewolf(resumedStore, scripted);
      expect((await readWerewolfLiveView(db, game.id, audience, true)).voteProgress).toMatchObject({ thread: 2, ready: 0, total: plans.length });
    }
  });
});
