import { expect, test } from "bun:test";
import OpenAI from "openai";
import { createProviderAdapter } from "../provider-adapters";
import { ProviderUnavailableError } from "../provider-execution";
import { modelCatalogEntryById } from "../model-catalog";
import type { LlmProviderRuntime } from "../llm-client";
import { exactStructuredOutputRegistry } from "../structured-output";
import { fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective } from "../fixtures/retrospective-agent";
import { completedCurrentWerewolfFixture } from "../fixtures/werewolf-results";
import { WerewolfModelAgent, werewolfDecisionArtifact } from "../werewolf/agent";
import { advanceWerewolf, werewolfFallback, type WerewolfAgent } from "../werewolf/runner";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, validateWerewolfAction, werewolfActionPlans, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { werewolfThinkingActions } from "../werewolf/thinking";
import { projectWerewolfWatch } from "../werewolf/watch";
import { compileWerewolfRetrospective } from "../werewolf/retrospective";
import type { WerewolfDecision, WerewolfEvent } from "../werewolf/types";

function setup(version: 10 | 11 = 11) {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Careful", backstory: "", strategy: "", avatarUrl: null }));
  const events = [startWerewolf("priority-test", players, { ...werewolfConfig("one_wolf", 3), rulesVersion: version }, "priority-seed")];
  const state = () => replayWerewolf(events);
  const store = { read: async () => structuredClone(events), append: async (event: WerewolfEvent) => { applyWerewolfEvent(state(), event); events.push(event); } };
  function accept(decision?: WerewolfDecision) {
    const s = state(), step = nextWerewolfStep(s);
    if (step.kind === "complete") throw new Error("Unexpected completion");
    if (step.kind === "event") events.push(werewolfEvent(s, step.event));
    else {
      if (!decision) {
        if ("solo" in step.request && step.request.solo) {
          const targetId = step.request.legalTargetIds.find(id => s.roles[id] === (step.request.action === "investigate" ? "werewolf" : step.request.action === "protect" ? "seer" : "villager"))!;
          decision = { kind: "solo_target", targetId, text: "My night choice.", cue: null };
        } else decision = werewolfFallback(s, step.request);
      }
      events.push(werewolfEvent(s, { type: "werewolf.action_accepted", payload: { ...step.request, decision, fallback: null } }));
    }
    return state();
  }
  for (let i = 0; state().phase !== "day" && i < 50; i++) accept();
  expect(state().phase).toBe("day");
  return { events, state, store, accept };
}
const agentWith = (decide: WerewolfAgent["decide"]): WerewolfAgent => ({ prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, getRetrospectiveStatement: fixtureWerewolfRetrospective, decide });

test("v11 gathers private priorities concurrently and lets the Seer with a wolf read speak first", async () => {
  const game = setup(), before = game.state(), plans = werewolfActionPlans(before);
  const seer = before.aliveIds.find(id => before.roles[id] === "seer")!;
  expect(observeWerewolf(before, seer).investigations).toMatchObject([{ isWolf: true }]);
  expect(plans).toHaveLength(before.aliveIds.length);
  const gate = Promise.withResolvers<void>(), allStarted = Promise.withResolvers<void>();
  const started: string[] = [];
  const run = advanceWerewolf(game.store, agentWith(async ({ request, observation }) => {
    expect(request.action).toBe("speaking_priority");
    expect(observation).toEqual(observeWerewolf(before, request.actorId));
    started.push(request.actorId);
    if (started.length === plans.length) allStarted.resolve();
    await gate.promise;
    return { kind: "speaking_priority", priority: request.actorId === seer ? 95 : 50 };
  }));
  await allStarted.promise;
  expect(game.state()).toEqual(before);
  gate.resolve();
  const after = await run;
  expect(after.conversation!.order).toEqual([seer, ...before.conversation!.order.filter(id => id !== seer)]);
  expect(nextWerewolfStep(after)).toMatchObject({ kind: "action", request: { action: "conversation", actorId: seer } });
  expect(after.history).toEqual(before.history);
  expect(after.conversation!.remainingBytes).toBe(before.conversation!.remainingBytes);
  for (const id of before.aliveIds) expect(observeWerewolf(after, id)).toEqual(observeWerewolf(before, id));
  expect(werewolfThinkingActions(game.events, 10000).some(item => item.event.payload.action === "speaking_priority")).toBe(false);
  for (const audience of ["mystery", "omniscient"] as const) {
    expect(projectWerewolfView(after, audience).entries).toEqual(projectWerewolfView(before, audience).entries);
    expect(projectWerewolfWatch(game.events, audience).moments).toEqual(projectWerewolfWatch(game.events.slice(0, -plans.length), audience).moments);
  }
  const receiver = after.conversation!.order.at(-1)!;
  game.accept({ kind: "conversation", text: "I found a wolf.", cue: null, recipientId: receiver, replyToContributionId: null });
  expect(nextWerewolfStep(game.state())).toMatchObject({ request: { actorId: receiver } });
}, 5000);

test("priority prefixes recover stable slots without exposing previous scores, and ties preserve seeded order", () => {
  const game = setup(), before = game.state(), plans = werewolfActionPlans(before);
  for (let i = 0; i < plans.length; i++) {
    expect(werewolfActionPlans(game.state())).toEqual(plans.slice(i));
    const plan = plans[i]!;
    expect(observeWerewolf(game.state(), plan.request.actorId)).toEqual(observeWerewolf(before, plan.request.actorId));
    game.accept({ kind: "speaking_priority", priority: 75 });
    expect(replayWerewolf(structuredClone(game.events))).toEqual(game.state());
  }
  expect(game.state().conversation!.order).toEqual(before.conversation!.order);
  expect(() => game.accept({ kind: "speaking_priority", priority: 99 })).toThrow();
});

test("new priorities are requested for surviving players every day; v10 has no survey", () => {
  const game = setup();
  for (const _plan of werewolfActionPlans(game.state())) game.accept({ kind: "speaking_priority", priority: 50 });
  for (let i = 0; !(game.state().day === 2 && game.state().phase === "day") && i < 100; i++) {
    const step = nextWerewolfStep(game.state());
    game.accept(step.kind === "action" && step.request.action === "public_vote"
      ? { kind: "spoken_target", targetId: null, thinking: "Listen.", text: null, cue: null } : undefined);
  }
  const day2 = game.state();
  expect(day2.day).toBe(2);
  expect(day2.actions).toEqual([]);
  expect(werewolfActionPlans(day2).map(plan => plan.request.actorId).sort()).toEqual([...day2.aliveIds].sort());
  expect(werewolfActionPlans(day2).every(plan => plan.request.action === "speaking_priority")).toBe(true);
  expect(nextWerewolfStep(setup(10).state())).toMatchObject({ request: { action: "conversation" } });
});

test("priority schema rejects malformed output, out-of-range numbers and extra speech/thinking", () => {
  const request = { actorId: "p0", action: "speaking_priority" as const, legalTargetIds: [] };
  const artifact = werewolfDecisionArtifact(request);
  expect(artifact.providerSchema).toMatchObject({ additionalProperties: false, required: ["priority"], properties: { priority: { type: "integer", minimum: 1, maximum: 100 } } });
  expect(artifact.audioDelivery).toBeUndefined();
  for (const value of [1, 75, 100]) {
    const decision = { kind: "speaking_priority", priority: value };
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ priority: value }))).toMatchObject({ status: "valid", value: decision });
    expect(exactStructuredOutputRegistry.decodeAcceptedValue(artifact, decision).status).toBe("valid");
  }
  for (const value of [0, 101, 1.5, "75", null]) {
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ priority: value })).status).toBe("invalid");
    expect(exactStructuredOutputRegistry.decodeAcceptedValue(artifact, { kind: "speaking_priority", priority: value }).status).toBe("invalid");
  }
  for (const text of ["75", "not json", "{}", 'prefix {"priority":75', '{"priority":75} {"priority":90}', '{"priority":75,"thinking":"urgent"}', '{"priority":75,"text":"wolf"}']) {
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, text).status).toBe("invalid");
  }
  expect(() => validateWerewolfAction(request, { ...request, decision: { kind: "speaking_priority", priority: 50 }, fallback: "provider_unavailable" })).toThrow();
});

test("unavailable priority uses marked minimum without inventing speech or blocking the day", async () => {
  const game = setup();
  const after = await advanceWerewolf(game.store, agentWith(async () => { throw new ProviderUnavailableError("Attempts exhausted", "malformed_output"); }));
  expect(after.actions.every(action => action.fallback === "provider_unavailable" && action.decision.kind === "speaking_priority" && action.decision.priority === 1)).toBe(true);
  expect(nextWerewolfStep(after)).toMatchObject({ request: { action: "conversation" } });
});

test.each([false, true])("priority model call is routed and silent; malformed retries exhaust=%s", async exhaust => {
  const game = setup(), before = game.state(), plan = werewolfActionPlans(before)[0]!;
  let calls = 0;
  const client = new OpenAI({ apiKey: "fixture", baseURL: "http://fixture.invalid/v1", maxRetries: 0, fetch: async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    expect(body.response_format.json_schema.schema.required).toEqual(["priority"]);
    expect(body.messages[0].content).toContain("fresh actionable investigation");
    expect(body.messages[0].content).not.toContain("2–4 short sentences");
    expect(body.messages[0].content).not.toContain("<higher-pitch>");
    expect(game.state()).toEqual(before);
    return Response.json({ id: `priority-${calls}`, object: "chat.completion", created: 0, model: "glm-5-2",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: exhaust || calls === 1 ? '{"priority":101}' : '{"priority":75}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  } });
  const model = modelCatalogEntryById("katana:glm-5-2")!;
  const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id, providerProfileId: "katana", modelId: model.modelId, modelCapabilities: model.capabilities, reasoningPolicy: "medium", position: 0, role: "primary" };
  const routed: string[] = [];
  const agent = new WerewolfModelAgent({ runtimes: [runtime], runtimesForActor: id => { routed.push(id); return [runtime]; } });
  const result = agent.decide({ gameId: before.gameId, actionSlot: plan.sequence, request: plan.request, observation: observeWerewolf(before, plan.request.actorId) });
  if (exhaust) await expect(result).rejects.toBeInstanceOf(ProviderUnavailableError);
  else expect(await result).toEqual({ kind: "speaking_priority", priority: 75 });
  expect(calls).toBe(exhaust ? 3 : 2);
  expect(game.state()).toEqual(before);
  expect(routed).toEqual([plan.request.actorId]);
});

test("completed v11 replay retains private priority events without putting them in retrospective context", async () => {
  const events = await completedCurrentWerewolfFixture("priority-complete", 11);
  expect(events.some(event => event.type === "werewolf.action_accepted" && event.payload.action === "speaking_priority")).toBe(true);
  const context = compileWerewolfRetrospective(events);
  expect(JSON.stringify(context.input)).not.toContain("speaking_priority");
  expect(replayWerewolf(events).outcome).not.toBeNull();
});
